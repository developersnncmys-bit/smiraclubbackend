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
