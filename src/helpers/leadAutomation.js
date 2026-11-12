const AutomationRule = require('../models/AutomationRule');
const Lead = require('../models/Lead');
const Task = require('../models/Task');
const User = require('../models/User');
const { record } = require('./audit');

/**
 * The lead automation engine.
 *
 * Rules are made on the Automation page → Lead rules: WHEN a lead is added,
 * assigned or moved to a status, IF it matches (status, person, source),
 * THEN move its status, assign it, add a task, file it in a folder or send
 * it a WhatsApp. Every place a lead changes calls `fire` afterwards.
 *
 * One pass only: what a rule does does not set off more rules, so two rules
 * pointing at each other cannot loop. Each run is written to the audit log
 * against the rule, which is what Automation → History shows. A rule that
 * fails is counted and logged; it never fails the change that set it off.
 */
const EVENTS = ['New lead', 'Lead assigned', 'Lead status changed'];
const TASK_TYPES = ['Call', 'Follow-up', 'WhatsApp', 'Presentation', 'Customer Visit', 'Payment Follow-up', 'Booking Follow-up'];
const firstName = (s) => String(s || '').split(' ')[0];

function matches(rule, lead) {
  const m = rule.match || {};
  if (m.status && lead.status !== m.status) return false;
  if (m.owner && String(lead.owner?._id || lead.owner || '') !== String(m.owner)) return false;
  if (m.source && lead.source !== m.source) return false;
  return true;
}

async function sendWhatsApp(leads, text) {
  try {
    const wa = require('./openwa');
    const session = await wa.findSession();
    if (!session || session.status !== 'ready') return 0;
    let sent = 0;
    // Paced, and capped, so a big bulk change cannot flood the number.
    for (const lead of leads.slice(0, 50)) {
      if (!lead.phone) continue;
      const body = String(text).replace(/\{name\}/g, firstName(lead.name)).slice(0, 4096);
      await wa.call(`/sessions/${session.id}/messages/send-text`, {
        method: 'POST',
        body: { chatId: wa.chatIdFor(lead.phone), text: body },
      }).then(() => { sent += 1; }).catch(() => {});
      await new Promise((r) => setTimeout(r, 2500));
    }
    return sent;
  } catch {
    return 0;
  }
}

