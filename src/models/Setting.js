const mongoose = require('mongoose');

/**
 * A desk-wide setting, kept as one row per key.
 *
 * Some numbers are not derived from anything — what a lead from Instagram
 * costs, for instance, is what the desk paid for it, and only the desk
 * knows. Those were hard-coded in the panel, which meant every return-on-
 * spend figure on the Reports page was arithmetic on invented numbers.
 * They live here now so somebody can type the real ones in.
 */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true, trim: true, maxlength: 80 },
    value: mongoose.Schema.Types.Mixed,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Setting', settingSchema);
