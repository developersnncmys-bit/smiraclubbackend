const Offer = require('../models/Offer');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');

const base = crud(Offer, { name: 'Offer', searchable: ['name', 'couponCode', 'code'] });

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/** Checking a coupon before it is honoured. */
exports.validateCoupon = catchAsync(async (req, res) => {
  const code = String(req.params.couponCode || '').toUpperCase();
  const offer = await Offer.findOne({ couponCode: code });
  if (!offer) throw ApiError.notFound('No offer with that code');

  const now = new Date();
  const problems = [];
  if (offer.status !== 'Live') problems.push('That offer is not live');
  if (offer.startsOn && offer.startsOn > now) problems.push('That offer has not started yet');
  if (offer.endsOn && offer.endsOn < now) problems.push('That offer has run out');
  if (offer.usageLimit && offer.used >= offer.usageLimit) problems.push('That offer has been used up');

  const spend = Number(req.query.spend || 0);
  if (offer.minSpend && spend < offer.minSpend) problems.push(`It needs a minimum spend of ${offer.minSpend}`);

  let discount = 0;
  if (!problems.length) {
    discount = offer.kind === 'Percent off' ? Math.round((spend * offer.value) / 100) : offer.value;
    if (offer.maxDiscount) discount = Math.min(discount, offer.maxDiscount);
  }

  res.json({ success: true, data: { valid: !problems.length, problems, offer, discount } });
});

exports.redeem = catchAsync(async (req, res) => {
  const offer = await Offer.findByIdAndUpdate(req.params.id, { $inc: { used: 1 } }, { new: true });
  if (!offer) throw ApiError.notFound('Offer not found');
  res.json({ success: true, data: offer });
});
