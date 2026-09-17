const ApiError = require('./ApiError');
const catchAsync = require('./catchAsync');
const { buildFilter, buildOptions, paginate } = require('./query');
const { scopeFilter } = require('../middleware/scope');
const { record } = require('./audit');

/**
 * The five handlers every module needs, built once. A controller reaches for
 * these and then adds whatever is actually particular to it — which is where
 * the interesting code lives.
 */
function crud(Model, config = {}) {
  const {
    name = Model.modelName,
    searchable = [],
    allowed = null,
    populate = null,
    defaultSort = '-createdAt',
    ownerField = null,
    beforeCreate = null,
    afterCreate = null,
    beforeUpdate = null,
    afterUpdate = null,
  } = config;

  const list = catchAsync(async (req, res) => {
    const filter = {
      ...buildFilter(req.query, { searchable, allowed }),
      ...scopeFilter(req, ownerField),
    };
    const options = buildOptions(req.query, { defaultSort });
    const result = await paginate(Model, filter, options, { populate });
    res.json({ success: true, ...result });
  });

  /** This record, if this user is allowed to see it. */
  const mine = (req) => ({ _id: req.params.id, ...scopeFilter(req, ownerField) });

  const getOne = catchAsync(async (req, res) => {
    let q = Model.findOne(mine(req));
    if (populate) q = q.populate(populate);
    const doc = await q;
    if (!doc) throw ApiError.notFound(`${name} not found`);
    res.json({ success: true, data: doc });
  });

  const create = catchAsync(async (req, res) => {
    const payload = beforeCreate ? await beforeCreate(req.body, req) : req.body;

    // Whoever made it owns it, unless they said otherwise. Without this a
    // record belongs to nobody, and the person who created it cannot see it.
    const owned =
      ownerField && !payload[ownerField] ? { [ownerField]: req.user?._id } : {};

    const doc = await Model.create({ ...payload, ...owned, createdBy: req.user?._id });
    if (afterCreate) await afterCreate(doc, req);
    await record(req, 'create', name, doc._id, `Created ${doc.code || doc.name || doc._id}`);
    res.status(201).json({ success: true, data: doc });
  });

  const update = catchAsync(async (req, res) => {
    const payload = beforeUpdate ? await beforeUpdate(req.body, req) : req.body;
    const doc = await Model.findOneAndUpdate(
      mine(req),
      { ...payload, updatedBy: req.user?._id },
      { new: true, runValidators: true }
    );
    if (!doc) throw ApiError.notFound(`${name} not found`);
    if (afterUpdate) await afterUpdate(doc, req);
    await record(req, 'update', name, doc._id, `Updated ${doc.code || doc.name || doc._id}`);
    res.json({ success: true, data: doc });
  });

  const remove = catchAsync(async (req, res) => {
    const doc = await Model.findOneAndDelete(mine(req));
    if (!doc) throw ApiError.notFound(`${name} not found`);
    await record(req, 'delete', name, doc._id, `Deleted ${doc.code || doc.name || doc._id}`);
    res.json({ success: true, data: { id: req.params.id } });
  });

  return { list, getOne, create, update, remove };
}

module.exports = { crud };
