const mongoose = require('mongoose');
const { LEAD_SOURCES, LEAD_SCORES } = require('../config/constants');
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

    /**
     * How this person travels, and what they asked for.
     *
     * The customised tour form collects all of this and it was flattened
     * into the notes — one wall of text the booking team had to read
     * through before they could quote anything, and could not sort or
     * filter by. It is kept as fields as well, so the desk can see the
     * requirement at a glance and before they build the booking.
     *
     * The first six are the usage questions the desk asks on a call; the
     * rest is whatever the website form was given.
     */
    trip: {
      yearlyTrips: { type: String, trim: true, maxlength: 60 },
      hotelPreference: { type: String, trim: true, maxlength: 80 },
      travelPersons: { type: Number, min: 0 },
      roomsRequired: { type: Number, min: 0 },
      lastExpenses: { type: Number, min: 0 },
      planToTravel: { type: String, trim: true, maxlength: 80 },
      nextDestination: { type: String, trim: true, maxlength: 120 },
      nextTripDate: Date,

      checkIn: Date,
      checkOut: Date,
      duration: { type: String, trim: true, maxlength: 60 },
      dateMode: { type: String, trim: true, maxlength: 30 },
      adults: { type: Number, min: 0 },
      children: { type: Number, min: 0 },
      childAges: [{ type: Number, min: 0, max: 21 }],
      pets: { type: Boolean, default: false },
      occasion: { type: String, trim: true, maxlength: 60 },
      mealPlan: { type: String, trim: true, maxlength: 60 },
      mealType: { type: String, trim: true, maxlength: 40 },
      transport: [{ type: String, trim: true, maxlength: 60 }],
      pickupFrom: { type: String, trim: true, maxlength: 120 },
      pickupTo: { type: String, trim: true, maxlength: 120 },
      dropFrom: { type: String, trim: true, maxlength: 120 },
      dropTo: { type: String, trim: true, maxlength: 120 },
      returnTransfer: { type: Boolean, default: false },
      sightseeing: { type: String, trim: true, maxlength: 400 },
      extras: [{ type: String, trim: true, maxlength: 80 }],
      support: [{ type: String, trim: true, maxlength: 80 }],
      needs: { type: String, trim: true, maxlength: 600 },
      note: { type: String, trim: true, maxlength: 1000 },
    },

    status: { type: String, trim: true, maxlength: 40, default: 'New', index: true },
    /** The campaign that brought it in, by name — for leads and sales by campaign. */
    campaign: { type: String, trim: true, maxlength: 80 },
    source: { type: String, enum: LEAD_SOURCES, default: 'Website' },
    score: { type: String, enum: LEAD_SCORES, default: 'Warm' },
    priority: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium' },
    label: String,

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    /** When it was last given to somebody — by hand, by import or by a rule. */
    assignedAt: Date,
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
leadSchema.index({ owner: 1, assignedAt: -1 });

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

/*
 * Given to somebody: stamp the time. The automation's "take turns" counts
 * each person's leads given today, so every way a lead changes hands has
 * to leave the same mark — a new lead with an owner, an edit, a bulk move.
 */
leadSchema.pre('save', function stampAssign(next) {
  if (this.owner && (this.isNew || this.isModified('owner'))) this.assignedAt = new Date();
  next();
});

function stampAssignOnUpdate(next) {
  const upd = this.getUpdate() || {};
  const owner = upd.owner !== undefined ? upd.owner : upd.$set?.owner;
  if (owner) {
    upd.$set = { ...(upd.$set || {}), assignedAt: new Date() };
    this.setUpdate(upd);
  }
  next();
}
leadSchema.pre('findOneAndUpdate', stampAssignOnUpdate);
leadSchema.pre('updateOne', stampAssignOnUpdate);
leadSchema.pre('updateMany', stampAssignOnUpdate);

leadSchema.pre('insertMany', function stampImported(next, docs) {
  const now = new Date();
  (Array.isArray(docs) ? docs : []).forEach((d) => { if (d && d.owner && !d.assignedAt) d.assignedAt = now; });
  next();
});

/** How many leads each of these people was given since `since` (default: today). */
leadSchema.statics.givenSince = async function givenSince(userIds, since) {
  // Today starts at midnight in India, whatever the server's clock zone.
  const IST = 5.5 * 60 * 60 * 1000;
  const from = since || new Date(Math.floor((Date.now() + IST) / 86400000) * 86400000 - IST);
  const ids = userIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const rows = await this.aggregate([
    { $match: { owner: { $in: ids }, assignedAt: { $gte: from } } },
    { $group: { _id: '$owner', n: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(userIds.map((id) => [String(id), 0]));
  rows.forEach((r) => { counts[String(r._id)] = r.n; });
  return counts;
};

module.exports = mongoose.model('Lead', leadSchema);
