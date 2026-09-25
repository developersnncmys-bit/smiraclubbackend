const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Booking = require('../models/Booking');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Membership = require('../models/Membership');
const MembershipPlan = require('../models/MembershipPlan');
const InventoryItem = require('../models/InventoryItem');
const Offer = require('../models/Offer');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { sellingRate, memberRate } = require('../helpers/money');

/**
 * Who picks up what the website sends.
 *
 * Work with no owner is only visible to the few roles that see everything,
 * so a branch or team manager never found the website's enquiries at all.
 * Each one now goes to whoever on the sales desk has the fewest new leads,
 * which puts it in front of them and their managers straight away.
 * WEBSITE_DESK names a different department if the sales desk is not the one.
 */
async function pickDeskOwner() {
  const department = process.env.WEBSITE_DESK || 'Sales desk';
  const desk = await User.find({ department, status: 'Active' }).select('_id').lean();
  if (!desk.length) return undefined;

  const load = await Lead.aggregate([
    { $match: { owner: { $in: desk.map((u) => u._id) }, status: 'New' } },
    { $group: { _id: '$owner', n: { $sum: 1 } } },
  ]);
  const open = Object.fromEntries(load.map((l) => [String(l._id), l.n]));
  const newLeads = (u) => open[String(u._id)] || 0;
  return desk.reduce((best, u) => (newLeads(u) < newLeads(best) ? u : best))._id;
}

exports.pickDeskOwner = pickDeskOwner;

/**
 * What the public website sends in.
 *
 * Nobody is signed in behind these routes, so every value is read by name,
 * trimmed and capped, and anything the desk decides — the stage, the owner,
 * the score — is set here rather than taken from the form.
 */

const text = (v, max = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v, max = 12) => (Array.isArray(v) ? v.map((x) => text(x, 60)).filter(Boolean).slice(0, max) : []);
const count = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

