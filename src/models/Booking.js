const mongoose = require('mongoose');
const { BOOKING_STATUSES, BOOKING_TYPES } = require('../config/constants');
const { withCode } = require('../helpers/ids');
const { bookingMarkup, balanceOf } = require('../helpers/money');

/** Who touched a booking, which the Booking sheet asks to be kept. */
const handledSchema = new mongoose.Schema(
  {
    created: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    handled: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    confirmed: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    modified: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelled: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: String,
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
    membership: { type: mongoose.Schema.Types.ObjectId, ref: 'Membership' },
    membershipPlan: String,

    bookingType: { type: String, enum: BOOKING_TYPES, default: 'Package' },
    hotel: String,
    inventory: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
    vendorName: String,
    destination: String,
    packageName: String,

    departureOn: Date,
    checkIn: Date,
    checkOut: Date,
    nights: { type: Number, default: 0 },
    rooms: { type: Number, default: 1 },
    roomType: String,
    mealPlan: String,
    pax: { type: Number, default: 1 },
    adults: { type: Number, default: 1 },
    children: { type: Number, default: 0 },
    infants: { type: Number, default: 0 },

    // -- What it is worth ---------------------------------------------------
    charges: {
      base: { type: Number, default: 0 },
      membershipDiscount: { type: Number, default: 0 },
      offerDiscount: { type: Number, default: 0 },
      meals: { type: Number, default: 0 },
      extra: { type: Number, default: 0 },
      taxes: { type: Number, default: 0 },
    },
    amount: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    vendorCost: { type: Number, default: 0 },
    vendorPaid: { type: Number, default: 0 },
    refund: { type: Number, default: 0 },

    status: { type: String, enum: BOOKING_STATUSES, default: 'Pending', index: true },
    confirmation: {
      status: { type: String, default: 'Waiting on the hotel' },
      reference: String,
      confirmedAt: Date,
    },
    voucherSentAt: Date,

    freeStay: { type: Boolean, default: false },
    occasion: String,
    specialRequests: [String],
    specialNote: String,

    source: String,
    channel: String,
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    branch: String,
    department: String,
    handledBy: handledSchema,

    cancelledOn: Date,
    cancelledReason: String,
    cancelledBy: { type: String, enum: ['Customer', 'Hotel', 'Smira', ''], default: '' },

    documents: [{ name: String, url: String, uploadedAt: Date }],
    activities: [
      {
        kind: String,
        text: String,
        byName: String,
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(bookingSchema, 'BKG', { pad: 4, start: 8800 });

bookingSchema.index({ customerName: 'text', hotel: 'text', destination: 'text' });
bookingSchema.index({ status: 1, checkIn: 1, owner: 1 });

bookingSchema.virtual('balance').get(function balance() {
  return balanceOf({ amount: this.amount, paid: this.paid });
});

/** What Smira keeps once the hotel has been paid. */
bookingSchema.virtual('markup').get(function markup() {
  return bookingMarkup(this.amount, this.vendorCost);
});

bookingSchema.virtual('vendorBalance').get(function vendorBalance() {
  return Math.max(0, (this.vendorCost || 0) - (this.vendorPaid || 0));
});

/** The total is worked out from the charge lines, never typed in twice. */
bookingSchema.pre('save', function totalUp(next) {
  if (this.isModified('charges')) {
    const c = this.charges || {};
    this.amount =
      Number(c.base || 0) -
      Number(c.membershipDiscount || 0) -
      Number(c.offerDiscount || 0) +
      Number(c.meals || 0) +
      Number(c.extra || 0) +
      Number(c.taxes || 0);
  }
  next();
});

module.exports = mongoose.model('Booking', bookingSchema);
