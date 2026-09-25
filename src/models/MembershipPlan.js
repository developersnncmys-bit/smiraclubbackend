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
    /** How many preferred services a member on this plan may choose. */
    privileges: { type: Number, default: 1 },
    services: [String],
    gifts: [String],
    features: [String],

    published: { type: Boolean, default: true },
    popular: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },

    /**
     * The colour the plan wears, on the panel and on the website's pricing
     * page. Named rather than a hex, so each end draws its own gradient from
     * it and the two cannot drift into slightly different golds.
     */
    accent: {
      type: String,
      enum: ['slate', 'amber', 'violet', 'brand', 'sky', 'emerald', 'rose'],
      default: 'brand',
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(planSchema, 'MEM', { pad: 2, start: 0 });

module.exports = mongoose.model('MembershipPlan', planSchema);
