const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { protectPartner } = require('../middleware/partnerAuth');
const c = require('../controllers/partnerPortal.controller');

/**
 * The partner portal.
 *
 * Asking for a code is counted per number and, separately, per address: the
 * number cap stops one hotel's phone being flooded, and the address cap stops
 * somebody walking through a list of numbers to register partner after
 * partner. Entering a code is counted loosely per address, since a wrong code
 * is already limited to five tries on whatever holds it.
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

const requestsPerAddress = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  message: { success: false, message: 'Too many codes requested — try again in a few minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

const perAddress = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  message: { success: false, message: 'Too many sign-in attempts — try again in a few minutes' },
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/otp/request', requestsPerAddress, perPhone, c.requestOtp);
router.post('/otp/verify', perAddress, c.verifyOtp);

router.use(protectPartner);

// The five-step listing, then submitting it for review.
router.get('/listing', c.getListing);
router.put('/listing', c.saveListing);
router.post('/listing/submit', c.submitListing);

// Once live.
router.get('/dashboard', c.dashboard);
router.post('/bookings/:id/accept', c.accept);
router.post('/bookings/:id/decline', c.decline);

module.exports = router;
