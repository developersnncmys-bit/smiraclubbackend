const mongoose = require('mongoose');
const { HOME_OFFER_TABS, HOME_OFFER_TONES } = require('../config/constants');
const { withCode } = require('../helpers/ids');

/**
 * One card in the website's Grab Offers strip.
 *
 * Not an Offer. An Offer is a coupon — a code, a discount, a window, a
 * usage limit — and it is redeemed. This is a banner: a badge, a headline,
 * a couple of selling points and a photograph, pointing at a part of the
 * site. They shared a name on two different screens and nothing else, which
 * is why the strip was hardcoded into the website for so long.
 *
 * `order` is what the desk drags; `status` is whether a reader sees it.
 */
const homeOfferSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },

    /** Which of the strip's tabs it files under. */
    tab: { type: String, enum: HOME_OFFER_TABS, default: HOME_OFFER_TABS[0], index: true },

    /** The small label in the corner — "Weekend getaway", "Seasonal". */
    badge: { type: String, trim: true },
    title: { type: String, required: true, trim: true },

    /** The ticked lines under the headline. Two is what the design draws. */
    points: [String],

    /** Where the card goes. A path on the site, such as /free-stay. */
    href: { type: String, trim: true, default: '/offers' },

    imageUrl: String,
    tone: { type: String, enum: HOME_OFFER_TONES, default: 'indigo' },

    order: { type: Number, default: 0, index: true },
    status: { type: String, enum: ['Live', 'Hidden'], default: 'Hidden', index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(homeOfferSchema, 'HOF', { pad: 3, start: 0 });

module.exports = mongoose.model('HomeOffer', homeOfferSchema);
