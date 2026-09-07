const Lead = require('../models/Lead');
const Booking = require('../models/Booking');
const Membership = require('../models/Membership');
const Ticket = require('../models/Ticket');
const Task = require('../models/Task');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const catchAsync = require('../helpers/catchAsync');

/** A date window from ?from&to, defaulting to the last thirty days. */
function windowOf(query) {
  const to = query.to ? new Date(query.to) : new Date();
  to.setHours(23, 59, 59, 999);
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86400000);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

/**
 * The whole business on one page. One call, because the panel's first screen
 * should not need eleven.
 */
exports.overview = catchAsync(async (req, res) => {
  const { from, to } = windowOf(req.query);
  const inWindow = { createdAt: { $gte: from, $lte: to } };

  const [leads, won, bookings, memberships, tickets, team, invoices] = await Promise.all([
    Lead.countDocuments(inWindow),
    Lead.countDocuments({ ...inWindow, status: 'Won' }),
    Booking.aggregate([
      { $match: inWindow },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          value: { $sum: '$amount' },
          collected: { $sum: '$paid' },
          vendorCost: { $sum: '$vendorCost' },
        },
      },
    ]),
    Membership.aggregate([
      { $match: inWindow },
      { $group: { _id: null, count: { $sum: 1 }, gross: { $sum: '$amount' }, collected: { $sum: '$paid' } } },
    ]),
    Ticket.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          open: { $sum: { $cond: [{ $in: ['$stage', ['Closed', 'Customer confirmed']] }, 0, 1] } },
          breached: { $sum: { $cond: [{ $eq: ['$slaState', 'Breached'] }, 1, 0] } },
        },
      },
    ]),
    User.aggregate([
      { $match: { status: 'Active' } },
      {
        $group: {
          _id: null,
          people: { $sum: 1 },
          online: { $sum: { $cond: [{ $eq: ['$live', 'Online'] }, 1, 0] } },
          revenue: { $sum: '$revenue' },
          target: { $sum: '$target' },
        },
      },
    ]),
    Invoice.aggregate([
      { $group: { _id: null, billed: { $sum: '$amount' }, paid: { $sum: '$paid' } } },
    ]),
  ]);

  const b = bookings[0] || {};
  const m = memberships[0] || {};
  const t = tickets[0] || {};
  const u = team[0] || {};
  const i = invoices[0] || {};

  /**
   * Revenue is the membership money plus the markup kept on bookings — never
   * the gross booking value, or the margin reads as nonsense.
   */
  const markup = Math.max(0, (b.value || 0) - (b.vendorCost || 0));
  const revenue = (m.collected || 0) + markup;

  res.json({
    success: true,
    data: {
      window: { from, to },
      sales: { leads, won, conversion: leads ? Math.round((won / leads) * 100) : 0 },
      bookings: { count: b.count || 0, value: b.value || 0, collected: b.collected || 0, markup },
      memberships: { sold: m.count || 0, gross: m.gross || 0, collected: m.collected || 0 },
      money: {
        revenue,
        billed: i.billed || 0,
        collected: i.paid || 0,
        outstanding: Math.max(0, (i.billed || 0) - (i.paid || 0)),
        target: u.target || 0,
        achievement: u.target ? Math.round((revenue / u.target) * 100) : 0,
      },
      support: { total: t.total || 0, open: t.open || 0, breached: t.breached || 0 },
      team: { people: u.people || 0, online: u.online || 0 },
    },
  });
});

/** Revenue day by day, for the chart under the headline. */
exports.trend = catchAsync(async (req, res) => {
  const { from, to } = windowOf(req.query);

  const rows = await Booking.aggregate([
    { $match: { createdAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        bookings: { $sum: 1 },
        value: { $sum: '$amount' },
        markup: { $sum: { $subtract: ['$amount', '$vendorCost'] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json({ success: true, data: rows.map((r) => ({ date: r._id, ...r, _id: undefined })) });
});

/** What needs a person right now — the panel's to-do list. */
exports.needsAttention = catchAsync(async (req, res) => {
  const now = new Date();
  const soon = new Date(Date.now() + 45 * 86400000);

  const [overdueTasks, breachedTickets, unpaidInvoices, expiringMemberships, staleLeads] = await Promise.all([
    Task.countDocuments({ status: { $nin: ['Completed', 'Cancelled'] }, dueAt: { $lt: now } }),
    Ticket.countDocuments({ slaState: 'Breached', stage: { $nin: ['Closed', 'Customer confirmed'] } }),
    Invoice.countDocuments({ $expr: { $lt: ['$paid', '$amount'] }, dueOn: { $lt: now } }),
    Membership.countDocuments({ expiresOn: { $gte: now, $lte: soon } }),
    Lead.countDocuments({ status: { $nin: ['Won', 'Lost'] }, nextFollowUpAt: { $lt: now } }),
  ]);

  res.json({
    success: true,
    data: [
      { what: 'Tasks past their due time', count: overdueTasks, where: '/tasks' },
      { what: 'Tickets past their SLA', count: breachedTickets, where: '/tickets' },
      { what: 'Invoices overdue', count: unpaidInvoices, where: '/invoices' },
      { what: 'Memberships expiring in 45 days', count: expiringMemberships, where: '/memberships' },
      { what: 'Leads nobody has followed up', count: staleLeads, where: '/leads' },
    ].filter((row) => row.count > 0),
  });
});
