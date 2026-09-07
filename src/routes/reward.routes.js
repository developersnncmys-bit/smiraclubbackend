const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const rewards = require('../controllers/reward.controller');
const referrals = require('../controllers/referral.controller');
const offers = require('../controllers/offer.controller');

router.use(protect);

// -- Gifts ------------------------------------------------------------------
router.get('/due', can('Customer', 'view'), rewards.due);

router
  .route('/')
  .get(can('Customer', 'view'), rewards.list)
  .post(can('Customer', 'create'), validate({ customer: 'required', gift: 'required' }), rewards.create);

router.patch('/:id/advance', can('Customer', 'edit'), rewards.advance);

router
  .route('/:id')
  .get(can('Customer', 'view'), rewards.getOne)
  .patch(can('Customer', 'edit'), rewards.update)
  .delete(can('Customer', 'delete'), rewards.remove);

module.exports = router;

// Referrals and offers ride along on their own routers.
module.exports.referrals = referrals;
module.exports.offers = offers;
