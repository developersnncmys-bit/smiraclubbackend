const mongoose = require('mongoose');
const { LEAD_STAGES, LEAD_SOURCES, LEAD_SCORES } = require('../config/constants');
const { withCode } = require('../helpers/ids');

/** One line on the lead's history — every call, message and stage change. */
const activitySchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['note', 'call', 'whatsapp', 'email', 'meeting', 'status', 'visit'], default: 'note' },
    text: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * A lead, walking the Sales & Leads funnel. The sheet's stages, sources and
 * scoring bands, plus who owns it and when it is next being touched.
 */
const leadSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },

    destination: String,
    pax: { type: Number, default: 1 },
    travelDate: Date,
    budget: { type: Number, default: 0 },

    status: { type: String, enum: LEAD_STAGES, default: 'New', index: true },
    /** The campaign that brought it in, by name — for leads and sales by campaign. */
    campaign: { type: String, trim: true, maxlength: 80 },
    source: { type: String, enum: LEAD_SOURCES, default: 'Website' },
    score: { type: String, enum: LEAD_SCORES, default: 'Warm' },
    priority: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium' },
    label: String,

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    branch: String,
    department: String,

    lastContactAt: Date,
    nextFollowUpAt: Date,
    presentationAt: Date,
    visitAt: Date,

    /** Set the moment the stage becomes Lost — the sheet reports on these. */
    lostReason: String,
    lostAt: Date,

    convertedCustomer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    convertedAt: Date,

    /** How long it has spent in the stage it is in now. */
    stageChangedAt: { type: Date, default: Date.now },

    activities: [activitySchema],
    tags: [String],
    notes: String,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(leadSchema, 'LEAD', { pad: 4, start: 2000 });

leadSchema.index({ name: 'text', phone: 'text', destination: 'text' });
leadSchema.index({ status: 1, owner: 1, createdAt: -1 });

/** Days in the current stage — the funnel report asks for this. */
leadSchema.virtual('daysInStage').get(function daysInStage() {
  const from = this.stageChangedAt || this.createdAt;
  if (!from) return 0;
  return Math.max(0, Math.round((Date.now() - from.getTime()) / 86400000));
});

leadSchema.virtual('isOverdue').get(function isOverdue() {
  return Boolean(this.nextFollowUpAt && this.nextFollowUpAt < new Date());
});

/** Moving stage stamps the clock, so time-in-stage stays honest. */
leadSchema.pre('save', function stampStage(next) {
  if (!this.isNew && this.isModified('status')) {
    this.stageChangedAt = new Date();
    if (this.status === 'Lost' && !this.lostAt) this.lostAt = new Date();
  }
  next();
});

module.exports = mongoose.model('Lead', leadSchema);
