const router = require('express').Router();
const { protect, can, allowed } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const c = require('../controllers/task.controller');
const Task = require('../models/Task');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');

/**
 * Changing a task: a role allowed to edit in CRM may change any task it can
 * see; anyone else in CRM may still change the tasks given to them — their
 * own follow-ups, their own times, their own "done". Without this a sales
 * person whose role could only view CRM could not save their own task.
 */
const ownTaskOrEdit = catchAsync(async (req, res, next) => {
  const role = req.user?.role;
  if (allowed(role, 'CRM', 'edit')) return next();
  const task = await Task.findById(req.params.id).select('owner').lean();
  if (!task) throw ApiError.notFound('Task not found');
  if (String(task.owner) !== String(req.user._id)) throw ApiError.forbidden('You can only change tasks given to you');
  next();
});

router.use(protect);

router.get('/board', can('CRM', 'view'), c.board);

router
  .route('/')
  .get(can('CRM', 'view'), c.list)
  .post(can('CRM', 'view'), validate({ title: 'required' }), c.create);

router.post('/:id/comments', can('CRM', 'view'), c.comment);
router.patch('/:id/complete', can('CRM', 'view'), ownTaskOrEdit, c.complete);

router
  .route('/:id')
  .get(can('CRM', 'view'), c.getOne)
  .patch(can('CRM', 'view'), ownTaskOrEdit, c.update)
  .delete(can('CRM', 'delete'), c.remove);

module.exports = router;
