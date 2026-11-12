const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const Task = require('../models/Task');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const User = require('../models/User');
const { scopeFilter } = require('../middleware/scope');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');
const { LEAD_SOURCES } = require('../config/constants');
const Setting = require('../models/Setting');
const stagesCfg = require('../helpers/leadStages');
const automation = require('../helpers/leadAutomation');
const Counter = require('../models/Counter');
const { buildFilter, buildOptions, paginate } = require('../helpers/query');

/**
 * The leads this person may see and work: the ones their role's reach
 * covers, and any lead somebody has given them a task on. A follow-up sent
 * to a colleague used to point at a lead they could not open — no number,
 * no history, no way to move its status. Deleting still goes by the role.
 */
async function leadScope(req) {
  const own = scopeFilter(req, 'owner');
  if (!Object.keys(own).length) return {};
  const viaTasks = await Task.distinct('lead', { owner: req.user._id, lead: { $ne: null } });
  if (!viaTasks.length) return own;
  return { $and: [{ $or: [own, { _id: { $in: viaTasks } }] }] };
}

const base = crud(Lead, {
  name: 'Lead',
  searchable: ['name', 'phone', 'email', 'destination', 'code'],
  populate: { path: 'owner', select: 'name code' },
  ownerField: 'owner',
  // A lead typed in runs the New lead rules (and Lead assigned, if it came with an owner).
  afterCreate: async (doc, req) => {
    await automation.fire('New lead', [doc], req);
    if (req.body?.owner) await automation.fire('Lead assigned', [doc], req);
  },
});

const POPULATE = { path: 'owner', select: 'name code' };

exports.list = catchAsync(async (req, res) => {
  const filter = { ...buildFilter(req.query, { searchable: ['name', 'phone', 'email', 'destination', 'code'] }), ...(await leadScope(req)) };
  const options = buildOptions(req.query, { defaultSort: '-createdAt' });
  const result = await paginate(Lead, filter, options, { populate: POPULATE });
  res.json({ success: true, ...result });
});

/** GET /leads/given-today?ids=a,b,c — leads each person was given today. */
exports.givenToday = catchAsync(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter((s) => /^[a-f0-9]{24}$/i.test(s)).slice(0, 50);
  const counts = ids.length ? await Lead.givenSince(ids) : {};
  res.json({ success: true, data: counts });
});

exports.getOne = catchAsync(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...(await leadScope(req)) }).populate(POPULATE);
  if (!lead) throw ApiError.notFound('Lead not found');
  res.json({ success: true, data: lead });
});
exports.create = base.create;

/**
 * Many leads at once, from a spreadsheet.
 *
 * Every row needs a name and a phone; a row without either is reported
 * back, not guessed at. A number already in Sales & Leads, or seen earlier
 * in the same file, is skipped, so importing the same sheet twice adds
 * nothing the second time. Codes are reserved as one block, because
 * minting them one by one is too slow for a sheet of a thousand.
 */
const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const prettyPhone = (v) => {
  const d = String(v || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : String(v).trim();
};
const text = (v, max = 300) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));

