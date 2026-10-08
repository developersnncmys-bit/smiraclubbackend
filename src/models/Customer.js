const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/**
 * A member. The Members sheet's profile: who they are, what they have spent,
 * how engaged they are, their special days, and their referral record.
 */
const customerSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    city: String,
    address: String,
    gst: String,

    family: [{ name: String, relation: String, dob: Date }],
    dob: Date,
    anniversary: Date,
    /** What the special date is — "Anniversary", "Spouse birthday", "Other". */
    specialLabel: { type: String, trim: true, maxlength: 40 },
    childBirthday: Date,

    source: String,
    branch: String,
    expert: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    fieldOfficer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    tier: String,
    trips: { type: Number, default: 0 },
    spend: { type: Number, default: 0 },
    lastBookingOn: Date,
    lastInteractionOn: Date,
    lastMessageOn: Date,

    preferences: {
      destinations: [String],
      hotelCategory: String,
      mealPlan: String,
      travelMonths: [String],
      notes: String,
    },

    engagement: {
      type: String,
      enum: ['Highly engaged', 'Engaged', 'Low engagement', 'At risk'],
      default: 'Engaged',
    },
    satisfaction: { type: Number, min: 0, max: 5 },

    /**
     * When they last opened their notifications.
     *
     * Notifications are not stored — they are worked out from the
     * bookings, membership, gifts and offers on the account, so there
     * is no row to mark read. Anything older than this has been seen.
     */
    notificationsReadAt: Date,

    referral: {
      code: String,
      total: { type: Number, default: 0 },
      qualified: { type: Number, default: 0 },
      converted: { type: Number, default: 0 },
      earned: { type: Number, default: 0 },
      redeemed: { type: Number, default: 0 },
    },

    tags: [String],
    notes: String,

    /**
     * What they have saved on the website.
     *
     * It lived in the browser, which meant a member who saved six villas
     * on their phone opened the site on a laptop to an empty list — and
     * the desk, who could have called them about those six villas, never
     * knew. `href` is the identity; the rest is enough to draw the card
     * again without looking anything up.
     */
    wishlist: [
      {
        _id: false,
        href: { type: String, required: true, trim: true, maxlength: 400 },
        name: { type: String, trim: true, maxlength: 200 },
        place: { type: String, trim: true, maxlength: 200 },
        image: { type: String, trim: true, maxlength: 600 },
        savedAt: { type: Date, default: Date.now },
      },
    ],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(customerSchema, 'CUS', { pad: 4, start: 1000 });

customerSchema.index({ name: 'text', phone: 'text', email: 'text' });
customerSchema.index({ expert: 1, branch: 1 });

/** Referral money still owed to them. */
customerSchema.virtual('referral.pending').get(function pending() {
  return Math.max(0, (this.referral?.earned || 0) - (this.referral?.redeemed || 0));
});

module.exports = mongoose.model('Customer', customerSchema);
