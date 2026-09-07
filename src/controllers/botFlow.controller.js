const BotFlow = require('../models/BotFlow');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');

const base = crud(BotFlow, { name: 'Chatbot journey', searchable: ['name', 'trigger', 'code'] });

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

exports.setStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  if (!['Draft', 'Live', 'Paused'].includes(status)) {
    throw ApiError.badRequest('status has to be Draft, Live or Paused');
  }
  const flow = await BotFlow.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!flow) throw ApiError.notFound('Journey not found');
  res.json({ success: true, data: flow });
});

/** Where every bot session ended, and the three rates the sheet asks for. */
exports.performance = catchAsync(async (req, res) => {
  const rows = await BotFlow.aggregate([
    {
      $group: {
        _id: null,
        sessions: { $sum: '$sessions' },
        completed: { $sum: '$completed' },
        transferred: { $sum: '$transferred' },
        abandoned: { $sum: '$abandoned' },
        leadsCreated: { $sum: '$leadsCreated' },
      },
    },
  ]);

  const r = rows[0] || {};
  const sessions = r.sessions || 0;

  res.json({
    success: true,
    data: {
      ...r,
      botResolutionRate: sessions ? Math.round(((r.completed || 0) / sessions) * 100) : 0,
      humanHandoverRate: sessions ? Math.round(((r.transferred || 0) / sessions) * 100) : 0,
      botConversionRate: sessions ? Math.round(((r.leadsCreated || 0) / sessions) * 100) : 0,
    },
  });
});
