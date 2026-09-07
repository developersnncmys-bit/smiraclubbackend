const Referral = require('../models/Referral');
const Customer = require('../models/Customer');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');

const base = crud(Referral, {
  name: 'Referral',
  searchable: ['referrerName', 'referredName', 'referralCode', 'code'],
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/** Paying a referral out also credits it on the member's own record. */
exports.pay = catchAsync(async (req, res) => {
  const referral = await Referral.findById(req.params.id);
  if (!referral) throw ApiError.notFound('Referral not found');
  if (referral.paid) throw ApiError.conflict('That referral has already been paid');
  if (!['Booked', 'Member'].includes(referral.status)) {
    throw ApiError.badRequest('A referral only pays out once it has converted');
  }

  referral.paid = true;
  referral.paidOn = new Date();
  await referral.save();

  await Customer.findByIdAndUpdate(referral.referrer, {
    $inc: { 'referral.redeemed': Number(referral.reward || 0) },
  });

  res.json({ success: true, data: referral });
});

/** Who has sent the most business, and what it earned them. */
exports.leaderboard = catchAsync(async (req, res) => {
  const rows = await Referral.aggregate([
    {
      $group: {
        _id: '$referrer',
        name: { $first: '$referrerName' },
        total: { $sum: 1 },
        converted: { $sum: { $cond: [{ $in: ['$status', ['Booked', 'Member']] }, 1, 0] } },
        earned: { $sum: '$reward' },
        paid: { $sum: { $cond: ['$paid', '$reward', 0] } },
      },
    },
    { $sort: { converted: -1, total: -1 } },
  ]);

  res.json({
    success: true,
    data: rows.map((r) => ({ ...r, pending: Math.max(0, r.earned - r.paid) })),
  });
});
