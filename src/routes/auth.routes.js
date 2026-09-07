const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/auth.controller');

router.post('/login', validate({ email: 'required|email', password: 'required' }), c.login);

// Signing in with a mobile number.
router.post('/otp/request', validate({ phone: 'required' }), c.requestOtp);
router.post('/otp/verify', validate({ phone: 'required', code: 'required' }), c.verifyOtp);

router.use(protect);
router.get('/me', c.me);
router.post('/logout', c.logout);
router.patch('/password', validate({ newPassword: 'required|min:8' }), c.changePassword);

module.exports = router;
