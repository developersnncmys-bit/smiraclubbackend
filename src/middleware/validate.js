const ApiError = require('../helpers/ApiError');

/**
 * A small validator — enough to keep obvious rubbish out without dragging a
 * schema library in. `validate({ name: 'required', amount: 'required|number' })`
 */
function validate(rules, where = 'body') {
  return (req, res, next) => {
    const source = req[where] || {};
    const details = [];

    Object.entries(rules).forEach(([field, spec]) => {
      const checks = String(spec).split('|');
      const value = source[field];

      if (checks.includes('required') && (value === undefined || value === null || value === '')) {
        details.push({ field, message: `${field} is required` });
        return;
      }
      if (value === undefined || value === null || value === '') return;

      if (checks.includes('number') && Number.isNaN(Number(value))) {
        details.push({ field, message: `${field} has to be a number` });
      }
      if (checks.includes('email') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value))) {
        details.push({ field, message: `${field} has to be an email address` });
      }
      const inRule = checks.find((c) => c.startsWith('in:'));
      if (inRule) {
        const options = inRule.slice(3).split(',');
        if (!options.includes(String(value))) {
          details.push({ field, message: `${field} has to be one of: ${options.join(', ')}` });
        }
      }
      const minRule = checks.find((c) => c.startsWith('min:'));
      if (minRule && String(value).length < Number(minRule.slice(4))) {
        details.push({ field, message: `${field} has to be at least ${minRule.slice(4)} characters` });
      }
    });

    if (details.length) return next(ApiError.badRequest('Some fields are not right', details));
    next();
  };
}

module.exports = { validate };
