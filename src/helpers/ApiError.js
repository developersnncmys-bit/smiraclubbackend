/** An error that already knows what HTTP status it deserves. */
class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = 'You are not signed in') {
    return new ApiError(401, message);
  }
  static forbidden(message = 'You are not allowed to do that') {
    return new ApiError(403, message);
  }
  static notFound(message = 'Not found') {
    return new ApiError(404, message);
  }
  static conflict(message = 'That already exists') {
    return new ApiError(409, message);
  }
}

module.exports = ApiError;
