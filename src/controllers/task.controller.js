const Task = require('../models/Task');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');

/** A repeating task that was just done: make the next one, once. */
async function repeatIfDone(doc, req) {
  if (!doc || doc.status !== 'Completed' || !doc.repeat || doc.nextMade) return;
  const due = new Date(doc.dueAt || Date.now());
  if (doc.repeat === 'Daily') due.setDate(due.getDate() + 1);
  if (doc.repeat === 'Weekly') due.setDate(due.getDate() + 7);
  if (doc.repeat === 'Monthly') due.setMonth(due.getMonth() + 1);
  const claimed = await Task.updateOne({ _id: doc._id, nextMade: { $ne: true } }, { $set: { nextMade: true } });
  if (!claimed.modifiedCount) return;
  doc.nextMade = true;
  await Task.create({
    title: doc.title,
    type: doc.type,
    owner: doc.owner?._id || doc.owner,
    customer: doc.customer,
    customerName: doc.customerName,
    lead: doc.lead,
    dueAt: due,
    priority: doc.priority,
    repeat: doc.repeat,
    note: doc.note,
    createdByName: doc.createdByName,
    raisedBy: doc.raisedBy,
    createdBy: req.user?._id,
  });
}

const base = crud(Task, {
  name: 'Task',
  searchable: ['title', 'customerName', 'code'],
  populate: { path: 'owner', select: 'name code' },
  ownerField: 'owner',
  defaultSort: 'dueAt',
  afterUpdate: repeatIfDone,
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

exports.complete = catchAsync(async (req, res) => {
  const task = await Task.findByIdAndUpdate(
    req.params.id,
    { status: 'Completed', completedAt: new Date(), lastAction: req.body.note || 'Completed' },
    { new: true }
  );
  if (!task) throw ApiError.notFound('Task not found');
  await repeatIfDone(task, req);
  res.json({ success: true, data: task });
});

/** Add a comment to a task. */
exports.comment = catchAsync(async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 1000);
  if (!text) throw ApiError.badRequest('Write a comment first');
  const task = await Task.findByIdAndUpdate(
    req.params.id,
    { $push: { comments: { text, by: req.user._id, byName: req.user.name, at: new Date() } } },
    { new: true }
  ).populate('owner', 'name code');
  if (!task) throw ApiError.notFound('Task not found');
  res.json({ success: true, data: task });
});

/** Today, overdue and done — the three piles the desk works from. */
exports.board = catchAsync(async (req, res) => {
  const filter = {};
  if ((req.user.role?.scope || 'own') === 'own') filter.owner = req.user._id;
  if (req.query.owner) filter.owner = req.query.owner;

  const tasks = await Task.find(filter).sort('dueAt').populate('owner', 'name').lean();
  const now = new Date();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  res.json({
    success: true,
    data: {
      overdue: tasks.filter((t) => !['Completed', 'Cancelled'].includes(t.status) && t.dueAt && t.dueAt < now),
      today: tasks.filter(
        (t) => !['Completed', 'Cancelled'].includes(t.status) && t.dueAt && t.dueAt >= now && t.dueAt <= endOfDay
      ),
      later: tasks.filter((t) => !['Completed', 'Cancelled'].includes(t.status) && (!t.dueAt || t.dueAt > endOfDay)),
      done: tasks.filter((t) => t.status === 'Completed'),
    },
  });
});
