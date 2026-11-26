/**
 * The 6-day follow-up: one approved WhatsApp template a day to every new
 * lead, with nobody pressing anything.
 *
 *   Day 1  Silver Membership & company trust (with image) — as soon as the lead comes in
 *   Day 2  "Claim your gift" — after 8 PM
 *   Day 3  Membership & gift activation steps
 *   Day 4  Customer testimonials
 *   Day 5  Membership activation reminder
 *   Day 6  Website activation steps
 *
 * Which template goes on which day, and at what time, is set on the panel
 * (Automation → 6-day follow-up) and kept in the `followupDrip` setting.
 *
 * Only leads that came in after it was switched on get it — never the leads
 * already in the CRM, and never an import (imports skip the save hook that
 * starts it). It stops by itself when the lead is Won, Lost or Not
 * interested, becomes a customer, has an active membership, or replies STOP.
 */
const Setting = require('../models/Setting');

const KEY = 'followupDrip';
const DAY_MS = 24 * 60 * 60 * 1000;
const IST = 5.5 * 60 * 60 * 1000;
// Nothing goes out at night, whatever a day's time says.
const QUIET_FROM = 21 * 60 + 30; // 9:30 PM
const QUIET_TILL = 9 * 60; // 9:00 AM
const STOP_STAGES = ['Won', 'Lost', 'Not interested'];

const DEFAULTS = {
  enabled: false,
  enabledAt: null,
  days: [
    { day: 1, title: 'Silver Membership & company trust (with image)', template: '', at: '' },
    { day: 2, title: 'Claim your gift', template: '', at: '20:15' },
    { day: 3, title: 'Membership & gift activation', template: '', at: '11:00' },
    { day: 4, title: 'Customer testimonials', template: '', at: '12:00' },
    { day: 5, title: 'Membership activation reminder', template: '', at: '11:00' },
    { day: 6, title: 'Website activation steps', template: '', at: '11:00' },
  ],
};

async function config() {
  const row = await Setting.findOne({ key: KEY }).lean();
  const v = row?.value || {};
  return {
    ...DEFAULTS,
    ...v,
    days: DEFAULTS.days.map((d, i) => ({ ...d, ...(v.days?.[i] || {}), day: d.day, title: d.title })),
  };
}

/** Save from the panel. Switching it on stamps the moment, so only leads after it are followed up. */
async function save(input = {}, userId) {
  const now = await config();
  const enabled = Boolean(input.enabled);
  const next = {
    enabled,
    enabledAt: enabled ? (now.enabled && now.enabledAt ? now.enabledAt : new Date()) : now.enabledAt,
    days: now.days.map((d, i) => {
      const given = input.days?.[i] || {};
      const valid = /^\d{2}:\d{2}$/.test(String(given.at || ''));
      // Day 1 with no time goes as soon as the lead comes in.
      const at = valid ? given.at : d.day === 1 ? '' : d.at || DEFAULTS.days[i].at;
      return { day: d.day, title: d.title, template: String(given.template ?? d.template ?? '').trim(), at };
    }),
  };
  await Setting.findOneAndUpdate({ key: KEY }, { value: next, updatedBy: userId }, { upsert: true });
  return next;
}

// -- Time in India ---------------------------------------------------------------
const istMinutes = (d = new Date()) => {
  const t = new Date(d.getTime() + IST);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};
/** Midnight in India on the day `d` falls on. */
const istMidnight = (d) => new Date(Math.floor((d.getTime() + IST) / DAY_MS) * DAY_MS - IST);
const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const byNumber = (ten) => ({ phone: new RegExp(`${ten.split('').join('\\D*')}$`) });

/** Why this lead should not get any more, or '' to carry on. */
async function reasonToStop(lead) {
  if (STOP_STAGES.includes(lead.status)) return `Lead is ${lead.status}`;
  if (lead.convertedCustomer) return 'Became a customer';
  const ten = tenDigits(lead.phone);
  if (ten.length === 10) {
    const Membership = require('../models/Membership');
    const active = await Membership.exists({ ...byNumber(ten), status: { $in: ['Active', 'Expiring soon'] } });
    if (active) return 'Membership is active';
  }
  return '';
}

let running = false;

