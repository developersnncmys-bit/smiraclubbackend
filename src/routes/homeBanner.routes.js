const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/homeBanner.controller');

router.use(protect);

/** The banner carousel at the top of the website. Same desk as offers. */
router
  .route('/')
  .get(c.list)
  .post(can('CRM', 'create'), validate({ figure: 'required' }), c.create);

router.post('/reorder', can('CRM', 'edit'), c.reorder);

router
  .route('/:id')
  .get(c.getOne)
  .patch(can('CRM', 'edit'), c.update)
  .delete(can('CRM', 'delete'), c.remove);

module.exports = router;
