const mongoose = require('mongoose');

/**
 * One person's attendance for one day.
 *
 * Signing in to the panel only says someone opened a laptop; somebody out
 * on a site visit never does. So the day starts with a check-in that says
 * where they are working — the office or the field — and, from a phone,
 * where they actually were: the location is what makes a field check-in
 * worth something. Check-out closes the day the same way.
 */
const stampSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    mode: { type: String, enum: ['Office', 'Field', 'Work from home'], default: 'Office' },
    lat: Number,
    lng: Number,
    accuracy: Number,
    note: { type: String, trim: true, maxlength: 200 },
    device: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false }
);

/** A break in the day: lunch, tea or washroom. `end` is empty while on it. */
const breakSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['Lunch', 'Tea', 'Washroom'], required: true },
    start: { type: Date, required: true },
    end: Date,
  },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // The working day in India, as YYYY-MM-DD, so "today" does not turn over at 5:30 am.
    date: { type: String, required: true, index: true },
    checkIn: stampSchema,
    checkOut: stampSchema,
    breaks: { type: [breakSchema], default: [] },
    // The day's standing. Set by check-in, and changeable by a manager.
    status: {
      type: String,
      enum: ['Present', 'Late', 'Half day', 'Field visit', 'Work from home', 'Leave', 'Absent'],
    },
    // When they first signed in to the panel that day, and last signed out.
    firstLoginAt: Date,
    lastLogoutAt: Date,
    // A manager's correction, and why — so a changed day is never silent.
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    editedByName: String,
    editedAt: Date,
    editReason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

attendanceSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
