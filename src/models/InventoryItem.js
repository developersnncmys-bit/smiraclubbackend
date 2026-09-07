const mongoose = require('mongoose');
const { INVENTORY_CATEGORIES, MEMBERSHIP_TIERS, SALES_CHANNELS } = require('../config/constants');
const { withCode } = require('../helpers/ids');
const { sellingRate, memberRate } = require('../helpers/money');

/** A room type inside a hotel, with every rate the sheet lists. */
const roomSchema = new mongoose.Schema(
  {
    type: String,
    count: { type: Number, default: 0 },
    occupancy: { type: Number, default: 2 },
    extraBed: { type: Boolean, default: false },
    childPolicy: String,
    mealPlan: String,
    rack: Number,
    b2b: Number,
    smira: Number,
    member: Number,
    weekend: Number,
    seasonal: Number,
    blackout: String,
  },
  { _id: false }
);

/**
 * Stock. What is held, what it costs, who supplies it, who it is reserved
 * for, and when the contract behind it runs out.
 */
const inventorySchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    category: { type: String, enum: INVENTORY_CATEGORIES, required: true, index: true },
    name: { type: String, required: true, trim: true },
    reference: String,
    destination: String,
    grade: String,

    partner: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
    vendorName: String,

    units: { type: Number, default: 0 },
    booked: { type: Number, default: 0 },
    blocked: { type: Number, default: 0 },

    baseRate: { type: Number, default: 0 },
    markup: { type: Number, default: 0 },
    memberDiscount: { type: Number, default: 0 },

    status: { type: String, enum: ['Active', 'Limited', 'Low', 'Sold out', 'Blocked'], default: 'Active' },
    confirmation: { type: String, enum: ['Confirmed', 'Waiting'], default: 'Waiting' },
    contractEndsOn: Date,
    rateEndsOn: Date,

    address: String,
    gps: String,
    checkIn: String,
    checkOut: String,
    contact: String,
    amenities: [String],
    description: String,
    images: [String],

    rooms: [roomSchema],

    /** Reserved by tier and by channel, so one cannot eat everything. */
    allocation: {
      tiers: {
        Silver: { type: Number, default: 0 },
        Gold: { type: Number, default: 0 },
        Platinum: { type: Number, default: 0 },
        Diamond: { type: Number, default: 0 },
        Crown: { type: Number, default: 0 },
      },
      channels: {
        Website: { type: Number, default: 0 },
        App: { type: Number, default: 0 },
        CRM: { type: Number, default: 0 },
        WhatsApp: { type: Number, default: 0 },
        'Travel expert': { type: Number, default: 0 },
        Branch: { type: Number, default: 0 },
        'Corporate or B2B': { type: Number, default: 0 },
      },
      buffer: { type: Number, default: 0 },
    },

    /** Day-by-day overrides — what is left and what it costs that day. */
    availability: [
      { date: Date, left: Number, rate: Number, note: String, _id: false },
    ],
    blackouts: [{ from: Date, to: Date, reason: String, _id: false }],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(inventorySchema, 'INV', { pad: 3, start: 0 });

inventorySchema.index({ name: 'text', destination: 'text', vendorName: 'text' });

inventorySchema.virtual('available').get(function available() {
  return Math.max(0, (this.units || 0) - (this.booked || 0) - (this.blocked || 0));
});

inventorySchema.virtual('sellingRate').get(function selling() {
  return sellingRate(this.baseRate, this.markup);
});

inventorySchema.virtual('memberRate').get(function member() {
  return memberRate(this.baseRate, this.markup, this.memberDiscount);
});

inventorySchema.virtual('stockValue').get(function value() {
  return this.available * sellingRate(this.baseRate, this.markup);
});

/** Everything already spoken for, tiers plus channels plus the buffer. */
inventorySchema.virtual('allocated').get(function allocated() {
  const a = this.allocation || {};
  const tiers = MEMBERSHIP_TIERS.reduce((s, t) => s + Number(a.tiers?.[t] || 0), 0);
  const channels = SALES_CHANNELS.reduce((s, c) => s + Number(a.channels?.[c] || 0), 0);
  return tiers + channels + Number(a.buffer || 0);
});

module.exports = mongoose.model('InventoryItem', inventorySchema);
