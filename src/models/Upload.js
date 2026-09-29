const mongoose = require('mongoose');

/**
 * A file somebody sent us — a cancelled cheque, a lease, a PAN card.
 *
 * Partners were asked to paste a link to their papers, which meant the
 * documents lived in somebody's Drive: they could be moved, revoked or
 * quietly edited after we checked them, and a partner without a Drive
 * account could not apply at all. They are kept here instead.
 *
 * The bytes sit in the document because these are single-page scans and
 * cheque photographs, a few hundred kilobytes each, and a handful per
 * partner. That is well inside what a record holds, and it means no bucket
 * to provision, no keys to rotate and nothing to go stale when a link dies.
 * Anything large enough to make that a bad trade is refused on the way in.
 */
const uploadSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, trim: true, maxlength: 200 },
    contentType: { type: String, required: true, trim: true, maxlength: 100 },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true, select: false },

    /** Who it belongs to, so a partner can only ever fetch their own. */
    partner: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', index: true },
    /** What it is — "Cancelled cheque", "Ownership proof" — for the desk. */
    label: { type: String, trim: true, maxlength: 120 },
    uploadedBy: { type: String, trim: true, maxlength: 120 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Upload', uploadSchema);
