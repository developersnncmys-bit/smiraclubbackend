const mongoose = require('mongoose');
const { PAYMENT_STATUSES } = require('../config/constants');
const { withCode } = require('../helpers/ids');
const { balanceOf, paymentStatus } = require('../helpers/money');

/** Raised the moment a sale closes; receipted the moment money lands. */
const invoiceSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: String,
    gst: String,

    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    membership: { type: mongoose.Schema.Types.ObjectId, ref: 'Membership' },
    forWhat: String,

    baseAmount: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },

    issuedOn: { type: Date, default: Date.now },
    dueOn: Date,
    status: { type: String, enum: PAYMENT_STATUSES, default: 'Pending', index: true },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    branch: String,

    lastReminderAt: Date,
    nextFollowUpAt: Date,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(invoiceSchema, 'INV', { pad: 4, start: 2000 });

invoiceSchema.index({ customerName: 'text', code: 'text' });

invoiceSchema.virtual('balance').get(function balance() {
  return balanceOf({ amount: this.amount, paid: this.paid });
});

/** How many days past due it is — the collection buckets read this. */
invoiceSchema.virtual('overdueDays').get(function overdue() {
  if (!this.dueOn || this.balance <= 0) return 0;
  return Math.max(0, Math.round((Date.now() - this.dueOn.getTime()) / 86400000));
});

/** Due today → 1 day → 3 → 7 → 15 → 30+, straight off the sheet. */
invoiceSchema.virtual('bucket').get(function bucket() {
  if (this.balance <= 0) return 'Settled';
  const d = this.overdueDays;
  if (d <= 0) return 'Due today';
  if (d <= 1) return '1 day overdue';
  if (d <= 3) return '3 days overdue';
  if (d <= 7) return '7 days overdue';
  if (d <= 15) return '15 days overdue';
  return '30+ days overdue';
});

invoiceSchema.pre('save', function total(next) {
  if (this.isModified('baseAmount') || this.isModified('discount') || this.isModified('tax')) {
    this.amount = Math.max(0, Number(this.baseAmount || 0) - Number(this.discount || 0)) + Number(this.tax || 0);
  }
  if (this.isModified('paid') || this.isModified('amount')) {
    this.status = paymentStatus({ amount: this.amount, paid: this.paid });
  }
  next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);
