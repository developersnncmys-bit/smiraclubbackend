const AuditLog = require('../models/AuditLog');
const catchAsync = require('../helpers/catchAsync');
const { buildFilter, buildOptions, paginate } = require('../helpers/query');

/** Read-only. Nothing is allowed to edit the trail it left. */
exports.list = catchAsync(async (req, res) => {
  const filter = buildFilter(req.query, { searchable: ['message', 'actorName', 'entity'] });
  const options = buildOptions(req.query, { defaultSort: '-createdAt' });
  const result = await paginate(AuditLog, filter, options);
  res.json({ success: true, ...result });
});

/** Everything that has happened to one record. */
exports.forEntity = catchAsync(async (req, res) => {
  const rows = await AuditLog.find({ entity: req.params.entity, entityId: req.params.id })
    .sort('-createdAt')
    .lean();
  res.json({ success: true, data: rows });
});