/** Send whatever is due now. Runs every few minutes from server.js. */
async function run() {
  if (running) return { sent: 0 };
  running = true;
  try {
    const notify = require('./notify');
    if (!notify.ready()) return { sent: 0 };
    const cfg = await config();
    if (!cfg.enabled || !cfg.enabledAt) return { sent: 0 };
    const nowMin = istMinutes();
    if (nowMin >= QUIET_FROM || nowMin < QUIET_TILL) return { sent: 0 };

    const Lead = require('../models/Lead');
    const now = new Date();
    const due = await Lead.find({
      'drip.nextOn': { $lte: now },
      'drip.done': { $ne: true },
      'drip.startedAt': { $gte: new Date(cfg.enabledAt) },
    })
      .select('name phone status convertedCustomer drip')
      .sort({ 'drip.nextOn': 1 })
      .limit(150)
      .lean();

    let sent = 0;
    for (const lead of due) {
      const n = (lead.drip.day || 0) + 1;
      const step = cfg.days[n - 1];
      if (!step) {
        await Lead.updateOne({ _id: lead._id }, { $set: { 'drip.done': true } });
        continue;
      }
      // Its time of day has not come yet (Day 1 goes as soon as it can).
      if (step.at && nowMin < toMinutes(step.at)) continue;

      const stop = await reasonToStop(lead);
      if (stop) {
        await Lead.updateOne(
          { _id: lead._id },
          {
            $set: { 'drip.done': true, 'drip.stopped': stop },
            $push: { activities: { kind: 'whatsapp', text: `6-day follow-up stopped: ${stop}`, byName: 'Automation' } },
          }
        );
        continue;
      }

      let note;
      if (!step.template) {
        note = `Day ${n} follow-up skipped — no template chosen`;
      } else {
        // eslint-disable-next-line no-await-in-loop
        const ok = await notify.sendNamed(step.template, lead.phone, lead.name);
        note = ok ? `Day ${n} follow-up sent: ${step.title} (${step.template})` : `Day ${n} follow-up NOT sent — WhatsApp refused "${step.template}"`;
        if (ok) sent += 1;
      }
      const last = n >= cfg.days.length;
      await Lead.updateOne(
        { _id: lead._id },
        {
          $set: {
            'drip.day': n,
            'drip.lastAt': now,
            ...(last
              ? { 'drip.done': true }
              : {
                  // Its own day — and never two on one day, even after the server was down.
                  'drip.nextOn': new Date(Math.max(
                    istMidnight(new Date(lead.drip.startedAt)).getTime() + n * DAY_MS,
                    istMidnight(now).getTime() + DAY_MS
                  )),
                }),
          },
          $push: { activities: { kind: 'whatsapp', text: note, byName: 'Automation' } },
        }
      );
    }
    if (sent) console.log(`6-day follow-up: ${sent} message(s) sent`);
    return { sent };
  } finally {
    running = false;
  }
}

/** A customer who replies STOP gets no more of it. */
async function stopIfAsked(phone, text) {
  if (!/^\s*(stop|unsubscribe|no more)\s*[.!]?\s*$/i.test(String(text || ''))) return;
  const ten = tenDigits(phone);
  if (ten.length !== 10) return;
  const Lead = require('../models/Lead');
  await Lead.updateMany(
    { ...byNumber(ten), 'drip.startedAt': { $ne: null }, 'drip.done': { $ne: true } },
    {
      $set: { 'drip.done': true, 'drip.stopped': 'Replied STOP' },
      $push: { activities: { kind: 'whatsapp', text: '6-day follow-up stopped: the customer replied STOP', byName: 'Automation' } },
    }
  );
}

/** For the panel: how many leads are in it, finished and stopped. */
async function counts() {
  const cfg = await config();
  const Lead = require('../models/Lead');
  if (!cfg.enabledAt) return { running: 0, finished: 0, stopped: 0, sentToday: 0 };
  const since = new Date(cfg.enabledAt);
  const today = istMidnight(new Date());
  const [running, finished, stopped, sentToday] = await Promise.all([
    Lead.countDocuments({ 'drip.startedAt': { $gte: since }, 'drip.done': { $ne: true } }),
    Lead.countDocuments({ 'drip.startedAt': { $gte: since }, 'drip.done': true, 'drip.stopped': { $in: [null, ''] } }),
    Lead.countDocuments({ 'drip.startedAt': { $gte: since }, 'drip.stopped': { $nin: [null, ''] } }),
    Lead.countDocuments({ 'drip.startedAt': { $gte: since }, 'drip.lastAt': { $gte: today } }),
  ]);
  return { running, finished, stopped, sentToday };
}

module.exports = { config, save, run, counts, stopIfAsked, DEFAULTS };
