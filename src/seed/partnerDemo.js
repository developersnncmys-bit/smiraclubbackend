/**
 * A little real-looking work for each demo partner, so their dashboard has
 * something in every part of it: a guest arriving today, a request waiting to
 * be accepted, a payout still owed, a ticket, and papers on file.
 *
 * Safe to run again. Each booking is found by a reference of its own and its
 * dates are moved back to "today" and "in a few days", so a dashboard that
 * has gone stale comes back to life rather than filling up with copies.
 */
const Booking = require('../models/Booking');
const Customer = require('../models/Customer');
const Partner = require('../models/Partner');
const Ticket = require('../models/Ticket');

const day = (offset) => {
  const d = new Date();
  d.setHours(14, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

const PLAN = {
  '9845011201': {
    documents: [
      { name: 'GST certificate', status: 'Verified' },
      { name: 'Trade licence', status: 'Verified' },
      { name: 'Cancelled cheque', status: 'Verified' },
      { name: 'Partner agreement', status: 'Verified' },
    ],
    ratePlan: 'Contract 2026-A · ocean view suite ₹42,000 a night',
    bookings: [
      {
        ref: 'DEMO-AYANA-1',
        guest: 'Rohan Bhatt',
        hotel: 'Ayana Resort & Spa',
        roomType: 'Ocean view suite',
        from: 0,
        nights: 2,
        adults: 2,
        children: 0,
        mealPlan: 'Breakfast',
        amount: 96000,
        vendorCost: 84000,
        status: 'Confirmed',
        confirmation: 'Confirmed by partner',
      },
      {
        ref: 'DEMO-AYANA-2',
        guest: 'Ananya Deshmukh',
        hotel: 'Ayana Resort & Spa',
        roomType: 'Ocean view suite',
        from: 3,
        nights: 3,
        adults: 2,
        children: 1,
        mealPlan: 'Breakfast + Dinner',
        amount: 148000,
        vendorCost: 126000,
        status: 'Pending',
        confirmation: 'Waiting on the hotel',
      },
    ],
    ticket: {
      subCategory: 'Weekend rate does not match the contract',
      description: 'The weekend rate showing to members is ₹48,300; our signed rate plan says ₹46,000.',
      stage: 'Assigned',
      priority: 'Medium',
    },
  },
  '9845011202': {
    documents: [
      { name: 'Trade licence', status: 'Verified' },
      { name: 'Partner agreement', status: 'Verified' },
    ],
    ratePlan: 'Contract 2026-B · deluxe room ₹32,000 a night',
    bookings: [
      {
        ref: 'DEMO-ATLANTIS-1',
        guest: 'Siddhesh Rane',
        hotel: 'Atlantis The Palm',
        roomType: 'Deluxe room',
        from: 5,
        nights: 3,
        adults: 2,
        children: 0,
        mealPlan: 'Breakfast',
        amount: 112000,
        vendorCost: 96000,
        status: 'Pending',
        confirmation: 'Waiting on the hotel',
      },
      {
        ref: 'DEMO-ATLANTIS-2',
        guest: 'Rohan Bhatt',
        hotel: 'Atlantis The Palm',
        roomType: 'Deluxe room',
        from: -10,
        nights: 2,
        adults: 2,
        children: 0,
        mealPlan: 'Room only',
        amount: 70000,
        vendorCost: 64000,
        status: 'Cancelled',
        confirmation: 'Cancelled by the member',
      },
    ],
  },
  '9845011203': {
    documents: [
      { name: 'Commercial vehicle permit', status: 'Verified' },
      { name: 'Partner agreement', status: 'Verified' },
    ],
    ratePlan: 'Airport transfer · sedan ₹2,400 a trip',
    bookings: [
      {
        ref: 'DEMO-SKYLINE-1',
        guest: 'Ananya Deshmukh',
        vendorName: 'Skyline Transfers',
        roomType: 'Airport transfer — sedan',
        from: 1,
        nights: 0,
        adults: 2,
        children: 0,
        mealPlan: '—',
        amount: 3000,
        vendorCost: 2400,
        vendorPaid: 2400,
        status: 'Confirmed',
        confirmation: 'Confirmed by partner',
      },
    ],
  },
};

async function seedPartnerDemo({ log = console.log } = {}) {
  const customers = await Customer.find({}).lean();
  const byName = Object.fromEntries(customers.map((c) => [c.name, c]));
  const anyCustomer = customers[0];
  if (!anyCustomer) {
    log('  partner demo: no customers to attach bookings to — skipped');
    return;
  }

  for (const [digits, plan] of Object.entries(PLAN)) {
    const partner = await Partner.findOne({ phoneDigits: digits });
    if (!partner) {
      log(`  partner demo: no partner on ${digits} — skipped`);
      continue;
    }

    partner.documents = plan.documents;
    partner.ratePlan = plan.ratePlan;
    await partner.save({ validateBeforeSave: false });

    for (const b of plan.bookings) {
      const customer = byName[b.guest] || anyCustomer;
      const fields = {
        customer: customer._id,
        customerName: b.guest,
        vendor: partner._id,
        vendorName: b.vendorName || partner.name,
        hotel: b.hotel,
        roomType: b.roomType,
        checkIn: day(b.from),
        checkOut: day(b.from + Math.max(1, b.nights)),
        nights: b.nights,
        rooms: 1,
        adults: b.adults,
        children: b.children,
        pax: b.adults + b.children,
        mealPlan: b.mealPlan,
        amount: b.amount,
        paid: b.status === 'Cancelled' ? 0 : b.amount,
        vendorCost: b.vendorCost,
        vendorPaid: b.vendorPaid || 0,
        status: b.status,
        confirmation: {
          status: b.confirmation,
          reference: b.ref,
          confirmedAt: /confirmed by partner/i.test(b.confirmation) ? new Date() : undefined,
        },
      };

      const existing = await Booking.findOne({ 'confirmation.reference': b.ref });
      if (existing) {
        existing.set(fields);
        await existing.save({ validateBeforeSave: false });
        log(`  ${existing.code}  ${partner.name} · ${b.guest} · refreshed`);
      } else {
        const created = await new Booking(fields).save();
        log(`  ${created.code}  ${partner.name} · ${b.guest} · added`);
      }
    }

    if (plan.ticket) {
      const t = plan.ticket;
      const existing = await Ticket.findOne({ partner: partner._id, subCategory: t.subCategory });
      if (!existing) {
        const created = await new Ticket({
          customerName: partner.contact || partner.name,
          phone: partner.phone,
          category: 'Hotel or partner',
          subCategory: t.subCategory,
          description: t.description,
          partner: partner._id,
          hotel: partner.name,
          stage: t.stage,
          priority: t.priority,
        }).save();
        log(`  ${created.code}  ${partner.name} · ticket added`);
      }
    }
  }
}

module.exports = { seedPartnerDemo };

// Run on its own: `node src/seed/partnerDemo.js`
if (require.main === module) {
  require('dotenv').config();
  const { connectDB, mongoose } = require('../config/db');
  connectDB()
    .then(() => seedPartnerDemo())
    .then(() => mongoose.disconnect())
    .catch(async (err) => {
      console.error(err.message);
      await mongoose.disconnect();
      process.exit(1);
    });
}