exports.importLeads = catchAsync(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) throw ApiError.badRequest('There are no rows to import');

  const existing = await Lead.find({}, { phone: 1 }).lean();
  const seen = new Set(existing.map((l) => tenDigits(l.phone)).filter(Boolean));

  const skipped = [];
  const LEAD_STAGES = await stagesCfg.leadStages();
  const docs = [];
  rows.forEach((r, i) => {
    const row = i + 2; // the sheet's own row number, under its header
    const name = text(r.name, 120);
    const phone = text(r.phone, 40);
    if (!name || !phone) {
      skipped.push({ row, name, reason: !name ? 'No name' : 'No phone' });
      return;
    }
    const key = tenDigits(phone);
    if (key && seen.has(key)) {
      skipped.push({ row, name, reason: 'Phone already in Sales & Leads' });
      return;
    }
    if (key) seen.add(key);

    const when = r.travelDate ? new Date(r.travelDate) : null;
    docs.push({
      name,
      phone: prettyPhone(phone),
      ...(text(r.email) ? { email: text(r.email, 160).toLowerCase() } : {}),
      ...(text(r.destination) ? { destination: text(r.destination, 120) } : {}),
      ...(Number(r.pax) > 0 ? { pax: Number(r.pax) } : {}),
      ...(Number(r.budget) > 0 ? { budget: Number(r.budget) } : {}),
      ...(when && !Number.isNaN(when.getTime()) ? { travelDate: when } : {}),
      source: LEAD_SOURCES.includes(r.source) ? r.source : 'Calling data',
      status: LEAD_STAGES.includes(r.status) ? r.status : 'New',
      ...(text(r.campaign) ? { campaign: text(r.campaign, 80) } : {}),
      ...(text(r.label) ? { label: text(r.label, 60) } : {}),
      ...(text(r.notes) ? { notes: text(r.notes, 4000) } : {}),
      tags: [...new Set(['Imported', ...(Array.isArray(r.tags) ? r.tags.map((t) => text(t, 40)).filter(Boolean) : [])])],
      createdBy: req.user?._id,
    });
  });

  let added = [];
  if (docs.length) {
    // One block of codes for the lot: LEAD-3079 … LEAD-3200.
    const counter = await Counter.findOneAndUpdate(
      { _id: 'LEAD' },
      { $inc: { seq: docs.length }, $setOnInsert: { start: 2000 } },
      { new: true, upsert: true }
    );
    const first = (counter.seq || 0) - docs.length + 1 + (counter.start || 2000);
    docs.forEach((d, i) => { d.code = `LEAD-${String(first + i).padStart(4, '0')}`; });
    added = await Lead.insertMany(docs, { ordered: false });
    await record(req, 'create', 'Lead', added.map((l) => l._id).join(','), `Imported ${added.length} lead(s)`);
    await automation.fire('New lead', added, req);
  }

  res.status(201).json({
    success: true,
    data: {
      added: added.length,
      first: added[0]?.code || null,
      last: added[added.length - 1]?.code || null,
      skipped,
    },
  });
});
/**
 * One lead edited. A change of status or owner runs the automation rules
 * for it, and the lead is sent back as the rules left it.
 */
exports.update = catchAsync(async (req, res) => {
  const where = { _id: req.params.id, ...(await leadScope(req)) };
  const before = await Lead.findOne(where).select('status owner').lean();
  if (!before) throw ApiError.notFound('Lead not found');
  const { code, ...payload } = req.body || {};
  let doc = await Lead.findOneAndUpdate(where, { ...payload, updatedBy: req.user?._id }, { new: true, runValidators: true });
  if (!doc) throw ApiError.notFound('Lead not found');
  await record(req, 'update', 'Lead', doc._id, `Updated ${doc.code || doc.name}`);

  let automated = [];
  if (payload.status && payload.status !== before.status) automated.push(...(await automation.fire('Lead status changed', [doc], req)));
  if (payload.owner && String(payload.owner) !== String(before.owner || '')) automated.push(...(await automation.fire('Lead assigned', [doc], req)));
  if (automated.length) doc = await Lead.findById(doc._id);
  await doc.populate({ path: 'owner', select: 'name code' });
  res.json({ success: true, data: doc, automated: [...new Set(automated)] });
});
exports.remove = base.remove;

