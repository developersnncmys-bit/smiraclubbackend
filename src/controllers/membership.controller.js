const Membership = require('../models/Membership');
const MembershipPlan = require('../models/MembershipPlan');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');
const { finalAmount } = require('../helpers/money');

const base = crud(Membership, {
  name: 'Membership',
  searchable: ['name', 'phone', 'planName', 'code'],
  populate: [
    { path: 'expert', select: 'name code' },
    { path: 'plan', select: 'name price durationMonths freeStay' },
  ],
  ownerField: 'expert',
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.update = base.update;
exports.remove = base.remove;

/**
 * Selling a membership: price − discount + tax, an expiry worked out from the
 * plan, and the plan's benefits copied onto the member so they can be spent.
 */
exports.create = catchAsync(async (req, res) => {
  const plan = await MembershipPlan.findById(req.body.plan);
  if (!plan) throw ApiError.badRequest('That plan does not exist');

  const customer = await Customer.findById(req.body.customer);
  if (!customer) throw ApiError.badRequest('That customer does not exist');

  const members = Number(req.body.members || plan.persons || 1);
  const { net, tax, total } = finalAmount({
    price: req.body.price != null ? req.body.price : plan.price,
    discount: req.body.discount || 0,
    taxRate: req.body.taxRate != null ? req.body.taxRate : 18,
  });

  const startedOn = req.body.startedOn ? new Date(req.body.startedOn) : new Date();
  const expiresOn = new Date(startedOn);
  expiresOn.setMonth(expiresOn.getMonth() + (plan.durationMonths || 12));

  const membership = await Membership.create({
    ...req.body,
    customer: customer._id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    city: customer.city,
    planName: plan.name,
    members,
    amount: total,
    discount: req.body.discount || 0,
    tax,
    startedOn,
    expiresOn,
    benefits: plan.freeStay?.nights
      ? [{ name: 'Free nights', total: plan.freeStay.nights, used: 0, expiresOn }]
      : [],
    timeline: [{ step: 'Membership sold', at: new Date(), note: `${plan.name}, ${members} member(s)` }],
    expert: req.body.expert || req.user._id,
    createdBy: req.user._id,
  });

  await record(req, 'create', 'Membership', membership._id, `${membership.code} · ${plan.name} · net ${net}`);
  res.status(201).json({ success: true, data: membership });
});

/** Sold → payment → documents → activated, one step at a time. */
exports.activate = catchAsync(async (req, res) => {
  const membership = await Membership.findById(req.params.id);
  if (!membership) throw ApiError.notFound('Membership not found');
  if (membership.paid < membership.amount) {
    throw ApiError.badRequest('The fee has not been collected in full yet');
  }

  membership.activation.stage = 'Activated';
  membership.activation.activatedOn = new Date();
  membership.activation.documents = true;
  membership.status = 'Active';
  membership.timeline.push({ step: 'Membership activated', at: new Date(), note: req.body.note });
  await membership.save();

  await record(req, 'update', 'Membership', membership._id, `${membership.code} activated`);
  res.json({ success: true, data: membership });
});

/** Money against a membership, which writes a receipt at the same time. */
exports.collect = catchAsync(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) throw ApiError.badRequest('Say how much has come in');

  const membership = await Membership.findById(req.params.id);
  if (!membership) throw ApiError.notFound('Membership not found');

  membership.paid = Number(membership.paid || 0) + amount;
  if (membership.paid >= membership.amount && membership.activation.stage === 'Payment pending') {
    membership.activation.stage = 'Documents pending';
  }
  membership.timeline.push({ step: 'Payment received', at: new Date(), note: `${amount}` });
  await membership.save();

  const payment = await Payment.create({
    customer: membership.customer,
    customerName: membership.name,
    membership: membership._id,
    product: `${membership.planName} membership`,
    amount,
    mode: req.body.mode || 'UPI',
    gateway: req.body.gateway || '—',
    reference: req.body.reference,
    collectedBy: req.user._id,
    branch: membership.branch,
    createdBy: req.user._id,
  });

  await record(req, 'payment', 'Membership', membership._id, `${amount} collected on ${membership.code}`);
  res.json({ success: true, data: { membership, payment } });
});

