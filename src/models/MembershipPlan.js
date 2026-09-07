const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/**
 * A plan on the shelf — Silver, Gold, Platinum and up. What it costs, how
 * long it runs, who it covers, and what the member gets.
 */
const planSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    name: { type: String, required: true, unique: true, trim: true },
    tagline: String,

    price: { type: Number, required: true },
    billing: { type: String, default: 'Yearly' },
    durationMonths: { type: Number, default: 12 },

    persons: { type: Number, default: 2 },
    rooms: { type: Number, default: 1 },

    /** The free nights the plan carries, and how long they stay usable. */
    freeStay: {
      nights: { type: Number, default: 0 },
      validityMonths: { type: Number, default: 12 },
      note: String,
    },

    discount: { type: Number, default: 0 },
    services: [String],
    gifts: [String],
    features: [String],

    published: { type: Boolean, default: true },
    popular: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(planSchema, 'MEM', { pad: 2, start: 0 });

module.exports = mongoose.model('MembershipPlan', planSchema);
