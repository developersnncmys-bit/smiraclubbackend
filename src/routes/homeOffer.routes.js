const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/homeOffer.controller');

router.use(protect);

/** The Grab Offers strip on the website's home page. Same desk as offers. */
router
  .route('/')
  .get(c.list)
  .post(can('CRM', 'create'), validate({ title: 'required' }), c.create);

router.post('/reorder', can('CRM', 'edit'), c.reorder);

router
  .route('/:id')
  .get(c.getOne)
  .patch(can('CRM', 'edit'), c.update)
  .delete(can('CRM', 'delete'), c.remove);

module.exports = router;
