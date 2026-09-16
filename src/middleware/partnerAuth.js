const jwt = require('jsonwebtoken');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const Partner = require('../models/Partner');

/**
 * The partner portal's own gate.
 *
 * It only accepts a token minted for a partner, and hangs that partner — never
 * anyone else — off the request. Every route behind it works from
 * `req.partner._id`, so there is no id in the URL a partner could change to
 * read somebody else's bookings.
 */
const protectPartner = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Sign in to the partner portal');

  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.kind !== 'partner') throw ApiError.forbidden('That is not a partner sign-in');

  const partner = await Partner.findById(payload.sub);
  if (!partner) throw ApiError.unauthorized('That partner account no longer exists');
  if (partner.status === 'Blacklisted') throw ApiError.forbidden('That partner account has been closed');

  req.partner = partner;
  next();
});

module.exports = { protectPartner };
