const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/** A promotion the desk can put in front of a customer. */
const offerSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    name: { type: String, required: true },
    couponCode: { type: String, uppercase: true, trim: true },
    description: String,

    kind: { type: String, enum: ['Percent off', 'Flat off', 'Free night', 'Upgrade', 'Gift'], default: 'Percent off' },
    value: { type: Number, default: 0 },
    maxDiscount: { type: Number, default: 0 },
    minSpend: { type: Number, default: 0 },

    appliesTo: [String],
    segments: [String],
    channels: [String],

    startsOn: Date,
    endsOn: Date,
    usageLimit: { type: Number, default: 0 },
    used: { type: Number, default: 0 },

    status: { type: String, enum: ['Draft', 'Live', 'Paused', 'Expired'], default: 'Draft', index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(offerSchema, 'OFR', { pad: 3, start: 0 });

module.exports = mongoose.model('Offer', offerSchema);
