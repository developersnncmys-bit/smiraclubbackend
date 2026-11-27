/**
 * Automatic WhatsApp messages to customers (and staff), through AdsEra.
 *
 * Every message is an approved AdsEra template, found by its name, so a
 * template edited or re-created in AdsEra keeps working without a code change.
 * Each one sent is also written into that person's WhatsApp thread in the
 * CRM, so the desk sees what went out.
 *
 * Settings (.env):
 *   WHATSAPP_AUTO=off          stops all automatic messages
 *   WHATSAPP_TEST_TO=9035300961 sends every automatic message to this number
 *                               instead of the customer — for testing
 *
 * Nothing here ever throws into the request that triggered it.
 */
const adsera = require('./adsera');

const off = () => String(process.env.WHATSAPP_AUTO || '').toLowerCase() === 'off';
const testTo = () => String(process.env.WHATSAPP_TEST_TO || '').replace(/\D/g, '');

// -- Templates, by name ----------------------------------------------------------
let cache = { at: 0, byName: new Map() };
async function templateNamed(name) {
  if (Date.now() - cache.at > 10 * 60 * 1000 || !cache.byName.has(name)) {
    const list = await adsera.templates();
    cache = { at: Date.now(), byName: new Map(list.map((t) => [t.name, t])) };
  }
  return cache.byName.get(name) || null;
}

const fill = (body, vars) => String(body || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => (vars[k] != null ? vars[k] : m));

// -- Small formatting helpers ----------------------------------------------------
const day = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
const when = (d) =>
  d
    ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    : '';
const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
const rupees = (n) => Number(n || 0).toLocaleString('en-IN');
const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);

/** Keep the thread in the CRM in step with what went out. */
async function logToThread(phone, name, text, templateName) {
  try {
    const Conversation = require('../models/Conversation');
    const ten = tenDigits(phone);
    if (ten.length !== 10) return;
    const byNumber = { phone: new RegExp(`${ten.split('').join('\\D*')}$`) };
    let c = await Conversation.findOne(byNumber).sort({ lastMessageAt: -1 });
    if (!c) c = new Conversation({ phone: `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`, name: name || ten, source: 'WhatsApp', handledBy: 'Staff' });
    c.messages.push({ from: 'me', text: String(text).slice(0, 4096), templateName, at: new Date() });
    c.lastMessageAt = new Date();
    await c.save();
  } catch {
    /* the message still went out */
  }
}

/**
 * Send one template. Returns true when AdsEra took it.
 * `vars` are the template's {{variables}}, all as text.
 */
async function send(templateName, phone, vars, { name, log = true } = {}) {
  if (off() || !adsera.configured()) return false;
  const to = testTo() || tenDigits(phone);
  if (to.length < 10) return false;
  try {
    const t = await templateNamed(templateName);
    if (!t) {
      console.warn(`WhatsApp template "${templateName}" is not approved in AdsEra yet — not sent`);
      return false;
    }
    // Only the blanks this template has — one set of details serves an old
    // and a new version of the same message.
    const wanted = t.params?.length ? new Set(t.params) : null;
    const clean = Object.fromEntries(
      Object.entries(vars)
        .filter(([k]) => !wanted || wanted.has(k))
        .map(([k, v]) => [k, String(v ?? '').replace(/\s+/g, ' ').trim() || '-'])
    );
    await adsera.sendTemplate(t.id, to, clean);
    if (log) await logToThread(to, name || clean.name, fill(t.body, clean), templateName);
    return true;
  } catch (err) {
    console.error(`WhatsApp "${templateName}" to ${to} failed:`, err.message);
    return false;
  }
}

/** Whether automatic messages can go at all (not switched off, AdsEra set up). */
const ready = () => !off() && adsera.configured();

/**
 * Send a template whose only blank is the person's name — {{name}},
 * {{customer_name}}, {{1}} and the like. Any other blank gets a dash, so
 * a follow-up template should ask for the name and nothing else.
 */
