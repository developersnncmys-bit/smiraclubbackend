const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { protect, can } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/partner.controller');

/**
 * The website's "Become a Partner" form posts here, and it is the one route in
 * this module with nobody signed in behind it. Capped per address, because an
 * open form on a public site is a mailing list to somebody: five applications
 * in an hour is generous for a person and useless to a script.
 */
router.post(
  '/apply',
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    message: { success: false, message: 'That is a lot of applications — try again later, or call the desk' },
    standardHeaders: true,
    legacyHeaders: false,
  }),
  validate({ name: 'required', phone: 'required' }),
  c.apply
);

router.use(protect);

router.get('/performance', can('Vendors', 'view'), c.performance);
router.get('/payables', can('Vendors', 'view'), c.payables);

router
  .route('/')
  .get(can('Vendors', 'view'), c.list)
  .post(can('Vendors', 'create'), validate({ name: 'required' }), c.create);

router.patch('/:id/verify', can('Vendors', 'edit'), c.verify);
router.patch('/:id/approve', can('Vendors', 'approve'), c.approve);
router.patch('/:id/reject', can('Vendors', 'approve'), validate({ reason: 'required' }), c.reject);

router
  .route('/:id')
  .get(can('Vendors', 'view'), c.getOne)
  .patch(can('Vendors', 'edit'), c.update)
  .delete(can('Vendors', 'delete'), c.remove);

module.exports = router;
