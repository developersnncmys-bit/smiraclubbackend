const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/website.controller');
const { protectMember } = require('../middleware/memberAuth');

/**
 * Routes the public website posts to, with nobody signed in.
 *
 * An open form is a way in for anyone, so each is capped twice: per address,
 * so one script cannot fill Sales & Leads, and per number, so one phone
 * cannot be put down as the contact on a flood of enquiries.
 */
const perAddress = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  message: { success: false, message: 'That is a lot of enquiries — try again later, or call us' },
  standardHeaders: true,
  legacyHeaders: false,
});

const perPhone = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `trip:${String(req.body?.phone || '').replace(/\D/g, '').slice(-10) || req.ip}`,
  message: { success: false, message: 'We already have your enquiries — our travel desk will call you shortly' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

router.post('/trip-enquiry', perAddress, perPhone, c.tripEnquiry);
router.post('/package-booking', perAddress, perPhone, c.packageBooking);
router.post('/booking', perAddress, perPhone, c.booking);
router.post('/membership', perAddress, perPhone, c.membership);
router.post('/enquiry', perAddress, perPhone, c.enquiry);
router.get('/plans', c.plans);

/**
 * What the desk is selling, read-only and open, so the site can show the
 * stock and the offers the panel holds rather than the copy in its build.
 */
router.get('/catalog', c.catalog);
router.get('/catalog/:id', c.catalogItem);
router.get('/offers', c.liveOffers);

router.post('/member/otp', perAddress, perPhone, c.memberOtpRequest);
router.post('/member/verify', perAddress, c.memberOtpVerify);
router.get('/member/me', protectMember, c.memberMe);

module.exports = router;
