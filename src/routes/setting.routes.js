const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const c = require('../controllers/setting.controller');

router.use(protect);

router.get('/', c.all);
router.put('/:key', can('Settings', 'edit'), c.set);

module.exports = router;
