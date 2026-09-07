const Booking = require('../models/Booking');
const Membership = require('../models/Membership');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const Expense = require('../models/Expense');
const User = require('../models/User');
const catchAsync = require('../helpers/catchAsync');
const { commissionRate } = require('../helpers/money');

/**
 * Money in, money out and what is left. The Revenue sheet's arithmetic in one
 * place: total income is the membership money plus the booking markup.
 */
exports.overview = catchAsync(async (req, res) => {
  const [bookings, memberships, invoices, expenses, team] = await Promise.all([
    Booking.aggregate([
      {
        $group: {
          _id: null,
          value: { $sum: '$amount' },
          collected: { $sum: '$paid' },
          vendorCost: { $sum: '$vendorCost' },
          refunds: { $sum: '$refund' },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, '$amount', 0] } },
          count: { $sum: 1 },
        },
      },
    ]),
    Membership.aggregate([
      { $group: { _id: null, gross: { $sum: '$amount' }, collected: { $sum: '$paid' }, refunds: { $sum: '$refund' } } },
    ]),
    Invoice.aggregate([{ $group: { _id: null, billed: { $sum: '$amount' }, paid: { $sum: '$paid' } } }]),
    Expense.aggregate([{ $group: { _id: '$category', amount: { $sum: '$amount' } } }]),
    User.aggregate([{ $match: { status: 'Active' } }, { $group: { _id: null, target: { $sum: '$target' }, people: { $sum: 1 } } }]),
  ]);

  const b = bookings[0] || {};
  const m = memberships[0] || {};
  const i = invoices[0] || {};
  const u = team[0] || {};

  const markup = Math.max(0, (b.value || 0) - (b.vendorCost || 0));
  const membershipRevenue = m.collected || 0;
  const totalRevenue = membershipRevenue + markup;
  const refunds = (b.refunds || 0) + (m.refunds || 0);
  const netRevenue = totalRevenue - refunds;

  const spendOn = (category) => expenses.find((e) => e._id === category)?.amount || 0;
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const staffCost = spendOn('Staff salary') + spendOn('Incentives');
  const marketing = spendOn('Marketing');

  const profit = netRevenue - totalExpenses;

  res.json({
    success: true,
    data: {
      membershipRevenue,
      bookingValue: b.value || 0,
      bookingMarkup: markup,
      vendorCost: b.vendorCost || 0,
      totalRevenue,
      refunds,
      netRevenue,
      billed: i.billed || 0,
      collected: i.paid || 0,
      receivable: Math.max(0, (i.billed || 0) - (i.paid || 0)),
      cancellationValue: b.cancelled || 0,
      averageBookingValue: b.count ? Math.round((b.value || 0) / b.count) : 0,
      expenses: { total: totalExpenses, staffCost, marketing, byCategory: expenses },
      profit,
      margin: netRevenue ? Math.round((profit / netRevenue) * 100) : 0,
      staffCostRatio: netRevenue ? Math.round((staffCost / netRevenue) * 100) : 0,
      revenuePerEmployee: u.people ? Math.round(netRevenue / u.people) : 0,
      target: u.target || 0,
      achievement: u.target ? Math.round((totalRevenue / u.target) * 100) : 0,
    },
  });
});

/** Daily, weekly, monthly or yearly, off the same payments. */
exports.trend = catchAsync(async (req, res) => {
  const grain = ['day', 'week', 'month', 'year'].includes(req.query.grain) ? req.query.grain : 'month';
  const format = { day: '%Y-%m-%d', week: '%Y-W%V', month: '%Y-%m', year: '%Y' }[grain];

  const rows = await Payment.aggregate([
    { $match: { status: 'Success' } },
    { $group: { _id: { $dateToString: { format, date: '$paidOn' } }, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  res.json({ success: true, data: rows.map((r) => ({ period: r._id, amount: r.amount, payments: r.count })) });
});

/** Every stream the agency earns on. */
exports.sources = catchAsync(async (req, res) => {
  const [byType, memberships] = await Promise.all([
    Booking.aggregate([
      {
        $group: {
          _id: '$bookingType',
          count: { $sum: 1 },
          value: { $sum: '$amount' },
          cost: { $sum: '$vendorCost' },
        },
      },
    ]),
    Membership.aggregate([{ $group: { _id: '$planName', count: { $sum: 1 }, value: { $sum: '$paid' } } }]),
  ]);

  res.json({
    success: true,
    data: {
      bookings: byType.map((r) => ({
        source: `${r._id || 'Package'} bookings`,
        count: r.count,
        value: r.value,
        margin: Math.max(0, r.value - r.cost),
      })),
      memberships: memberships.map((r) => ({ source: `${r._id} membership`, count: r.count, value: r.value })),
    },
  });
});

/** Branch, team or one person, with the nine numbers the sheet compares on. */
exports.compare = catchAsync(async (req, res) => {
  const by = ['branch', 'department'].includes(req.query.by) ? req.query.by : 'branch';

  const [team, memberships] = await Promise.all([
    User.aggregate([
      { $match: { status: 'Active' } },
      {
        $group: {
          _id: `$${by}`,
          people: { $sum: 1 },
          revenue: { $sum: '$revenue' },
          target: { $sum: '$target' },
          productivity: { $avg: '$productivity' },
        },
      },
    ]),
    Membership.aggregate([
      { $group: { _id: `$${by === 'branch' ? 'branch' : 'branch'}`, collected: { $sum: '$paid' }, outstanding: { $sum: { $subtract: ['$amount', '$paid'] } }, customers: { $sum: 1 } } },
    ]),
  ]);

  res.json({
    success: true,
    data: team.map((t) => {
      const m = memberships.find((x) => x._id === t._id) || {};
      return {
        label: t._id || 'Unassigned',
        people: t.people,
        revenue: t.revenue,
        target: t.target,
        achievement: t.target ? Math.round((t.revenue / t.target) * 100) : 0,
        customers: m.customers || 0,
        collections: m.collected || 0,
        outstanding: Math.max(0, m.outstanding || 0),
        productivity: Math.round(t.productivity || 0),
      };
    }),
  });
});

/** Commission, incentive, override, paid and pending — worked out, not typed. */
exports.commission = catchAsync(async (req, res) => {
  const users = await User.find({ status: 'Active' }).select('name code revenue target manager').lean();

  const outstanding = await Membership.aggregate([
    { $group: { _id: '$expert', pending: { $sum: { $subtract: ['$amount', '$paid'] } }, sold: { $sum: 1 } } },
  ]);

  res.json({
    success: true,
    data: users.map((u) => {
      const o = outstanding.find((x) => String(x._id) === String(u._id)) || {};
      const rate = commissionRate(u.revenue);
      const commission = Math.round(((u.revenue || 0) * rate) / 100);
      const pending = Math.max(0, o.pending || 0);
      const reports = users.filter((x) => String(x.manager) === String(u._id));
      const overRun = Math.max(0, (u.revenue || 0) - (u.target || 0));

      return {
        id: u._id,
        name: u.name,
        memberships: o.sold || 0,
        revenue: u.revenue || 0,
        slab: rate,
        commission,
        incentive: u.target && u.revenue >= u.target ? Math.round(overRun * 0.02) : 0,
        override: Math.round((reports.reduce((s, r) => s + Number(r.revenue || 0), 0) * 0.5) / 100),
        paid: Math.round(((u.revenue || 0) - pending) * rate) / 100,
        pending: Math.round((pending * rate) / 100),
      };
    }),
  });
});
