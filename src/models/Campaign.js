const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/** A WhatsApp broadcast, and what it actually earned. */
const campaignSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    name: { type: String, required: true },
    segment: { type: String, required: true },
    template: String,
    message: String,

    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read: { type: Number, default: 0 },
    replied: { type: Number, default: 0 },
    leads: { type: Number, default: 0 },
    sales: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },

    status: { type: String, enum: ['Draft', 'Sending', 'Sent', 'Paused'], default: 'Draft' },
    sentOn: Date,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(campaignSchema, 'CMP', { pad: 2, start: 0 });

/** What the sheet calls the actual ROI. */
campaignSchema.virtual('roi').get(function roi() {
  if (!this.cost) return null;
  return Math.round(((Number(this.revenue || 0) - this.cost) / this.cost) * 100);
});

module.exports = mongoose.model('Campaign', campaignSchema);
