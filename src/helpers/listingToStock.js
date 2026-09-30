const InventoryItem = require('../models/InventoryItem');

/**
 * Turning a partner's listing into something the website can sell.
 *
 * The two halves never met. A partner filled in five steps and it sat on
 * their own record; the website reads Travel Inventory. So every approved
 * partner had to be typed in again by hand before a member could see them,
 * and until somebody did, going live meant nothing.
 *
 * This is that step, done once when the desk puts them live. It is written
 * to be run again safely — the desk may re-approve, or a partner may change
 * their rooms — so it updates the item it made last time rather than
 * leaving a second copy behind.
 */

/** What a partner calls their place, and what the website files it under. */
const CATEGORY_OF = {
  Hotel: 'Hotels',
  Resort: 'Hotels',
  Homestay: 'Hotels',
  Camp: 'Hotels',
  Villa: 'Villas',
  Restaurant: 'Restaurants',
  'Spa & Salon': 'Spa and salon',
  'Games Zone': 'Games',
  'Theme Park': 'Attractions',
  Activity: 'Activities',
  Transport: 'Transport',
  Lifestyle: 'Experiences',
};

/** The partner's own category, when they never chose a property type. */
const FALLBACK = {
  Hotel: 'Hotels',
  Villa: 'Villas',
  Package: 'Packages',
  Restaurant: 'Restaurants',
  Activity: 'Activities',
  Spa: 'Spa and salon',
  Transport: 'Transport',
  Lifestyle: 'Experiences',
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const text = (v) => String(v ?? '').trim();

/**
 * Each room type the partner listed, priced.
 *
 * `smira` is what Smira pays them and `rack` what the property charges
 * walk-ins; the selling price is the desk's markup on top and is not set
 * here, because the partner does not get to decide Smira's margin.
 */
function roomsFrom(listing) {
  const p = listing.pricing || {};
  const meal = (p.mealPlans || [])[0] || '';
  return (listing.rooms || [])
    .filter((r) => text(r.name) || text(r.type))
    .map((r) => ({
      type: text(r.name) || text(r.type),
      count: num(r.count),
      occupancy: num(r.maxOccupancy) || num(r.adults) || 2,
      extraBed: Boolean(r.extraBed),
      childPolicy: text(r.children ? `Up to ${r.children} children` : ''),
      mealPlan: meal,
      rack: num(p.standardTariff),
      smira: num(p.partnerRate),
      weekend: num(p.weekendRate),
    }));
}

/** Their photographs, property first, then the rooms. */
const photosFrom = (listing) =>
  [...(listing.photos?.property || []), ...(listing.photos?.rooms || [])]
    .map(text)
    .filter(Boolean)
    .slice(0, 24);

/**
 * Everything on the property that a member would tick a box to filter by:
 * the amenities they chose, plus the facilities, which the website shows
 * in the same grid.
 */
const amenitiesFrom = (listing) =>
  [...new Set([...(listing.amenities || []), ...(listing.facilities || [])].map(text).filter(Boolean))].slice(0, 40);

/** Where a stay's hours belong, said the way the website prints them. */
const hoursFrom = (listing) => {
  const pol = listing.policies || {};
  return { checkIn: text(pol.checkIn), checkOut: text(pol.checkOut) };
};

/**
 * Put a live partner into Travel Inventory, or bring their item up to date.
 *
 * Returns the item. The desk still owns the markup and the status, so a
 * second run never overwrites what the desk has priced — only what the
 * partner themselves supplied.
 */
async function publishListing(partner, { by } = {}) {
  const listing = partner.listing || {};
  const prop = listing.property || {};
  const loc = listing.location || {};
  const inv = listing.inventory || {};
  const hours = hoursFrom(listing);

  const rooms = roomsFrom(listing);
  const units = num(inv.totalRooms) || rooms.reduce((s, r) => s + num(r.count), 0) || 1;
  const category = CATEGORY_OF[prop.type] || FALLBACK[partner.category] || 'Hotels';

  const fromPartner = {
    category,
    name: text(prop.name) || partner.name,
    partner: partner._id,
    vendorName: partner.name,
    destination: [text(loc.city), text(loc.state)].filter(Boolean).join(', ') || partner.location || '',
    grade: text(prop.starCategory),
    description: text(prop.description),
    address: [loc.line1, loc.line2, loc.landmark, loc.city, loc.state, loc.pin].map(text).filter(Boolean).join(', '),
    gps: [text(loc.latitude), text(loc.longitude)].filter(Boolean).join(', ') || text(loc.mapsUrl),
    checkIn: hours.checkIn,
    checkOut: hours.checkOut,
    contact: [text(prop.contactName), text(prop.contactPhone)].filter(Boolean).join(' · '),
    amenities: amenitiesFrom(listing),
    images: photosFrom(listing),
    rooms,
    units,
    baseRate: num(listing.pricing?.partnerRate),
    // Everything the detail pages print, exactly as the partner gave it.
    details: listing.details || {},
  };

  const already = await InventoryItem.findOne({ partner: partner._id });

  if (already) {
    // The desk's own columns are left alone: markup, status, what is booked
    // or blocked, and anything they have set day by day.
    Object.assign(already, fromPartner);
    already.updatedBy = by;
    await already.save();
    return already;
  }

  return InventoryItem.create({
    ...fromPartner,
    markup: 0,
    memberDiscount: 0,
    booked: 0,
    blocked: 0,
    // Live, because the desk clicking Go live is the decision — but with no
    // markup yet, so the desk sets what Smira makes before it earns anything.
    status: 'Active',
    confirmation: 'Confirmed',
    createdBy: by,
    updatedBy: by,
  });
}

module.exports = { publishListing, CATEGORY_OF };
