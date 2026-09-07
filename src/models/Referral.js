const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/** Refer and earn: who sent whom, and what it paid. */
const referralSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },

    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    referrerName: String,
    referralCode: String,

    referredName: { type: String, required: true },
    referredPhone: String,
    referredCustomer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },

    status: {
      type: String,
      enum: ['Enquiry', 'Qualified', 'Booked', 'Member', 'Lost'],
      default: 'Enquiry',
      index: true,
    },
    reward: { type: Number, default: 0 },
    rewardKind: { type: String, default: 'Travel credit' },
    paid: { type: Boolean, default: false },
    paidOn: Date,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(referralSchema, 'RFR', { pad: 3, start: 0 });

module.exports = mongoose.model('Referral', referralSchema);