async function sendNamed(templateName, phone, name) {
  if (!ready()) return false;
  let t;
  try {
    t = await templateNamed(templateName);
  } catch {
    return false;
  }
  if (!t) return send(templateName, phone, {}, { name });
  const vars = Object.fromEntries((t.params || []).map((p) => [p, /name|^1$/i.test(p) ? first(name) : '-']));
  return send(templateName, phone, vars, { name });
}

// -- The events ------------------------------------------------------------------

/** A new enquiry from the website (or an ad). */
const welcome = (lead) => send('welcome_enquiry', lead.phone, { name: first(lead.name) }, { name: lead.name });

/**
 * A membership has just become Active.
 *
 * The full version with the purchase invoice (membership_activated_invoice)
 * goes once it is approved in AdsEra; until then the short one does.
 */
async function membershipActivated(m) {
  const short = () =>
    send(
      'membership_activated',
      m.phone,
      {
        name: first(m.name),
        plan: String(m.planName || 'Smira Club').split(' ')[0],
        member_id: m.memberId || m.code,
        valid_till: day(m.expiresOn),
      },
      { name: m.name }
    );
  let full = null;
  try {
    full = await templateNamed('membership_activated_invoice');
  } catch {
    full = null;
  }
  if (!full) return short();

  const Invoice = require('../models/Invoice');
  const inv = await Invoice.findOne({ membership: m._id }).sort({ createdAt: -1 }).select('code issuedOn baseAmount discount paid amount').lean().catch(() => null);
  const amount = Number(inv?.baseAmount || m.amount || 0);
  const discount = Number(inv?.discount ?? m.discount ?? 0);
  const paid = Number(inv?.paid || m.paid || inv?.amount || Math.max(0, amount - discount));
  const activated = m.activation?.activatedOn || m.startedOn || new Date();
  return send(
    'membership_activated_invoice',
    m.phone,
    {
      customer_name: String(m.name || '').trim() || 'Member',
      membership_name: m.planName || 'Smira Club',
      membership_id: m.memberId || m.code,
      activation_date: day(activated),
      expiry_date: day(m.expiresOn),
      invoice_number: inv?.code || m.paymentRef || m.code,
      invoice_date: day(inv?.issuedOn || m.receivedOn || activated),
      membership_amount: rupees(amount),
      discount_amount: rupees(discount),
      amount_paid: rupees(paid),
    },
    { name: m.name }
  );
}

/** Money has come in. */
async function paymentReceived(p) {
  const Customer = require('../models/Customer');
  const c = p.customer ? await Customer.findById(p.customer).select('name phone').lean() : null;
  if (!c?.phone) return false;
  return send(
    'payment_received',
    c.phone,
    {
      name: first(c.name || p.customerName),
      amount: rupees(p.amount),
      product: p.product || 'your booking',
      reference: p.gatewayTxnId || p.reference || p.code,
      date: day(p.paidOn || new Date()),
    },
    { name: c.name }
  );
}

// -- Bookings --------------------------------------------------------------------
const placeOf = (b) => b.hotel || b.packageName || b.destination || 'your stay';
const guestsOf = (b) => {
  const a = Number(b.adults || b.pax || 1);
  const k = Number(b.children || 0);
  return `${a} Adult${a === 1 ? '' : 's'}${k ? `, ${k} Child${k === 1 ? '' : 'ren'}` : ''}`;
};
async function bookingPerson(b) {
  const Customer = require('../models/Customer');
  const c = b.customer ? await Customer.findById(b.customer).select('name phone').lean() : null;
  return { phone: c?.phone, name: c?.name || b.customerName };
}

/** The new wording (name_v2) once it is approved in AdsEra, else the one in use. */
async function versionOf(name) {
  try {
    if (await templateNamed(`${name}_v2`)) return `${name}_v2`;
  } catch {
    /* fall back */
  }
  return name;
}

