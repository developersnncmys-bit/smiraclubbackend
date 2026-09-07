const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/automation.controller');

router.use(protect);

router.get('/options', c.options);
router.get('/history', c.history);

router
  .route('/')
  .get(c.list)
  .post(can('Users', 'create'), validate({ name: 'required', when: 'required' }), c.create);

router.patch('/:id/toggle', can('Users', 'edit'), c.toggle);
router.post('/:id/run', can('Users', 'edit'), c.run);

router
  .route('/:id')
  .get(c.getOne)
  .patch(can('Users', 'edit'), c.update)
  .delete(can('Users', 'delete'), c.remove);

module.exports = router;
