const Expense = require('../models/Expense');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { EXPENSE_CATEGORIES } = require('../config/constants');

const base = crud(Expense, {
  name: 'Expense',
  searchable: ['detail', 'reference', 'code'],
  populate: { path: 'raisedBy', select: 'name' },
  defaultSort: '-spentOn',
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/** Expense → approval → payment → accounting. */
const ORDER = ['Raised', 'Approved', 'Paid', 'In accounts'];

exports.advance = catchAsync(async (req, res) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) throw ApiError.notFound('Expense not found');
  if (expense.stage === 'Rejected') throw ApiError.conflict('That expense was rejected');

  const at = ORDER.indexOf(expense.stage);
  if (at === ORDER.length - 1) throw ApiError.conflict('That expense is already in the books');

  expense.stage = ORDER[at + 1];
  if (expense.stage === 'Approved') expense.approvedBy = req.user._id;
  if (expense.stage === 'Paid') expense.paidOn = new Date();
  await expense.save();

  res.json({ success: true, data: expense });
});

/** What the company spends, by category. */
exports.summary = catchAsync(async (req, res) => {
  const rows = await Expense.aggregate([
    { $group: { _id: '$category', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);

  const total = rows.reduce((s, r) => s + r.amount, 0);

  res.json({
    success: true,
    data: {
      total,
      categories: EXPENSE_CATEGORIES.map((category) => {
        const r = rows.find((x) => x._id === category) || {};
        return {
          category,
          amount: r.amount || 0,
          count: r.count || 0,
          share: total ? Math.round(((r.amount || 0) / total) * 100) : 0,
        };
      }),
    },
  });
});
