const Lead = require('../models/Lead');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');

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
    source: 'Website',
    label: 'International',
    tags: ['International', 'Customised tour'],
    notes: brief,
    // Not the visitor's to decide.
    status: 'New',
    score: 'Warm',
    priority: 'Medium',
    activities: [{ kind: 'note', text: brief, byName: 'Website' }],
  });

  // The reference is all a visitor gets back.
  res.status(201).json({
    success: true,
    message: 'Enquiry received',
    data: { reference: lead.code },
  });
});
