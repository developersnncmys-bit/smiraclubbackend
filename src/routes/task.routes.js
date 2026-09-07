const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/task.controller');

router.use(protect);

router.get('/board', can('CRM', 'view'), c.board);

router
  .route('/')
  .get(can('CRM', 'view'), c.list)
  .post(can('CRM', 'create'), validate({ title: 'required' }), c.create);

router.patch('/:id/complete', can('CRM', 'edit'), c.complete);

router
  .route('/:id')
  .get(can('CRM', 'view'), c.getOne)
  .patch(can('CRM', 'edit'), c.update)
  .delete(can('CRM', 'delete'), c.remove);

module.exports = router;
