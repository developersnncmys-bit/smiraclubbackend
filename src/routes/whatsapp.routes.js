const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const conversations = require('../controllers/conversation.controller');
const flows = require('../controllers/botFlow.controller');
const campaigns = require('../controllers/campaign.controller');

router.use(protect);

// -- The inbox --------------------------------------------------------------
router.get('/overview', can('WhatsApp', 'view'), conversations.overview);
router.post('/receive', conversations.receive);

router
  .route('/conversations')
  .get(can('WhatsApp', 'view'), conversations.list)
  .post(can('WhatsApp', 'create'), validate({ name: 'required', phone: 'required' }), conversations.create);

router.post('/conversations/:id/reply', can('WhatsApp', 'edit'), validate({ text: 'required' }), conversations.reply);
router.patch('/conversations/:id/assign', can('WhatsApp', 'assign'), conversations.assign);
router.post('/conversations/:id/lead', can('CRM', 'create'), conversations.toLead);
router.post('/conversations/:id/task', can('CRM', 'create'), conversations.toTask);

router
  .route('/conversations/:id')
  .get(can('WhatsApp', 'view'), conversations.getOne)
  .patch(can('WhatsApp', 'edit'), conversations.update)
  .delete(can('WhatsApp', 'delete'), conversations.remove);

// -- The bot ----------------------------------------------------------------
router.get('/flows/performance', can('WhatsApp', 'view'), flows.performance);

router
  .route('/flows')
  .get(can('WhatsApp', 'view'), flows.list)
  .post(can('WhatsApp', 'create'), validate({ name: 'required' }), flows.create);

router.patch('/flows/:id/status', can('WhatsApp', 'edit'), flows.setStatus);

router
  .route('/flows/:id')
  .get(can('WhatsApp', 'view'), flows.getOne)
  .patch(can('WhatsApp', 'edit'), flows.update)
  .delete(can('WhatsApp', 'delete'), flows.remove);

// -- Campaigns --------------------------------------------------------------
router.get('/campaigns/results', can('WhatsApp', 'view'), campaigns.results);

router
  .route('/campaigns')
  .get(can('WhatsApp', 'view'), campaigns.list)
  .post(can('WhatsApp', 'create'), validate({ name: 'required', segment: 'required' }), campaigns.create);

router.post('/campaigns/:id/send', can('WhatsApp', 'edit'), campaigns.send);

router
  .route('/campaigns/:id')
  .get(can('WhatsApp', 'view'), campaigns.getOne)
  .patch(can('WhatsApp', 'edit'), campaigns.update)
  .delete(can('WhatsApp', 'delete'), campaigns.remove);

module.exports = router;
