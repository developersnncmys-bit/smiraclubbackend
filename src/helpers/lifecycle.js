/**
 * The WhatsApp messages that go on a date rather than on a click.
 *
 *   membership_activation_reminder  paid, still "Pending activation" a day later (once)
 *   complete_your_profile           active 2+ days, no email / city / date of birth (once)
 *   membership_renewal_reminder     30 days or less before expiry (once)
 *   membership_expired              on the day it expires (once)
 *   check_in                        the morning of check-in
 *   check_out                       the day of check-out
 *   post_checkout_thankyou          the day after check-out
 *   holiday_experience_feedback     two days after check-out
 *   birthday_wishes                 on their birthday, once a year
 *   anniversary_wishes              on their anniversary, once a year
 *
 * Each is sent once per membership / booking / year — what went is stamped
 * on the record (`notices`) — and only inside a short window, so switching
 * this on never sends a backlog for old bookings or long-expired members.
 * Nothing goes out before 9 AM or after 8 PM in India.
 */
const notify = require('./notify');

const DAY = 24 * 60 * 60 * 1000;
const IST = 5.5 * 60 * 60 * 1000;
const istMidnight = (d = new Date()) => new Date(Math.floor((d.getTime() + IST) / DAY) * DAY - IST);
const istHour = (d = new Date()) => new Date(d.getTime() + IST).getUTCHours();
const day = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
const full = (n) => String(n || '').trim() || 'Member';
const placeOf = (b) => b.hotel || b.packageName || b.destination || 'your stay';

let running = false;

async function stamp(Model, id, key) {
  await Model.updateOne({ _id: id }, { $set: { [`notices.${key}`]: new Date() } });
}

/** Memberships: activation, profile, renewal, expiry. */
async function memberships(now, today) {
  const Membership = require('../models/Membership');
  const Customer = require('../models/Customer');
  let sent = 0;
  const take = (q) => Membership.find(q).select('name phone planName expiresOn customer status').limit(100).lean();

  for (const m of await take({
    status: 'Pending activation',
    receivedOn: { $lte: new Date(now - DAY), $gte: new Date(now - 30 * DAY) },
    'notices.activation': null,
  })) {
    if (await notify.send('membership_activation_reminder', m.phone, { customer_name: full(m.name), name: full(m.name) }, { name: m.name })) sent += 1;
    await stamp(Membership, m._id, 'activation');
  }

  for (const m of await take({
    status: 'Active',
    startedOn: { $lte: new Date(now - 2 * DAY), $gte: new Date(now - 30 * DAY) },
    'notices.profile': null,
  })) {
    const c = m.customer ? await Customer.findById(m.customer).select('email city dob').lean() : null;
    if (c && (!c.email || !c.city || !c.dob)) {
      if (await notify.send('complete_your_profile', m.phone, { customer_name: full(m.name) }, { name: m.name })) sent += 1;
    }
    await stamp(Membership, m._id, 'profile');
  }

  for (const m of await take({
    status: { $in: ['Active', 'Expiring soon'] },
    expiresOn: { $gt: now, $lte: new Date(now.getTime() + 30 * DAY) },
    'renewal.stage': { $ne: 'Renewed' },
    'notices.renewal': null,
  })) {
    if (await notify.send('membership_renewal_reminder', m.phone, {
      customer_name: full(m.name), membership_name: m.planName || 'Smira Club', expiry_date: day(m.expiresOn),
    }, { name: m.name })) sent += 1;
    await stamp(Membership, m._id, 'renewal');
  }

  for (const m of await take({
    status: { $nin: ['Cancelled', 'Suspended'] },
    expiresOn: { $lte: now, $gte: new Date(now.getTime() - 3 * DAY) },
    'renewal.stage': { $ne: 'Renewed' },
    'notices.expired': null,
  })) {
    if (await notify.send('membership_expired', m.phone, { customer_name: full(m.name) }, { name: m.name })) sent += 1;
    await stamp(Membership, m._id, 'expired');
  }
  return sent;
}

