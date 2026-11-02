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

const attendanceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // The working day in India, as YYYY-MM-DD, so "today" does not turn over at 5:30 am.
    date: { type: String, required: true, index: true },
    checkIn: stampSchema,
    checkOut: stampSchema,
  },
  { timestamps: true }
);

attendanceSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
