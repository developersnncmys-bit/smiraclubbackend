const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { protectPartner } = require('../middleware/partnerAuth');
const c = require('../controllers/partnerPortal.controller');

/**
 * The partner portal. Asking for a code is counted per number, entering one
 * loosely per address — the same shape as staff sign-in, for the same reasons.
 */
const perPhone = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 12,
  keyGenerator: (req) => String(req.body?.phone || '').replace(/\D/g, '') || req.ip,
  message: { success: false, message: 'Too many codes requested for that number — try again in a few minutes' },
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

const perAddress = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  message: { success: false, message: 'Too many sign-in attempts — try again in a few minutes' },
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/otp/request', perPhone, c.requestOtp);
router.post('/otp/verify', perAddress, c.verifyOtp);

router.use(protectPartner);

router.get('/dashboard', c.dashboard);
router.post('/bookings/:id/accept', c.accept);
router.post('/bookings/:id/decline', c.decline);

module.exports = router;
