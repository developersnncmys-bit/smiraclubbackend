const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/invoice.controller');

router.use(protect);

router.get('/pipeline', can('Finance', 'view'), c.pipeline);

router
  .route('/')
  .get(can('Finance', 'view'), c.list)
  .post(can('Finance', 'create'), validate({ customer: 'required' }), c.create);

router.patch('/:id/remind', can('Finance', 'edit'), c.remind);

router
  .route('/:id')
  .get(can('Finance', 'view'), c.getOne)
  .patch(can('Finance', 'edit'), c.update)
  .delete(can('Finance', 'delete'), c.remove);

module.exports = router;