/** A date the website sends as yyyy-mm-dd, or nothing. */
const day = (v) => {
  const s = text(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T09:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/**
 * Where a visitor came from, read off the campaign link they arrived on
 * (utm_source / utm_campaign). An ad or WhatsApp broadcast link carries these,
 * so its enquiries land in Sales & Leads under that source and campaign
 * rather than as plain website traffic.
 */
function attribution(a) {
  const src = text(a?.source, 40).toLowerCase();
  const campaign = text(a?.campaign, 80) || undefined;
  let source = 'Website';
  if (/whatsapp|^wa$/.test(src)) source = 'WhatsApp';
  else if (/facebook|^fb$|meta/.test(src)) source = 'Facebook Ads';
  else if (/instagram|^ig$/.test(src)) source = 'Instagram';
  else if (/google|adwords/.test(src)) source = 'Google Ads';
  else if (campaign || src) source = 'Campaign';
  return { source, campaign };
}

/**
 * A customised international tour, asked for on the website.
 *
 * It lands in Sales & Leads as a new lead, because that is what it is: a
 * person, a destination and a callback owed. Everything else the form asked —
 * hotel, transport, meals, the rest — is written onto the lead in plain lines,
 * so whoever picks it up reads the whole brief without opening another screen.
 */
exports.tripEnquiry = catchAsync(async (req, res) => {
  const b = req.body || {};

  const name = text(b.name, 80);
  const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
  const email = text(b.email, 120).toLowerCase();
  const destination = text(b.destination, 120);

  if (name.length < 2) throw ApiError.badRequest('Tell us your name');
  if (!/^[6-9]\d{9}$/.test(phone)) throw ApiError.badRequest('Enter a 10-digit mobile number');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw ApiError.badRequest('That email does not look right');
  if (!destination) throw ApiError.badRequest('Tell us where you would like to go');

  const checkIn = day(b.checkIn);
  const checkOut = day(b.checkOut);
  if (checkIn && checkOut && checkOut < checkIn) throw ApiError.badRequest('Check-out has to be after check-in');

  const adults = count(b.adults, 1, 30);
  const childAges = list(b.childAges, 10);
  const rooms = count(b.rooms, 1, 20);

  // The brief, one line per answer, in the order the form asks.
  const yes = (v) => (v ? 'Yes' : 'No');
  const lines = [
    `Customised international tour — ${destination}`,
    `Hotel: ${text(b.hotel, 40) || 'Any'}`,
    `Dates: ${text(b.dateMode, 30) || 'Exact Date'}` +
      (checkIn ? `, ${checkIn.toDateString()}` : '') +
      (checkOut ? ` to ${checkOut.toDateString()}` : '') +
      (b.duration ? ` · ${text(b.duration, 40)}` : ''),
    `Guests: ${rooms} room${rooms === 1 ? '' : 's'}, ${adults} adult${adults === 1 ? '' : 's'}` +
      (childAges.length ? `, ${childAges.length} child${childAges.length === 1 ? '' : 'ren'} (${childAges.join(', ')})` : '') +
      `, pets: ${yes(b.pets)}`,
    b.occasion ? `Occasion: ${text(b.occasion, 40)}` : '',
    b.note ? `Special note: ${text(b.note, 120)}` : '',
    `Transport: ${list(b.transport, 6).join(', ') || '—'}`,
    `Pick-up: ${text(b.pickupFrom, 40)} → ${text(b.pickupTo, 40)} · Drop: ${text(b.dropFrom, 40)} → ${text(b.dropTo, 40)}` +
      ` · Return transfer: ${yes(b.returnTransfer)}`,
    `Sightseeing: ${text(b.sightseeing, 5) || '—'}`,
    `Meals: ${text(b.mealPlan, 60) || '—'} (${text(b.mealType, 20) || '—'})`,
    list(b.extras).length ? `Preferences: ${list(b.extras).join(', ')}` : '',
    list(b.support).length ? `Support: ${list(b.support).join(', ')}` : '',
    b.needs ? `Travel needs: ${text(b.needs, 120)}` : '',
  ].filter(Boolean);
  const brief = lines.join('\n');

  const lead = await Lead.create({
    name,
    phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`,
    email: email || undefined,
    destination,
    pax: adults + childAges.length,
    travelDate: checkIn,
    ...attribution(b.attribution),
    label: 'International',
    tags: ['International', 'Customised tour'],
    notes: brief,
    // Not the visitor's to decide.
    status: 'New',
    score: 'Warm',
    priority: 'Medium',
    owner: await pickDeskOwner(),
    activities: [{ kind: 'note', text: brief, byName: 'Website' }],
  });

  // The reference is all a visitor gets back.
  res.status(201).json({
    success: true,
    message: 'Enquiry received',
    data: { reference: lead.code },
  });
});

/**
 * What the member filled in on Complete Your Profile, read field by field.
 * Only the gaps on a customer are filled from it — the desk's own record wins.
 */
function profileFields(p) {
  if (!p || typeof p !== 'object') return {};
  const past = (d) => (d && d < new Date() ? d : undefined);
  const where = [text(p.address, 200), text(p.state, 40), text(p.pincode, 10)].filter(Boolean).join(', ');
  const out = {
    dob: past(day(p.dob)),
    anniversary: past(day(p.anniversary)),
    address: where || undefined,
    city: text(p.city, 60) || undefined,
  };
  if (out.anniversary) out.specialLabel = 'Anniversary';
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

/**
 * The plan a customer holds, or nothing.
 *
 * It decides what a website booking is: a member is confirmed the moment
 * they book, and anybody else is making a request the desk answers. It is
 * read from the desk's own records, never from what the browser claims.
 */
async function memberPlanOf(customer) {
  if (!customer?._id) return null;
  const held = await Membership.findOne({
    customer: customer._id,
    status: { $nin: ['Cancelled', 'Expired'] },
  }).sort({ receivedOn: -1 }).lean();
  if (!held) return null;
  if (held.expiresOn && new Date(held.expiresOn) < new Date()) return null;
  return String(held.planName || 'Smira Club').split(' ')[0];
}

/** The customer a website booking belongs to — found by number, or made. */
async function customerFor({ name, phone, email, profile }, expert) {
  const extra = profileFields(profile);

  // Stored numbers carry spaces and a +91, so match on the digits in order.
  const digitsInOrder = new RegExp(`${phone.split('').join('\\D*')}$`);
  const known = await Customer.findOne({ phone: digitsInOrder });
  if (known) {
    let changed = false;
    for (const [k, v] of Object.entries({ email: email || undefined, ...extra })) {
      if (v !== undefined && !known[k]) {
        known[k] = v;
        changed = true;
      }
    }
    if (changed) await known.save();
    return known;
  }

  return Customer.create({
    name,
    phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`,
    email: email || undefined,
    source: 'Website',
    expert,
    ...extra,
  });
}

/**
 * A fixed-departure package booked from its page on the website.
 *
 * It is a booking, so it lands on the Booking page — pending, because nothing
 * has been paid and the seats are not yet held. The price is the one the
 * website quoted: the packages are listed on the website rather than on the
 * server, so the desk checks it when they call to confirm and take payment,
 * and the booking says so on its trail.
 *
 * A number that already belongs to a customer books under that customer; the
 * name and email typed here do not overwrite theirs.
 */
exports.packageBooking = catchAsync(async (req, res) => {
  const b = req.body || {};

  const name = text(b.name, 80);
  const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
  const email = text(b.email, 120).toLowerCase();
  const packageName = text(b.packageName, 120);
  const destination = text(b.destination, 120);
  const departure = day(b.departure);

  if (name.length < 2) throw ApiError.badRequest('Tell us who is travelling');
  if (!/^[6-9]\d{9}$/.test(phone)) throw ApiError.badRequest('Enter a 10-digit mobile number');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw ApiError.badRequest('That email does not look right');
  if (!packageName) throw ApiError.badRequest('Which package is this for?');
  if (!departure) throw ApiError.badRequest('Pick a departure date');
  if (departure < new Date(Date.now() - 86400000)) throw ApiError.badRequest('That departure has already gone');

  const adults = count(b.adults, 1, 20);
  const children = count(b.children, 0, 20);
  const nights = count(b.nights, 0, 60);
  const amount = count(b.total, 0, 50000000);
  const gstin = text(b.gstin, 20).toUpperCase();
  const guests = (Array.isArray(b.guests) ? b.guests : [])
    .slice(0, 20)
    .map((g) => [text(g?.name, 80), text(g?.email, 120), String(g?.phone || '').replace(/\D/g, '').slice(-10)].filter(Boolean).join(' · '))
    .filter(Boolean);

  const owner = await pickDeskOwner();
  const customer = await customerFor({ name, phone, email, profile: b.profile }, owner);
  const plan = await memberPlanOf(customer);

  const from = attribution(b.attribution);
  const note = [
    from.source !== 'Website' ? `Came from ${from.source}${from.campaign ? ` — campaign "${from.campaign}"` : ''}` : '',
    `Booked on the website — ${packageName}`,
    `Departure ${departure.toDateString()}, ${nights} night${nights === 1 ? '' : 's'}`,
    `${adults} adult${adults === 1 ? '' : 's'}${children ? `, ${children} child${children === 1 ? '' : 'ren'}` : ''}`,
    `Quoted on the website: ₹${amount.toLocaleString('en-IN')} incl. taxes — confirm the price when you call`,
    guests.length > 1 ? `Guests: ${guests.join('; ')}` : '',
    gstin ? `GST invoice to ${gstin}` : '',
    b.coupon ? `Coupon typed: ${text(b.coupon, 30)}` : '',
  ].filter(Boolean);

  const booking = await Booking.create({
    customer: customer._id,
    customerName: customer.name,
    bookingType: 'International trip',
    packageName,
    destination,
    departureOn: departure,
    nights,
    pax: adults + children,
    adults,
    children,
    amount,
    paid: 0,
    // Not the visitor's to decide: a member has a seat, anyone else has asked.
    status: plan ? 'Confirmed' : 'Pending',
    confirmation: { status: plan ? 'Member booking' : 'Request — not a member yet' },
    source: from.source,
    channel: 'Website',
    owner,
    specialNote: gstin ? `GST: ${gstin}` : undefined,
    handledBy: { handled: owner },
    activities: [
      ...note.map((line) => ({ kind: 'note', text: line, byName: 'Website' })),
      {
        kind: 'status',
        text: plan
          ? `Confirmed on the spot — ${plan} member`
          : 'Requested by someone who is not a member — check the seats and call back within 24 hours',
        byName: 'Website',
      },
    ],
  });

  res.status(201).json({
    success: true,
    message: plan ? 'Booking confirmed' : 'Request received',
    data: { reference: booking.code, status: plan ? 'confirmed' : 'requested', plan: plan || null },
  });
});

/** What each website booking screen is on the Booking page. */
const KIND_TYPE = {
  stay: 'Hotel', hotel: 'Hotel', hourly: 'Hotel', 'free-stay': 'Hotel',
  villa: 'Villa',
  table: 'Restaurant',
  park: 'Activity', games: 'Activity', spa: 'Activity', luxury: 'Activity', adventure: 'Activity', camping: 'Activity', activity: 'Activity',
  package: 'Package', group: 'Package',
};
const KIND_LABEL = {
  stay: 'Hotel', hotel: 'Hotel', hourly: 'Hourly stay', 'free-stay': 'Free stay', villa: 'Villa',
  table: 'Restaurant', park: 'Theme park', games: 'Games zone', spa: 'Spa & salon', luxury: 'Luxury experience',
  adventure: 'Adventure', camping: 'Camping', activity: 'Activity', package: 'Package', group: 'Group departure',
};

/**
 * Any other booking made on the website — a hotel, villa, free stay, table,
 * park ticket, spa slot and the rest.
 *
 * It lands on the Booking page, pending, with the website's quote on its
 * trail for the desk to confirm when they call. Sales & Leads is kept for
 * leads from campaigns, WhatsApp and the like, so a website booking does not
 * open one. Check-in and check-out arrive as yyyy-mm-dd; the screen's own
 * wording of the slot is kept on the trail as well.
 */
exports.booking = catchAsync(async (req, res) => {
  const b = req.body || {};

  const name = text(b.name, 80);
  const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
  const email = text(b.email, 120).toLowerCase();
  const kind = Object.prototype.hasOwnProperty.call(KIND_TYPE, b.kind) ? b.kind : 'stay';
  const what = text(b.itemName, 120);
  const location = text(b.location, 120);
  const slot = text(b.slot, 80);
  const nightsText = text(b.nights, 60);
  const checkIn = day(b.checkIn);
  const checkOut = day(b.checkOut);

  if (name.length < 2) throw ApiError.badRequest('Tell us who is booking');
  if (!/^[6-9]\d{9}$/.test(phone)) throw ApiError.badRequest('Enter a 10-digit mobile number');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw ApiError.badRequest('That email does not look right');
  if (!what) throw ApiError.badRequest('What is this booking for?');
  if (checkIn && checkIn < new Date(Date.now() - 86400000)) throw ApiError.badRequest('That date has already gone');
  if (checkIn && checkOut && checkOut <= checkIn) throw ApiError.badRequest('Check-out has to be after check-in');

  const nights = checkIn && checkOut ? Math.round((checkOut - checkIn) / 86400000) : undefined;
  const guestCount = count(b.pax, 1, 50);
  const amount = count(b.total, 0, 50000000);
  const gstin = text(b.gstin, 20).toUpperCase();
  const guests = (Array.isArray(b.guests) ? b.guests : [])
    .slice(0, 20)
    .map((g) => [text(g?.name, 80), text(g?.email, 120), String(g?.phone || '').replace(/\D/g, '').slice(-10)].filter(Boolean).join(' · '))
    .filter(Boolean);
  const label = KIND_LABEL[kind];
  const show = (d) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

  const from = attribution(b.attribution);
  const note = [
    from.source !== 'Website' ? `Came from ${from.source}${from.campaign ? ` — campaign "${from.campaign}"` : ''}` : '',
    `Booked on the website — ${label}: ${what}`,
    location ? `Location: ${location}` : '',
    checkIn ? `Check-in ${show(checkIn)}${checkOut ? ` · Check-out ${show(checkOut)}` : ''}` : '',
    slot ? `When: ${slot}${nightsText ? ` · ${nightsText}` : ''}` : '',
    `Quoted on the website: ₹${amount.toLocaleString('en-IN')} incl. taxes — confirm the price when you call`,
    guests.length > 1 ? `Guests: ${guests.join('; ')}` : '',
    gstin ? `GST invoice to ${gstin}` : '',
    b.coupon ? `Coupon typed: ${text(b.coupon, 30)}` : '',
  ].filter(Boolean);

  const owner = await pickDeskOwner();
  const customer = await customerFor({ name, phone, email, profile: b.profile }, owner);
  const plan = await memberPlanOf(customer);

  const type = KIND_TYPE[kind];
  const booking = await Booking.create({
    customer: customer._id,
    customerName: customer.name,
    bookingType: type,
    ...(type === 'Hotel' || type === 'Villa' ? { hotel: what } : { packageName: what }),
    destination: location || undefined,
    checkIn,
    checkOut,
    departureOn: checkIn,
    nights,
    pax: guestCount,
    adults: guestCount,
    amount,
    paid: 0,
    // A member is confirmed on the spot; anybody else has made a request.
    status: plan ? 'Confirmed' : 'Pending',
    confirmation: { status: plan ? 'Member booking' : 'Request — not a member yet' },
    source: from.source,
    channel: 'Website',
    owner,
    specialNote: gstin ? `GST: ${gstin}` : undefined,
    handledBy: { handled: owner },
    activities: [
      ...note.map((line) => ({ kind: 'note', text: line, byName: 'Website' })),
      {
        kind: 'status',
        text: plan
          ? `Confirmed on the spot — ${plan} member`
          : 'Requested by someone who is not a member — check availability and call back within 24 hours',
        byName: 'Website',
      },
    ],
  });

  res.status(201).json({
    success: true,
    message: plan ? 'Booking confirmed' : 'Request received',
    data: { reference: booking.code, status: plan ? 'confirmed' : 'requested', plan: plan || null },
  });
});

/**
 * A membership bought on the website.
 *
 * There is no payment gateway yet, so Pay now sends the choice to the desk: it
 * lands on the Members page as a new membership with the payment pending, for
 * the member's expert to call, take the fee and activate. The website plans
 * are matched to the desk's plans by name; one the desk does not sell yet goes
 * on the nearest plan, with what was asked for written on it.
 */
exports.membership = catchAsync(async (req, res) => {
  const b = req.body || {};

  const name = text(b.name, 80);
  const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
  const email = text(b.email, 120).toLowerCase();
  const wanted = text(b.plan, 40);

  if (name.length < 2) throw ApiError.badRequest('Complete your profile first — we need your name');
  if (!/^[6-9]\d{9}$/.test(phone)) throw ApiError.badRequest('Enter a 10-digit mobile number');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw ApiError.badRequest('That email does not look right');
  if (!wanted) throw ApiError.badRequest('Pick a plan');

  const plans = await MembershipPlan.find().sort({ price: 1 }).lean();
  if (!plans.length) throw ApiError.badRequest('Memberships are not on sale just now — please call us');
  const first = wanted.split(/\s+/)[0].toLowerCase();
  const plan = plans.find((p) => p.name.toLowerCase().startsWith(first)) || plans[plans.length - 1];

  const amount = count(b.total, 0, 5000000);
  const from = attribution(b.attribution);
  const owner = await pickDeskOwner();
  const customer = await customerFor({ name, phone, email, profile: b.profile }, owner);
  const months = plan.durationMonths || 12;
  const expires = new Date();
  expires.setMonth(expires.getMonth() + months);

  const lines = [
    `Bought on the website — ${wanted} membership`,
    plan.name.toLowerCase().startsWith(first) ? '' : `The desk has no ${wanted} plan yet — put on ${plan.name}, check with the member`,
    `Quoted on the website: ₹${amount.toLocaleString('en-IN')} incl. taxes — take payment to activate`,
    list(b.gifts).length ? `Welcome gift: ${list(b.gifts).join(', ')}` : '',
    list(b.privileges).length ? `Privileges: ${list(b.privileges).join(', ')}` : '',
    b.sharing ? 'Wants membership sharing' : '',
    b.coupon ? `Coupon: ${text(b.coupon, 30)}` : '',
    from.source !== 'Website' ? `Came from ${from.source}${from.campaign ? ` — campaign "${from.campaign}"` : ''}` : '',
  ].filter(Boolean);

  const membership = await Membership.create({
    customer: customer._id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    city: customer.city,
    plan: plan._id,
    planName: plan.name,
    movement: 'New',
    source: from.source,
    receivedOn: new Date(),
    expiresOn: expires,
    amount,
    paid: 0,
    status: 'New',
    expert: owner,
    activation: { stage: 'Payment pending' },
    timeline: lines.map((note) => ({ step: 'Website', at: new Date(), note })),
  });

  res.status(201).json({
    success: true,
    message: 'Membership requested',
    data: { reference: membership.code, plan: wanted, expiresOn: expires },
  });
});

/**
 * The plans the website sells, as the desk has them set up.
 *
 * The membership page reads its prices and numbers from here, so a change on
 * the admin panel's Plans page is what the website shows. Only published
 * plans, and only what a visitor needs to choose one.
 */
exports.plans = catchAsync(async (req, res) => {
  const plans = await MembershipPlan.find({ published: true })
    .sort({ sortOrder: 1, price: 1 })
    .select('code name tagline price durationMonths persons rooms freeStay privileges popular sortOrder')
    .lean();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ success: true, data: plans });
});

// -- Members signing in on the website ---------------------------------------

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const OtpChallenge = require('../models/OtpChallenge');
const sms = require('../helpers/sms');

const OTP_MINUTES = 5;
const OTP_ATTEMPTS = 5;
const RESEND_SECONDS = 45;

/** Seconds still to wait before another code may be asked for. */
const tooSoon = (last) => {
  if (!last) return 0;
  const gone = (Date.now() - new Date(last).getTime()) / 1000;
  return gone < RESEND_SECONDS ? Math.ceil(RESEND_SECONDS - gone) : 0;
};

const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);