/** Renewing rolls the expiry forward and files the old term as history. */
exports.renew = catchAsync(async (req, res) => {
  const membership = await Membership.findById(req.params.id).populate('plan');
  if (!membership) throw ApiError.notFound('Membership not found');

  const months = membership.plan?.durationMonths || 12;
  const from = membership.expiresOn && membership.expiresOn > new Date() ? membership.expiresOn : new Date();
  const expiresOn = new Date(from);
  expiresOn.setMonth(expiresOn.getMonth() + months);

  membership.expiresOn = expiresOn;
  membership.movement = 'Renewal';
  membership.status = 'Active';
  membership.renewal.stage = 'Renewed';
  membership.paid = 0;
  membership.amount = Number(req.body.amount || membership.amount);
  membership.timeline.push({ step: 'Membership renewed', at: new Date(), note: `Now runs to ${expiresOn.toDateString()}` });
  await membership.save();

  await record(req, 'update', 'Membership', membership._id, `${membership.code} renewed`);
  res.json({ success: true, data: membership });
});

/** Spending a free night, or any other benefit the plan carries. */
exports.useBenefit = catchAsync(async (req, res) => {
  const { name, units = 1 } = req.body;
  const membership = await Membership.findById(req.params.id);
  if (!membership) throw ApiError.notFound('Membership not found');

  const benefit = membership.benefits.find((b) => b.name === name);
  if (!benefit) throw ApiError.badRequest(`That membership has no benefit called "${name}"`);
  if (benefit.used + units > benefit.total) throw ApiError.badRequest('There is not that much left on it');

  benefit.used += units;
  membership.timeline.push({ step: `${name} used`, at: new Date(), note: `${units}` });
  await membership.save();

  res.json({ success: true, data: membership });
});

/** 90 → 60 → 30 → 15 → 7 days, then expired. */
exports.renewalPipeline = catchAsync(async (req, res) => {
  const rows = await Membership.find({ expiresOn: { $ne: null }, status: { $nin: ['Cancelled'] } })
    .select('code name planName expiresOn renewal expert amount benefits')
    .populate('expert', 'name')
    .lean();

  const bucketOf = (days) => {
    if (days < 0) return 'Expired';
    if (days <= 7) return '7 days';
    if (days <= 15) return '15 days';
    if (days <= 30) return '30 days';
    if (days <= 60) return '60 days';
    if (days <= 90) return '90 days';
    return 'Later';
  };

  const withDays = rows.map((m) => {
    const days = Math.round((new Date(m.expiresOn).getTime() - Date.now()) / 86400000);
    return { ...m, daysLeft: days, bucket: bucketOf(days) };
  });

  const buckets = ['90 days', '60 days', '30 days', '15 days', '7 days', 'Expired'].map((b) => ({
    bucket: b,
    count: withDays.filter((m) => m.bucket === b).length,
    value: withDays.filter((m) => m.bucket === b).reduce((s, m) => s + Number(m.amount || 0), 0),
  }));

  res.json({ success: true, data: { buckets, memberships: withDays.filter((m) => m.bucket !== 'Later') } });
});

/** Where every membership stands — the seven states the sheet reads. */
exports.overview = catchAsync(async (req, res) => {
  const [byStatus, byActivation, money] = await Promise.all([
    Membership.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$paid' } } }]),
    Membership.aggregate([{ $group: { _id: '$activation.stage', count: { $sum: 1 } } }]),
    Membership.aggregate([
      {
        $group: {
          _id: null,
          gross: { $sum: '$amount' },
          collected: { $sum: '$paid' },
          upgrades: { $sum: { $cond: [{ $eq: ['$movement', 'Upgrade'] }, 1, 0] } },
          downgrades: { $sum: { $cond: [{ $eq: ['$movement', 'Downgrade'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const m = money[0] || {};
  res.json({
    success: true,
    data: {
      byStatus,
      byActivation,
      gross: m.gross || 0,
      collected: m.collected || 0,
      outstanding: Math.max(0, (m.gross || 0) - (m.collected || 0)),
      upgrades: m.upgrades || 0,
      downgrades: m.downgrades || 0,
    },
  });
});
