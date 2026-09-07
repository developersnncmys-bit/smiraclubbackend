const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');
const { GATEWAYS } = require('../config/constants');

const base = crud(Payment, {
  name: 'Payment',
  searchable: ['customerName', 'reference', 'gatewayTxnId', 'code'],
  populate: { path: 'collectedBy', select: 'name code' },
  defaultSort: '-paidOn',
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.remove = base.remove;
exports.update = base.update;

/** Taking money in, and moving the invoice along with it. */
exports.collect = catchAsync(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) throw ApiError.badRequest('Say how much has come in');

  let invoice = null;
  if (req.body.invoice) {
    invoice = await Invoice.findById(req.body.invoice);
    if (!invoice) throw ApiError.badRequest('That invoice does not exist');
    if (amount > invoice.balance) throw ApiError.badRequest(`Only ${invoice.balance} is owing on that invoice`);
  }

  const payment = await Payment.create({
    ...req.body,
    amount,
    customerName: req.body.customerName || invoice?.customerName,
    customer: req.body.customer || invoice?.customer,
    collectedBy: req.user._id,
    createdBy: req.user._id,
  });

  if (invoice) {
    invoice.paid = Number(invoice.paid || 0) + amount;
    await invoice.save();
  }

  await record(req, 'payment', 'Payment', payment._id, `${amount} collected from ${payment.customerName}`);
  res.status(201).json({ success: true, data: { payment, invoice } });
});

/** Where money arrives, what it costs and whether it has settled. */
exports.gateways = catchAsync(async (req, res) => {
  const rows = await Payment.aggregate([
    {
      $group: {
        _id: '$gateway',
        successful: { $sum: { $cond: [{ $eq: ['$status', 'Success'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'Failed'] }, 1, 0] } },
        settled: { $sum: '$amount' },
        fees: { $sum: '$gatewayFee' },
      },
    },
  ]);

  res.json({
    success: true,
    data: GATEWAYS.map((name) => {
      const r = rows.find((x) => x._id === name) || {};
      return {
        gateway: name,
        successful: r.successful || 0,
        pending: r.pending || 0,
        failed: r.failed || 0,
        settled: r.settled || 0,
        fees: r.fees || 0,
      };
    }),
  });
});

/** Everything that has come in and gone out, in one ledger. */
exports.ledger = catchAsync(async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 90 * 86400000);
  const to = req.query.to ? new Date(req.query.to) : new Date();

  const rows = await Payment.find({ paidOn: { $gte: from, $lte: to } })
    .sort('-paidOn')
    .populate('collectedBy', 'name')
    .lean();

  res.json({
    success: true,
    data: {
      from,
      to,
      total: rows.reduce((s, p) => s + Number(p.amount || 0), 0),
      rows,
    },
  });
});
