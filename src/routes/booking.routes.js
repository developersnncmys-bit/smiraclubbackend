const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/booking.controller');

router.use(protect);

router.get('/overview', can('Booking', 'view'), c.overview);
router.get('/calendar', can('Booking', 'view'), c.calendar);

router
  .route('/')
  .get(can('Booking', 'view'), c.list)
  .post(can('Booking', 'create'), validate({ customer: 'required' }), c.create);

router.patch('/:id/confirm', can('Booking', 'edit'), c.confirm);
router.patch('/:id/cancel', can('Booking', 'edit'), validate({ reason: 'required' }), c.cancel);
router.patch('/:id/reschedule', can('Booking', 'edit'), validate({ checkIn: 'required' }), c.reschedule);

router
  .route('/:id')
  .get(can('Booking', 'view'), c.getOne)
  .patch(can('Booking', 'edit'), c.update)
  .delete(can('Booking', 'delete'), c.remove);

module.exports = router;
