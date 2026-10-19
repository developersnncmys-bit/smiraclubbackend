const HomeBanner = require('../models/HomeBanner');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');

/**
 * A new slide goes to the end of the carousel.
 *
 * Everything defaulting to order 0 means the carousel reshuffles itself
 * each time the desk adds a slide, which looks like a bug to whoever is
 * watching the home page.
 */
const atTheEnd = async (body) => {
  if (body.order !== undefined && body.order !== null && body.order !== '') return body;
  const last = await HomeBanner.findOne().sort('-order').select('order').lean();
  return { ...body, order: (last?.order ?? -1) + 1 };
};

const base = crud(HomeBanner, {
  name: 'Home banner',
  searchable: ['eyebrow', 'headline', 'figure', 'copy', 'code'],
  defaultSort: 'order createdAt',
  beforeCreate: atTheEnd,
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/**
 * The whole carousel in one go, in the order the desk arranged it.
 *
 * Saving a reorder a slide at a time is several requests that can half
 * fail, and the home page would show the result of the ones that landed.
 */
exports.reorder = catchAsync(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];

  await HomeBanner.bulkWrite(
    ids.map((id, at) => ({
      updateOne: { filter: { _id: id }, update: { $set: { order: at, updatedBy: req.user?._id } } },
    }))
  );

  const rows = await HomeBanner.find().sort('order createdAt').lean();
  res.json({ success: true, count: rows.length, data: rows });
});