/** The customer behind a number, however their number was typed in. */
const customerByPhone = (digits) =>
  Customer.findOne({ phone: new RegExp(`${digits.split('').join('\\D*')}$`) });

/**
 * "Send me a code" on the website's sign-in screen.
 *
 * The code is kept hashed against the number, not against a customer, so a
 * number nobody has booked with cannot be told whether it is known. Until an
 * SMS provider is wired the helper hands the code back for the screen to show
 * — an authentication bypass, and only for the demo.
 */
exports.memberOtpRequest = catchAsync(async (req, res) => {
  const digits = tenDigits(req.body.phone);
  if (!/^[6-9]\d{9}$/.test(digits)) throw ApiError.badRequest('Enter a ten digit mobile number');

  const existing = await OtpChallenge.findOne({ phoneDigits: digits, purpose: 'member-login' });
  const wait = tooSoon(existing?.lastSentAt);
  if (wait) throw new ApiError(429, `Ask again in ${wait} seconds`);

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await OtpChallenge.findOneAndUpdate(
    { phoneDigits: digits, purpose: 'member-login' },
    { codeHash: await bcrypt.hash(code, 10), expiresAt: new Date(Date.now() + OTP_MINUTES * 60000), attempts: 0, lastSentAt: new Date(), createdAt: new Date() },
    { upsert: true, setDefaultsOnInsert: true },
  );

  const sent = await sms.send(`+91 ${digits}`, code);
  res.json({
    success: true,
    message: sent.delivered ? 'Code sent' : 'Code generated',
    data: { expiresInMinutes: OTP_MINUTES, ...(sent.devCode ? { devCode: sent.devCode, demo: true } : {}) },
  });
});

