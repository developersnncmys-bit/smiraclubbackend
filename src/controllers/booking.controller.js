const Booking = require('../models/Booking');
const Customer = require('../models/Customer');
const InventoryItem = require('../models/InventoryItem');
const Partner = require('../models/Partner');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { scopeFilter } = require('../middleware/scope');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');

const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The partner who runs what a booking is for — the one it was already sent
 * to, or else the partner whose name, listed property or stock carries the
 * hotel or package name on the booking.
 */
async function partnerFor(booking) {
  // A partner the desk named is used either way; one we found ourselves is
  // only used while their own switch says they are taking bookings.
  if (booking.vendor) return Partner.findById(booking.vendor);
  const open = { acceptingBookings: { $ne: false } };
  const names = [booking.hotel, booking.packageName, booking.vendorName].map((n) => String(n || '').trim()).filter(Boolean);
  for (const n of names) {
    const exact = new RegExp(`^${escape(n)}$`, 'i');
    const found = await Partner.findOne({ ...open, $or: [{ name: exact }, { 'listing.property.name': exact }] });
    if (found) return found;
    const item = await InventoryItem.findOne({ name: exact, partner: { $ne: null } }).select('partner');
    if (item) return Partner.findOne({ _id: item.partner, ...open });
  }
  return null;
}

/**
 * A confirmed booking goes to its partner: it is linked to them, so it shows
 * on their portal waiting for them to accept, and the trail says so. With no
 * partner to be found the trail says that instead, for the desk to pick one.
 */
async function sendToPartner(booking, byName) {
  const partner = await partnerFor(booking);
  if (!partner) {
    booking.activities.push({ kind: 'note', text: 'Confirmed — no partner is linked to this hotel yet; choose one to send it', byName });
    await booking.save();
    return booking;
  }
  const answered = /by partner/i.test(booking.confirmation?.status || '');
  booking.vendor = partner._id;
  booking.vendorName = partner.listing?.property?.name || partner.name;
  if (!answered) booking.set('confirmation.status', 'Sent to partner');
  booking.activities.push({ kind: 'status', text: `Sent to ${partner.name} to accept`, byName });
  await booking.save();
  return booking;
}

const base = crud(Booking, {
  name: 'Booking',
  searchable: ['customerName', 'hotel', 'destination', 'code'],
  populate: [
    { path: 'owner', select: 'name code' },
    { path: 'customer', select: 'name phone tier' },
  ],
  ownerField: 'owner',
  // Confirming a booking (or pointing a confirmed one at a partner) sends it on.
  afterUpdate: async (doc, req) => {
    const confirmedNow = req.body?.status === 'Confirmed';
    const repointed = req.body?.vendor !== undefined && doc.status === 'Confirmed';
    if (confirmedNow || repointed) await sendToPartner(doc, req.user?.name || 'Desk');
  },
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.update = base.update;
exports.remove = base.remove;

/** Taking a booking also takes the units out of stock. */
exports.create = catchAsync(async (req, res) => {
  if (!req.body.customer) throw ApiError.badRequest('Pick the customer this booking is for');
  const customer = await Customer.findById(req.body.customer);
  if (!customer) throw ApiError.badRequest('That customer does not exist');

  const booking = await Booking.create({
    ...req.body,
    customerName: customer.name,
    owner: req.body.owner || req.user._id,
    handledBy: { created: req.user._id, handled: req.body.owner || req.user._id },
    createdBy: req.user._id,
  });

  if (booking.inventory) {
    await InventoryItem.findByIdAndUpdate(booking.inventory, { $inc: { booked: booking.rooms || 1 } });
  }
  await booking.populate([
    { path: 'owner', select: 'name code' },
    { path: 'customer', select: 'name phone tier' },
  ]);

  await record(req, 'create', 'Booking', booking._id, `${booking.code} for ${customer.name}`);
  res.status(201).json({ success: true, data: booking });
});

exports.confirm = catchAsync(async (req, res) => {
  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.id, ...scopeFilter(req, 'owner') },
    {
      status: 'Confirmed',
      'confirmation.status': 'Hotel confirmed',
      'confirmation.reference': req.body.reference,
      'confirmation.confirmedAt': new Date(),
      'handledBy.confirmed': req.user._id,
      $push: { activities: { kind: 'status', text: 'Confirmed with the hotel', byName: req.user.name } },
    },
    { new: true }
  );
  if (!booking) throw ApiError.notFound('Booking not found');
  await sendToPartner(booking, req.user.name);
  await record(req, 'update', 'Booking', booking._id, `${booking.code} confirmed`);
  res.json({ success: true, data: booking });
});