/** Moving a lead along, with the reason if it is being lost. */
exports.moveStage = catchAsync(async (req, res) => {
  const { status, lostReason, note } = req.body;
  const LEAD_STAGES = await stagesCfg.leadStages();
  if (!LEAD_STAGES.includes(status)) throw ApiError.badRequest(`status has to be one of: ${LEAD_STAGES.join(', ')}`);
  if (status === 'Lost' && !lostReason) throw ApiError.badRequest('A lost lead needs a reason');

  const lead = await Lead.findOne({ _id: req.params.id, ...(await leadScope(req)) });
  if (!lead) throw ApiError.notFound('Lead not found');

  const from = lead.status;
  lead.status = status;
  if (lostReason) lead.lostReason = lostReason;
  lead.activities.push({
    kind: 'status',
    text: note || `Moved from ${from} to ${status}`,
    by: req.user._id,
    byName: req.user.name,
  });
  await lead.save();

  await record(req, 'update', 'Lead', lead._id, `${lead.code}: ${from} → ${status}`);
  const automated = from !== status ? await automation.fire('Lead status changed', [lead], req) : [];
  res.json({ success: true, data: automated.length ? await Lead.findById(lead._id) : lead, automated });
});

/** A call, a message, a note — whatever just happened on this lead. */
exports.addActivity = catchAsync(async (req, res) => {
  const { kind = 'note', text } = req.body;
  if (!text) throw ApiError.badRequest('Say what happened');

  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, ...(await leadScope(req)) },
    {
      $push: { activities: { kind, text, by: req.user._id, byName: req.user.name } },
      lastContactAt: new Date(),
    },
    { new: true }
  );
  if (!lead) throw ApiError.notFound('Lead not found');
  res.json({ success: true, data: lead });
});

/** Handing leads over, one or many at a time. */
exports.assign = catchAsync(async (req, res) => {
  const { ids = [], owner } = req.body;
  if (!owner) throw ApiError.badRequest('Say who they are going to');
  const list = ids.length ? ids : [req.params.id].filter(Boolean);
  if (!list.length) throw ApiError.badRequest('Pick at least one lead');

  // Handing work to somebody who does not exist would orphan it.
  const target = await User.findById(owner).select('_id');
  if (!target) throw ApiError.badRequest('That team member does not exist');

  const result = await Lead.updateMany(
    { _id: { $in: list }, ...(await leadScope(req)) },
    { owner, $push: { activities: { kind: 'status', text: 'Reassigned', byName: req.user.name } } }
  );

  await record(req, 'assign', 'Lead', list.join(','), `${result.modifiedCount} lead(s) reassigned`);
  const automated = await automation.fire('Lead assigned', list, req);
  res.json({ success: true, data: { moved: result.modifiedCount }, automated });
});

/** Won means a member exists — so make one if there is not already. */
exports.convert = catchAsync(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...(await leadScope(req)) });
  if (!lead) throw ApiError.notFound('Lead not found');
  if (lead.convertedCustomer) throw ApiError.conflict('That lead is already a member');

  let customer = await Customer.findOne({ phone: lead.phone });
  if (!customer) {
    customer = await Customer.create({
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      source: lead.source,
      branch: lead.branch,
      expert: lead.owner,
      createdBy: req.user._id,
    });
  }

  lead.status = 'Won';
  lead.convertedCustomer = customer._id;
  lead.convertedAt = new Date();
  lead.activities.push({ kind: 'status', text: `Converted to ${customer.code}`, byName: req.user.name });
  await lead.save();

  await record(req, 'convert', 'Lead', lead._id, `${lead.code} became ${customer.code}`);
  res.json({ success: true, data: { lead, customer } });
});

/**
 * The funnel: how many sit at each stage, what they are worth, how much
 * carries to the next stage and how long they have been sitting there.
 */
exports.funnel = catchAsync(async (req, res) => {
  const rows = await Lead.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        value: { $sum: '$budget' },
        avgAgeDays: {
          $avg: { $divide: [{ $subtract: [new Date(), { $ifNull: ['$stageChangedAt', '$createdAt'] }] }, 86400000] },
        },
      },
    },
  ]);

  const at = (stage) => rows.find((r) => r._id === stage) || { count: 0, value: 0, avgAgeDays: 0 };
  const total = rows.reduce((s, r) => s + r.count, 0);

  const LEAD_STAGES = await stagesCfg.leadStages();
  const funnel = LEAD_STAGES.filter((s) => s !== 'Lost').map((stage, i, all) => {
    const here = at(stage);
    const before = i === 0 ? null : at(all[i - 1]).count;
    const carried = before ? Math.round((here.count / before) * 100) : null;
    return {
      stage,
      count: here.count,
      value: here.value,
      share: total ? Math.round((here.count / total) * 100) : 0,
      carriedFromLast: carried,
      dropOff: carried == null ? null : Math.max(0, 100 - carried),
      avgDaysInStage: Math.round(here.avgAgeDays || 0),
    };
  });

  res.json({ success: true, data: { total, funnel, lost: at('Lost') } });
});