async function bookingChanged(b, { isNew, changed }) {
  const who = await bookingPerson(b);
  if (!who.phone) return;
  const start = b.checkIn || b.departureOn;
  // Everything either version of a booking message asks for; send() keeps
  // just the blanks the template being sent has.
  let member = null;
  if (b.membership) {
    const Membership = require('../models/Membership');
    member = await Membership.findById(b.membership).select('memberId code planName').lean().catch(() => null);
  }
  const base = {
    name: first(who.name),
    customer_name: String(who.name || '').trim() || 'Guest',
    booking_id: b.code,
    hotel: placeOf(b),
    property: placeOf(b),
    check_in: day(start),
    check_in_date: day(start),
    check_out: day(b.checkOut) || day(start),
    check_out_date: day(b.checkOut) || day(start),
    membership_id: member?.memberId || member?.code || '-',
    membership_name: member?.planName || b.membershipPlan || 'Smira Club',
  };

  if (isNew || (changed.includes('status') && b.status === 'Confirmed')) {
    if (b.status === 'Confirmed') {
      return send(await versionOf('booking_confirmed'), who.phone, {
        ...base,
        hotel: placeOf(b),
        check_in: day(start),
        check_out: day(b.checkOut) || day(start),
        guests: guestsOf(b),
      }, { name: who.name });
    }
    if (isNew && b.status !== 'Cancelled') {
      return send(await versionOf('booking_request_received'), who.phone, {
        ...base,
        hotel: placeOf(b),
        dates: b.checkOut ? `${day(start)} to ${day(b.checkOut)}` : day(start) || 'your chosen dates',
      }, { name: who.name });
    }
    return undefined;
  }

  if (changed.includes('status') && b.status === 'Cancelled') {
    return send(await versionOf('booking_cancelled'), who.phone, {
      ...base,
      hotel: placeOf(b),
      refund_note: Number(b.refund) > 0
        ? `Rs ${rupees(b.refund)} will be refunded to your original payment method within 5 to 7 working days`
        : 'Our team will contact you about any payment made for this booking',
    }, { name: who.name });
  }

  if ((changed.includes('checkIn') || changed.includes('checkOut')) && b.status !== 'Cancelled') {
    return send(await versionOf('booking_updated'), who.phone, {
      ...base,
      change: b.checkOut
        ? `Check-in is now ${day(b.checkIn)} and check-out is ${day(b.checkOut)}`
        : `Check-in is now ${day(b.checkIn)}`,
    }, { name: who.name });
  }
  return undefined;
}

/** Two days before check-in, once. */
async function bookingReminder(b) {
  const who = await bookingPerson(b);
  if (!who.phone) return false;
  return send(await versionOf('booking_reminder'), who.phone, {
    name: first(who.name),
    customer_name: String(who.name || '').trim() || 'Guest',
    hotel: placeOf(b),
    check_in: day(b.checkIn || b.departureOn),
    check_in_date: day(b.checkIn || b.departureOn),
    check_out_date: day(b.checkOut) || day(b.checkIn || b.departureOn),
    booking_id: b.code,
  }, { name: who.name });
}

// -- Gifts and support -----------------------------------------------------------
const GIFT_WORDS = {
  Eligible: 'ready to be claimed',
  Approved: 'approved',
  Assigned: 'being prepared',
  'Out for delivery': 'out for delivery',
  Delivered: 'delivered',
  Cancelled: 'cancelled',
};
async function giftChanged(r, { isNew, changed }) {
  if (isNew || !changed.includes('stage')) return undefined;
  const Customer = require('../models/Customer');
  const c = r.customer ? await Customer.findById(r.customer).select('name phone').lean() : null;
  if (!c?.phone) return undefined;
  return send('gift_claim_update', c.phone, {
    name: first(c.name),
    gift: r.gift,
    status: GIFT_WORDS[r.stage] || String(r.stage || '').toLowerCase(),
  }, { name: c.name });
}

