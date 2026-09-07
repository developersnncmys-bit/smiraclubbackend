const Invoice = require('../models/Invoice');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');

const base = crud(Invoice, {
  name: 'Invoice',
  searchable: ['customerName', 'code', 'forWhat'],
  populate: { path: 'customer', select: 'name phone gst' },
  ownerField: 'owner',
  defaultSort: '-issuedOn',
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/**
 * The collection pipeline: due today → 1 day → 3 → 7 → 15 → 30+, which is
 * exactly how the Payment sheet wants chasing organised.
 */
exports.pipeline = catchAsync(async (req, res) => {
  const open = await Invoice.find({ $expr: { $lt: ['$paid', '$amount'] } })
    .populate('customer', 'name phone')
    .populate('owner', 'name')
    .lean();

  const bucketOf = (invoice) => {
    if (!invoice.dueOn) return 'Due today';
    const days = Math.round((Date.now() - new Date(invoice.dueOn).getTime()) / 86400000);
    if (days <= 0) return 'Due today';
    if (days <= 1) return '1 day overdue';
    if (days <= 3) return '3 days overdue';
    if (days <= 7) return '7 days overdue';
    if (days <= 15) return '15 days overdue';
    return '30+ days overdue';
  };

  const withBucket = open.map((i) => ({
    ...i,
    balance: Math.max(0, Number(i.amount || 0) - Number(i.paid || 0)),
    bucket: bucketOf(i),
  }));

  const buckets = ['Due today', '1 day overdue', '3 days overdue', '7 days overdue', '15 days overdue', '30+ days overdue'];

  res.json({
    success: true,
    data: {
      buckets: buckets.map((b) => ({
        bucket: b,
        count: withBucket.filter((i) => i.bucket === b).length,
        value: withBucket.filter((i) => i.bucket === b).reduce((s, i) => s + i.balance, 0),
      })),
      invoices: withBucket,
    },
  });
});

/** Chasing somebody, and remembering that it was done. */
exports.remind = catchAsync(async (req, res) => {
  const invoice = await Invoice.findByIdAndUpdate(
    req.params.id,
    { lastReminderAt: new Date(), nextFollowUpAt: req.body.nextFollowUpAt },
    { new: true }
  );
  if (!invoice) throw ApiError.notFound('Invoice not found');
  res.json({ success: true, data: invoice });
});