/** Why leads are lost, and what walked away with them. */
exports.lostAnalysis = catchAsync(async (req, res) => {
  const by = ['lostReason', 'owner', 'source', 'destination'].includes(req.query.by) ? req.query.by : 'lostReason';

  const rows = await Lead.aggregate([
    { $match: { status: 'Lost' } },
    { $group: { _id: `$${by}`, count: { $sum: 1 }, value: { $sum: '$budget' } } },
    { $sort: { count: -1 } },
  ]);

  res.json({ success: true, data: rows.map((r) => ({ label: r._id || 'Not given', count: r.count, value: r.value })) });
});

/** What each channel brings, and what it converts at. */
exports.bySource = catchAsync(async (req, res) => {
  const rows = await Lead.aggregate([
    {
      $group: {
        _id: '$source',
        leads: { $sum: 1 },
        won: { $sum: { $cond: [{ $eq: ['$status', 'Won'] }, 1, 0] } },
        revenue: { $sum: { $cond: [{ $eq: ['$status', 'Won'] }, '$budget', 0] } },
      },
    },
    { $sort: { leads: -1 } },
  ]);

  res.json({
    success: true,
    data: rows.map((r) => ({
      source: r._id || 'Unknown',
      leads: r.leads,
      won: r.won,
      revenue: r.revenue,
      conversion: r.leads ? Math.round((r.won / r.leads) * 100) : 0,
    })),
  });
});

/** Everything due today, plus anything already late. */
exports.today = catchAsync(async (req, res) => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const filter = { nextFollowUpAt: { $lte: end }, status: { $nin: ['Won', 'Lost'] } };
  if ((req.user.role?.scope || 'own') === 'own') filter.owner = req.user._id;

  const leads = await Lead.find(filter).sort('nextFollowUpAt').populate('owner', 'name').lean();
  const now = new Date();

  res.json({
    success: true,
    data: {
      due: leads.filter((l) => l.nextFollowUpAt >= now),
      overdue: leads.filter((l) => l.nextFollowUpAt < now),
    },
  });
});

/**
 * One change to many leads, in one request: a stage, a source, a follow-up,
 * an owner, or a folder to file them in or take them out of.
 *
 * The panel used to send one request per lead, which was fine for ten and
 * hung the browser for ten thousand. Only the fields a bulk action sets are
 * accepted, so this cannot be used to overwrite a lead's name or phone.
 */
const BULK_FIELDS = ['status', 'source', 'priority', 'label', 'campaign', 'lostReason', 'nextFollowUpAt', 'lastContactAt', 'owner'];

