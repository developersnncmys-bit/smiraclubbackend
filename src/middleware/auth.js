const jwt = require('jsonwebtoken');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const User = require('../models/User');
const { peersOf } = require('./scope');

/** Reads the bearer token and hangs the live user off the request. */
const protect = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized();

  const payload = jwt.verify(token, process.env.JWT_SECRET);

  const user = await User.findById(payload.sub).populate('role');
  if (!user) throw ApiError.unauthorized('That account no longer exists');
  if (user.status !== 'Active') throw ApiError.forbidden('That account has been disabled');
  if (user.passwordChangedAfter(payload.iat)) {
    throw ApiError.unauthorized('The password changed — sign in again');
  }

  req.user = user;

  // Worked out once here so every list on this request shares the answer.
  req.visibleUserIds = await peersOf(user);

  next();
});

/**
 * `can('Booking', 'edit')` — the permission matrix from the Users & Roles
 * sheet, enforced. The role carries which modules it may open and what it may
 * do inside them.
 */
const can = (module, action) =>
  catchAsync(async (req, res, next) => {
    const role = req.user?.role;
    if (!role) throw ApiError.forbidden('No role is set on your account');

    if (role.superAdmin) return next();

    if (!role.modules?.includes(module)) {
      throw ApiError.forbidden(`Your role cannot open ${module}`);
    }
    if (!role.permissions?.includes(action)) {
      throw ApiError.forbidden(`Your role cannot ${action} in ${module}`);
    }
    next();
  });

/** For the handful of places a named role is simpler than a permission. */
const restrictTo = (...roleNames) =>
  catchAsync(async (req, res, next) => {
    if (!roleNames.includes(req.user?.role?.name)) {
      throw ApiError.forbidden('Your role cannot do that');
    }
    next();
  });

module.exports = { protect, can, restrictTo };
