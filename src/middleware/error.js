const ApiError = require('../helpers/ApiError');
const { isProduction } = require('../config/env');

function notFound(req, res, next) {
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`));
}

/** Turns anything thrown into one shape the admin panel can rely on. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;

  if (err.name === 'ValidationError') {
    // Said plainly, and naming the field — "Some fields are not right" on its own
    // left people guessing which box to fix.
    const label = (path) => String(path || '').split('.').filter((x) => !/^\d+$/.test(x)).pop()
      .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
    const why = (e) => {
      if (e.kind === 'maxlength') return `${label(e.path)} is too long (up to ${e.properties?.maxlength} characters)`;
      if (e.kind === 'enum') return `${label(e.path)}: "${e.value}" is not one of the choices`;
      if (e.kind === 'min') return `${label(e.path)} cannot be below ${e.properties?.min}`;
      if (e.kind === 'max') return `${label(e.path)} cannot be above ${e.properties?.max}`;
      if (e.name === 'CastError' || e.kind === 'Number') return `${label(e.path)} has to be a number`;
      if (e.kind === 'required') return `${label(e.path)} is needed`;
      return `${label(e.path)} is not right`;
    };
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: why(e) }));
    error = new ApiError(400, `Please check: ${details.map((d) => d.message).join('; ')}`, details);
  }

  if (err.name === 'CastError') {
    error = new ApiError(400, `${err.value} is not a valid ${err.path}`);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'value';
    error = new ApiError(409, `That ${field} is already taken`);
  }

  if (err.name === 'JsonWebTokenError') error = ApiError.unauthorized('That token is not valid');
  if (err.name === 'TokenExpiredError') error = ApiError.unauthorized('Your session has expired — sign in again');

  const statusCode = error.statusCode || 500;
  const body = {
    success: false,
    message: statusCode === 500 ? 'Something went wrong at our end' : error.message,
  };
  if (error.details) body.details = error.details;
  // A stack trace names the file layout and the libraries in use. It is a gift
  // to somebody probing the API, so it stays on the server's own log.
  if (!isProduction && statusCode === 500) body.stack = err.stack;

  if (statusCode === 500) console.error(err);

  res.status(statusCode).json(body);
}

module.exports = { notFound, errorHandler };
