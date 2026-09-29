const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/**
 * A report the desk has asked for on a schedule.
 *
 * These lived in the panel's own memory, so a schedule set on Monday was
 * gone by Tuesday and nobody else on the desk could see it. They are
 * records now, like everything else the desk sets up.
 *
 * Nothing here sends the report — that is the mail job's business. This is
 * the standing instruction: what to send, to whom, and how often.
 */
const scheduledReportSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** Which report — matches the sections the Reports page offers. */
    module: { type: String, required: true, trim: true, maxlength: 60 },
    frequency: {
      type: String,
      enum: ['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly'],
      default: 'Weekly',
    },
    /** When of the day it goes, as HH:mm in the desk's own time. */
    at: { type: String, trim: true, maxlength: 5, default: '09:00' },
    /** Monday is 1. Only read for the weekly and fortnightly ones. */
    weekday: { type: Number, min: 1, max: 7 },
    /** Only read for monthly and quarterly. */
    dayOfMonth: { type: Number, min: 1, max: 28 },

    recipients: [{ type: String, trim: true, maxlength: 160 }],
    format: { type: String, enum: ['PDF', 'Excel', 'CSV'], default: 'PDF' },
    active: { type: Boolean, default: true },

    lastSentOn: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

withCode(scheduledReportSchema, 'RPT');

module.exports = mongoose.model('ScheduledReport', scheduledReportSchema);
