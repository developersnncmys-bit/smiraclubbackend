const Setting = require('../models/Setting');
const catchAsync = require('../helpers/catchAsync');

/** Everything the desk has set, as one object keyed by name. */
exports.all = catchAsync(async (req, res) => {
  const rows = await Setting.find().lean();
  const data = {};
  rows.forEach((r) => { data[r.key] = r.value; });
  res.json({ success: true, data });
});

/**
 * Set one.
 *
 * Upserted rather than created, because a setting has no lifecycle worth
 * modelling: there is one value for a key and the last person to type it
 * wins, the same way it would on a shared spreadsheet.
 */
exports.set = catchAsync(async (req, res) => {
  const { key } = req.params;
  const row = await Setting.findOneAndUpdate(
    { key },
    { value: req.body?.value, updatedBy: req.user?._id },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  res.json({ success: true, data: { key: row.key, value: row.value } });
});
