const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/offer.controller');

router.use(protect);

router.get('/validate/:couponCode', c.validateCoupon);

router
  .route('/')
  .get(c.list)
  .post(can('CRM', 'create'), validate({ name: 'required' }), c.create);

router.post('/:id/redeem', can('CRM', 'edit'), c.redeem);

router
  .route('/:id')
  .get(c.getOne)
  .patch(can('CRM', 'edit'), c.update)
  .delete(can('CRM', 'delete'), c.remove);

module.exports = router;
