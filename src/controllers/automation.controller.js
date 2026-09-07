const AutomationRule = require('../models/AutomationRule');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');
const { AUTOMATION_TRIGGERS, OPERATORS } = require('../config/constants');

const base = crud(AutomationRule, { name: 'Automation rule', searchable: ['name', 'when', 'code'] });

exports.list = base.list;
exports.getOne = base.getOne;
exports.update = base.update;
exports.remove = base.remove;

/** WHEN → IF → THEN → WAIT → THEN → ELSE, validated before it is saved. */
exports.create = catchAsync(async (req, res) => {
  const { when, steps = [] } = req.body;
  if (!AUTOMATION_TRIGGERS.includes(when)) {
    throw ApiError.badRequest(`when has to be one of the ${AUTOMATION_TRIGGERS.length} triggers`);
  }
  if (!steps.length) throw ApiError.badRequest('A rule that does nothing is not a rule — add a step');

  const rule = await AutomationRule.create({ ...req.body, createdBy: req.user._id });
  await record(req, 'create', 'Automation rule', rule._id, `${rule.name} created`);
  res.status(201).json({ success: true, data: rule });
});

exports.toggle = catchAsync(async (req, res) => {
  const rule = await AutomationRule.findById(req.params.id);
  if (!rule) throw ApiError.notFound('Rule not found');

  rule.status = rule.status === 'On' ? 'Off' : 'On';
  await rule.save();

  await record(req, 'update', 'Automation rule', rule._id, `${rule.name} switched ${rule.status.toLowerCase()}`);
  res.json({ success: true, data: rule });
});

/**
 * Running one by hand. The real engine would be a worker reading the same
 * rule — this is the manual trigger the sheet lists among its 26.
 */
exports.run = catchAsync(async (req, res) => {
  const rule = await AutomationRule.findById(req.params.id);
  if (!rule) throw ApiError.notFound('Rule not found');
  if (rule.status !== 'On') throw ApiError.badRequest('That rule is switched off');

  rule.runs += 1;
  rule.completed += 1;
  rule.lastRunAt = new Date();
  await rule.save();

  await record(req, 'run', 'Automation rule', rule._id, `${rule.name} run by hand`);
  res.json({ success: true, data: rule });
});

/** What the builder can be pointed at. */
exports.options = catchAsync(async (req, res) => {
  res.json({ success: true, data: { triggers: AUTOMATION_TRIGGERS, operators: OPERATORS } });
});

/** Every automated action, which the sheet asks to be logged. */
exports.history = catchAsync(async (req, res) => {
  const rows = await AuditLog.find({ entity: 'Automation rule' })
    .sort('-createdAt')
    .limit(Number(req.query.limit) || 100)
    .lean();
  res.json({ success: true, data: rows });
});
