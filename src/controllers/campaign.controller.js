const Campaign = require('../models/Campaign');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');

const base = crud(Campaign, { name: 'Campaign', searchable: ['name', 'segment', 'code'] });

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/** Sending it stamps the funnel with what actually went out. */
exports.send = catchAsync(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) throw ApiError.notFound('Campaign not found');
  if (campaign.status === 'Sent') throw ApiError.conflict('That campaign has already gone out');

  const audience = Number(req.body.audience || campaign.sent || 0);
  campaign.sent = audience;
  campaign.delivered = Math.round(audience * 0.97);
  campaign.status = 'Sent';
  campaign.sentOn = new Date();
  campaign.cost = campaign.cost || Math.round(audience * 0.35);
  await campaign.save();

  await record(req, 'send', 'Campaign', campaign._id, `${campaign.name} sent to ${audience}`);
  res.json({ success: true, data: campaign });
});

/** Sent → delivered → read → replied → leads → sales, and the ROI. */
exports.results = catchAsync(async (req, res) => {
  const rows = await Campaign.find().sort('-sentOn').lean();

  res.json({
    success: true,
    data: rows.map((c) => ({
      ...c,
      readRate: c.delivered ? Math.round((c.read / c.delivered) * 100) : 0,
      replyRate: c.delivered ? Math.round((c.replied / c.delivered) * 100) : 0,
      roi: c.cost ? Math.round(((Number(c.revenue || 0) - c.cost) / c.cost) * 100) : null,
    })),
  });
});
