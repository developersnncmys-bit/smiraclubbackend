const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/payment.controller');

router.use(protect);

router.get('/gateways', can('Finance', 'view'), c.gateways);
router.get('/ledger', can('Finance', 'financial'), c.ledger);

router
  .route('/')
  .get(can('Finance', 'view'), c.list)
  .post(can('Finance', 'create'), validate({ amount: 'required|number' }), c.collect);

router
  .route('/:id')
  .get(can('Finance', 'view'), c.getOne)
  .patch(can('Finance', 'edit'), c.update)
  .delete(can('Finance', 'delete'), c.remove);

module.exports = router;
