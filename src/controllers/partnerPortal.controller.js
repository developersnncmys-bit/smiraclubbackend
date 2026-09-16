const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Partner = require('../models/Partner');
const OtpChallenge = require('../models/OtpChallenge');
const Booking = require('../models/Booking');
const InventoryItem = require('../models/InventoryItem');
const Ticket = require('../models/Ticket');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const sms = require('../helpers/sms');

const OTP_MINUTES = 5;
const OTP_ATTEMPTS = 5;
const RESEND_SECONDS = 45;

/**
 * Where a listing can be in the client's partner flow:
 *
 *   Registration → Admin review → (Needs changes → Admin review) → Contract → Live
 *
 * A partner may only edit their listing while it is theirs to edit — before
 * they submit it, or after the desk has sent it back.
 */
const EDITABLE = ['Registration', 'Needs changes', 'Enquiry'];

const sign = (partner) =>
  jwt.sign({ sub: partner._id, kind: 'partner' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

/** The stages a listing passes through before it is live. */
const BEFORE_LIVE = ['Registration', 'Admin review', 'Needs changes', 'Contract', 'Rejected'];

/**
 * Live means active and past the review. Partners that predate the flow were
 * made active without ever having a stage, so they are judged by what they are
 * not — mid-review — rather than by a stage they were never given.
 */
const isLive = (p) => p.status === 'Active' && !BEFORE_LIVE.includes(p.stage);

/**
 * Theirs to edit only before it is submitted, or once it is sent back — and
 * never once they are live, when a change would go straight to members
 * without anybody reviewing it.
 */
const canEdit = (p) => EDITABLE.includes(p.stage) && !isLive(p);

/** Who they are — theirs to see, and nothing of ours. */
const shape = (p) => ({
  id: p._id,
  code: p.code,
  name: p.name,
  category: p.category,
  location: p.location,
  contact: p.contact,
  phone: p.phone,
  email: p.email,
  status: p.status,
  approval: p.approval,
  verification: p.verification,
  stage: p.stage,
  live: isLive(p),
  editable: canEdit(p),
  reviewNote: p.reviewNote || '',
  submittedOn: p.submittedOn,
  contractSignedOn: p.contractSignedOn,
  rooms: p.rooms,
  rating: p.rating,
  responseMins: p.responseMins,
  commission: p.commission,
  ratePlan: p.ratePlan,
  contractEndsOn: p.contractEndsOn,
  documents: p.documents || [],
});

/**
 * A booking as the partner sees it.
 *
 * The amount is their payout, not the member's price: what Smira sells a room
 * for is ours, and a partner who could read it would read our margin. Guest
 * contact details stay with the desk too — the partner needs a name to put on
 * the room, not a phone number.
 */
const bookingFor = (b) => ({
  id: b._id,
  code: b.code,
  guest: b.customerName || '—',
  property: b.hotel || b.vendorName || '—',
  roomType: b.roomType || '—',
  rooms: b.rooms,
  adults: b.adults,
  children: b.children,
  mealPlan: b.mealPlan || '—',
  checkIn: b.checkIn,
  checkOut: b.checkOut,
  nights: b.nights,
  payout: b.vendorCost || 0,
  paidOut: b.vendorPaid || 0,
  status: b.status,
  confirmation: b.confirmation?.status || 'Waiting on the hotel',
  confirmedAt: b.confirmation?.confirmedAt,
});

const tooSoon = (lastSentAt) =>
  lastSentAt && Date.now() - lastSentAt.getTime() < RESEND_SECONDS * 1000
    ? Math.ceil((RESEND_SECONDS * 1000 - (Date.now() - lastSentAt.getTime())) / 1000)
    : 0;

// -- Signing in, or registering ----------------------------------------------

/**
 * One door for both. A number we know gets a sign-in code; a number we do not
 * gets a registration code, held in a challenge rather than on a partner,
 * because nothing should be created until the number is proved.
 */
exports.requestOtp = catchAsync(async (req, res) => {
  const digits = Partner.digits(req.body.phone);
  if (!/^[6-9]\d{9}$/.test(digits)) throw ApiError.badRequest('Enter a ten digit mobile number');

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_MINUTES * 60000);

  const partner = await Partner.findOne({ phoneDigits: digits }).select('+otp.codeHash');

  if (partner) {
    if (partner.status === 'Blacklisted') throw ApiError.forbidden('That partner account has been closed');
    const wait = tooSoon(partner.otp?.lastSentAt);
    if (wait) throw new ApiError(429, `Ask again in ${wait} seconds`);

    partner.otp = { codeHash, expiresAt, attempts: 0, lastSentAt: new Date() };
    await partner.save({ validateBeforeSave: false });
  } else {
    const existing = await OtpChallenge.findOne({ phoneDigits: digits, purpose: 'partner-signup' });
    const wait = tooSoon(existing?.lastSentAt);
    if (wait) throw new ApiError(429, `Ask again in ${wait} seconds`);

    await OtpChallenge.findOneAndUpdate(
      { phoneDigits: digits, purpose: 'partner-signup' },
      { codeHash, expiresAt, attempts: 0, lastSentAt: new Date(), createdAt: new Date() },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  const sent = await sms.send(`+91 ${digits}`, code);

  res.json({
    success: true,
    message: sent.delivered ? 'Code sent' : 'Code generated',
    data: {
      name: partner?.name || '',
      isNew: !partner,
      expiresInMinutes: OTP_MINUTES,
      ...(sent.devCode ? { devCode: sent.devCode, demo: true } : {}),
    },
  });
});

/** Checks a code against whatever is holding it, and counts a wrong guess. */
async function spend(holder, code, save) {
  if (!holder?.codeHash || !holder.expiresAt) throw ApiError.unauthorized('Ask for a code first');
  if (holder.expiresAt < new Date()) throw ApiError.unauthorized('That code has expired — ask for another');
  if ((holder.attempts || 0) >= OTP_ATTEMPTS) throw ApiError.forbidden('Too many wrong codes — ask for a new one');

  const ok = await bcrypt.compare(code, holder.codeHash);
  if (!ok) {
    holder.attempts = (holder.attempts || 0) + 1;
    await save();
    const left = OTP_ATTEMPTS - holder.attempts;
    throw ApiError.unauthorized(left > 0 ? `That code is wrong — ${left} tries left` : 'That code is wrong');
  }
}

exports.verifyOtp = catchAsync(async (req, res) => {
  const digits = Partner.digits(req.body.phone);
  const code = String(req.body.code || '').replace(/\D/g, '');
  if (!digits || !code) throw ApiError.badRequest('The number and the code are both needed');

  let partner = await Partner.findOne({ phoneDigits: digits }).select('+otp.codeHash');
  let isNew = false;

  if (partner) {
    await spend(partner.otp, code, () => partner.save({ validateBeforeSave: false }));
    partner.otp = undefined;
  } else {
    const challenge = await OtpChallenge.findOne({ phoneDigits: digits, purpose: 'partner-signup' }).select(
      '+codeHash'
    );
    if (!challenge) throw ApiError.unauthorized('That code did not work');
    await spend(challenge, code, () => challenge.save());
    await challenge.deleteOne();

    // Proved. Now — and only now — the partner exists, at the very start of
    // the flow, with nothing but the number they proved.
    partner = new Partner({
      name: 'New partner',
      phone: `+91 ${digits}`,
      stage: 'Registration',
      status: 'Pending',
      approval: 'Waiting',
      verification: 'Waiting',
      activities: [{ at: new Date(), text: 'Registered in the partner portal' }],
    });
    isNew = true;
  }

  partner.lastLoginAt = new Date();
  await partner.save({ validateBeforeSave: false });

  res.json({ success: true, token: sign(partner), data: { ...shape(partner), isNew } });
});

// -- The five-step listing ---------------------------------------------------

exports.getListing = catchAsync(async (req, res) => {
  res.json({
    success: true,
    data: { partner: shape(req.partner), listing: req.partner.listing || {} },
  });
});

const SECTIONS = [
  'account', 'property', 'location', 'rooms', 'photos', 'amenities', 'facilities',
  'rules', 'pricing', 'inventory', 'policies', 'ownership', 'bank',
];

/** A property type, filed under the category the desk filters by. */
const CATEGORY_OF = {
  Hotel: 'Hotel',
  Resort: 'Hotel',
  Homestay: 'Villa',
  Villa: 'Villa',
  Camp: 'Activity',
  Lifestyle: 'Lifestyle',
};

/**
 * Saves whichever sections were sent, and nothing else.
 *
 * Only the sections on the list are read from the body, and the listing
 * schema itself drops any field it does not declare — so the stage, the
 * approval and the status are never the partner's to post.
 */
exports.saveListing = catchAsync(async (req, res) => {
  const partner = req.partner;
  if (!canEdit(partner)) {
    throw ApiError.badRequest('Your listing is with the Smira desk and cannot be changed right now');
  }

  const body = { ...(req.body || {}) };

  /**
   * Links are shown to the desk as links, so only web addresses are kept. A
   * `javascript:` or `data:` value would otherwise sit waiting for a staff
   * member to click it.
   */
  const web = (u) => (/^https?:\/\/\S+$/i.test(String(u || '').trim()) ? String(u).trim() : '');
  if (body.photos) {
    body.photos = {
      property: (Array.isArray(body.photos.property) ? body.photos.property : []).map(web).filter(Boolean),
      rooms: (Array.isArray(body.photos.rooms) ? body.photos.rooms : []).map(web).filter(Boolean),
    };
  }
  if (body.location) body.location = { ...body.location, mapsUrl: web(body.location.mapsUrl) };
  if (body.ownership?.documentLinks) {
    const d = body.ownership.documentLinks;
    body.ownership = {
      ...body.ownership,
      documentLinks: {
        ownershipProof: web(d.ownershipProof),
        leaseAgreement: web(d.leaseAgreement),
        authorisation: web(d.authorisation),
      },
    };
  }
  if (body.bank) body.bank = { ...body.bank, proofLink: web(body.bank.proofLink) };

  const listing = partner.listing || {};
  for (const key of SECTIONS) {
    if (body[key] !== undefined) listing[key] = body[key];
  }
  if (body.step) listing.step = Math.max(listing.step || 1, Math.min(5, Number(body.step) || 1));
  if (typeof body.agreementAccepted === 'boolean') {
    listing.agreementAccepted = body.agreementAccepted;
    listing.agreementAcceptedAt = body.agreementAccepted ? new Date() : undefined;
  }
  partner.listing = listing;

  // Keep the headline fields in step, so the desk's lists read properly.
  const l = partner.listing;
  if (l.property?.name) partner.name = l.property.name;
  if (l.property?.type) partner.category = CATEGORY_OF[l.property.type] || partner.category;
  if (l.property?.type) partner.businessType = l.property.type;
  if (l.location?.city) partner.location = [l.location.city, l.location.state].filter(Boolean).join(', ');
  if (l.account?.fullName) partner.contact = l.account.fullName;
  if (l.account?.email) partner.email = l.account.email;
  if (l.ownership?.gst) partner.gst = l.ownership.gst;
  if (l.ownership?.pan) partner.pan = l.ownership.pan;
  if (l.bank?.accountNumber) {
    partner.bank = [l.bank.bankName, `••••${String(l.bank.accountNumber).slice(-4)}`, l.bank.ifsc]
      .filter(Boolean)
      .join(' · ');
  }
  if (Array.isArray(l.rooms)) partner.rooms = l.rooms.reduce((n, r) => n + (Number(r.count) || 0), 0);

  await partner.save();
  res.json({ success: true, data: { partner: shape(partner), listing: partner.listing } });
});

/** What has to be there before the desk will look at it. */
function missingFrom(l = {}) {
  const missing = [];
  const need = (ok, label) => !ok && missing.push(label);

  need(l.account?.fullName, 'Your full name (step 1)');
  need(l.property?.type, 'Property type (step 1)');
  need(l.property?.name, 'Property name (step 1)');
  // The sheet makes address verification mandatory, so the address is too.
  need(l.location?.line1, 'Address line 1 (step 1)');
  need(l.location?.city, 'City (step 1)');
  need(l.location?.state, 'State (step 1)');
  need(l.location?.pin, 'PIN code (step 1)');
  need(
    (l.rooms || []).some((r) => r.name && Number(r.count) > 0),
    'At least one room category with a number of rooms (step 2)'
  );
  need(Number(l.pricing?.partnerRate) > 0, 'Smira partner rate (step 4)');
  need(l.ownership?.type, 'Ownership type (step 5)');
  need(l.bank?.holder && l.bank?.accountNumber && l.bank?.ifsc, 'Bank account holder, number and IFSC (step 5)');
  need(l.agreementAccepted, 'The partner agreement, ticked (step 5)');

  return missing;
}

exports.submitListing = catchAsync(async (req, res) => {
  const partner = req.partner;
  if (!canEdit(partner)) {
    throw ApiError.badRequest('Your listing has already been submitted');
  }

  const missing = missingFrom(partner.listing);
  if (missing.length) {
    throw new ApiError(400, 'A few things are still needed before you can submit', missing);
  }

  const resubmitted = partner.stage === 'Needs changes';
  partner.stage = 'Admin review';
  partner.approval = 'Waiting';
  partner.submittedOn = new Date();
  partner.activities.push({
    at: new Date(),
    text: resubmitted ? 'Listing resubmitted with changes' : 'Listing submitted for review',
  });
  await partner.save();

  res.json({ success: true, data: { partner: shape(partner), listing: partner.listing } });
});

// -- Their dashboard ---------------------------------------------------------

const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

exports.dashboard = catchAsync(async (req, res) => {
  const me = req.partner;

  const [bookings, stock, tickets] = await Promise.all([
    Booking.find({ vendor: me._id }).sort({ checkIn: 1 }).limit(200).lean(),
    InventoryItem.find({ partner: me._id }).lean(),
    Ticket.find({ partner: me._id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);

  const today = startOfDay();
  const tomorrow = new Date(today.getTime() + 86400000);
  const weekOut = new Date(today.getTime() + 7 * 86400000);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const live = bookings.filter((b) => b.status !== 'Cancelled');
  const inWindow = (b, from, to) => b.checkIn && b.checkIn >= from && b.checkIn < to;

  const available = stock.reduce(
    (sum, i) => sum + Math.max(0, (i.units || 0) - (i.booked || 0) - (i.blocked || 0)),
    0
  );

  const overview = {
    bookings: bookings.length,
    upcoming: live.filter((b) => inWindow(b, tomorrow, weekOut)).length,
    today: live.filter((b) => inWindow(b, today, tomorrow)).length,
    rooms: available,
    revenue: live
      .filter((b) => !b.checkIn || b.checkIn >= monthStart)
      .reduce((s, b) => s + (b.vendorCost || 0), 0),
    pending: live.reduce((s, b) => s + Math.max(0, (b.vendorCost || 0) - (b.vendorPaid || 0)), 0),
    cancellations: bookings.filter((b) => b.status === 'Cancelled').length,
  };

  res.json({
    success: true,
    data: {
      partner: shape(me),
      overview,
      bookings: bookings.map(bookingFor),
      inventory: stock.map((i) => ({
        id: i._id,
        name: i.name,
        units: i.units || 0,
        booked: i.booked || 0,
        blocked: i.blocked || 0,
        available: Math.max(0, (i.units || 0) - (i.booked || 0) - (i.blocked || 0)),
        status: i.status,
      })),
      tickets: tickets.map((t) => ({
        id: t._id,
        code: t.code,
        subject: t.subCategory || t.category || 'Ticket',
        status: t.status || t.stage,
        createdAt: t.createdAt,
      })),
    },
  });
});

// -- Answering a booking -----------------------------------------------------

/**
 * Available or not — the partner's response from the sheet's booking flow.
 *
 * The booking is looked up by its id *and* this partner, so an id belonging to
 * somebody else comes back as not found rather than as a booking they may now
 * edit. Only the confirmation moves: whether the booking is confirmed to the
 * member still waits on the desk and on payment.
 */
const answer = (accepted) =>
  catchAsync(async (req, res) => {
    if (!isLive(req.partner)) throw ApiError.forbidden('Your listing is not live yet');

    const booking = await Booking.findOne({ _id: req.params.id, vendor: req.partner._id });
    if (!booking) throw ApiError.notFound('That booking is not one of yours');
    if (booking.status === 'Cancelled') throw ApiError.badRequest('That booking has been cancelled');

    booking.confirmation = {
      ...(booking.confirmation?.toObject?.() || booking.confirmation || {}),
      status: accepted ? 'Confirmed by partner' : 'Declined by partner',
      confirmedAt: accepted ? new Date() : undefined,
    };
    await booking.save({ validateBeforeSave: false });

    req.partner.activities.push({
      at: new Date(),
      text: `${accepted ? 'Accepted' : 'Declined'} ${booking.code} in the partner portal`,
    });
    await req.partner.save({ validateBeforeSave: false });

    res.json({ success: true, data: bookingFor(booking) });
  });

exports.accept = answer(true);
exports.decline = answer(false);
