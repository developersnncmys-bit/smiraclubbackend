const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/attendance.controller');

router.use(protect);

// Everyone marks their own day; everyone signed in can see the desk's.
router.get('/me', c.mine);
router.post('/check-in', c.checkIn);
router.post('/check-out', c.checkOut);
router.get('/', c.day);

module.exports = router;
