const Conversation = require('../models/Conversation');
const Lead = require('../models/Lead');
const Task = require('../models/Task');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const adsera = require('../helpers/adsera');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');

const base = crud(Conversation, {
  name: 'Conversation',
  searchable: ['name', 'phone', 'code'],
  populate: { path: 'owner', select: 'name code' },
  ownerField: 'owner',
  defaultSort: '-lastMessageAt',
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/** Replying puts the message on the thread and clears the unread count. */
exports.reply = catchAsync(async (req, res) => {
  const { text, templateName } = req.body;
  if (!text) throw ApiError.badRequest('Write something first');

  const found = await Conversation.findById(req.params.id).select('phone name messages.from messages.at').lean();
  if (!found) throw ApiError.notFound('Conversation not found');

  // A typed message only reaches somebody who wrote in the last 24 hours —
  // WhatsApp's rule. Past that it takes the request and then drops it, so the
  // desk thought it had gone. Say so now instead; a template still goes.
  if (!req.body.template) {
    const lastIn = [...(found.messages || [])].reverse().find((m) => m.from === 'them');
    const age = lastIn ? Date.now() - new Date(lastIn.at).getTime() : Infinity;
    if (age > 24 * 60 * 60 * 1000) {
      throw new ApiError(
        409,
        lastIn
          ? `${found.name || 'They'} last wrote more than 24 hours ago — WhatsApp only allows an approved template now`
          : `${found.name || 'They'} have not written to you yet — WhatsApp only allows an approved template`
      );
    }
  }

  // Out through AdsEra first, then onto the thread with how it went.
  let delivered = false;
  let problem = '';
  const conversation = found;
  if (conversation.phone && adsera.configured()) {
    try {
      if (req.body.template) await adsera.sendTemplate(req.body.template, conversation.phone, req.body.vars || {});
      else await adsera.sendText(conversation.phone, text);
      delivered = true;
    } catch (err) {
      problem = err.message || 'WhatsApp did not take the message';
    }
  } else if (!adsera.configured()) {
    problem = 'WhatsApp is not set up on the server';
  }
  const saved = await Conversation.findByIdAndUpdate(
    req.params.id,
    {
      $push: {
        messages: {
          from: 'me',
          text,
          templateName,
          at: new Date(),
          byName: req.user?.name,
          ...(delivered ? {} : { failed: true, error: problem.slice(0, 300) }),
        },
      },
      lastMessageAt: new Date(),
      unread: 0,
      handledBy: 'Staff',
    },
    { new: true }
  ).populate('owner', 'name code');
  res.json({ success: true, data: saved, delivered, ...(problem ? { message: problem } : {}) });
});

/** A message coming the other way — from the customer or the bot. */
exports.receive = catchAsync(async (req, res) => {
  const { phone, text, from = 'them', name } = req.body;
  if (!phone || !text) throw ApiError.badRequest('A phone number and a message are both needed');

  let conversation = await Conversation.findOne({ phone });
  if (!conversation) {
    conversation = await Conversation.create({ phone, name: name || phone, source: 'WhatsApp' });
  }

  conversation.messages.push({ from, text, at: new Date() });
  conversation.lastMessageAt = new Date();
  if (from === 'them') conversation.unread = (conversation.unread || 0) + 1;
  await conversation.save();

  res.status(201).json({ success: true, data: conversation });
});

exports.assign = catchAsync(async (req, res) => {
  const { owner } = req.body;
  if (!owner) throw ApiError.badRequest('Say who is taking it');

  const conversation = await Conversation.findByIdAndUpdate(
    req.params.id,
    { owner, handledBy: 'Staff' },
    { new: true }
  ).populate('owner', 'name');
  if (!conversation) throw ApiError.notFound('Conversation not found');
  res.json({ success: true, data: conversation });
});

/** Turning a chat into a lead, which is the point of the whole module. */
exports.toLead = catchAsync(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation) throw ApiError.notFound('Conversation not found');
  if (conversation.lead) throw ApiError.conflict('That chat is already a lead');

  const lead = await Lead.create({
    name: conversation.name,
    phone: conversation.phone,
    source: 'WhatsApp',
    score: conversation.score,
    owner: conversation.owner || req.user._id,
    status: 'New',
    lastContactAt: new Date(),
    createdBy: req.user._id,
    activities: [{ kind: 'whatsapp', text: 'Created from a WhatsApp chat', byName: req.user.name }],
  });

  conversation.lead = lead._id;
  conversation.category = 'New lead';
  await conversation.save();

  await record(req, 'convert', 'Conversation', conversation._id, `${conversation.code} became ${lead.code}`);
  res.status(201).json({ success: true, data: { conversation, lead } });
});

exports.toTask = catchAsync(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation) throw ApiError.notFound('Conversation not found');

  const task = await Task.create({
    title: req.body.title || `Follow up with ${conversation.name} on WhatsApp`,
    type: 'WhatsApp',
    owner: conversation.owner || req.user._id,
    customer: conversation.customer,
    customerName: conversation.name,
    dueAt: req.body.dueAt || conversation.followUpAt || new Date(Date.now() + 86400000),
    priority: conversation.score === 'Hot' ? 'High' : 'Medium',
    note: conversation.note,
    createdBy: req.user._id,
  });

  res.status(201).json({ success: true, data: task });
});

/** The numbers management asks for at the top of the WhatsApp tab. */
exports.overview = catchAsync(async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [total, today, byCategory, unread, bot] = await Promise.all([
    Conversation.countDocuments(),
    Conversation.countDocuments({ createdAt: { $gte: startOfDay } }),
    Conversation.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
    Conversation.countDocuments({ unread: { $gt: 0 } }),
    Conversation.aggregate([{ $group: { _id: '$handledBy', count: { $sum: 1 } } }]),
  ]);

  const handled = (who) => bot.find((b) => b._id === who)?.count || 0;

  res.json({
    success: true,
    data: {
      conversations: total,
      today,
      unanswered: unread,
      botHandled: handled('Bot'),
      staffHandled: handled('Staff'),
      byCategory,
    },
  });
});