/** Bookings: check-in, check-out, thank you, feedback. */
async function bookings(now, today) {
  const Booking = require('../models/Booking');
  const Customer = require('../models/Customer');
  const live = { $in: ['Confirmed', 'Part paid', 'Completed', 'Rescheduled'] };
  let sent = 0;
  const steps = [
    // [notice, template, which date, from (days after today's midnight), to, earliest hour]
    ['checkIn', 'check_in', 'checkIn', 0, 1, 9],
    ['checkOut', 'check_out', 'checkOut', 0, 1, 10],
    ['thanks', 'post_checkout_thankyou', 'checkOut', -1, 0, 11],
    ['feedback', 'holiday_experience_feedback', 'checkOut', -3, -1, 12],
  ];
  for (const [notice, template, field, from, to, hour] of steps) {
    if (istHour(now) < hour) continue;
    const list = await Booking.find({
      status: live,
      [field]: { $gte: new Date(today.getTime() + from * DAY), $lt: new Date(today.getTime() + to * DAY) },
      [`notices.${notice}`]: null,
    })
      .select('code customer customerName hotel packageName destination checkIn checkOut departureOn')
      .limit(100)
      .lean();
    for (const b of list) {
      const c = b.customer ? await Customer.findById(b.customer).select('name phone').lean() : null;
      if (c?.phone) {
        const ok = await notify.send(template, c.phone, {
          customer_name: full(c.name || b.customerName),
          booking_id: b.code,
          hotel: placeOf(b),
          check_in_date: day(b.checkIn || b.departureOn),
        }, { name: c.name || b.customerName });
        if (ok) sent += 1;
      }
      await stamp(Booking, b._id, notice);
    }
  }
  return sent;
}

/** Birthdays and anniversaries, once a year each. */
async function wishes(now) {
  if (istHour(now) < 9) return 0;
  const Customer = require('../models/Customer');
  const ist = new Date(now.getTime() + IST);
  const month = ist.getUTCMonth() + 1;
  const date = ist.getUTCDate();
  const year = ist.getUTCFullYear();
  let sent = 0;
  for (const [field, template, key] of [['dob', 'birthday_wishes', 'birthday'], ['anniversary', 'anniversary_wishes', 'anniversary']]) {
    const list = await Customer.find({
      [field]: { $ne: null },
      [`notices.${key}`]: { $ne: year },
      $expr: {
        $and: [
          { $eq: [{ $month: { date: `$${field}`, timezone: 'Asia/Kolkata' } }, month] },
          { $eq: [{ $dayOfMonth: { date: `$${field}`, timezone: 'Asia/Kolkata' } }, date] },
        ],
      },
    })
      .select('name phone')
      .limit(300)
      .lean();
    for (const c of list) {
      if (c.phone && (await notify.send(template, c.phone, { customer_name: full(c.name) }, { name: c.name }))) sent += 1;
      await Customer.updateOne({ _id: c._id }, { $set: { [`notices.${key}`]: year } });
    }
  }
  return sent;
}

/** Everything due now. Runs every 30 minutes from server.js. */
async function run() {
  if (running || !notify.ready()) return { sent: 0 };
  const now = new Date();
  const hour = istHour(now);
  if (hour < 9 || hour >= 20) return { sent: 0 };
  running = true;
  try {
    const today = istMidnight(now);
    let sent = 0;
    sent += await memberships(now, today).catch((e) => { console.error('Membership messages:', e.message); return 0; });
    sent += await bookings(now, today).catch((e) => { console.error('Booking messages:', e.message); return 0; });
    sent += await wishes(now).catch((e) => { console.error('Wishes:', e.message); return 0; });
    if (sent) console.log(`Dated WhatsApp messages: ${sent} sent`);
    return { sent };
  } finally {
    running = false;
  }
}

module.exports = { run };
