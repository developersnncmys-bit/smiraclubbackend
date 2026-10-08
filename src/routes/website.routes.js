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

/**
 * Counting a page view is not filling in a form: browsing a few listings is
 * normal, and a whole office can share one address. It is still capped, so
 * a script cannot sit and inflate a partner's numbers all afternoon.
 */
const perView = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 300,
  message: { success: false, message: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/trip-enquiry', perAddress, perPhone, c.tripEnquiry);
router.post('/package-booking', perAddress, perPhone, c.packageBooking);
router.post('/booking', perAddress, perPhone, c.booking);
router.post('/membership', perAddress, perPhone, c.membership);
// Finishing the quiz is not filling in a form, but it still writes a
// lead, so it is capped the same way the forms are.
router.post('/quiz', perAddress, perPhone, c.membershipQuiz);
router.post('/enquiry', perAddress, perPhone, c.enquiry);
router.get('/plans', c.plans);

/**
 * Checking a coupon is one lookup for us and a guessing game for anybody
 * trying codes at random, so it is capped tighter than the forms are. It
 * takes nothing and writes nothing, which is why it is a GET.
 */
const perCoupon = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  message: { success: false, message: 'Too many codes tried — give it a few minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/coupon/:code', perCoupon, c.checkCoupon);

/**
 * What the desk is selling, read-only and open, so the site can show the
 * stock and the offers the panel holds rather than the copy in its build.
 */
router.get('/catalog', c.catalog);
router.get('/catalog/:id', c.catalogItem);
router.post('/catalog/:id/view', perView, c.listingView);
// A complaint from Get Help. Capped: an open form on a public site is a
// way to fill somebody's queue with noise.
router.post(
  '/support',
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    message: { success: false, message: 'That is a lot of complaints — call the desk instead' },
    standardHeaders: true,
    legacyHeaders: false,
  }),
  c.support,
);

router.get('/offers', c.liveOffers);
// The short ones, with the listing and the clock attached.
router.get('/offers/flash', c.flashOffers);

router.post('/member/otp', perAddress, perPhone, c.memberOtpRequest);
router.post('/member/verify', perAddress, c.memberOtpVerify);
router.get('/member/me', protectMember, c.memberMe);
router.get('/member/wishlist', protectMember, c.wishlistRead);
router.post('/member/wishlist', protectMember, c.wishlistWrite);

/**
 * A member's own gifts and referrals.
 *
 * Everything here reads `req.member` from the token, so there is no id in
 * an address anybody could change to somebody else's.
 */
router.get('/member/rewards', protectMember, c.memberRewards);
router.post('/member/rewards/:id/claim', protectMember, c.claimReward);
router.get('/member/referrals', protectMember, c.memberReferrals);
router.get('/member/notifications', protectMember, c.memberNotifications);
router.post('/member/notifications/read', protectMember, c.readNotifications);
router.post('/member/refer', protectMember, perPhone, c.referSomeone);

module.exports = router;
