const Reward = require('../models/Reward');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');

const base = crud(Reward, {
  name: 'Reward',
  searchable: ['customerName', 'gift', 'code'],
  populate: { path: 'fieldOfficer', select: 'name' },
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/** Eligible → approved → assigned → out → delivered. */
const ORDER = ['Eligible', 'Approved', 'Assigned', 'Out for delivery', 'Delivered'];

exports.advance = catchAsync(async (req, res) => {
  const reward = await Reward.findById(req.params.id);
  if (!reward) throw ApiError.notFound('Reward not found');
  if (reward.stage === 'Cancelled') throw ApiError.conflict('That reward was cancelled');

  const at = ORDER.indexOf(reward.stage);
  if (at === ORDER.length - 1) throw ApiError.conflict('That has already been handed over');

  reward.stage = ORDER[at + 1];
  if (reward.stage === 'Assigned') {
    reward.assignedOn = new Date();
    if (req.body.fieldOfficer) reward.fieldOfficer = req.body.fieldOfficer;
  }
  if (reward.stage === 'Delivered') {
    reward.deliveredOn = new Date();
    reward.proof = req.body.proof || reward.proof;
  }
  await reward.save();

  res.json({ success: true, data: reward });
});

/** What is owed and not yet in somebody's hands. */
exports.due = catchAsync(async (req, res) => {
  const rows = await Reward.find({ stage: { $nin: ['Delivered', 'Cancelled'] } })
    .populate('fieldOfficer', 'name')
    .sort('dueOn')
    .lean();
  res.json({ success: true, data: rows });
});
