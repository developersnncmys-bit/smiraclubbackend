const mongoose = require('mongoose');
const {
  TICKET_STAGES,
  TICKET_PRIORITIES,
  TICKET_CATEGORIES,
  SLA_STATES,
  SLA,
} = require('../config/constants');
const { withCode } = require('../helpers/ids');

/** Calls, WhatsApp, emails, internal notes and partner replies, in order. */
const timelineSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    who: String,
    channel: {
      type: String,
      enum: ['Call', 'WhatsApp', 'Email', 'Internal note', 'Panel', 'Partner', 'Website', 'Automation', 'Resolution'],
      default: 'Internal note',
    },
    text: String,
  },
  { _id: false }
);

/**
 * A complaint. Everything the Support sheet asks a ticket to carry, including
 * the SLA clock, the escalation level and the resolution record it cannot be
 * closed without.
 */
const ticketSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String, required: true },
    phone: String,
    membership: { type: mongoose.Schema.Types.ObjectId, ref: 'Membership' },
    membershipName: String,
    membershipExpiry: Date,

    category: { type: String, enum: TICKET_CATEGORIES, required: true },
    subCategory: String,
    description: { type: String, required: true },
    attachments: [{ name: String, url: String }],

    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    partner: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
    hotel: String,

    executive: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    department: { type: String, default: 'Support' },
    branch: String,

    priority: { type: String, enum: TICKET_PRIORITIES, default: 'Medium' },
    stage: { type: String, enum: TICKET_STAGES, default: 'New', index: true },
    escalation: { type: Number, min: 1, max: 4, default: 1 },

    firstResponseAt: Date,
    slaDeadline: Date,
    slaState: { type: String, enum: SLA_STATES, default: 'Within' },
    resolvedAt: Date,
    closedAt: Date,

    /** The eight things the sheet wants before a ticket may close. */
    resolution: {
      note: String,
      action: String,
      refund: { type: Number, default: 0 },
      compensation: { type: Number, default: 0 },
      partnerResponse: String,
      contacted: { type: Boolean, default: false },
      confirmed: { type: Boolean, default: false },
      remarks: String,
    },

    rating: { type: Number, min: 1, max: 5 },
    ratedAt: Date,

    previousComplaints: { type: Number, default: 0 },
    timeline: [timelineSchema],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(ticketSchema, 'TCK', { pad: 4, start: 1000 });

ticketSchema.index({ customerName: 'text', description: 'text', subCategory: 'text' });
ticketSchema.index({ stage: 1, priority: 1, executive: 1 });

ticketSchema.virtual('isOpen').get(function isOpen() {
  return !['Closed', 'Customer confirmed'].includes(this.stage);
});

/** Minutes taken to resolve, once it has been. */
ticketSchema.virtual('resolutionMins').get(function mins() {
  if (!this.resolvedAt || !this.createdAt) return null;
  return Math.round((this.resolvedAt.getTime() - this.createdAt.getTime()) / 60000);
});

/** The SLA clock is set from the priority the moment the ticket lands. */
ticketSchema.pre('save', function startClock(next) {
  if (this.isNew && !this.slaDeadline) {
    const target = SLA[this.priority] || SLA.Medium;
    this.slaDeadline = new Date(Date.now() + target.resolution * 3600000);
  }

  if (this.slaDeadline && this.isOpen) {
    const left = this.slaDeadline.getTime() - Date.now();
    if (left < 0) this.slaState = 'Breached';
    else if (left < 3600000) this.slaState = 'Approaching';
    else this.slaState = 'Within';
  }

  if (this.isModified('stage')) {
    if (this.stage === 'Resolved' && !this.resolvedAt) this.resolvedAt = new Date();
    if (this.stage === 'Closed' && !this.closedAt) this.closedAt = new Date();
  }

  next();
});

module.exports = mongoose.model('Ticket', ticketSchema);
