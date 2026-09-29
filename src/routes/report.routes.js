const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const c = require('../controllers/report.controller');

router.use(protect);

router.get('/sales-performance', can('Reports', 'view'), c.salesPerformance);
router.get('/member-growth', can('Reports', 'view'), c.memberGrowth);
router.get('/retention', can('Reports', 'view'), c.retention);
router.get('/messaging', can('Reports', 'view'), c.messaging);
router.get('/engagement', can('Reports', 'view'), c.engagement);
router.get('/builder/options', can('Reports', 'view'), c.builderOptions);
router.get('/builder', can('Reports', 'view'), c.build);

module.exports = router;
