const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/referral.controller');

router.use(protect);

router.get('/leaderboard', can('Customer', 'view'), c.leaderboard);

router
  .route('/')
  .get(can('Customer', 'view'), c.list)
  .post(can('Customer', 'create'), validate({ referrer: 'required', referredName: 'required' }), c.create);

router.patch('/:id/pay', can('Finance', 'approve'), c.pay);

router
  .route('/:id')
  .get(can('Customer', 'view'), c.getOne)
  .patch(can('Customer', 'edit'), c.update)
  .delete(can('Customer', 'delete'), c.remove);

module.exports = router;
