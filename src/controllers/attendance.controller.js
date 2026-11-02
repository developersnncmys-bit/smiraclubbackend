const Attendance = require('../models/Attendance');
const User = require('../models/User');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { record } = require('../helpers/audit');

/** Today in India, YYYY-MM-DD. */
const todayIst = (at = new Date()) => new Date(at.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const MODES = ['Office', 'Field', 'Work from home'];
const STATUSES = ['Present', 'Late', 'Half day', 'Field visit', 'Work from home', 'Leave', 'Absent'];
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
    { $set: { checkIn: stamp, status: ATTENDANCE_LABEL[stamp.mode] } },
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

/** A sign-in or sign-out, noted on the day's record. Never fails the sign-in. */
exports.noteLogin = (userId, kind) => {
  const date = todayIst();
  const update =
    kind === 'in'
      ? [{ $set: { firstLoginAt: { $ifNull: ['$firstLoginAt', '$$NOW'] } } }]
      : { $set: { lastLogoutAt: new Date() } };
  return Attendance.updateOne({ user: userId, date }, update, { upsert: true }).catch(() => {});
};

/**
 * A manager corrects a day: the status, the check-in and check-out times,
 * where they worked. A reason is required and kept with who changed it.
 * Times come as "HH:MM" on that day, India time.
 */
exports.edit = catchAsync(async (req, res) => {
  const { userId, date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw ApiError.badRequest('The date has to be YYYY-MM-DD');
  const b = req.body || {};
  const reason = String(b.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Say why the attendance is being changed');
  if (b.status && !STATUSES.includes(b.status)) throw ApiError.badRequest('That status does not exist');
  if (b.mode && !MODES.includes(b.mode)) throw ApiError.badRequest('That place of work does not exist');
  if (!(await User.exists({ _id: userId }))) throw ApiError.notFound('User not found');

  const at = (hhmm) => {
    if (hhmm === null || hhmm === '') return null;
    if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return undefined;
    return new Date(`${date}T${hhmm}:00+05:30`);
  };
  const row = (await Attendance.findOne({ user: userId, date })) || new Attendance({ user: userId, date });
  const mode = b.mode || row.checkIn?.mode || 'Office';

  const inAt = at(b.checkIn);
  if (inAt === null) row.checkIn = undefined;
  else if (inAt) row.checkIn = { ...(row.checkIn?.toObject?.() || {}), at: inAt, mode };
  else if (b.mode && row.checkIn) row.checkIn.mode = mode;

  const outAt = at(b.checkOut);
  if (outAt === null) row.checkOut = undefined;
  else if (outAt) row.checkOut = { ...(row.checkOut?.toObject?.() || {}), at: outAt, mode };
  if (row.checkIn?.at && row.checkOut?.at && row.checkOut.at < row.checkIn.at) {
    throw ApiError.badRequest('Check out cannot be before check in');
  }

  if (b.status) row.status = b.status;
  row.editedBy = req.user._id;
  row.editedByName = req.user.name;
  row.editedAt = new Date();
  row.editReason = reason.slice(0, 300);
  await row.save();

  if (date === todayIst() && row.status) await User.updateOne({ _id: userId }, { attendance: row.status }).catch(() => {});
  await record(req, 'update', 'Attendance', row._id, `Attendance for ${date} changed: ${reason}`);
  res.json({ success: true, data: row.toObject() });
});

/** Everybody's day — Team Status reads this. ?date=YYYY-MM-DD for another day. */
exports.day = catchAsync(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : todayIst();
  const rows = await Attendance.find({ date }).lean();
  res.json({ success: true, date, rows });
});
