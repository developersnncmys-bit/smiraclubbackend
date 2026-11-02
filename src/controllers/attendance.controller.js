const Attendance = require('../models/Attendance');
const User = require('../models/User');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { record } = require('../helpers/audit');

/** Today in India, YYYY-MM-DD. */
const todayIst = (at = new Date()) => new Date(at.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const MODES = ['Office', 'Field', 'Work from home'];
const ATTENDANCE_LABEL = { Office: 'Present', Field: 'Field visit', 'Work from home': 'Work from home' };

/** What a check-in or check-out sent, kept to the fields it may set. */
function stampFrom(req, { mode: fixedMode, needsPlace = true } = {}) {
  const b = req.body || {};
  const mode = fixedMode || (MODES.includes(b.mode) ? b.mode : 'Office');
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : undefined);
  const lat = num(b.lat);
  const lng = num(b.lng);
  if (needsPlace && mode === 'Field' && (lat === undefined || lng === undefined)) {
    throw ApiError.badRequest('A field check-in needs your location — allow location on this device and try again');
  }
  return {
    at: new Date(),
    mode,
    ...(lat !== undefined && lng !== undefined ? { lat, lng, accuracy: num(b.accuracy) } : {}),
    ...(b.note ? { note: String(b.note).slice(0, 200) } : {}),
    device: String(req.headers['user-agent'] || '').slice(0, 200),
  };
}

/** My day so far. */
exports.mine = catchAsync(async (req, res) => {
  const row = await Attendance.findOne({ user: req.user._id, date: todayIst() }).lean();
  res.json({ success: true, data: row });
});

exports.checkIn = catchAsync(async (req, res) => {
  const date = todayIst();
  const existing = await Attendance.findOne({ user: req.user._id, date });
  if (existing?.checkIn) throw ApiError.conflict('You have already checked in today');

  const stamp = stampFrom(req);
  const row = await Attendance.findOneAndUpdate(
    { user: req.user._id, date },
    { $set: { checkIn: stamp } },
    { new: true, upsert: true }
  ).lean();
  await User.updateOne(
    { _id: req.user._id },
    { attendance: ATTENDANCE_LABEL[stamp.mode], lastActiveAt: stamp.at }
  ).catch(() => {});
  await record(req, 'update', 'Attendance', row._id, `Checked in · ${stamp.mode}`);
  res.status(201).json({ success: true, data: row });
});

exports.checkOut = catchAsync(async (req, res) => {
  const date = todayIst();
  const existing = await Attendance.findOne({ user: req.user._id, date });
  if (!existing?.checkIn) throw ApiError.badRequest('Check in first');
  if (existing.checkOut) throw ApiError.conflict('You have already checked out today');

  // The day's mode stays what it was at check-in; the place is kept if the device gave one.
  const stamp = stampFrom(req, { mode: existing.checkIn.mode, needsPlace: false });
  existing.checkOut = stamp;
  await existing.save();
  await record(req, 'update', 'Attendance', existing._id, `Checked out · ${stamp.mode}`);
  res.json({ success: true, data: existing.toObject() });
});

/** Everybody's day — Team Status reads this. ?date=YYYY-MM-DD for another day. */
exports.day = catchAsync(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : todayIst();
  const rows = await Attendance.find({ date }).lean();
  res.json({ success: true, date, rows });
});
