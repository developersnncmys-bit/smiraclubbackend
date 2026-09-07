const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/dashboard.controller');

router.use(protect);

router.get('/', c.overview);
router.get('/trend', c.trend);
router.get('/needs-attention', c.needsAttention);

module.exports = router;
