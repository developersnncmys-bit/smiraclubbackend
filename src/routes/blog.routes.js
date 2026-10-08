const router = require('express').Router();
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/blog.controller');

router.use(protect);

/**
 * The website's blog, written from the panel. Promotions and content are
 * the same desk's work, so a post is governed by the same CRM permissions
 * as an offer rather than a module of its own.
 */
router
  .route('/')
  .get(c.list)
  .post(can('CRM', 'create'), validate({ title: 'required' }), c.create);

router
  .route('/:id')
  .get(c.getOne)
  .patch(can('CRM', 'edit'), c.update)
  .delete(can('CRM', 'delete'), c.remove);

module.exports = router;
