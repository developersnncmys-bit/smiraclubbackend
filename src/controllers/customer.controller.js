const Customer = require('../models/Customer');
const Booking = require('../models/Booking');
const Membership = require('../models/Membership');
const Ticket = require('../models/Ticket');
const Invoice = require('../models/Invoice');
const Reward = require('../models/Reward');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { scopeFilter } = require('../middleware/scope');
const { crud } = require('../helpers/crud');

const base = crud(Customer, {
  name: 'Customer',
  searchable: ['name', 'phone', 'email', 'code'],
  populate: { path: 'expert', select: 'name code' },
  ownerField: 'expert',
});

exports.list = base.list;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/** One member, with everything hanging off them in one call. */
exports.getOne = catchAsync(async (req, res) => {
  const customer = await Customer.findOne({ _id: req.params.id, ...scopeFilter(req, 'expert') }).populate('expert', 'name code');
  if (!customer) throw ApiError.notFound('Customer not found');

  const [bookings, memberships, tickets, invoices, rewards] = await Promise.all([
    Booking.find({ customer: customer._id }).sort('-checkIn').lean(),
    Membership.find({ customer: customer._id }).sort('-createdAt').lean(),
    Ticket.find({ customer: customer._id }).sort('-createdAt').lean(),
    Invoice.find({ customer: customer._id }).sort('-issuedOn').lean(),
    Reward.find({ customer: customer._id }).sort('-createdAt').lean(),
  ]);

  res.json({ success: true, data: { customer, bookings, memberships, tickets, invoices, rewards } });
});

/**
 * What every member owes and has paid — the Payment sheet's customer summary,
 * worked out rather than stored.
 */
exports.money = catchAsync(async (req, res) => {
  const customer = await Customer.findOne({ _id: req.params.id, ...scopeFilter(req, 'expert') });
  if (!customer) throw ApiError.notFound('Customer not found');

  const [invoices, memberships] = await Promise.all([
    Invoice.find({ customer: customer._id }).lean(),
    Membership.find({ customer: customer._id }).lean(),
  ]);

  const billed =
    invoices.reduce((s, i) => s + Number(i.amount || 0), 0) +
    memberships.reduce((s, m) => s + Number(m.amount || 0), 0);
  const paid =
    invoices.reduce((s, i) => s + Number(i.paid || 0), 0) +
    memberships.reduce((s, m) => s + Number(m.paid || 0), 0);
  const open = invoices.filter((i) => Number(i.paid || 0) < Number(i.amount || 0));

  res.json({
    success: true,
    data: {
      totalValue: billed,
      paid,
      pending: Math.max(0, billed - paid),
      discount: invoices.reduce((s, i) => s + Number(i.discount || 0), 0),
      tax: invoices.reduce((s, i) => s + Number(i.tax || 0), 0),
      refunded: memberships.reduce((s, m) => s + Number(m.refund || 0), 0),
      nextPaymentOn: open[0]?.dueOn || null,
      openInvoices: open,
    },
  });
});

/** Birthdays and anniversaries in the next N days. */
exports.specialDays = catchAsync(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const customers = await Customer.find({ $or: [{ dob: { $ne: null } }, { anniversary: { $ne: null } }] })
    .select('name phone dob anniversary childBirthday tier')
    .lean();

  const now = new Date();
  /** The next time this day comes round, whatever year it was set in. */
  const nextOn = (date) => {
    if (!date) return null;
    const d = new Date(date);
    const next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
    if (next < now) next.setFullYear(now.getFullYear() + 1);
    return next;
  };

  const rows = [];
  customers.forEach((c) => {
    [
      ['Birthday', c.dob],
      ['Anniversary', c.anniversary],
      ["Child's birthday", c.childBirthday],
    ].forEach(([kind, date]) => {
      const on = nextOn(date);
      if (!on) return;
      const inDays = Math.round((on - now) / 86400000);
      if (inDays <= days) rows.push({ customer: c.name, phone: c.phone, tier: c.tier, kind, on, inDays });
    });
  });

  res.json({ success: true, data: rows.sort((a, b) => a.inDays - b.inDays) });
});

/** Who is slipping away, and why the panel thinks so. */
exports.atRisk = catchAsync(async (req, res) => {
  const cutoff = new Date(Date.now() - 90 * 86400000);
  const rows = await Customer.find({
    $or: [
      { engagement: { $in: ['At risk', 'Low engagement'] } },
      { lastInteractionOn: { $lt: cutoff } },
    ],
  })
    .select('name phone engagement lastBookingOn lastInteractionOn spend expert')
    .populate('expert', 'name')
    .lean();

  res.json({ success: true, data: rows });
});
