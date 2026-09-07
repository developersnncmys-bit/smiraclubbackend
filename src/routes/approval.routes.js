const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/approval.controller');

router.use(protect);

router.get('/mine', c.mine);

router
  .route('/')
  .get(c.list)
  .post(validate({ area: 'required', what: 'required' }), c.create);

router.patch('/:id/decide', validate({ status: 'required' }), c.decide);

router.route('/:id').get(c.getOne).delete(can('Users', 'delete'), c.remove);

module.exports = router;
