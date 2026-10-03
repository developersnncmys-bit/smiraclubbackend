const Offer = require('../models/Offer');
const InventoryItem = require('../models/InventoryItem');
const ApiError = require('../helpers/ApiError');

/**
 * Flash offers: a partner's own short discount on their own listing.
 *
 * A hotel with rooms left tonight, a restaurant with a quiet Tuesday, a spa
 * with an empty afternoon — the thing they want is a price cut that runs for
 * a few hours and then stops on its own. Going through the desk for that
 * takes longer than the offer would have lasted.
 *
 * So a partner raises it themselves. There is nothing to approve: the only
 * rate it can move is their own, it can only ever come down, and it ends at
 * a time they set. The desk sees it on the Offers page like any other.
 *
 * Both doors — the portal and the desk raising one on a partner's behalf —
 * come through here, so the rules are written once.
 */

/** As long as a flash offer may run. Longer than this is a campaign. */
const MAX_HOURS = 72;
const MIN_PERCENT = 5;
const MAX_PERCENT = 60;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Whether an offer is running right now. */
function isRunning(o, now = new Date()) {
  if (o.status !== 'Live') return false;
  if (o.startsOn && new Date(o.startsOn) > now) return false;
  if (o.endsOn && new Date(o.endsOn) < now) return false;
  return true;
}

/**
 * Raise one.
 *
 * The listing has to be the partner's own and on sale — a partner cannot
 * discount somebody else's room, and an offer on a listing nobody can see
 * is a promise with nothing behind it.
 */
async function createFlash(partner, body = {}, { raisedBy = 'Partner', by } = {}) {
  const percent = Math.round(num(body.percent));
  if (percent < MIN_PERCENT || percent > MAX_PERCENT) {
    throw ApiError.badRequest(`A flash offer is between ${MIN_PERCENT}% and ${MAX_PERCENT}% off`);
  }

  const hours = Math.round(num(body.hours)) || 24;
  if (hours < 1 || hours > MAX_HOURS) {
    throw ApiError.badRequest(`A flash offer runs for up to ${MAX_HOURS} hours`);
  }

  const listing = await InventoryItem.findOne({
    _id: body.listing,
    partner: partner._id,
  });
  if (!listing) throw ApiError.notFound('We could not find that listing of yours');
  if (!['Active', 'Limited', 'Low'].includes(listing.status)) {
    throw ApiError.badRequest('That listing is not on sale, so there is nothing to discount');
  }

  // One at a time per listing: two live discounts on one room is a question
  // about which of them applies, and nobody wants to answer it at the till.
  const already = await Offer.findOne({ flash: true, listing: listing._id, status: 'Live' });
  if (already && isRunning(already)) {
    throw ApiError.badRequest(`${listing.name} already has a flash offer running — stop that one first`);
  }

  const startsOn = new Date();
  const endsOn = new Date(startsOn.getTime() + hours * 3600000);

  return Offer.create({
    name: String(body.name || '').trim() || `${percent}% off ${listing.name}`,
    description: String(body.description || '').trim(),
    kind: 'Percent off',
    value: percent,
    minSpend: Math.max(0, Math.round(num(body.minSpend))),
    appliesTo: [listing.category],
    channels: ['Website'],
    startsOn,
    endsOn,
    status: 'Live',
    flash: true,
    partner: partner._id,
    listing: listing._id,
    raisedBy,
    createdBy: by,
  });
}

/** Stop one early. It stays on the record, ended rather than deleted. */
async function stopFlash(offer) {
  offer.status = 'Expired';
  offer.endsOn = new Date();
  await offer.save();
  return offer;
}

/** A partner's flash offers, newest first, with the listing they are on. */
async function flashOffersOf(partnerId, limit = 20) {
  const rows = await Offer.find({ flash: true, partner: partnerId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('listing', 'code name category baseRate markup')
    .lean();

  const now = new Date();
  return rows.map((o) => ({
    id: o.code || String(o._id),
    _id: String(o._id),
    name: o.name,
    description: o.description || '',
    percent: o.value,
    minSpend: o.minSpend || 0,
    startsOn: o.startsOn,
    endsOn: o.endsOn,
    status: isRunning(o, now) ? 'Running' : o.status === 'Live' ? 'Scheduled' : 'Ended',
    raisedBy: o.raisedBy || '',
    listing: o.listing
      ? { id: o.listing.code, name: o.listing.name, category: o.listing.category }
      : null,
  }));
}

module.exports = { createFlash, stopFlash, flashOffersOf, isRunning, MAX_HOURS, MIN_PERCENT, MAX_PERCENT };
