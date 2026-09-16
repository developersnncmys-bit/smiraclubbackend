const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/**
 * A hotel, villa, transport or activity supplier. The Partners sheet's
 * onboarding record, their contract, and how they are actually performing.
 */
const partnerSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ['Hotel', 'Villa', 'Package', 'Lifestyle', 'Transport', 'Restaurant', 'Activity', 'Spa'],
      default: 'Hotel',
    },
    businessType: String,
    location: String,

    contact: String,
    phone: String,
    /** The last ten digits of `phone`, which is what sign-in looks up. */
    phoneDigits: { type: String, index: true },
    whatsapp: String,
    email: { type: String, lowercase: true, trim: true },

    // -- Papers -------------------------------------------------------------
    gst: String,
    pan: String,
    upi: String,
    bank: String,
    registration: String,
    contract: String,
    contractEndsOn: Date,
    documents: [
      { name: String, url: String, status: { type: String, default: 'Waiting' }, _id: false },
    ],

    commission: { type: Number, default: 0 },
    ratePlan: String,
    rooms: { type: Number, default: 0 },

    // -- Onboarding ---------------------------------------------------------
    submittedOn: Date,
    verification: { type: String, enum: ['Waiting', 'Verified', 'Rejected'], default: 'Waiting' },
    approval: { type: String, enum: ['Waiting', 'Approved', 'Rejected'], default: 'Waiting' },
    stage: { type: String, default: 'Enquiry' },
    status: { type: String, enum: ['Active', 'Paused', 'Blacklisted', 'Pending'], default: 'Pending' },
    rejectedReason: String,

    // -- How they are doing --------------------------------------------------
    bookings: { type: Number, default: 0 },
    confirmed: { type: Number, default: 0 },
    cancelled: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    commissionEarned: { type: Number, default: 0 },
    payable: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    responseMins: { type: Number, default: 0 },
    rating: { type: Number, min: 0, max: 5, default: 0 },
    repeatRate: { type: Number, default: 0 },

    activities: [{ at: Date, text: String, _id: false }],

    // -- Signing in to the partner portal ------------------------------------
    otp: {
      /** Hashed. The digits themselves are never stored. */
      codeHash: { type: String, select: false },
      expiresAt: Date,
      attempts: { type: Number, default: 0 },
      lastSentAt: Date,
    },
    lastLoginAt: Date,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(partnerSchema, 'PTR', { pad: 2, start: 0 });

const digitsOf = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

partnerSchema.statics.digits = digitsOf;

partnerSchema.pre('save', function keepDigits(next) {
  if (this.isModified('phone')) this.phoneDigits = digitsOf(this.phone);
  next();
});

/** Upserts skip document middleware, and the seed upserts partners. */
partnerSchema.pre('findOneAndUpdate', function keepDigitsOnUpdate(next) {
  const update = this.getUpdate() || {};
  const phone = update.phone ?? update.$set?.phone;
  if (phone !== undefined) {
    if (update.$set) update.$set.phoneDigits = digitsOf(phone);
    else update.phoneDigits = digitsOf(phone);
  }
  next();
});

partnerSchema.index({ name: 'text', location: 'text', contact: 'text' });

partnerSchema.virtual('confirmationRate').get(function rate() {
  return this.bookings ? Math.round((this.confirmed / this.bookings) * 100) : 0;
});

partnerSchema.virtual('cancellationRate').get(function rate() {
  return this.bookings ? Math.round((this.cancelled / this.bookings) * 100) : 0;
});

partnerSchema.virtual('pendingConfirmations').get(function pending() {
  return Math.max(0, (this.bookings || 0) - (this.confirmed || 0) - (this.cancelled || 0) - (this.failed || 0));
});

partnerSchema.virtual('balance').get(function balance() {
  return Math.max(0, (this.payable || 0) - (this.paid || 0));
});

module.exports = mongoose.model('Partner', partnerSchema);
