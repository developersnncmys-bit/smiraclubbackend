const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/partner.controller');

router.use(protect);

router.get('/performance', can('Vendors', 'view'), c.performance);
router.get('/payables', can('Vendors', 'view'), c.payables);

router
  .route('/')
  .get(can('Vendors', 'view'), c.list)
  .post(can('Vendors', 'create'), validate({ name: 'required' }), c.create);

router.patch('/:id/verify', can('Vendors', 'edit'), c.verify);
router.patch('/:id/approve', can('Vendors', 'approve'), c.approve);
router.patch('/:id/reject', can('Vendors', 'approve'), validate({ reason: 'required' }), c.reject);

router
  .route('/:id')
  .get(can('Vendors', 'view'), c.getOne)
  .patch(can('Vendors', 'edit'), c.update)
  .delete(can('Vendors', 'delete'), c.remove);

module.exports = router;
