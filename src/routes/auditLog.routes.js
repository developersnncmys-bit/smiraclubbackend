const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const c = require('../controllers/auditLog.controller');

router.use(protect);

router.get('/', can('Users', 'view'), c.list);
router.get('/:entity/:id', can('Users', 'view'), c.forEntity);

module.exports = router;
