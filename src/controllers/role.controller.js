const Role = require('../models/Role');
const User = require('../models/User');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const constants = require('../config/constants');

const base = crud(Role, { name: 'Role', searchable: ['name', 'department'], defaultSort: 'name' });

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;

/** A role in use cannot be deleted out from under the people carrying it. */
exports.remove = catchAsync(async (req, res) => {
  const inUse = await User.countDocuments({ role: req.params.id });
  if (inUse) throw ApiError.conflict(`${inUse} user(s) still carry that role`);
  const doc = await Role.findByIdAndDelete(req.params.id);
  if (!doc) throw ApiError.notFound('Role not found');
  res.json({ success: true, data: { id: req.params.id } });
});

/** Everything the role builder needs to draw its choices. */
exports.options = catchAsync(async (req, res) => {
  res.json({
    success: true,
    data: {
      modules: constants.MODULES,
      permissions: constants.PERMISSIONS,
      scopes: constants.SCOPES,
      approvals: constants.APPROVAL_AREAS,
    },
  });
});

/** The permission matrix, with how many people sit on each role. */
exports.matrix = catchAsync(async (req, res) => {
  const roles = await Role.find().sort('name').lean();
  const counts = await User.aggregate([{ $group: { _id: '$role', people: { $sum: 1 } } }]);
  const byRole = Object.fromEntries(counts.map((c) => [String(c._id), c.people]));

  res.json({
    success: true,
    data: roles.map((r) => ({ ...r, people: byRole[String(r._id)] || 0 })),
  });
});
