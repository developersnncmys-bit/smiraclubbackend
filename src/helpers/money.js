/**
 * The money rules the Revenue and Payment sheets spell out, in one place so
 * a booking, an invoice and a report can never disagree.
 */

/** Vendor rate + markup = selling. A member then takes their discount off. */
function sellingRate(baseRate = 0, markup = 0) {
  return Number(baseRate || 0) + Number(markup || 0);
}

function memberRate(baseRate = 0, markup = 0, memberDiscount = 0) {
  return Math.max(0, sellingRate(baseRate, markup) - Number(memberDiscount || 0));
}

/** What Smira keeps on a booking once the hotel is paid. */
function bookingMarkup(amount = 0, vendorCost = 0) {
  return Math.max(0, Number(amount || 0) - Number(vendorCost || 0));
}

/** Price − discount + tax = what the customer actually owes. */
function finalAmount({ price = 0, discount = 0, taxRate = 18 }) {
  const net = Math.max(0, Number(price || 0) - Number(discount || 0));
  const tax = Math.round((net * Number(taxRate || 0)) / 100);
  return { net, tax, total: net + tax };
}

function balanceOf({ amount = 0, paid = 0 }) {
  return Math.max(0, Number(amount || 0) - Number(paid || 0));
}

/** Paid, partly paid, or not started — used everywhere a status is shown. */
function paymentStatus({ amount = 0, paid = 0 }) {
  const total = Number(amount || 0);
  const got = Number(paid || 0);
  if (total > 0 && got >= total) return 'Paid';
  if (got > 0) return 'Partially paid';
  return 'Pending';
}

/** The commission slab from the Revenue sheet. */
function commissionRate(revenue = 0) {
  const n = Number(revenue || 0);
  if (n > 700000) return 3;
  if (n > 300000) return 2;
  return 1;
}

module.exports = {
  sellingRate,
  memberRate,
  bookingMarkup,
  finalAmount,
  balanceOf,
  paymentStatus,
  commissionRate,
};