/** Do one rule's steps to the leads it matched. Returns what it did, in words. */
async function apply(rule, leads, req) {
  const ids = leads.map((l) => l._id);
  const done = [];
  const note = (text) => ({ kind: 'status', text: `Automation · ${rule.name}: ${text}`, byName: 'Automation', at: new Date() });
  // Who each lead belongs to after this rule, for tasks made in the same rule.
  const ownerOf = new Map(leads.map((l) => [String(l._id), l.owner?._id || l.owner || null]));

  for (const step of rule.steps || []) {
    if (step.type === 'Move status' && step.value) {
      await Lead.updateMany(
        { _id: { $in: ids } },
        { $set: { status: step.value, stageChangedAt: new Date(), ...(step.value === 'Lost' ? { lostAt: new Date() } : {}) }, $push: { activities: note(`moved to ${step.value}`) } }
      );
      done.push(`moved to ${step.value}`);
    }

    if (step.type === 'Assign to' && step.value) {
      // One person, or several taking turns.
      const people = (Array.isArray(step.value) ? step.value : [step.value]).filter(Boolean);
      const users = await User.find({ _id: { $in: people }, status: { $ne: 'Inactive' } }).select('name').lean();
      if (!users.length) continue;
      const turns = people.map((id) => users.find((u) => String(u._id) === String(id))).filter(Boolean);
      /*
       * Taking turns, fairly: each lead goes to whoever has been given the
       * fewest leads today — counting the ones given by hand, by import and
       * by any rule, not just this one. It used to start from the first
       * name every time, so one new lead at a time all went to one person.
       */
      const given = await Lead.givenSince(turns.map((u) => u._id));
      // The most one person is given in a day; once everyone has it, the
      // rest stay where they are.
      const limit = Math.max(0, Math.floor(Number(step.limit) || 0));
      const now = new Date();
      const tally = {};
      let left = 0;
      const ops = [];
      for (const l of leads) {
        const open = limit ? turns.filter((p) => given[String(p._id)] < limit) : turns;
        if (!open.length) { left += 1; continue; }
        const u = open.reduce((best, p) => (given[String(p._id)] < given[String(best._id)] ? p : best), open[0]);
        given[String(u._id)] += 1;
        tally[firstName(u.name)] = (tally[firstName(u.name)] || 0) + 1;
        ownerOf.set(String(l._id), u._id);
        ops.push({ updateOne: { filter: { _id: l._id }, update: { $set: { owner: u._id, assignedAt: now }, $push: { activities: note(`assigned to ${u.name}`) } } } });
      }
      if (ops.length) {
        await Lead.bulkWrite(ops);
        done.push(`assigned to ${Object.entries(tally).map(([n, c]) => `${n} (${c})`).join(', ')}`);
      }
      if (left) done.push(`${left} not assigned — everyone has their ${limit} for today`);
    }

    if (step.type === 'Create task') {
      const v = step.value || {};
      const type = TASK_TYPES.includes(v.type) ? v.type : 'Follow-up';
      const hours = Number(step.dueIn) || 0;
      const dueAt = new Date(Date.now() + hours * 3600 * 1000);
      await Task.insertMany(
        leads.map((l) => ({
          title: String(v.title || `${type} — ${l.name}`).replace(/\{name\}/g, l.name).slice(0, 200),
          type,
          lead: l._id,
          customerName: l.name,
          owner: ownerOf.get(String(l._id)) || undefined,
          dueAt,
          priority: ['High', 'Medium', 'Low'].includes(v.priority) ? v.priority : 'Medium',
          status: 'Pending',
          raisedBy: 'Automation',
          createdByName: `Automation · ${rule.name}`,
        })),
        { ordered: false }
      );
      done.push(`${type} task${hours ? ` due in ${hours >= 24 && hours % 24 === 0 ? `${hours / 24} day(s)` : `${hours} hour(s)`}` : ''}`);
    }

    if (step.type === 'Add to folder' && step.value) {
      const folder = String(step.value).trim().slice(0, 40);
      await Lead.updateMany({ _id: { $in: ids } }, { $addToSet: { tags: folder }, $push: { activities: note(`filed in ${folder}`) } });
      done.push(`filed in ${folder}`);
    }

    if (step.type === 'Send WhatsApp' && step.value) {
      // After the reply — sending is slow and must not hold the change up.
      const list = leads.map((l) => ({ _id: l._id, name: l.name, phone: l.phone }));
      setImmediate(() => sendWhatsApp(list, step.value));
      done.push('WhatsApp sent');
    }
  }
  return done;
}

/**
 * Something happened to these leads: run the rules for it.
 * `leadsOrIds` are lead documents or ids, read after the change.
 * Resolves with the ids of the leads a rule changed.
 */
async function fire(event, leadsOrIds, req) {
  try {
    if (!EVENTS.includes(event) || !leadsOrIds?.length) return [];
    const rules = await AutomationRule.find({ when: event, status: 'On', 'steps.type': { $exists: true, $ne: null } }).lean();
    if (!rules.length) return [];

    const ids = leadsOrIds.map((l) => l?._id || l);
    const leads = await Lead.find({ _id: { $in: ids } }).select('name phone status owner source').lean();
    const touched = new Set();

    for (const rule of rules) {
      const hit = leads.filter((l) => matches(rule, l));
      if (!hit.length) continue;
      try {
        const done = await apply(rule, hit, req);
        hit.forEach((l) => touched.add(String(l._id)));
        await AutomationRule.updateOne(
          { _id: rule._id },
          { $inc: { runs: 1, completed: 1 }, $set: { lastRunAt: new Date() } }
        );
        await record(
          req,
          'run',
          'Automation rule',
          rule._id,
          `${rule.name}: ${hit.length === 1 ? hit[0].name : `${hit.length} leads`} — ${done.join(', ') || 'nothing to do'}`
        );
      } catch (err) {
        await AutomationRule.updateOne({ _id: rule._id }, { $inc: { runs: 1, errorCount: 1 }, $set: { lastRunAt: new Date() } });
        await record(req, 'run', 'Automation rule', rule._id, `${rule.name} failed: ${err.message}`);
      }
    }
    return [...touched];
  } catch (err) {
    console.warn('Lead automation failed:', err.message);
    return [];
  }
}

module.exports = { fire, EVENTS };
