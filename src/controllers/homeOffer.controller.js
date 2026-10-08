const HomeOffer = require('../models/HomeOffer');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');

/**
 * A new card goes to the end of the strip.
 *
 * Everything defaulting to order 0 means the strip reorders itself every
 * time the desk adds one, which looks like a bug to whoever is watching
 * the website.
 */
const atTheEnd = async (body) => {
  if (body.order !== undefined && body.order !== null && body.order !== '') return body;
  const last = await HomeOffer.findOne().sort('-order').select('order').lean();
  return { ...body, order: (last?.order ?? -1) + 1 };
};

const base = crud(HomeOffer, {
  name: 'Homepage offer',
  searchable: ['title', 'badge', 'code'],
  defaultSort: 'order createdAt',
  beforeCreate: atTheEnd,
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/**
 * The whole strip in one go, in the order the desk dragged it into.
 *
 * Saving a reorder one card at a time is several requests that can half
 * fail, and the website would show the result of the ones that landed.
 */
exports.reorder = catchAsync(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];

  await HomeOffer.bulkWrite(
    ids.map((id, at) => ({
      updateOne: { filter: { _id: id }, update: { $set: { order: at, updatedBy: req.user?._id } } },
    }))
  );

  const rows = await HomeOffer.find().sort('order createdAt').lean();
  res.json({ success: true, count: rows.length, data: rows });
});
