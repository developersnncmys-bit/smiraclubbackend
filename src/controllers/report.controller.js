const Lead = require('../models/Lead');
const Booking = require('../models/Booking');
const Membership = require('../models/Membership');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Partner = require('../models/Partner');
const catchAsync = require('../helpers/catchAsync');
const ApiError = require('../helpers/ApiError');
const { commissionRate } = require('../helpers/money');

/** Every consultant, from leads assigned through to incentive earned. */
exports.salesPerformance = catchAsync(async (req, res) => {
  const users = await User.find({ status: 'Active' }).select('name code target revenue calls presentations visits followUps closings branch department').lean();

  const leads = await Lead.aggregate([
    {
      $group: {
        _id: '$owner',
        leads: { $sum: 1 },
        won: { $sum: { $cond: [{ $eq: ['$status', 'Won'] }, 1, 0] } },
        qualified: { $sum: { $cond: [{ $in: ['$status', ['New', 'Lost']] }, 0, 1] } },
        wonValue: { $sum: { $cond: [{ $eq: ['$status', 'Won'] }, '$budget', 0] } },
      },
    },
  ]);

  res.json({
    success: true,
    data: users.map((u) => {
      const l = leads.find((x) => String(x._id) === String(u._id)) || {};
      const rate = commissionRate(u.revenue);
      const achievement = u.target ? Math.round((u.revenue / u.target) * 100) : 0;
      return {
        id: u._id,
        name: u.name,
        branch: u.branch,
        team: u.department,
        leads: l.leads || 0,
        qualified: l.qualified || 0,
        calls: u.calls || 0,
        presentations: u.presentations || 0,
        visits: u.visits || 0,
        followUps: u.followUps || 0,
        closings: l.won || 0,
        revenue: u.revenue || 0,
        conversion: l.leads ? Math.round(((l.won || 0) / l.leads) * 100) : 0,
        averageDeal: l.won ? Math.round((l.wonValue || 0) / l.won) : 0,
        target: u.target || 0,
        achievement,
        commissionRate: rate,
        incentive: Math.round(((u.revenue || 0) * rate) / 100),
      };
    }),
  });
});

/** How members are growing, and how many are slipping. */
exports.memberGrowth = catchAsync(async (req, res) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const soon = new Date(Date.now() + 45 * 86400000);

  const [total, joined, byStatus, atRisk, expiring] = await Promise.all([
    Customer.countDocuments(),
    Customer.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    Membership.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Customer.countDocuments({ engagement: { $in: ['At risk', 'Low engagement'] } }),
    Membership.countDocuments({ expiresOn: { $gte: new Date(), $lte: soon } }),
  ]);

  res.json({
    success: true,
    data: { total, newInThirtyDays: joined, byStatus, atRisk, expiringSoon: expiring },
  });
});

/** Renewal rate, churn, repeat bookings and what a member is worth. */
exports.retention = catchAsync(async (req, res) => {
  const [memberships, customers] = await Promise.all([
    Membership.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          renewed: { $sum: { $cond: [{ $eq: ['$renewal.stage', 'Renewed'] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ['$renewal.stage', 'Renewal lost'] }, 1, 0] } },
          collected: { $sum: '$paid' },
        },
      },
    ]),
    Customer.aggregate([
      {
        $group: {
          _id: null,
          people: { $sum: 1 },
          spend: { $sum: '$spend' },
          repeat: { $sum: { $cond: [{ $gt: ['$trips', 1] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const m = memberships[0] || {};
  const c = customers[0] || {};

  res.json({
    success: true,
    data: {
      renewalRate: m.total ? Math.round(((m.renewed || 0) / m.total) * 100) : 0,
      churnRate: m.total ? Math.round(((m.lost || 0) / m.total) * 100) : 0,
      repeatBookingRate: c.people ? Math.round(((c.repeat || 0) / c.people) * 100) : 0,
      averageRevenuePerMember: c.people ? Math.round((c.spend || 0) / c.people) : 0,
      lifetimeValue: c.people ? Math.round(((c.spend || 0) + (m.collected || 0)) / c.people) : 0,
    },
  });
});

/** The bit the Report & Analytics sheet calls the custom report builder. */
const SETS = {
  Sales: { model: Lead, value: 'budget', closed: ['Won'] },
  Leads: { model: Lead, value: 'budget', closed: ['Won'] },
  Bookings: { model: Booking, value: 'amount', closed: ['Confirmed', 'Completed'] },
  Revenue: { model: Booking, value: 'amount', closed: ['Confirmed', 'Completed'] },
  Membership: { model: Membership, value: 'paid', closed: ['Active'] },
  Members: { model: Customer, value: 'spend', closed: [] },
  Team: { model: User, value: 'revenue', closed: [] },
  Partners: { model: Partner, value: 'revenue', closed: ['Active'] },
  Support: { model: Ticket, value: null, closed: ['Closed', 'Customer confirmed'] },
};

const DIMENSIONS = {
  Salesperson: 'owner',
  Owner: 'owner',
  Source: 'source',
  'Lead source': 'source',
  Stage: 'status',
  Status: 'status',
  Plan: 'planName',
  Type: 'bookingType',
  Hotel: 'hotel',
  Destination: 'destination',
  Branch: 'branch',
  Team: 'department',
  Employee: 'name',
  Category: 'category',
  Executive: 'executive',
  Priority: 'priority',
  Engagement: 'engagement',
  City: 'city',
};

/**
 * Group any module by any dimension and measure it — count, revenue,
 * conversion, average value.
 */
exports.build = catchAsync(async (req, res) => {
  const { module = 'Sales', dimension = 'Source', measure = 'Count' } = req.query;

  const set = SETS[module];
  if (!set) throw ApiError.badRequest(`module has to be one of: ${Object.keys(SETS).join(', ')}`);

  const field = DIMENSIONS[dimension];
  if (!field) throw ApiError.badRequest(`dimension has to be one of: ${Object.keys(DIMENSIONS).join(', ')}`);

  const rows = await set.model.aggregate([
    {
      $group: {
        _id: `$${field}`,
        records: { $sum: 1 },
        value: set.value ? { $sum: `$${set.value}` } : { $sum: 0 },
        closed: set.closed.length
          ? { $sum: { $cond: [{ $in: ['$status', set.closed] }, 1, 0] } }
          : { $sum: 0 },
      },
    },
    { $sort: { value: -1, records: -1 } },
  ]);

  const shaped = rows.map((r) => {
    const out = { label: r._id || 'Not set', records: r.records, value: r.value };
    if (measure === 'Conversion %') out.measure = r.records ? Math.round((r.closed / r.records) * 100) : 0;
    else if (measure === 'Average value') out.measure = r.records ? Math.round(r.value / r.records) : 0;
    else if (measure === 'Revenue') out.measure = r.value;
    else out.measure = r.records;
    return out;
  });

  res.json({ success: true, data: { module, dimension, measure, rows: shaped } });
});

/** What the builder can be pointed at. */
exports.builderOptions = catchAsync(async (req, res) => {
  res.json({
    success: true,
    data: {
      modules: Object.keys(SETS),
      dimensions: Object.keys(DIMENSIONS),
      measures: ['Count', 'Revenue', 'Conversion %', 'Average value'],
    },
  });
});
