const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/refund.controller');

router.use(protect);

router
  .route('/')
  .get(can('Finance', 'view'), c.list)
  .post(can('Finance', 'create'), validate({ amount: 'required|number' }), c.create);

router.patch('/:id/advance', can('Finance', 'approve'), c.advance);
router.patch('/:id/reject', can('Finance', 'approve'), validate({ reason: 'required' }), c.reject);

router
  .route('/:id')
  .get(can('Finance', 'view'), c.getOne)
  .patch(can('Finance', 'edit'), c.update)
  .delete(can('Finance', 'delete'), c.remove);

module.exports = router;
