const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/user.controller');

router.use(protect);

// Anyone signed in can see who their colleagues are.
router.get('/directory', c.directory);

router.get('/workload', can('Users', 'view'), c.workload);
router.get('/compare', can('Users', 'view'), c.compare);

router
  .route('/')
  .get(can('Users', 'view'), c.list)
  .post(
    can('Users', 'create'),
    validate({ name: 'required', email: 'required|email', password: 'required|min:8', role: 'required' }),
    c.create
  );

router.get('/:id/profile', can('Users', 'view'), c.profile);
router.patch('/:id/live', c.setLive);
router.patch('/:id/password', can('Users', 'edit'), c.resetPassword);
router.patch('/:id/status', can('Users', 'edit'), c.setStatus);

router
  .route('/:id')
  .get(can('Users', 'view'), c.getOne)
  .patch(can('Users', 'edit'), c.update)
  .delete(can('Users', 'delete'), c.remove);

module.exports = router;
