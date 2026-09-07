const ApiError = require('../helpers/ApiError');

function notFound(req, res, next) {
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`));
}

/** Turns anything thrown into one shape the admin panel can rely on. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;

  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    error = new ApiError(400, 'Some fields are not right', details);
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
  if (process.env.NODE_ENV !== 'production' && statusCode === 500) body.stack = err.stack;

  if (statusCode === 500) console.error(err);

  res.status(statusCode).json(body);
}

module.exports = { notFound, errorHandler };
