const mongoose = require('mongoose');
const { EXPENSE_CATEGORIES } = require('../config/constants');
const { withCode } = require('../helpers/ids');

/** Company spend: expense → approval → payment → accounting. */
const expenseSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    detail: String,
    amount: { type: Number, required: true },

    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    branch: String,
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },

    stage: {
      type: String,
      enum: ['Raised', 'Approved', 'Paid', 'In accounts', 'Rejected'],
      default: 'Raised',
      index: true,
    },
    spentOn: { type: Date, default: Date.now },
    paidOn: Date,
    reference: String,
    attachment: String,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(expenseSchema, 'EXP', { pad: 3, start: 0 });

module.exports = mongoose.model('Expense', expenseSchema);
