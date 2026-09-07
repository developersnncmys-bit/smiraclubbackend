const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { LIVE_STATES } = require('../config/constants');
const { withCode } = require('../helpers/ids');

/**
 * An employee: the basic information the Add New User form collects, the
 * login block, the business assignment, and the numbers Team Status reports.
 */
const userSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    empId: { type: String, trim: true },
    name: { type: String, required: [true, 'A name is required'], trim: true },
    email: {
      type: String,
      required: [true, 'An email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, trim: true },
    /** Kept alongside the pretty version so a number can actually be found. */
    phoneDigits: { type: String, index: true },
    password: { type: String, required: true, minlength: 8, select: false },
    passwordChangedAt: Date,

    // -- Where they sit --------------------------------------------------
    role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true },
    designation: String,
    department: { type: String, trim: true },
    branch: { type: String, trim: true },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    joinedOn: Date,
    employment: { type: String, enum: ['Permanent', 'Probation', 'Contract', 'Intern'], default: 'Probation' },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },

    // -- Personal, as the sheet's form asks --------------------------------
    aadhaar: String,
    family: [{ name: String, relation: String }],

    // -- Login and security ------------------------------------------------
    /** The live one-time code, hashed — never the digits themselves. */
    otp: {
      codeHash: { type: String, select: false },
      expiresAt: Date,
      attempts: { type: Number, default: 0 },
      lastSentAt: Date,
    },

    twoFactor: { type: Boolean, default: false },
    webAccess: { type: Boolean, default: true },
    mobileAccess: { type: Boolean, default: true },
    deviceNote: String,
    lastLoginAt: Date,
    lastLogoutAt: Date,
    lastIp: String,
    lastAgent: String,
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,

    // -- What they have been given to work ---------------------------------
    leadSources: [String],
    territory: String,
    segment: String,
    products: [String],
    bookingCategories: [String],

    // -- Live status and the day's work ------------------------------------
    live: { type: String, enum: LIVE_STATES, default: 'Offline' },
    attendance: { type: String, default: 'Not marked' },
    activity: String,
    lastActiveAt: Date,

    target: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    calls: { type: Number, default: 0 },
    connectedCalls: { type: Number, default: 0 },
    presentations: { type: Number, default: 0 },
    visits: { type: Number, default: 0 },
    followUps: { type: Number, default: 0 },
    closings: { type: Number, default: 0 },
    productivity: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(userSchema, 'USR', { pad: 3, start: 100 });

userSchema.index({ name: 'text', email: 'text', empId: 'text' });
userSchema.index({ branch: 1, department: 1, status: 1 });

/** How far past target they are — the panel shows this everywhere. */
userSchema.virtual('achievement').get(function achievement() {
  return this.target ? Math.round((this.revenue / this.target) * 100) : 0;
});

/** The first name is what leads, bookings and tickets are filed under. */
userSchema.virtual('firstName').get(function firstName() {
  return String(this.name || '').split(' ')[0];
});

/** Whatever shape the number was typed in, store the ten digits too. */
userSchema.pre('save', function keepDigits(next) {
  if (this.isModified('phone')) {
    this.phoneDigits = String(this.phone || '').replace(/\D/g, '').slice(-10);
  }
  next();
});

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
  next();
});

userSchema.methods.checkPassword = function checkPassword(plain) {
  return bcrypt.compare(plain, this.password);
};

/** The last ten digits, which is how a number is matched however it was typed. */
userSchema.statics.digits = function digits(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
};

userSchema.methods.passwordChangedAfter = function passwordChangedAfter(issuedAt) {
  if (!this.passwordChangedAt) return false;
  return Math.floor(this.passwordChangedAt.getTime() / 1000) > issuedAt;
};

module.exports = mongoose.model('User', userSchema);
