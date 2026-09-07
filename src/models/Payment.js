const mongoose = require('mongoose');
const { PAYMENT_MODES, GATEWAYS } = require('../config/constants');
const { withCode } = require('../helpers/ids');

/** A receipt. Money that has actually arrived, and where it came from. */
const paymentSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    customerName: String,
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    membership: { type: mongoose.Schema.Types.ObjectId, ref: 'Membership' },
    product: String,

    amount: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },

    mode: { type: String, enum: PAYMENT_MODES, default: 'UPI' },
    gateway: { type: String, enum: [...GATEWAYS, '—'], default: '—' },
    gatewayTxnId: String,
    gatewayFee: { type: Number, default: 0 },
    settlementOn: Date,
    settlementStatus: { type: String, enum: ['Pending', 'Settled', 'Reconciled'], default: 'Pending' },

    paidOn: { type: Date, default: Date.now, index: true },
    status: { type: String, enum: ['Success', 'Pending', 'Failed', 'Refunded'], default: 'Success' },

    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    branch: String,
    reference: String,
    note: String,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(paymentSchema, 'PAY', { pad: 4, start: 9900 });

paymentSchema.index({ customerName: 'text', reference: 'text' });
paymentSchema.index({ paidOn: -1, status: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
