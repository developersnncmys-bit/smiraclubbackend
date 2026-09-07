const Refund = require('../models/Refund');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');

const base = crud(Refund, {
  name: 'Refund',
  searchable: ['customerName', 'reason', 'code'],
  populate: { path: 'raisedBy', select: 'name' },
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.remove = base.remove;
exports.update = base.update;

/**
 * Request → manager approval → finance approval → processed. The sheet is
 * clear that money going back out needs permission at every step.
 */
const ORDER = ['Refund request', 'Manager approval', 'Finance approval', 'Refund processed'];

exports.advance = catchAsync(async (req, res) => {
  const refund = await Refund.findById(req.params.id);
  if (!refund) throw ApiError.notFound('Refund not found');
  if (refund.stage === 'Rejected') throw ApiError.conflict('That refund was rejected');

  const at = ORDER.indexOf(refund.stage);
  if (at === ORDER.length - 1) throw ApiError.conflict('That refund has already gone out');

  const canApprove = req.user.role?.superAdmin || req.user.role?.approvals?.includes('Refund');
  if (!canApprove) throw ApiError.forbidden('Your role cannot approve a refund');

  refund.stage = ORDER[at + 1];
  if (refund.stage === 'Finance approval') {
    refund.approvedBy = req.user._id;
    refund.approvedAt = new Date();
  }
  if (refund.stage === 'Refund processed') {
    refund.processedBy = req.user._id;
    refund.processedAt = new Date();
    refund.refundTxnId = req.body.refundTxnId || `RFN-${Date.now()}`;
  }
  await refund.save();

  await record(req, 'approve', 'Refund', refund._id, `${refund.code} → ${refund.stage}`);
  res.json({ success: true, data: refund });
});

exports.reject = catchAsync(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw ApiError.badRequest('A rejection needs a reason');

  const refund = await Refund.findByIdAndUpdate(
    req.params.id,
    { stage: 'Rejected', remark: reason, decidedBy: req.user._id },
    { new: true }
  );
  if (!refund) throw ApiError.notFound('Refund not found');
  res.json({ success: true, data: refund });
});