/** Cancelling puts the stock back and records who asked for it. */
exports.cancel = catchAsync(async (req, res) => {
  const { reason, by = 'Customer', refund = 0 } = req.body;
  if (!reason) throw ApiError.badRequest('A cancellation needs a reason');

  const booking = await Booking.findOne({ _id: req.params.id, ...scopeFilter(req, 'owner') });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status === 'Cancelled') throw ApiError.conflict('That booking is already cancelled');

  booking.status = 'Cancelled';
  booking.cancelledOn = new Date();
  booking.cancelledReason = reason;
  booking.cancelledBy = by;
  booking.refund = Number(refund) || 0;
  booking.handledBy.cancelled = req.user._id;
  booking.activities.push({ kind: 'status', text: `Cancelled — ${reason}`, byName: req.user.name });
  await booking.save();

  if (booking.inventory) {
    await InventoryItem.findByIdAndUpdate(booking.inventory, { $inc: { booked: -(booking.rooms || 1) } });
  }

  await record(req, 'cancel', 'Booking', booking._id, `${booking.code} cancelled — ${reason}`);
  res.json({ success: true, data: booking });
});

exports.reschedule = catchAsync(async (req, res) => {
  const { checkIn, checkOut, note } = req.body;
  if (!checkIn) throw ApiError.badRequest('A new check-in date is needed');

  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.id, ...scopeFilter(req, 'owner') },
    {
      checkIn,
      checkOut,
      status: 'Rescheduled',
      'handledBy.modified': req.user._id,
      $push: { activities: { kind: 'status', text: note || 'Rescheduled', byName: req.user.name } },
    },
    { new: true }
  );
  if (!booking) throw ApiError.notFound('Booking not found');
  res.json({ success: true, data: booking });
});

/** Check-ins, check-outs and departures across a month. */
exports.calendar = catchAsync(async (req, res) => {
  const month = Number(req.query.month);
  const year = Number(req.query.year) || new Date().getFullYear();
  const from = new Date(year, Number.isNaN(month) ? new Date().getMonth() : month, 1);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59);

  const bookings = await Booking.find({
    $or: [
      { checkIn: { $gte: from, $lte: to } },
      { checkOut: { $gte: from, $lte: to } },
      { departureOn: { $gte: from, $lte: to } },
    ],
  })
    .select('code customerName hotel destination checkIn checkOut departureOn status bookingType amount')
    .lean();

  const events = [];
  bookings.forEach((b) => {
    if (b.checkIn >= from && b.checkIn <= to) events.push({ ...b, on: b.checkIn, kind: 'Check-in' });
    if (b.checkOut && b.checkOut >= from && b.checkOut <= to) events.push({ ...b, on: b.checkOut, kind: 'Check-out' });
    if (b.departureOn && b.departureOn >= from && b.departureOn <= to)
      events.push({ ...b, on: b.departureOn, kind: 'Departure' });
  });

  res.json({ success: true, data: { from, to, events: events.sort((a, b) => a.on - b.on) } });
});

/** Every booking by where it stands, and what each state is worth. */
exports.overview = catchAsync(async (req, res) => {
  const [byStatus, byType, money] = await Promise.all([
    Booking.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$amount' } } }]),
    Booking.aggregate([{ $group: { _id: '$bookingType', count: { $sum: 1 }, value: { $sum: '$amount' } } }]),
    Booking.aggregate([
      {
        $group: {
          _id: null,
          value: { $sum: '$amount' },
          collected: { $sum: '$paid' },
          vendorCost: { $sum: '$vendorCost' },
          refunds: { $sum: '$refund' },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const m = money[0] || {};
  const markup = Math.max(0, (m.value || 0) - (m.vendorCost || 0));

  res.json({
    success: true,
    data: {
      byStatus,
      byType,
      total: m.count || 0,
      value: m.value || 0,
      collected: m.collected || 0,
      pending: Math.max(0, (m.value || 0) - (m.collected || 0)),
      vendorCost: m.vendorCost || 0,
      markup,
      refunds: m.refunds || 0,
      averageValue: m.count ? Math.round((m.value || 0) / m.count) : 0,
    },
  });
});
