const Partner = require('../models/Partner');
const Booking = require('../models/Booking');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');

const base = crud(Partner, {
  name: 'Partner',
  searchable: ['name', 'location', 'contact', 'email', 'code'],
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/** Papers checked. */
exports.verify = catchAsync(async (req, res) => {
  const partner = await Partner.findByIdAndUpdate(
    req.params.id,
    {
      verification: 'Verified',
      stage: 'Verified',
      $push: { activities: { at: new Date(), text: `Papers verified by ${req.user.name}` } },
    },
    { new: true }
  );
  if (!partner) throw ApiError.notFound('Partner not found');
  await record(req, 'verify', 'Partner', partner._id, `${partner.name} verified`);
  res.json({ success: true, data: partner });
});

/** Signed off and live. */
exports.approve = catchAsync(async (req, res) => {
  const partner = await Partner.findById(req.params.id);
  if (!partner) throw ApiError.notFound('Partner not found');
  if (partner.verification !== 'Verified') {
    throw ApiError.badRequest('The papers have to be verified before it can go live');
  }

  partner.approval = 'Approved';
  partner.stage = 'Active';
  partner.status = 'Active';
  partner.activities.push({ at: new Date(), text: `Approved by ${req.user.name}` });
  await partner.save();

  await record(req, 'approve', 'Partner', partner._id, `${partner.name} approved`);
  res.json({ success: true, data: partner });
});

exports.reject = catchAsync(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw ApiError.badRequest('A rejection needs a reason');

  const partner = await Partner.findByIdAndUpdate(
    req.params.id,
    {
      approval: 'Rejected',
      verification: 'Rejected',
      status: 'Paused',
      stage: 'Rejected',
      rejectedReason: reason,
      $push: { activities: { at: new Date(), text: `Rejected — ${reason}` } },
    },
    { new: true }
  );
  if (!partner) throw ApiError.notFound('Partner not found');
  res.json({ success: true, data: partner });
});

/** What each supplier is actually doing, from the bookings placed with them. */
exports.performance = catchAsync(async (req, res) => {
  const partners = await Partner.find().lean();
  const bookings = await Booking.aggregate([
    { $match: { vendor: { $ne: null } } },
    {
      $group: {
        _id: '$vendor',
        bookings: { $sum: 1 },
        value: { $sum: '$amount' },
        cost: { $sum: '$vendorCost' },
        paid: { $sum: '$vendorPaid' },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] } },
        confirmed: { $sum: { $cond: [{ $eq: ['$status', 'Confirmed'] }, 1, 0] } },
      },
    },
  ]);

  const totalCommission = partners.reduce((s, p) => s + Number(p.commissionEarned || 0), 0);

  res.json({
    success: true,
    data: partners.map((p) => {
      const b = bookings.find((x) => String(x._id) === String(p._id)) || {};
      const booked = b.bookings || p.bookings || 0;
      return {
        id: p._id,
        name: p.name,
        category: p.category,
        bookings: booked,
        revenue: b.value || p.revenue || 0,
        commission: p.commissionEarned || 0,
        cancellationRate: booked ? Math.round(((b.cancelled || p.cancelled || 0) / booked) * 100) : 0,
        confirmationRate: booked ? Math.round(((b.confirmed || p.confirmed || 0) / booked) * 100) : 0,
        rating: p.rating,
        responseMins: p.responseMins,
        pendingConfirmations: Math.max(0, booked - (b.confirmed || p.confirmed || 0) - (b.cancelled || p.cancelled || 0)),
        payable: Math.max(0, (b.cost || p.payable || 0) - (b.paid || p.paid || 0)),
        profitShare: totalCommission ? Math.round((Number(p.commissionEarned || 0) / totalCommission) * 100) : 0,
        contractEndsOn: p.contractEndsOn,
      };
    }),
  });
});

/** What the hotels are owed against each booking. */
exports.payables = catchAsync(async (req, res) => {
  const rows = await Booking.find({ vendorCost: { $gt: 0 } })
    .select('code customerName vendorName vendorCost vendorPaid checkIn status vendor')
    .populate('vendor', 'name')
    .lean();

  res.json({
    success: true,
    data: rows.map((b) => ({
      ...b,
      pending: Math.max(0, Number(b.vendorCost || 0) - Number(b.vendorPaid || 0)),
    })),
  });
});
