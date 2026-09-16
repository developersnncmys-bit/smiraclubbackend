const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Partner = require('../models/Partner');
const Booking = require('../models/Booking');
const InventoryItem = require('../models/InventoryItem');
const Ticket = require('../models/Ticket');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const sms = require('../helpers/sms');

const OTP_MINUTES = 5;
const OTP_ATTEMPTS = 5;
const RESEND_SECONDS = 45;

const sign = (partner) =>
  jwt.sign({ sub: partner._id, kind: 'partner' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

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

// -- Signing in --------------------------------------------------------------

exports.requestOtp = catchAsync(async (req, res) => {
  const digits = Partner.digits(req.body.phone);
  if (digits.length < 10) throw ApiError.badRequest('Enter a ten digit mobile number');

  const partner = await Partner.findOne({ phoneDigits: digits }).select('+otp.codeHash');
  if (!partner) throw ApiError.notFound('No partner is registered against that number');
  if (partner.status === 'Blacklisted') throw ApiError.forbidden('That partner account has been closed');

  if (partner.otp?.lastSentAt && Date.now() - partner.otp.lastSentAt.getTime() < RESEND_SECONDS * 1000) {
    const wait = Math.ceil((RESEND_SECONDS * 1000 - (Date.now() - partner.otp.lastSentAt.getTime())) / 1000);
    throw new ApiError(429, `Ask again in ${wait} seconds`);
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  partner.otp = {
    codeHash: await bcrypt.hash(code, 10),
    expiresAt: new Date(Date.now() + OTP_MINUTES * 60000),
    attempts: 0,
    lastSentAt: new Date(),
  };
  await partner.save({ validateBeforeSave: false });

  const sent = await sms.send(partner.phone, code);

  res.json({
    success: true,
    message: sent.delivered ? 'Code sent' : 'Code generated',
    data: {
      name: partner.name,
      expiresInMinutes: OTP_MINUTES,
      ...(sent.devCode ? { devCode: sent.devCode, demo: true } : {}),
    },
  });
});

exports.verifyOtp = catchAsync(async (req, res) => {
  const digits = Partner.digits(req.body.phone);
  const code = String(req.body.code || '').replace(/\D/g, '');
  if (!digits || !code) throw ApiError.badRequest('The number and the code are both needed');

  const partner = await Partner.findOne({ phoneDigits: digits }).select('+otp.codeHash');
  if (!partner) throw ApiError.unauthorized('That code did not work');
  if (!partner.otp?.codeHash || !partner.otp.expiresAt) throw ApiError.unauthorized('Ask for a code first');
  if (partner.otp.expiresAt < new Date()) throw ApiError.unauthorized('That code has expired — ask for another');
  if ((partner.otp.attempts || 0) >= OTP_ATTEMPTS) {
    throw ApiError.forbidden('Too many wrong codes — ask for a new one');
  }

  const ok = await bcrypt.compare(code, partner.otp.codeHash);
  if (!ok) {
    partner.otp.attempts = (partner.otp.attempts || 0) + 1;
    await partner.save({ validateBeforeSave: false });
    const left = OTP_ATTEMPTS - partner.otp.attempts;
    throw ApiError.unauthorized(left > 0 ? `That code is wrong — ${left} tries left` : 'That code is wrong');
  }

  // Spent. A code works exactly once.
  partner.otp = undefined;
  partner.lastLoginAt = new Date();
  await partner.save({ validateBeforeSave: false });

  res.json({ success: true, token: sign(partner), data: shape(partner) });
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
        subject: t.subject || t.title || t.category || 'Ticket',
        status: t.status || t.stage,
        createdAt: t.createdAt,
      })),
    },
  });
});

// -- Answering a booking -----------------------------------------------------

/**
 * Accept or decline — the only thing a partner can change.
 *
 * The booking is looked up by its id *and* this partner, so an id belonging to
 * somebody else comes back as not found rather than as a booking they may now
 * edit. Only the confirmation moves: whether the booking is confirmed to the
 * member still waits on payment, which is the desk's step, not theirs.
 */
const answer = (accepted) =>
  catchAsync(async (req, res) => {
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
