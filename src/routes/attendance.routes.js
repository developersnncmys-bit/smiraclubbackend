const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const c = require('../controllers/attendance.controller');

router.use(protect);

// Everyone marks their own day; everyone signed in can see the desk's.
router.get('/me', c.mine);
router.post('/check-in', c.checkIn);
router.post('/check-out', c.checkOut);
router.get('/', c.day);
// Correcting somebody's day is a manager's job.
router.patch('/:userId/:date', can('Users', 'edit'), c.edit);

module.exports = router;
