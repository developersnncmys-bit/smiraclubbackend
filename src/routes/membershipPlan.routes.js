const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/membershipPlan.controller');

router.use(protect);

router.get('/performance', can('Membership', 'view'), c.performance);

router
  .route('/')
  .get(can('Membership', 'view'), c.list)
  .post(can('Membership', 'create'), validate({ name: 'required', price: 'required|number' }), c.create);

router
  .route('/:id')
  .get(can('Membership', 'view'), c.getOne)
  .patch(can('Membership', 'edit'), c.update)
  .delete(can('Membership', 'delete'), c.remove);

module.exports = router;