/**
 * The code, and what signing in gives back: the member's own details and the
 * membership the desk holds for them, so a member who joined on one phone has
 * their profile and plan on the next. A number the desk has never seen signs
 * in as somebody new, with the profile still to fill in.
 */
exports.memberOtpVerify = catchAsync(async (req, res) => {
  const digits = tenDigits(req.body.phone);
  const code = String(req.body.code || '').replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(digits)) throw ApiError.badRequest('Enter a ten digit mobile number');
  if (code.length !== 6) throw ApiError.badRequest('Enter the six digit code');

  const challenge = await OtpChallenge.findOne({ phoneDigits: digits, purpose: 'member-login' }).select('+codeHash');
  if (!challenge) throw ApiError.badRequest('Ask for a code first');
  if (challenge.expiresAt < new Date()) throw ApiError.badRequest('That code has expired — ask for another');
  if (challenge.attempts >= OTP_ATTEMPTS) throw ApiError.badRequest('Too many tries — ask for another code');

  if (!(await bcrypt.compare(code, challenge.codeHash))) {
    challenge.attempts += 1;
    await challenge.save();
    throw ApiError.badRequest('That code is not right');
  }
  await challenge.deleteOne();

  const customer = await customerByPhone(digits);
  const membership = customer
    ? await Membership.findOne({ customer: customer._id, status: { $ne: 'Cancelled' } }).sort({ receivedOn: -1 }).lean()
    : null;

  res.json({
    success: true,
    message: customer ? 'Signed in' : 'Welcome to Smira Club',
    data: {
      isNew: !customer,
      // A session only for a number the desk already knows.
      token: customer ? memberToken(customer) : null,
      member: customer
        ? {
            name: customer.name,
            email: customer.email || '',
            phone: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`,
            city: customer.city || '',
            address: customer.address || '',
            dob: customer.dob || null,
            anniversary: customer.anniversary || null,
          }
        : { name: '', email: '', phone: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`, city: '', address: '', dob: null, anniversary: null },
      membership: membership
        ? {
            plan: String(membership.planName || '').split(' ')[0],
            planName: membership.planName,
            reference: membership.code,
            status: membership.activation?.stage === 'Activated' ? 'Active' : membership.activation?.stage || membership.status,
            expiresOn: membership.expiresOn || null,
          }
        : null,
    },
  });
});