const TICKET_WORDS = {
  New: ['received', 'Our team will look into it and get back to you shortly'],
  Assigned: ['assigned to our team', 'A team member is now looking into your request'],
  'In progress': ['in progress', 'Our team is working on it'],
  Waiting: ['waiting on an update', 'We are waiting for a response and will update you soon'],
  Escalated: ['escalated', 'It has been escalated to a senior team member'],
  Resolved: ['resolved', 'We hope everything is sorted for you'],
  'Customer confirmed': ['closed', 'Thank you for confirming'],
  Closed: ['closed', 'Thank you for your patience'],
};
async function ticketChanged(t, { isNew, changed }) {
  if (!isNew && !changed.includes('stage')) return undefined;
  if (!isNew && ['Assigned', 'Customer confirmed'].includes(t.stage)) return undefined; // not worth a message
  let phone = t.phone;
  let name = t.customerName;
  if (!phone && t.customer) {
    const Customer = require('../models/Customer');
    const c = await Customer.findById(t.customer).select('name phone').lean();
    phone = c?.phone;
    name = name || c?.name;
  }
  if (!phone) return undefined;
  const [status, note] = TICKET_WORDS[t.stage] || [String(t.stage || 'updated').toLowerCase(), 'Our team is on it'];
  return send('support_ticket_update', phone, {
    name: first(name),
    ticket_id: t.code,
    status,
    note: t.stage === 'Resolved' && t.resolution?.note ? t.resolution.note : note,
  }, { name });
}

// -- Staff -----------------------------------------------------------------------
const followupStaff = (user, lead) =>
  send('followup_reminder_staff', user.phone, {
    staff_name: first(user.name),
    lead_name: lead.name || 'a customer',
    lead_phone: lead.phone || '-',
    time: when(lead.nextFollowUpAt),
  }, { name: user.name, log: false });

// -- Timers ----------------------------------------------------------------------

/** Bookings that start in about two days and have not been reminded. */
async function sendBookingReminders() {
  if (off() || !adsera.configured()) return;
  const Booking = require('../models/Booking');
  const from = new Date(Date.now() + 24 * 3600 * 1000);
  const to = new Date(Date.now() + 48 * 3600 * 1000);
  const due = await Booking.find({
    status: { $in: ['Confirmed', 'Part paid', 'Paid', 'Rescheduled'] },
    checkIn: { $gte: from, $lt: to },
    reminderSentAt: null,
  }).limit(200).lean();
  for (const b of due) {
    await Booking.updateOne({ _id: b._id }, { $set: { reminderSentAt: new Date() } });
    await bookingReminder(b);
  }
}

/** Follow-ups due in the next 30 minutes: a WhatsApp to the lead's owner. */
async function sendFollowupReminders() {
  if (off() || !adsera.configured()) return;
  const Lead = require('../models/Lead');
  const User = require('../models/User');
  const now = new Date();
  const soon = new Date(Date.now() + 30 * 60 * 1000);
  const due = await Lead.find({ nextFollowUpAt: { $gte: now, $lte: soon }, owner: { $ne: null } })
    .select('name phone owner nextFollowUpAt followUpRemindedFor')
    .limit(300)
    .lean();
  const owners = new Map();
  for (const lead of due) {
    if (lead.followUpRemindedFor && new Date(lead.followUpRemindedFor).getTime() === new Date(lead.nextFollowUpAt).getTime()) continue;
    const key = String(lead.owner);
    if (!owners.has(key)) owners.set(key, await User.findById(lead.owner).select('name phone').lean());
    const user = owners.get(key);
    await Lead.updateOne({ _id: lead._id }, { $set: { followUpRemindedFor: lead.nextFollowUpAt } });
    if (user?.phone) await followupStaff(user, lead);
  }
}

module.exports = {
  send,
  sendNamed,
  ready,
  welcome,
  membershipActivated,
  paymentReceived,
  bookingChanged,
  bookingReminder,
  giftChanged,
  ticketChanged,
  followupStaff,
  sendBookingReminders,
  sendFollowupReminders,
};