exports.bulkUpdate = catchAsync(async (req, res) => {
  const { ids = [], set = {}, addTag, removeTag } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) throw ApiError.badRequest('Pick at least one lead');

  const fields = {};
  BULK_FIELDS.forEach((k) => {
    if (set[k] !== undefined) fields[k] = set[k];
  });
  if (fields.status && !(await stagesCfg.leadStages()).includes(fields.status)) throw ApiError.badRequest('That stage does not exist');
  if (fields.source && !LEAD_SOURCES.includes(fields.source)) throw ApiError.badRequest('That source does not exist');
  if (fields.owner && !(await User.exists({ _id: fields.owner }))) throw ApiError.badRequest('That team member does not exist');
  if (!Object.keys(fields).length && !addTag && !removeTag) throw ApiError.badRequest('Nothing to change');

  const where = { _id: { $in: ids }, ...(await leadScope(req)) };
  let changed = 0;
  // A tag cannot be pulled and added in the same update, so a move is two.
  if (removeTag) {
    const r = await Lead.updateMany(where, { $pull: { tags: text(removeTag, 40) } });
    changed = Math.max(changed, r.modifiedCount);
  }
  if (Object.keys(fields).length || addTag) {
    const r = await Lead.updateMany(where, {
      ...(Object.keys(fields).length ? { $set: { ...fields, updatedBy: req.user?._id } } : {}),
      ...(addTag ? { $addToSet: { tags: text(addTag, 40) } } : {}),
    });
    changed = Math.max(changed, r.modifiedCount);
  }

  await record(req, 'update', 'Lead', `${ids.length} lead(s)`, `Bulk change on ${changed} lead(s)`);

  // The rules for what changed, on the leads this person could change.
  let automated = [];
  if (fields.status || fields.owner) {
    const mine = (await Lead.find(where).select('_id').lean()).map((l) => l._id);
    if (fields.status) automated.push(...(await automation.fire('Lead status changed', mine, req)));
    if (fields.owner) automated.push(...(await automation.fire('Lead assigned', mine, req)));
  }
  res.json({ success: true, data: { changed }, automated: [...new Set(automated)] });
});

/** Many leads deleted in one request — for clearing out a bad import. */
exports.bulkDelete = catchAsync(async (req, res) => {
  const { ids = [] } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) throw ApiError.badRequest('Pick at least one lead');
  const result = await Lead.deleteMany({ _id: { $in: ids }, ...scopeFilter(req, 'owner') });
  // Their open tasks would point at nothing.
  await Task.updateMany({ lead: { $in: ids } }, { $unset: { lead: 1 } }).catch(() => {});
  await record(req, 'delete', 'Lead', `${ids.length} lead(s)`, `Bulk deleted ${result.deletedCount} lead(s)`);
  res.json({ success: true, data: { deleted: result.deletedCount } });
});

/** The stage list, in order. */
exports.stages = catchAsync(async (req, res) => {
  res.json({ success: true, data: await stagesCfg.leadStages() });
});

/**
 * Save the stage list from Move stage → Customize.
 *
 * `renames` carries the stages whose name changed, so their leads move with
 * them. A stage taken out of the list while leads still sit in it is
 * refused, rather than leaving those leads in a stage nobody can pick.
 */
exports.saveStages = catchAsync(async (req, res) => {
  const { stages, renames = [] } = req.body || {};
  const next = stagesCfg.withFixed(stages);
  if (next.length < 3) throw ApiError.badRequest('Add at least one stage');

  const moves = (Array.isArray(renames) ? renames : [])
    .map((r) => ({ from: text(r?.from, 40), to: text(r?.to, 40) }))
    .filter((r) => r.from && r.to && r.from !== r.to && !stagesCfg.FIXED.includes(r.from) && next.includes(r.to));

  const before = await stagesCfg.leadStages();
  const renamed = new Set(moves.map((m) => m.from));
  const dropped = before.filter((s) => !next.includes(s) && !renamed.has(s));
  for (const s of dropped) {
    const n = await Lead.countDocuments({ status: s });
    if (n) throw ApiError.badRequest(`"${s}" still has ${n} lead(s) — move them to another stage before removing it`);
  }

  let moved = 0;
  for (const m of moves) {
    const r = await Lead.updateMany({ status: m.from }, { $set: { status: m.to } });
    moved += r.modifiedCount;
  }

  await Setting.findOneAndUpdate(
    { key: stagesCfg.KEY },
    { value: next, updatedBy: req.user?._id },
    { upsert: true, setDefaultsOnInsert: true },
  );
  await record(req, 'update', 'Setting', null, `Lead stages: ${next.join(' → ')}`);
  res.json({ success: true, data: next, moved });
});
