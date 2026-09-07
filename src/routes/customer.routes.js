const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/customer.controller');

router.use(protect);

router.get('/special-days', can('Customer', 'view'), c.specialDays);
router.get('/at-risk', can('Customer', 'view'), c.atRisk);

router
  .route('/')
  .get(can('Customer', 'view'), c.list)
  .post(can('Customer', 'create'), validate({ name: 'required', phone: 'required' }), c.create);

router.get('/:id/money', can('Customer', 'view'), c.money);

router
  .route('/:id')
  .get(can('Customer', 'view'), c.getOne)
  .patch(can('Customer', 'edit'), c.update)
  .delete(can('Customer', 'delete'), c.remove);

module.exports = router;
