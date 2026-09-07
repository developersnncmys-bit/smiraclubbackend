const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/role.controller');

router.use(protect);

router.get('/options', c.options);
router.get('/matrix', can('Users', 'view'), c.matrix);

router
  .route('/')
  .get(can('Users', 'view'), c.list)
  .post(can('Users', 'create'), validate({ name: 'required' }), c.create);

router
  .route('/:id')
  .get(can('Users', 'view'), c.getOne)
  .patch(can('Users', 'edit'), c.update)
  .delete(can('Users', 'delete'), c.remove);

module.exports = router;
