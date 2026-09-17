const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const Task = require('../models/Task');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const User = require('../models/User');
const { scopeFilter } = require('../middleware/scope');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');
const { LEAD_STAGES } = require('../config/constants');

const base = crud(Lead, {
  name: 'Lead',
  searchable: ['name', 'phone', 'email', 'destination', 'code'],
  populate: { path: 'owner', select: 'name code' },
  ownerField: 'owner',
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/** Moving a lead along, with the reason if it is being lost. */
exports.moveStage = catchAsync(async (req, res) => {
  const { status, lostReason, note } = req.body;
  if (!LEAD_STAGES.includes(status)) throw ApiError.badRequest(`status has to be one of: ${LEAD_STAGES.join(', ')}`);
  if (status === 'Lost' && !lostReason) throw ApiError.badRequest('A lost lead needs a reason');

  const lead = await Lead.findOne({ _id: req.params.id, ...scopeFilter(req, 'owner') });
  if (!lead) throw ApiError.notFound('Lead not found');

  const from = lead.status;
  lead.status = status;
  if (lostReason) lead.lostReason = lostReason;
  lead.activities.push({
    kind: 'status',
    text: note || `Moved from ${from} to ${status}`,
    by: req.user._id,
    byName: req.user.name,
  });
  await lead.save();

  await record(req, 'update', 'Lead', lead._id, `${lead.code}: ${from} → ${status}`);
  res.json({ success: true, data: lead });
});

/** A call, a message, a note — whatever just happened on this lead. */
exports.addActivity = catchAsync(async (req, res) => {
  const { kind = 'note', text } = req.body;
  if (!text) throw ApiError.badRequest('Say what happened');

  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, ...scopeFilter(req, 'owner') },
    {
      $push: { activities: { kind, text, by: req.user._id, byName: req.user.name } },
      lastContactAt: new Date(),
    },
    { new: true }
  );
  if (!lead) throw ApiError.notFound('Lead not found');
  res.json({ success: true, data: lead });
});

/** Handing leads over, one or many at a time. */
exports.assign = catchAsync(async (req, res) => {
  const { ids = [], owner } = req.body;
  if (!owner) throw ApiError.badRequest('Say who they are going to');
  const list = ids.length ? ids : [req.params.id].filter(Boolean);
  if (!list.length) throw ApiError.badRequest('Pick at least one lead');

  // Handing work to somebody who does not exist would orphan it.
  const target = await User.findById(owner).select('_id');
  if (!target) throw ApiError.badRequest('That team member does not exist');

  const result = await Lead.updateMany(
    { _id: { $in: list }, ...scopeFilter(req, 'owner') },
    { owner, $push: { activities: { kind: 'status', text: 'Reassigned', byName: req.user.name } } }
  );

  await record(req, 'assign', 'Lead', list.join(','), `${result.modifiedCount} lead(s) reassigned`);
  res.json({ success: true, data: { moved: result.modifiedCount } });
});

/** Won means a member exists — so make one if there is not already. */
exports.convert = catchAsync(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...scopeFilter(req, 'owner') });
  if (!lead) throw ApiError.notFound('Lead not found');
  if (lead.convertedCustomer) throw ApiError.conflict('That lead is already a member');

  let customer = await Customer.findOne({ phone: lead.phone });
  if (!customer) {
    customer = await Customer.create({
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      source: lead.source,
      branch: lead.branch,
      expert: lead.owner,
      createdBy: req.user._id,
    });
  }

  lead.status = 'Won';
  lead.convertedCustomer = customer._id;
  lead.convertedAt = new Date();
  lead.activities.push({ kind: 'status', text: `Converted to ${customer.code}`, byName: req.user.name });
  await lead.save();

  await record(req, 'convert', 'Lead', lead._id, `${lead.code} became ${customer.code}`);
  res.json({ success: true, data: { lead, customer } });
});

/**
 * The funnel: how many sit at each stage, what they are worth, how much
 * carries to the next stage and how long they have been sitting there.
 */
exports.funnel = catchAsync(async (req, res) => {
  const rows = await Lead.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        value: { $sum: '$budget' },
        avgAgeDays: {
          $avg: { $divide: [{ $subtract: [new Date(), { $ifNull: ['$stageChangedAt', '$createdAt'] }] }, 86400000] },
        },
      },
    },
  ]);

  const at = (stage) => rows.find((r) => r._id === stage) || { count: 0, value: 0, avgAgeDays: 0 };
  const total = rows.reduce((s, r) => s + r.count, 0);

  const funnel = LEAD_STAGES.filter((s) => s !== 'Lost').map((stage, i, all) => {
    const here = at(stage);
    const before = i === 0 ? null : at(all[i - 1]).count;
    const carried = before ? Math.round((here.count / before) * 100) : null;
    return {
      stage,
      count: here.count,
      value: here.value,
      share: total ? Math.round((here.count / total) * 100) : 0,
      carriedFromLast: carried,
      dropOff: carried == null ? null : Math.max(0, 100 - carried),
      avgDaysInStage: Math.round(here.avgAgeDays || 0),
    };
  });

  res.json({ success: true, data: { total, funnel, lost: at('Lost') } });
});

/** Why leads are lost, and what walked away with them. */
exports.lostAnalysis = catchAsync(async (req, res) => {
  const by = ['lostReason', 'owner', 'source', 'destination'].includes(req.query.by) ? req.query.by : 'lostReason';

  const rows = await Lead.aggregate([
    { $match: { status: 'Lost' } },
    { $group: { _id: `$${by}`, count: { $sum: 1 }, value: { $sum: '$budget' } } },
    { $sort: { count: -1 } },
  ]);

  res.json({ success: true, data: rows.map((r) => ({ label: r._id || 'Not given', count: r.count, value: r.value })) });
});

/** What each channel brings, and what it converts at. */
exports.bySource = catchAsync(async (req, res) => {
  const rows = await Lead.aggregate([
    {
      $group: {
        _id: '$source',
        leads: { $sum: 1 },
        won: { $sum: { $cond: [{ $eq: ['$status', 'Won'] }, 1, 0] } },
        revenue: { $sum: { $cond: [{ $eq: ['$status', 'Won'] }, '$budget', 0] } },
      },
    },
    { $sort: { leads: -1 } },
  ]);

  res.json({
    success: true,
    data: rows.map((r) => ({
      source: r._id || 'Unknown',
      leads: r.leads,
      won: r.won,
      revenue: r.revenue,
      conversion: r.leads ? Math.round((r.won / r.leads) * 100) : 0,
    })),
  });
});

/** Everything due today, plus anything already late. */
exports.today = catchAsync(async (req, res) => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const filter = { nextFollowUpAt: { $lte: end }, status: { $nin: ['Won', 'Lost'] } };
  if ((req.user.role?.scope || 'own') === 'own') filter.owner = req.user._id;

  const leads = await Lead.find(filter).sort('nextFollowUpAt').populate('owner', 'name').lean();
  const now = new Date();

  res.json({
    success: true,
    data: {
      due: leads.filter((l) => l.nextFollowUpAt >= now),
      overdue: leads.filter((l) => l.nextFollowUpAt < now),
    },
  });
});
