const MembershipPlan = require('../models/MembershipPlan');
const Membership = require('../models/Membership');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');

const base = crud(MembershipPlan, {
  name: 'Plan',
  searchable: ['name', 'tagline'],
  defaultSort: 'sortOrder price',
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;

/** A plan somebody is on cannot simply disappear — unpublish it instead. */
exports.remove = catchAsync(async (req, res) => {
  const sold = await Membership.countDocuments({ plan: req.params.id });
  if (sold) throw ApiError.conflict(`${sold} membership(s) are on that plan — unpublish it instead`);
  const doc = await MembershipPlan.findByIdAndDelete(req.params.id);
  if (!doc) throw ApiError.notFound('Plan not found');
  res.json({ success: true, data: { id: req.params.id } });
});

/** What each plan has actually earned. */
exports.performance = catchAsync(async (req, res) => {
  const plans = await MembershipPlan.find().sort('price').lean();
  const rows = await Membership.aggregate([
    {
      $group: {
        _id: '$plan',
        sold: { $sum: 1 },
        gross: { $sum: '$amount' },
        collected: { $sum: '$paid' },
        renewals: { $sum: { $cond: [{ $eq: ['$movement', 'Renewal'] }, 1, 0] } },
        upgrades: { $sum: { $cond: [{ $eq: ['$movement', 'Upgrade'] }, 1, 0] } },
      },
    },
  ]);

  res.json({
    success: true,
    data: plans.map((p) => {
      const r = rows.find((x) => String(x._id) === String(p._id)) || {};
      const sold = r.sold || 0;
      return {
        plan: p.name,
        price: p.price,
        sold,
        gross: r.gross || 0,
        collected: r.collected || 0,
        outstanding: Math.max(0, (r.gross || 0) - (r.collected || 0)),
        averageValue: sold ? Math.round((r.gross || 0) / sold) : 0,
        renewals: r.renewals || 0,
        upgrades: r.upgrades || 0,
      };
    }),
  });
});
