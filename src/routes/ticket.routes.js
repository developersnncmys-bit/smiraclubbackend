const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/ticket.controller');

router.use(protect);

router.get('/overview', can('Customer', 'view'), c.overview);
router.post('/assign', can('Customer', 'assign'), c.assign);

router
  .route('/')
  .get(can('Customer', 'view'), c.list)
  .post(
    can('Customer', 'create'),
    validate({ customerName: 'required', category: 'required', description: 'required' }),
    c.create
  );

router.patch('/:id/assign', can('Customer', 'assign'), c.assign);
router.patch('/:id/escalate', can('Customer', 'edit'), c.escalate);
router.patch('/:id/transfer', can('Customer', 'edit'), validate({ department: 'required' }), c.transfer);
router.post('/:id/note', can('Customer', 'edit'), validate({ text: 'required' }), c.addNote);
router.patch('/:id/resolve', can('Customer', 'edit'), validate({ note: 'required' }), c.resolve);
router.patch('/:id/close', can('Customer', 'edit'), c.close);
router.patch('/:id/rate', validate({ rating: 'required|number' }), c.rate);

router
  .route('/:id')
  .get(can('Customer', 'view'), c.getOne)
  .patch(can('Customer', 'edit'), c.update)
  .delete(can('Customer', 'delete'), c.remove);

module.exports = router;
