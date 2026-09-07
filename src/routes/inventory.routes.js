const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/inventory.controller');
const holds = require('../controllers/hold.controller');

router.use(protect);

router.get('/analytics', can('Inventory', 'view'), c.analytics);
router.get('/alerts', can('Inventory', 'view'), c.alerts);
router.get('/holds', can('Inventory', 'view'), holds.list);
router.post('/holds/sweep', can('Inventory', 'edit'), c.sweepHolds);
router.patch('/holds/:holdId/release', can('Inventory', 'edit'), c.release);

router
  .route('/')
  .get(can('Inventory', 'view'), c.list)
  .post(can('Inventory', 'create'), validate({ name: 'required', category: 'required' }), c.create);

router.get('/:id/rates', can('Inventory', 'view'), c.rates);
router.get('/:id/availability', can('Inventory', 'view'), c.availability);
router.patch('/:id/availability', can('Inventory', 'edit'), validate({ date: 'required' }), c.setDay);
router.post('/:id/blackout', can('Inventory', 'edit'), validate({ from: 'required' }), c.addBlackout);
router.post('/:id/hold', can('Inventory', 'edit'), c.hold);

router
  .route('/:id')
  .get(can('Inventory', 'view'), c.getOne)
  .patch(can('Inventory', 'edit'), c.update)
  .delete(can('Inventory', 'delete'), c.remove);

module.exports = router;
