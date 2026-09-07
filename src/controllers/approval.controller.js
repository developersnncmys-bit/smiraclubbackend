const Approval = require('../models/Approval');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');

const base = crud(Approval, {
  name: 'Approval',
  searchable: ['what', 'area', 'code'],
  populate: [
    { path: 'raisedBy', select: 'name' },
    { path: 'approver', select: 'name' },
  ],
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.remove = base.remove;

/** Signing something off, but only if the role carries that right. */
exports.decide = catchAsync(async (req, res) => {
  const { status, remark } = req.body;
  if (!['Approved', 'Rejected'].includes(status)) {
    throw ApiError.badRequest('status has to be Approved or Rejected');
  }

  const approval = await Approval.findById(req.params.id);
  if (!approval) throw ApiError.notFound('Approval not found');
  if (approval.status !== 'Waiting') throw ApiError.conflict('That has already been decided');

  const allowed = req.user.role?.superAdmin || req.user.role?.approvals?.includes(approval.area);
  if (!allowed) throw ApiError.forbidden(`Your role cannot approve ${approval.area.toLowerCase()}`);

  approval.status = status;
  approval.decidedAt = new Date();
  approval.decidedBy = req.user._id;
  approval.remark = remark;
  await approval.save();

  await record(req, 'approve', 'Approval', approval._id, `${approval.code} ${status.toLowerCase()}`);
  res.json({ success: true, data: approval });
});

/** What is sitting on the signed-in user right now. */
exports.mine = catchAsync(async (req, res) => {
  const rows = await Approval.find({ status: 'Waiting', approver: req.user._id })
    .populate('raisedBy', 'name')
    .sort('-createdAt')
    .lean();
  res.json({ success: true, data: rows });
});
