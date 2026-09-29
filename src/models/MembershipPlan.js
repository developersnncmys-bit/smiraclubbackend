const mongoose = require('mongoose');

/** The tier colours the website already knows by name. */
const ACCENT_NAMES = [
  'silver', 'gold', 'platinum', 'diamond', 'crown',
  'slate', 'amber', 'violet', 'brand', 'sky', 'emerald', 'rose',
];
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
     * it and the two cannot drift into slightly different golds. The first
     * five are the tier colours the website was designed in; the rest are
     * there for a plan that is not one of the five.
     */
    accent: {
      type: String,
      default: 'brand',
      trim: true,
      lowercase: true,
      /**
       * One of the tier names, or a colour code of the desk's own.
       *
       * It was a fixed list, which meant the only colours a plan could ever
       * be were the ones somebody thought of in advance. A hex code is
       * allowed now and the website builds the card's gradient from it, so
       * a new tier does not need a deploy to get its colour.
       */
      validate: {
        validator: (v) =>
          !v ||
          ACCENT_NAMES.includes(v) ||
          /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v),
        message: 'Use a tier name or a colour code like #b8860b',
      },
    },

    /**
     * What the website calls it, in the two places the full name will not
     * fit or will not do: the tier chip wants one short word, and the card
     * wants a line saying who the plan is for.
     */
    shortLabel: { type: String, trim: true, maxlength: 20 },
    blurb: { type: String, trim: true, maxlength: 160 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(planSchema, 'MEM', { pad: 2, start: 0 });

module.exports = mongoose.model('MembershipPlan', planSchema);
