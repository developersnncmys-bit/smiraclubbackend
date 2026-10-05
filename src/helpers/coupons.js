const Offer = require('../models/Offer');

/**
 * Coupon codes, as the desk writes them on the Offers page.
 *
 * The website used to carry one code in its own source — SMIRA500, five
 * hundred rupees off, applied before anybody typed anything. Nobody at the
 * desk could add a second one, retire that one, or put an end date on it.
 *
 * A coupon is an Offer with a code on it, so this reads the Offers page and
 * nothing else. The same check runs for the website's "Apply" button and
 * for the membership that comes back afterwards, because a code that is
 * worth five hundred rupees when you type it must be worth five hundred
 * rupees when it is counted — and a page can say anything.
 */

/** Kinds that take money off. The rest give a thing, not a discount. */
const MONEY_OFF = ['Percent off', 'Flat off'];

const rupees = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * Look a code up and work out what it is worth against this spend.
 *
 * Always resolves — an unusable code is a `valid: false` with a reason
 * worth showing someone, not an error. A flash offer is skipped: that is a
 * partner cutting their own rate on one listing, not a code to type.
 */
async function couponFor(rawCode, { spend = 0, use = '' } = {}) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { code: '', valid: false, off: 0, reason: 'Enter a code first.' };

  const offer = await Offer.findOne({ couponCode: code, flash: { $ne: true } });
  if (!offer) return { code, valid: false, off: 0, reason: `We could not find "${code}".` };

  const now = new Date();
  const no = (reason) => ({ code, valid: false, off: 0, reason, offer });

  if (offer.status !== 'Live') return no('That code is not running at the moment.');
  if (offer.startsOn && offer.startsOn > now) return no('That code has not started yet.');
  if (offer.endsOn && offer.endsOn < now) return no('That code has expired.');
  if (offer.usageLimit && offer.used >= offer.usageLimit) return no('That code has been fully claimed.');
  if (use && offer.appliesTo?.length && !offer.appliesTo.includes(use))
    return no(`That code cannot be used on a ${use.toLowerCase()}.`);
  if (offer.minSpend && spend < offer.minSpend)
    return no(`That code needs a spend of at least ${rupees(offer.minSpend)}.`);

  let off = 0;
  if (MONEY_OFF.includes(offer.kind)) {
    off = offer.kind === 'Percent off' ? Math.round((spend * (offer.value || 0)) / 100) : offer.value || 0;
    if (offer.maxDiscount) off = Math.min(off, offer.maxDiscount);
    // Never more than the thing costs, and never a negative bill.
    off = Math.max(0, Math.min(off, spend));
  }

  return {
    code,
    valid: true,
    off,
    offer,
    name: offer.name || '',
    kind: offer.kind,
    // A Gift or an Upgrade is worth nothing off the price, so say what it
    // is instead of showing someone a discount of zero.
    gives: MONEY_OFF.includes(offer.kind) ? '' : offer.description || offer.name || '',
    reason: '',
  };
}

/**
 * Count one use, so a code capped at fifty stops at fifty.
 *
 * Conditional on the cap in the same write rather than read-then-save, so
 * two people typing the last code at once cannot both get it.
 */
async function redeemCoupon(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return false;
  const res = await Offer.updateOne(
    {
      couponCode: code,
      flash: { $ne: true },
      $or: [{ usageLimit: 0 }, { usageLimit: null }, { $expr: { $lt: ['$used', '$usageLimit'] } }],
    },
    { $inc: { used: 1 } },
  );
  return res.modifiedCount > 0;
}

module.exports = { couponFor, redeemCoupon, MONEY_OFF };
