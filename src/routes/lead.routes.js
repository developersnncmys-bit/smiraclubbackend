const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/lead.controller');

router.use(protect);

router.get('/funnel', can('CRM', 'view'), c.funnel);
router.get('/lost-analysis', can('CRM', 'view'), c.lostAnalysis);
router.get('/by-source', can('CRM', 'view'), c.bySource);
router.get('/today', can('CRM', 'view'), c.today);
router.post('/assign', can('CRM', 'assign'), c.assign);

router
  .route('/')
  .get(can('CRM', 'view'), c.list)
  .post(can('CRM', 'create'), validate({ name: 'required', phone: 'required' }), c.create);

router.patch('/:id/stage', can('CRM', 'edit'), validate({ status: 'required' }), c.moveStage);
router.post('/:id/activity', can('CRM', 'edit'), validate({ text: 'required' }), c.addActivity);
router.patch('/:id/assign', can('CRM', 'assign'), c.assign);
router.post('/:id/convert', can('CRM', 'edit'), c.convert);

router
  .route('/:id')
  .get(can('CRM', 'view'), c.getOne)
  .patch(can('CRM', 'edit'), c.update)
  .delete(can('CRM', 'delete'), c.remove);

module.exports = router;
