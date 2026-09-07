const Booking = require('../models/Booking');
const Customer = require('../models/Customer');
const InventoryItem = require('../models/InventoryItem');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');

const base = crud(Booking, {
  name: 'Booking',
  searchable: ['customerName', 'hotel', 'destination', 'code'],
  populate: [
    { path: 'owner', select: 'name code' },
    { path: 'customer', select: 'name phone tier' },
  ],
  ownerField: 'owner',
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.update = base.update;
exports.remove = base.remove;

/** Taking a booking also takes the units out of stock. */
exports.create = catchAsync(async (req, res) => {
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

  await record(req, 'create', 'Booking', booking._id, `${booking.code} for ${customer.name}`);
  res.status(201).json({ success: true, data: booking });
});

exports.confirm = catchAsync(async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(
    req.params.id,
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
  await record(req, 'update', 'Booking', booking._id, `${booking.code} confirmed`);
  res.json({ success: true, data: booking });
});

/** Cancelling puts the stock back and records who asked for it. */
exports.cancel = catchAsync(async (req, res) => {
  const { reason, by = 'Customer', refund = 0 } = req.body;
  if (!reason) throw ApiError.badRequest('A cancellation needs a reason');

  const booking = await Booking.findById(req.params.id);
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

  const booking = await Booking.findByIdAndUpdate(
    req.params.id,
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
