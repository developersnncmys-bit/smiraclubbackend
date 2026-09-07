const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/**
 * Stock reserved but not sold. The Travel Inventory sheet calls this critical
 * for preventing leakage: payment turns it into a booking, the timer running
 * out puts the units straight back on sale.
 */
const holdSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    inventory: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    inventoryName: String,
    units: { type: Number, default: 1 },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    customerName: String,
    channel: String,
    heldBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    heldForMinutes: { type: Number, default: 30 },
    expiresAt: { type: Date, index: true },
    stage: {
      type: String,
      enum: ['Awaiting payment', 'Confirmed', 'Released', 'Expired'],
      default: 'Awaiting payment',
    },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(holdSchema, 'HLD', { pad: 3, start: 0 });

holdSchema.virtual('minutesLeft').get(function left() {
  if (!this.expiresAt) return 0;
  return Math.max(0, Math.round((this.expiresAt.getTime() - Date.now()) / 60000));
});

holdSchema.pre('save', function setExpiry(next) {
  if (this.isNew && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + (this.heldForMinutes || 30) * 60000);
  }
  next();
});

module.exports = mongoose.model('Hold', holdSchema);
