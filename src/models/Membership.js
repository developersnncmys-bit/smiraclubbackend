const mongoose = require('mongoose');
const { MEMBERSHIP_STATUSES, ACTIVATION_STAGES, MOVEMENTS } = require('../config/constants');
const { withCode } = require('../helpers/ids');
const { balanceOf, paymentStatus } = require('../helpers/money');

/**
 * Somebody's membership: what they bought, what they have paid, where the
 * activation got to, what they have used, and when it renews.
 */
const membershipSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    name: { type: String, required: true },
    phone: String,
    email: String,
    city: String,
    branch: String,

    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'MembershipPlan', required: true },
    planName: String,
    members: { type: Number, default: 1 },
    movement: { type: String, enum: MOVEMENTS, default: 'New' },

    source: String,
    receivedOn: { type: Date, default: Date.now },
    startedOn: Date,
    expiresOn: { type: Date, index: true },

    amount: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    refund: { type: Number, default: 0 },

    status: { type: String, enum: MEMBERSHIP_STATUSES, default: 'New', index: true },

    expert: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    fieldOfficer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    /** Sold → payment → documents → activated, with who did what. */
    activation: {
      stage: { type: String, enum: ACTIVATION_STAGES, default: 'Sold' },
      activatedOn: Date,
      deadline: Date,
      contacted: { type: Boolean, default: false },
      explained: { type: Boolean, default: false },
      documents: { type: Boolean, default: false },
      giftGiven: { type: Boolean, default: false },
    },

    /** 90 → 60 → 30 → 15 → 7 days, then expired. */
    renewal: {
      stage: {
        type: String,
        enum: ['—', 'Not started', 'Reminded', 'In discussion', 'Offer sent', 'Renewed', 'Renewal lost'],
        default: '—',
      },
      offer: String,
      probability: { type: Number, default: 0 },
      assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      lastContactAt: Date,
      nextFollowUpAt: Date,
    },

    /** What the plan gave them, and how much is left. */
    benefits: [
      {
        name: String,
        total: { type: Number, default: 0 },
        used: { type: Number, default: 0 },
        expiresOn: Date,
        _id: false,
      },
    ],
    saving: { type: Number, default: 0 },

    timeline: [{ step: String, at: Date, note: String, _id: false }],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(membershipSchema, 'MSU', { pad: 3, start: 0 });

membershipSchema.index({ name: 'text', phone: 'text', planName: 'text' });
membershipSchema.index({ status: 1, expiresOn: 1, expert: 1 });

membershipSchema.virtual('pending').get(function pending() {
  return balanceOf({ amount: this.amount, paid: this.paid });
});

membershipSchema.virtual('paymentStatus').get(function status() {
  return paymentStatus({ amount: this.amount, paid: this.paid });
});

/** Days to expiry — negative once it has lapsed. */
membershipSchema.virtual('daysLeft').get(function daysLeft() {
  if (!this.expiresOn) return null;
  return Math.round((this.expiresOn.getTime() - Date.now()) / 86400000);
});

membershipSchema.virtual('benefitsUsed').get(function used() {
  const list = this.benefits || [];
  const total = list.reduce((s, b) => s + Number(b.total || 0), 0);
  const spent = list.reduce((s, b) => s + Number(b.used || 0), 0);
  return total ? Math.round((spent / total) * 100) : 0;
});

/** Expiring soon and expired look after themselves. */
membershipSchema.pre('save', function trackExpiry(next) {
  if (this.expiresOn && ['Active', 'Expiring soon', 'Expired'].includes(this.status)) {
    const days = Math.round((this.expiresOn.getTime() - Date.now()) / 86400000);
    if (days < 0) this.status = 'Expired';
    else if (days <= 45) this.status = 'Expiring soon';
    else this.status = 'Active';
  }
  next();
});

module.exports = mongoose.model('Membership', membershipSchema);