/** A member's own session, once their number has been proved. */
const jwt = require('jsonwebtoken');

const memberToken = (customer) =>
  jwt.sign({ sub: customer._id, kind: 'member' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

exports.memberToken = memberToken;

/** How a booking reads to the member it belongs to. */
const bookingForMember = (b) => ({
  reference: b.code,
  kind: b.bookingType,
  name: b.hotel || b.packageName || b.bookingType,
  destination: b.destination || '',
  checkIn: b.checkIn || b.departureOn || null,
  checkOut: b.checkOut || null,
  nights: b.nights || 0,
  guests: b.pax || 0,
  amount: b.amount || 0,
  paid: b.paid || 0,
  status: b.status,
  /**
   * Where it has got to between the desk and the property, in the member's
   * words — the desk's own wording ("Sent to partner") is not theirs to read.
   */
  progress:
    b.status === 'Cancelled'
      ? 'Cancelled'
      : /Declined by partner/i.test(b.confirmation?.status || '')
        ? 'Finding another property'
        : /Confirmed by partner|Hotel confirmed/i.test(b.confirmation?.status || '')
          ? 'Confirmed by the property'
          : b.status === 'Pending'
            ? 'Waiting for our desk to confirm'
            : 'Confirmed by our desk',
  bookedOn: b.createdAt,
});

/**
 * Everything the signed-in member's own screens need: who they are, the
 * membership the desk holds, and their bookings with where each one has got
 * to. Read from their token, never from an id in the address.
 */
exports.memberMe = catchAsync(async (req, res) => {
  const me = req.member;
  const [membership, bookings] = await Promise.all([
    Membership.findOne({ customer: me._id, status: { $ne: 'Cancelled' } }).sort({ receivedOn: -1 }).lean(),
    Booking.find({ customer: me._id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);

  res.json({
    success: true,
    data: {
      member: { name: me.name, email: me.email || '', phone: me.phone, city: me.city || '' },
      membership: membership
        ? {
            plan: String(membership.planName || '').split(' ')[0],
            planName: membership.planName,
            reference: membership.code,
            status: membership.activation?.stage === 'Activated' ? 'Active' : membership.activation?.stage || membership.status,
            expiresOn: membership.expiresOn || null,
          }
        : null,
      bookings: bookings.map(bookingForMember),
    },
  });
});

/* -- What the desk is selling -------------------------------------------- */

/**
 * The catalogue the website reads.
 *
 * Everything a member browses — hotels, villas, restaurants, spas, parks,
 * activities, packages — is Travel Inventory on the panel. The website had
 * no way to ask for any of it: /inventory is staff-only, so the site ran on
 * the copy bundled into its own build and nothing the desk added ever showed
 * up. This is that same stock with only the public parts on it, and no way
 * in: what a room costs the desk, which partner supplies it, how it is
 * allocated and who booked it stay behind the counter.
 *
 * A category with nothing Active in it comes back empty rather than as an
 * error, so the site can fall back to what it ships with and never show a
 * member a blank screen.
 */

/** Sold out and Blocked are not on offer; the rest are. */
const ON_OFFER = ['Active', 'Limited', 'Low'];

/** A date the desk has closed, or a day it has emptied, is not bookable. */
function closedOn(item, on) {
  const key = (d) => new Date(d).toISOString().slice(0, 10);
  if ((item.blackouts || []).some((b) => on >= key(b.from) && on <= key(b.to || b.from))) return true;
  const override = (item.availability || []).find((a) => key(a.date) === on);
  return Boolean(override && Number(override.left || 0) <= 0);
}

/** One row of stock, as a card on the website reads it. */
function forWebsite(item) {
  const selling = sellingRate(item.baseRate, item.markup);
  const member = memberRate(item.baseRate, item.markup, item.memberDiscount);
  const left = Math.max(0, (item.units || 0) - (item.booked || 0) - (item.blocked || 0));

  return {
    id: item.code || String(item._id),
    ref: String(item._id),
    category: item.category,
    name: item.name,
    place: item.destination || '',
    grade: item.grade || '',
    description: item.description || '',
    address: item.address || '',
    gps: item.gps || '',
    checkIn: item.checkIn || '',
    checkOut: item.checkOut || '',
    amenities: item.amenities || [],
    images: item.images || [],
    /** What a member pays, and what it would cost without the membership. */
    price: member,
    was: member < selling ? selling : 0,
    off: selling > 0 && member < selling ? Math.round(((selling - member) / selling) * 100) : 0,
    left,
    status: item.status,
    rooms: (item.rooms || []).map((r) => ({
      type: r.type,
      occupancy: r.occupancy,
      mealPlan: r.mealPlan,
      extraBed: r.extraBed,
      childPolicy: r.childPolicy,
      /** The member price and the rack rate it is struck from. */
      price: Number(r.member || r.smira || r.rack || 0),
      was: Number(r.rack || 0),
    })),
  };
}

/**
 * A category of stock, or all of it. `from` and `to` drop anything the desk
 * has closed over those nights, so a member is not shown a stay they cannot
 * have.
 */
exports.catalog = catchAsync(async (req, res) => {
  const { category, destination, q, from, to } = req.query;
  const where = { status: { $in: ON_OFFER } };
  if (category) where.category = category;
  if (destination) where.destination = new RegExp(String(destination).trim(), 'i');
  if (q) {
    const like = new RegExp(String(q).trim(), 'i');
    where.$or = [{ name: like }, { destination: like }, { description: like }];
  }

  const items = await InventoryItem.find(where)
    .sort({ category: 1, name: 1 })
    .limit(200)
    .lean({ virtuals: false });

  let open = items;
  if (from) {
    const start = new Date(from);
    const end = to ? new Date(to) : start;
    const nights = [];
    for (let d = new Date(start); d < end || nights.length === 0; d.setDate(d.getDate() + 1)) {
      nights.push(d.toISOString().slice(0, 10));
      if (nights.length > 60) break;
    }
    open = items.filter((item) => !nights.some((on) => closedOn(item, on)));
  }

  res.json({ success: true, count: open.length, data: open.map(forWebsite) });
});

/** One thing the desk sells, by its code or its id. */
exports.catalogItem = catchAsync(async (req, res) => {
  const { id } = req.params;
  const where = mongoose.isValidObjectId(id) ? { _id: id } : { code: String(id).toUpperCase() };
  const item = await InventoryItem.findOne({ ...where, status: { $in: ON_OFFER } }).lean({ virtuals: false });
  if (!item) throw ApiError.notFound('We do not have that one');
  res.json({ success: true, data: forWebsite(item) });
});

/**
 * The offers the desk has put live, for the Offers screen and the promo
 * strips. A coupon's own code is included because a member has to be able
 * to quote it; how many times it has been used is not.
 */
exports.liveOffers = catchAsync(async (req, res) => {
  const now = new Date();
  const offers = await Offer.find({
    status: 'Live',
    $and: [
      { $or: [{ startsOn: null }, { startsOn: { $lte: now } }] },
      { $or: [{ endsOn: null }, { endsOn: { $gte: now } }] },
    ],
  })
    .sort({ endsOn: 1, createdAt: -1 })
    .limit(50)
    .lean();

  res.json({
    success: true,
    count: offers.length,
    data: offers.map((o) => ({
      id: o.code || String(o._id),
      name: o.name,
      coupon: o.couponCode || '',
      description: o.description || '',
      kind: o.kind,
      value: o.value,
      maxDiscount: o.maxDiscount,
      minSpend: o.minSpend,
      appliesTo: o.appliesTo || [],
      endsOn: o.endsOn || null,
    })),
  });
});

/* -- Any other thing the website asks for -------------------------------- */

/**
 * A service enquiry, whatever the service is.
 *
 * Plan a trip, a visa, travel insurance, forex — screens that each asked a
 * different set of questions and then only told the visitor it had been
 * sent. Nothing left the browser, so the desk never heard about any of it.
 *
 * Rather than an endpoint per screen, the form names its service and hands
 * over whatever it asked, as label and answer. It lands in Sales & Leads as
 * a new lead with the whole form written onto it, tagged by service so the
 * desk can filter to just the visa enquiries or just the trip plans.
 */
exports.enquiry = catchAsync(async (req, res) => {
  const b = req.body || {};

  const service = text(b.service, 40) || 'Enquiry';
  const name = text(b.name, 80);
  const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
  const email = text(b.email, 120).toLowerCase();

  if (name.length < 2) throw ApiError.badRequest('Tell us your name');
  if (!/^[6-9]\d{9}$/.test(phone)) throw ApiError.badRequest('Enter a 10-digit mobile number');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw ApiError.badRequest('That email does not look right');

  /** Whatever the form asked, in the order it asked it. */
  const answers = Array.isArray(b.answers) ? b.answers.slice(0, 40) : [];
  const lines = [
    `${service} — asked for on the website`,
    ...answers
      .map((a) => [text(a?.label, 60), text(a?.value, 200)])
      .filter(([label, value]) => label && value)
      .map(([label, value]) => `${label}: ${value}`),
  ];
  const brief = lines.join('\n');

  const lead = await Lead.create({
    name,
    phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`,
    email: email || undefined,
    destination: text(b.destination, 120) || undefined,
    pax: b.pax ? count(b.pax, 1, 60) : undefined,
    travelDate: day(b.travelDate),
    ...attribution(b.attribution),
    label: service,
    tags: [service].concat(list(b.tags, 4)),
    notes: brief,
    // Not the visitor's to decide.
    status: 'New',
    score: 'Warm',
    priority: 'Medium',
    owner: await pickDeskOwner(),
    activities: [{ kind: 'note', text: brief, byName: 'Website' }],
  });

  res.status(201).json({
    success: true,
    message: 'Enquiry received',
    data: { reference: lead.code },
  });
});
