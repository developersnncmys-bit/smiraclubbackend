const Lead = require('../models/Lead');
const Booking = require('../models/Booking');
const Customer = require('../models/Customer');
const User = require('../models/User');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');

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
    // Not the visitor's to decide.
    status: 'Pending',
    source: from.source,
    channel: 'Website',
    owner,
    specialNote: gstin ? `GST: ${gstin}` : undefined,
    handledBy: { handled: owner },
    activities: note.map((line) => ({ kind: 'note', text: line, byName: 'Website' })),
  });

  res.status(201).json({
    success: true,
    message: 'Booking requested',
    data: { reference: booking.code },
  });
});

/** What each website booking screen is on the Booking page. */
const KIND_TYPE = {
  stay: 'Hotel', hotel: 'Hotel', hourly: 'Hotel', 'free-stay': 'Hotel',
  villa: 'Villa',
  table: 'Restaurant',
  park: 'Activity', spa: 'Activity', luxury: 'Activity', adventure: 'Activity', camping: 'Activity', activity: 'Activity',
  package: 'Package', group: 'Package',
};
const KIND_LABEL = {
  stay: 'Hotel', hotel: 'Hotel', hourly: 'Hourly stay', 'free-stay': 'Free stay', villa: 'Villa',
  table: 'Restaurant', park: 'Theme park', spa: 'Spa & salon', luxury: 'Luxury experience',
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
    status: 'Pending',
    source: from.source,
    channel: 'Website',
    owner,
    specialNote: gstin ? `GST: ${gstin}` : undefined,
    handledBy: { handled: owner },
    activities: note.map((line) => ({ kind: 'note', text: line, byName: 'Website' })),
  });

  res.status(201).json({
    success: true,
    message: 'Booking requested',
    data: { reference: booking.code },
  });
});
