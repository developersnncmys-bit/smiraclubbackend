const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const sms = require('../helpers/sms');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { record } = require('../helpers/audit');

const sign = (user) =>
  jwt.sign({ sub: user._id, role: user.role?.name }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

/** What the panel needs about whoever is signed in. */
const shape = (user) => ({
  id: user._id,
  code: user.code,
  name: user.name,
  email: user.email,
  phone: user.phone,
  designation: user.designation,
  department: user.department,
  branch: user.branch,
  live: user.live,
  role: user.role && {
    id: user.role._id,
    name: user.role.name,
    dashboard: user.role.dashboard,
    scope: user.role.scope,
    modules: user.role.modules,
    permissions: user.role.permissions,
    approvals: user.role.approvals,
    superAdmin: user.role.superAdmin,
  },
});

/**
 * Signing in. Five wrong passwords locks the account for fifteen minutes,
 * which is the cheapest thing that stops somebody guessing.
 */
exports.login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw ApiError.badRequest('Email and password are both needed');

  const user = await User.findOne({ email: String(email).toLowerCase() })
    .select('+password')
    .populate('role');

  if (!user) throw ApiError.unauthorized('That email and password do not match');

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw ApiError.forbidden('Too many attempts — try again in a few minutes');
  }
  if (user.status !== 'Active') throw ApiError.forbidden('That account has been disabled');

  const ok = await user.checkPassword(password);
  if (!ok) {
    user.failedLogins = (user.failedLogins || 0) + 1;
    if (user.failedLogins >= 5) user.lockedUntil = new Date(Date.now() + 15 * 60000);
    await user.save({ validateBeforeSave: false });
    throw ApiError.unauthorized('That email and password do not match');
  }

  user.failedLogins = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  user.lastIp = req.ip;
  user.lastAgent = req.headers['user-agent'];
  user.live = 'Online';
  await user.save({ validateBeforeSave: false });

  await record({ ...req, user }, 'login', 'User', user._id, `${user.name} signed in`);

  res.json({ success: true, token: sign(user), data: shape(user) });
});

// -- Signing in with a mobile number ---------------------------------------

const OTP_MINUTES = 5;
const OTP_ATTEMPTS = 5;
const RESEND_SECONDS = 45;

/**
 * Asks for a code. The digits are hashed before they are stored, so a copy of
 * the database is not a book of live passwords.
 */
exports.requestOtp = catchAsync(async (req, res) => {
  const digits = User.digits(req.body.phone);
  if (digits.length < 10) throw ApiError.badRequest('Enter a ten digit mobile number');

  const user = await User.findOne({ phoneDigits: digits }).select('+otp.codeHash');
  if (!user) throw ApiError.notFound('No account is registered against that number');
  if (user.status !== 'Active') throw ApiError.forbidden('That account has been disabled');
  if (!user.mobileAccess) throw ApiError.forbidden('That account cannot sign in from a mobile');

  // Don't let somebody hammer the send button, or an SMS bill with it.
  if (user.otp?.lastSentAt && Date.now() - user.otp.lastSentAt.getTime() < RESEND_SECONDS * 1000) {
    const wait = Math.ceil((RESEND_SECONDS * 1000 - (Date.now() - user.otp.lastSentAt.getTime())) / 1000);
    throw new ApiError(429, `Ask again in ${wait} seconds`);
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

  user.otp = {
    codeHash: await bcrypt.hash(code, 10),
    expiresAt: new Date(Date.now() + OTP_MINUTES * 60000),
    attempts: 0,
    lastSentAt: new Date(),
  };
  await user.save({ validateBeforeSave: false });

  const sent = await sms.send(user.phone, code);

  res.json({
    success: true,
    message: sent.delivered ? 'Code sent' : 'Code generated',
    data: {
      phone: `•••••• ${digits.slice(-4)}`,
      name: user.name.split(' ')[0],
      expiresInMinutes: OTP_MINUTES,
      // Only ever present while no provider is wired, and never in production.
      ...(sent.devCode ? { devCode: sent.devCode } : {}),
    },
  });
});

/** Checks the code and, if it holds up, issues the token. */
exports.verifyOtp = catchAsync(async (req, res) => {
  const digits = User.digits(req.body.phone);
  const code = String(req.body.code || '').replace(/\D/g, '');
  if (!digits || !code) throw ApiError.badRequest('The number and the code are both needed');

  const user = await User.findOne({ phoneDigits: digits }).select('+otp.codeHash').populate('role');
  if (!user) throw ApiError.unauthorized('That code did not work');

  if (!user.otp?.codeHash || !user.otp.expiresAt) {
    throw ApiError.unauthorized('Ask for a code first');
  }
  if (user.otp.expiresAt < new Date()) {
    throw ApiError.unauthorized('That code has expired — ask for another');
  }
  if ((user.otp.attempts || 0) >= OTP_ATTEMPTS) {
    throw ApiError.forbidden('Too many wrong codes — ask for a new one');
  }

  const ok = await bcrypt.compare(code, user.otp.codeHash);
  if (!ok) {
    user.otp.attempts = (user.otp.attempts || 0) + 1;
    await user.save({ validateBeforeSave: false });
    const left = OTP_ATTEMPTS - user.otp.attempts;
    throw ApiError.unauthorized(left > 0 ? `That code is wrong — ${left} tries left` : 'That code is wrong');
  }

  // Spent. A code works exactly once.
  user.otp = undefined;
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  user.lastIp = req.ip;
  user.lastAgent = req.headers['user-agent'];
  user.live = 'Online';
  await user.save({ validateBeforeSave: false });

  await record({ ...req, user }, 'login', 'User', user._id, `${user.name} signed in by OTP`);

  res.json({ success: true, token: sign(user), data: shape(user) });
});

exports.me = catchAsync(async (req, res) => {
  res.json({ success: true, data: shape(req.user) });
});

exports.logout = catchAsync(async (req, res) => {
  req.user.live = 'Offline';
  req.user.lastLogoutAt = new Date();
  await req.user.save({ validateBeforeSave: false });
  await record(req, 'logout', 'User', req.user._id, `${req.user.name} signed out`);
  res.json({ success: true, message: 'Signed out' });
});

exports.changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    throw ApiError.badRequest('The new password has to be at least 8 characters');
  }

  const user = await User.findById(req.user._id).select('+password').populate('role');
  const ok = await user.checkPassword(currentPassword || '');
  if (!ok) throw ApiError.unauthorized('The current password is not right');

  user.password = newPassword;
  await user.save();
  await record(req, 'update', 'User', user._id, 'Changed their own password');

  res.json({ success: true, token: sign(user), message: 'Password changed' });
});
