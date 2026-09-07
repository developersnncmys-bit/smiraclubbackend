const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const c = require('../controllers/revenue.controller');

router.use(protect);

router.get('/', can('Finance', 'view'), c.overview);
router.get('/trend', can('Finance', 'view'), c.trend);
router.get('/sources', can('Finance', 'view'), c.sources);
router.get('/compare', can('Finance', 'view'), c.compare);
router.get('/commission', can('Finance', 'financial'), c.commission);

module.exports = router;
