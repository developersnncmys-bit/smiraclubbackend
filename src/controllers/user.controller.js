const User = require('../models/User');
const Lead = require('../models/Lead');
const Booking = require('../models/Booking');
const Membership = require('../models/Membership');
const Ticket = require('../models/Ticket');
const Task = require('../models/Task');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');
const { LIVE_STATES } = require('../config/constants');

const base = crud(User, {
  name: 'User',
  searchable: ['name', 'email', 'empId', 'code'],
  populate: { path: 'role', select: 'name scope dashboard' },
  defaultSort: 'name',
});

exports.list = base.list;
exports.create = base.create;
exports.remove = base.remove;

exports.getOne = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id)
    .populate('role')
    .populate('manager', 'name code designation');
  if (!user) throw ApiError.notFound('User not found');
  res.json({ success: true, data: user });
});

/** A password never comes in through the general update path. */
exports.update = catchAsync(async (req, res) => {
  const { password, ...safe } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { ...safe, updatedBy: req.user._id },
    { new: true, runValidators: true }
  ).populate('role');
  if (!user) throw ApiError.notFound('User not found');
  await record(req, 'update', 'User', user._id, `Updated ${user.name}`);
  res.json({ success: true, data: user });
});

/**
 * Who else is on the desk. Readable by anyone signed in, because assigning
 * work needs a list of colleagues — but only the fields that takes. Money and
 * targets stay behind the Users module.
 */
exports.directory = catchAsync(async (req, res) => {
  const rows = await User.find({ status: 'Active' })
    .select('code empId name email phone designation department branch live attendance activity lastActiveAt')
    .populate('role', 'name scope dashboard')
    .sort('name')
    .lean();

  res.json({ success: true, rows, total: rows.length });
});

/** The live strip on Team Status — Online, On call, Customer meeting and so on. */
exports.setLive = catchAsync(async (req, res) => {
  const { live, activity } = req.body;
  if (!LIVE_STATES.includes(live)) throw ApiError.badRequest(`live has to be one of: ${LIVE_STATES.join(', ')}`);

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { live, activity, lastActiveAt: new Date() },
    { new: true }
  );
  if (!user) throw ApiError.notFound('User not found');
  res.json({ success: true, data: { id: user._id, live: user.live, activity: user.activity } });
});

exports.resetPassword = catchAsync(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    throw ApiError.badRequest('The new password has to be at least 8 characters');
  }
  const user = await User.findById(req.params.id).select('+password');
  if (!user) throw ApiError.notFound('User not found');

  user.password = newPassword;
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  await user.save();
  await record(req, 'update', 'User', user._id, `Reset the password for ${user.name}`);

  res.json({ success: true, message: `Password reset for ${user.name}` });
});

exports.setStatus = catchAsync(async (req, res) => {
  const status = req.body.status === 'Active' ? 'Active' : 'Inactive';
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { status, live: status === 'Active' ? 'Offline' : 'Offline' },
    { new: true }
  );
  if (!user) throw ApiError.notFound('User not found');
  await record(req, 'update', 'User', user._id, `${user.name} was set to ${status}`);
  res.json({ success: true, data: { id: user._id, status: user.status } });
});

/**
 * One employee, the six ways the sheet asks management to read them: profile,
 * sales, bookings, customers, performance and activity.
 */
exports.profile = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id).populate('role').populate('manager', 'name');
  if (!user) throw ApiError.notFound('User not found');

  const [leads, won, bookings, memberships, tickets, tasks, activity] = await Promise.all([
    Lead.countDocuments({ owner: user._id }),
    Lead.countDocuments({ owner: user._id, status: 'Won' }),
    Booking.find({ owner: user._id }).select('amount status').lean(),
    Membership.countDocuments({ expert: user._id }),
    Ticket.countDocuments({ executive: user._id }),
    Task.find({ owner: user._id }).select('status').lean(),
    AuditLog.find({ actor: user._id }).sort('-createdAt').limit(20).lean(),
  ]);

  const bookingValue = bookings.reduce((s, b) => s + Number(b.amount || 0), 0);

  res.json({
    success: true,
    data: {
      user,
      sales: {
        leads,
        won,
        conversion: leads ? Math.round((won / leads) * 100) : 0,
        calls: user.calls,
        presentations: user.presentations,
        visits: user.visits,
        revenue: user.revenue,
      },
      bookings: {
        handled: bookings.length,
        value: bookingValue,
        cancellations: bookings.filter((b) => b.status === 'Cancelled').length,
      },
      customers: { memberships, tickets },
      performance: {
        target: user.target,
        revenue: user.revenue,
        achievement: user.achievement,
        productivity: user.productivity,
        tasksDone: tasks.filter((t) => t.status === 'Completed').length,
        tasksTotal: tasks.length,
      },
      activity,
    },
  });
});

/** Branch, manager, team or one person — the four levels the sheet compares at. */
exports.compare = catchAsync(async (req, res) => {
  const by = ['branch', 'department', 'manager'].includes(req.query.by) ? req.query.by : 'branch';

  const rows = await User.aggregate([
    { $match: { status: 'Active' } },
    {
      $group: {
        _id: `$${by}`,
        people: { $sum: 1 },
        revenue: { $sum: '$revenue' },
        target: { $sum: '$target' },
        calls: { $sum: '$calls' },
        presentations: { $sum: '$presentations' },
        visits: { $sum: '$visits' },
        productivity: { $avg: '$productivity' },
      },
    },
    { $sort: { revenue: -1 } },
  ]);

  res.json({
    success: true,
    data: rows.map((r) => ({
      label: r._id || 'Unassigned',
      people: r.people,
      revenue: r.revenue,
      target: r.target,
      achievement: r.target ? Math.round((r.revenue / r.target) * 100) : 0,
      calls: r.calls,
      presentations: r.presentations,
      visits: r.visits,
      productivity: Math.round(r.productivity || 0),
    })),
  });
});

/** Who is carrying what, right now. */
exports.workload = catchAsync(async (req, res) => {
  const users = await User.find({ status: 'Active' }).select('name code live department branch').lean();

  const [leads, tickets, tasks] = await Promise.all([
    Lead.aggregate([
      { $match: { status: { $nin: ['Won', 'Lost'] } } },
      { $group: { _id: '$owner', open: { $sum: 1 } } },
    ]),
    Ticket.aggregate([
      { $match: { stage: { $nin: ['Closed', 'Customer confirmed'] } } },
      { $group: { _id: '$executive', open: { $sum: 1 }, breached: { $sum: { $cond: [{ $eq: ['$slaState', 'Breached'] }, 1, 0] } } } },
    ]),
    Task.aggregate([
      { $match: { status: { $nin: ['Completed', 'Cancelled'] } } },
      { $group: { _id: '$owner', open: { $sum: 1 } } },
    ]),
  ]);

  const at = (rows, id) => rows.find((r) => String(r._id) === String(id)) || {};

  res.json({
    success: true,
    data: users.map((u) => ({
      ...u,
      openLeads: at(leads, u._id).open || 0,
      openTickets: at(tickets, u._id).open || 0,
      breachedTickets: at(tickets, u._id).breached || 0,
      openTasks: at(tasks, u._id).open || 0,
    })),
  });
});
