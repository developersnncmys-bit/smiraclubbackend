const Ticket = require('../models/Ticket');
const Task = require('../models/Task');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');
const { TICKET_STAGES, SLA } = require('../config/constants');

const base = crud(Ticket, {
  name: 'Ticket',
  searchable: ['customerName', 'phone', 'subCategory', 'description', 'code'],
  populate: { path: 'executive', select: 'name code' },
  ownerField: 'executive',
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.update = base.update;
exports.remove = base.remove;

exports.create = catchAsync(async (req, res) => {
  const ticket = await Ticket.create({
    ...req.body,
    // Held by whoever raised it until it is passed on, so it is never
    // sitting in a queue nobody can see.
    executive: req.body.executive || req.user._id,
    stage: req.body.executive ? 'Assigned' : 'New',
    timeline: [
      { at: new Date(), who: req.user.name, channel: 'Panel', text: req.body.description },
    ],
    createdBy: req.user._id,
  });
  await record(req, 'create', 'Ticket', ticket._id, `${ticket.code} raised`);
  res.status(201).json({ success: true, data: ticket });
});

exports.assign = catchAsync(async (req, res) => {
  const { ids = [], executive } = req.body;
  if (!executive) throw ApiError.badRequest('Say who is picking it up');
  const list = ids.length ? ids : [req.params.id].filter(Boolean);

  const result = await Ticket.updateMany(
    { _id: { $in: list } },
    {
      executive,
      stage: 'Assigned',
      $push: { timeline: { at: new Date(), who: req.user.name, channel: 'Panel', text: 'Assigned' } },
    }
  );

  await record(req, 'assign', 'Ticket', list.join(','), `${result.modifiedCount} ticket(s) assigned`);
  res.json({ success: true, data: { moved: result.modifiedCount } });
});

/** Up the ladder: executive → manager → operations → senior management. */
exports.escalate = catchAsync(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');

  ticket.escalation = Math.min(4, (ticket.escalation || 1) + 1);
  ticket.stage = 'Escalated';
  ticket.timeline.push({
    at: new Date(),
    who: req.user.name,
    channel: 'Panel',
    text: `Escalated to level ${ticket.escalation}${req.body.reason ? ` — ${req.body.reason}` : ''}`,
  });
  await ticket.save();

  await record(req, 'escalate', 'Ticket', ticket._id, `${ticket.code} at level ${ticket.escalation}`);
  res.json({ success: true, data: ticket });
});

/** Hand it to another desk entirely. */
exports.transfer = catchAsync(async (req, res) => {
  const { department } = req.body;
  if (!department) throw ApiError.badRequest('Say which desk it is going to');

  const ticket = await Ticket.findByIdAndUpdate(
    req.params.id,
    {
      department,
      executive: null,
      stage: 'New',
      $push: { timeline: { at: new Date(), who: req.user.name, channel: 'Panel', text: `Transferred to ${department}` } },
    },
    { new: true }
  );
  if (!ticket) throw ApiError.notFound('Ticket not found');
  res.json({ success: true, data: ticket });
});

exports.addNote = catchAsync(async (req, res) => {
  const { text, channel = 'Internal note' } = req.body;
  if (!text) throw ApiError.badRequest('Say something');

  const ticket = await Ticket.findByIdAndUpdate(
    req.params.id,
    {
      $push: { timeline: { at: new Date(), who: req.user.name, channel, text } },
      ...(req.body.firstResponse ? { firstResponseAt: new Date() } : {}),
    },
    { new: true }
  );
  if (!ticket) throw ApiError.notFound('Ticket not found');
  res.json({ success: true, data: ticket });
});

/**
 * The sheet is firm: a ticket cannot close without a resolution note. This is
 * where that rule actually lives.
 */
exports.resolve = catchAsync(async (req, res) => {
  const { note, action, refund = 0, compensation = 0, partnerResponse, contacted = true, remarks } = req.body;
  if (!note) throw ApiError.badRequest('Write what was done before resolving this');

  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');

  ticket.resolution = { note, action, refund, compensation, partnerResponse, contacted, confirmed: false, remarks };
  ticket.stage = 'Resolved';
  ticket.timeline.push({ at: new Date(), who: req.user.name, channel: 'Resolution', text: note });
  await ticket.save();

  await record(req, 'resolve', 'Ticket', ticket._id, `${ticket.code} resolved`);
  res.json({ success: true, data: ticket });
});

exports.close = catchAsync(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (!ticket.resolution?.note) throw ApiError.badRequest('It cannot be closed without a resolution note');

  ticket.stage = 'Closed';
  ticket.resolution.confirmed = true;
  ticket.timeline.push({ at: new Date(), who: req.user.name, channel: 'Panel', text: 'Closed' });
  await ticket.save();

  res.json({ success: true, data: ticket });
});

/** A one or two star rating raises a follow-up on its own. */
exports.rate = catchAsync(async (req, res) => {
  const rating = Number(req.body.rating);
  if (!(rating >= 1 && rating <= 5)) throw ApiError.badRequest('A rating is one to five');

  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');

  ticket.rating = rating;
  ticket.ratedAt = new Date();
  ticket.timeline.push({ at: new Date(), who: ticket.customerName, channel: 'Panel', text: `Rated ${rating} of 5` });
  await ticket.save();

  let task = null;
  if (rating <= 2) {
    task = await Task.create({
      title: `Call ${ticket.customerName} about the ${rating} star rating on ${ticket.code}`,
      type: 'Follow-up',
      owner: ticket.executive,
      customer: ticket.customer,
      customerName: ticket.customerName,
      ticket: ticket._id,
      dueAt: new Date(Date.now() + 86400000),
      priority: 'High',
      lastAction: `${rating} star rating`,
      nextAction: 'Call the member and find out what went wrong',
      raisedBy: 'Automation',
    });
  }

  res.json({ success: true, data: { ticket, followUpTask: task } });
});

/** The funnel, the SLA clock and how it felt to the customer. */
exports.overview = catchAsync(async (req, res) => {
  const [byStage, bySla, byCategory, ratings, resolution] = await Promise.all([
    Ticket.aggregate([{ $group: { _id: '$stage', count: { $sum: 1 } } }]),
    Ticket.aggregate([{ $group: { _id: '$slaState', count: { $sum: 1 } } }]),
    Ticket.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
    Ticket.aggregate([
      { $match: { rating: { $ne: null } } },
      { $group: { _id: null, avg: { $avg: '$rating' }, rated: { $sum: 1 }, poor: { $sum: { $cond: [{ $lte: ['$rating', 2] }, 1, 0] } } } },
    ]),
    Ticket.aggregate([
      { $match: { resolvedAt: { $ne: null } } },
      { $group: { _id: null, avgMins: { $avg: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 60000] } } } },
    ]),
  ]);

  const total = byStage.reduce((s, r) => s + r.count, 0);
  const at = (stage) => byStage.find((r) => r._id === stage)?.count || 0;

  res.json({
    success: true,
    data: {
      total,
      funnel: TICKET_STAGES.map((stage) => ({
        stage,
        count: at(stage),
        share: total ? Math.round((at(stage) / total) * 100) : 0,
      })),
      sla: { targets: SLA, states: bySla },
      byCategory,
      satisfaction: ratings[0] ? { average: Number(ratings[0].avg.toFixed(1)), rated: ratings[0].rated, poor: ratings[0].poor } : null,
      averageResolutionHours: resolution[0] ? Math.round(resolution[0].avgMins / 60) : null,
    },
  });
});
