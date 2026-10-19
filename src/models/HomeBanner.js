const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/**
 * One slide of the banner carousel at the top of the website.
 *
 * It was three slides written into the website's own content file, so
 * changing the headline on the first one — the first thing anybody sees
 * — meant a developer and a deploy. A desk that can price a room can
 * write a headline.
 *
 * The figure is kept apart from the words around it because the design
 * sets it enormous: "Up to" small, "40" huge, "%" small again, "off"
 * small. One sentence in one field cannot be drawn that way.
 *
 * `order` is the order they rotate in; `status` is whether a reader
 * sees it at all.
 */
const homeBannerSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },

    /** The small label above the headline — "Membership benefits". */
    eyebrow: { type: String, trim: true },

    /** The words before the figure — "Up to", "From". */
    headline: { type: String, trim: true },

    /** The big number itself: "40", "4", "₹4,200". */
    figure: { type: String, required: true, trim: true },

    /** What sits tight against the figure — "%", or nothing. */
    unit: { type: String, trim: true, default: '' },

    /** The words after it — "off", "free nights", "a night". */
    suffix: { type: String, trim: true, default: '' },

    /** The line underneath, in a sentence. */
    copy: { type: String, trim: true },

    ctaLabel: { type: String, trim: true, default: 'Book now' },
    ctaHref: { type: String, trim: true, default: '/membership' },

    imageUrl: String,
    /** What the photograph shows, for a reader who cannot see it. */
    alt: { type: String, trim: true },

    order: { type: Number, default: 0, index: true },
    status: { type: String, enum: ['Live', 'Hidden'], default: 'Hidden', index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(homeBannerSchema, 'HBN', { pad: 3, start: 0 });

module.exports = mongoose.model('HomeBanner', homeBannerSchema);
