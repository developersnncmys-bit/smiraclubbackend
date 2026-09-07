const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/expense.controller');

router.use(protect);

router.get('/summary', can('Finance', 'view'), c.summary);

router
  .route('/')
  .get(can('Finance', 'view'), c.list)
  .post(can('Finance', 'create'), validate({ category: 'required', amount: 'required|number' }), c.create);

router.patch('/:id/advance', can('Finance', 'approve'), c.advance);

router
  .route('/:id')
  .get(can('Finance', 'view'), c.getOne)
  .patch(can('Finance', 'edit'), c.update)
  .delete(can('Finance', 'delete'), c.remove);

module.exports = router;
