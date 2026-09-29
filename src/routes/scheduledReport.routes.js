const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/scheduledReport.controller');

router.use(protect);

router
  .route('/')
  .get(can('Reports', 'view'), c.list)
  .post(can('Reports', 'view'), validate({ name: 'required', module: 'required' }), c.create);

router
  .route('/:id')
  .get(can('Reports', 'view'), c.getOne)
  .patch(can('Reports', 'view'), c.update)
  .delete(can('Reports', 'view'), c.remove);

module.exports = router;
