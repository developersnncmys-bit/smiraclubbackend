const jwt = require('jsonwebtoken');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const Customer = require('../models/Customer');

/**
 * The website member's own gate.
 *
 * It accepts only a token minted for a member — after the one-time code on
 * their number was proved — and hangs that customer off the request. Every
 * route behind it reads `req.member._id`, so there is no id in the URL a
 * member could change to read somebody else's bookings.
 */
const protectMember = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Log in to see your bookings');

  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.kind !== 'member') throw ApiError.forbidden('That is not a member sign-in');

  const member = await Customer.findById(payload.sub);
  if (!member) throw ApiError.unauthorized('That account no longer exists');

  req.member = member;
  next();
});

module.exports = { protectMember };
