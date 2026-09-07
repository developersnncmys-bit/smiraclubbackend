const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/**
 * Money going back out. The Payment sheet is firm that this needs permission:
 * request → manager approval → finance approval → processed.
 */
const refundSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    customerName: String,
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    originalPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },

    originalAmount: { type: Number, default: 0 },
    cancellationCharges: { type: Number, default: 0 },
    amount: { type: Number, required: true },
    reason: String,

    stage: {
      type: String,
      enum: ['Refund request', 'Manager approval', 'Finance approval', 'Refund processed', 'Rejected'],
      default: 'Refund request',
      index: true,
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    processedAt: Date,
    refundTxnId: String,

    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    branch: String,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(refundSchema, 'REF', { pad: 3, start: 0 });

module.exports = mongoose.model('Refund', refundSchema);
