const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/membership.controller');

router.use(protect);

router.get('/overview', can('Membership', 'view'), c.overview);
router.get('/renewals', can('Membership', 'view'), c.renewalPipeline);

router
  .route('/')
  .get(can('Membership', 'view'), c.list)
  .post(can('Membership', 'create'), validate({ customer: 'required', plan: 'required' }), c.create);

router.patch('/:id/activate', can('Membership', 'edit'), c.activate);
router.post('/:id/collect', can('Membership', 'edit'), validate({ amount: 'required|number' }), c.collect);
router.post('/:id/renew', can('Membership', 'edit'), c.renew);
router.post('/:id/benefit', can('Membership', 'edit'), validate({ name: 'required' }), c.useBenefit);

router
  .route('/:id')
  .get(can('Membership', 'view'), c.getOne)
  .patch(can('Membership', 'edit'), c.update)
  .delete(can('Membership', 'delete'), c.remove);

module.exports = router;
