require('dotenv').config();
const { seedPartnerDemo } = require('./partnerDemo');

const { connectDB, mongoose } = require('../config/db');
const models = require('../models');
const roles = require('./roles');

const FRESH = process.argv.includes('--fresh');

const daysFromNow = (n) => new Date(Date.now() + n * 86400000);

/**
 * Puts enough in the database to sign in and see every screen do something.
 * `npm run seed:fresh` wipes first; `npm run seed` only fills the gaps.
 */
async function seed() {
  await connectDB();

  if (FRESH) {
    console.log('Clearing the collections…');
    await Promise.all(Object.values(models).map((M) => M.deleteMany({})));
  }

  // -- Roles ---------------------------------------------------------------
  const roleDocs = {};
  for (const role of roles) {
    const doc = await models.Role.findOneAndUpdate({ name: role.name }, role, { upsert: true, new: true });
    roleDocs[role.name] = doc;
  }
  console.log(`Roles: ${Object.keys(roleDocs).length}`);

  // -- The first account ----------------------------------------------------
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'owner@smiraclub.com';

  /**
   * No default. A password written into the source is a password everybody
   * has, so one is generated and shown once unless .env names its own.
   */
  const generated = !process.env.SEED_ADMIN_PASSWORD;
  const adminPassword =
    process.env.SEED_ADMIN_PASSWORD || `Smira-${require('crypto').randomBytes(6).toString('base64url')}`;

  let admin = await models.User.findOne({ email: adminEmail });
  if (!admin) {
    admin = await models.User.create({
      name: 'Vikram Joshi',
      empId: 'EMP-101',
      email: adminEmail,
      password: adminPassword,
      phone: '+91 98190 55127',
      role: roleDocs['Owner / Super admin']._id,
      designation: 'Owner',
      department: 'Management',
      branch: 'Mumbai',
      employment: 'Permanent',
      joinedOn: new Date('2019-04-01'),
      target: 0,
      live: 'Offline',
    });
    console.log(`\nAdmin account created`);
    console.log(`  email:    ${adminEmail}`);
    console.log(`  password: ${adminPassword}`);
    if (generated) console.log(`  (generated — write it down, it is not stored anywhere)\n`);
  }

  // -- A desk to work with ---------------------------------------------------
  const people = [
    { name: 'Sneha Kulkarni', email: 'sneha@smiraclub.com', phone: '+91 98211 44556', role: 'Assistant branch manager', branch: 'Mumbai', department: 'Sales desk', target: 900000, revenue: 820000 },
    { name: 'Priya Nair', email: 'priya@smiraclub.com', phone: '+91 98330 77218', role: 'Branch business manager', branch: 'Pune', department: 'Sales desk', target: 850000, revenue: 910000 },
    { name: 'Kabir Menon', email: 'kabir@smiraclub.com', phone: '+91 90045 22119', role: 'Travel expert', branch: 'Mumbai', department: 'Sales desk', target: 600000, revenue: 480000 },
    { name: 'Rahul Sharma', email: 'rahul@smiraclub.com', phone: '+91 98765 43210', role: 'Travel expert', branch: 'Mumbai', department: 'Lead desk', target: 500000, revenue: 390000 },
    { name: 'Imran Shaikh', email: 'imran@smiraclub.com', phone: '+91 90820 11994', role: 'Field officer', branch: 'Mumbai', department: 'Field team', target: 0, revenue: 0 },
    { name: 'Divya Rao', email: 'divya@smiraclub.com', phone: '+91 98676 20031', role: 'Operations manager', branch: 'Mumbai', department: 'Operations', target: 0, revenue: 0 },
    { name: 'Neha Pillai', email: 'neha@smiraclub.com', phone: '+91 99872 40556', role: 'Finance', branch: 'Mumbai', department: 'Accounts', target: 0, revenue: 0 },
  ];

  const users = { [admin.name]: admin };
  for (const p of people) {
    let user = await models.User.findOne({ email: p.email });
    if (!user) {
      user = await models.User.create({
        ...p,
        role: roleDocs[p.role]._id,
        password: adminPassword,
        manager: admin._id,
        employment: 'Permanent',
        joinedOn: new Date('2024-01-15'),
        calls: 12,
        presentations: 3,
        visits: 1,
        followUps: 8,
        productivity: 78,
      });
    }
    users[p.name] = user;
  }
  console.log(`Users: ${Object.keys(users).length}`);

  // -- Plans ----------------------------------------------------------------
  const planSeed = [
    { name: 'Silver Explorer', price: 4999, persons: 2, durationMonths: 12, discount: 5, freeStay: { nights: 1, validityMonths: 12 }, sortOrder: 1 },
    { name: 'Gold Voyager', price: 9999, persons: 2, durationMonths: 12, discount: 10, freeStay: { nights: 2, validityMonths: 12 }, sortOrder: 2, popular: true },
    { name: 'Platinum Elite', price: 24999, persons: 4, durationMonths: 24, discount: 15, freeStay: { nights: 4, validityMonths: 24 }, sortOrder: 3 },
  ];
  const plans = {};
  for (const p of planSeed) {
    plans[p.name] = await models.MembershipPlan.findOneAndUpdate({ name: p.name }, p, { upsert: true, new: true });
  }
  console.log(`Plans: ${Object.keys(plans).length}`);

  // -- Members --------------------------------------------------------------
  const customerSeed = [
    { name: 'Rohan Bhatt', phone: '+91 99201 55420', email: 'rohan.bhatt@outlook.com', city: 'Mumbai', tier: 'Gold Voyager', trips: 3, spend: 420000, expert: users['Sneha Kulkarni']._id, dob: new Date('1988-09-14') },
    { name: 'Ananya Deshmukh', phone: '+91 98330 21145', email: 'ananya.d@gmail.com', city: 'Pune', tier: 'Platinum Elite', trips: 2, spend: 310000, expert: users['Priya Nair']._id, dob: new Date('1990-03-02') },
    { name: 'Siddhesh Rane', phone: '+91 98201 44521', email: 'siddhesh.r@gmail.com', city: 'Mumbai', tier: 'Silver Explorer', trips: 1, spend: 96000, expert: users['Kabir Menon']._id },
  ];
  const customers = {};
  for (const c of customerSeed) {
    customers[c.name] = await models.Customer.findOneAndUpdate({ phone: c.phone }, c, { upsert: true, new: true });
  }
  console.log(`Customers: ${Object.keys(customers).length}`);

  // -- Memberships ----------------------------------------------------------
  if (!(await models.Membership.countDocuments())) {
    await models.Membership.create([
      {
        customer: customers['Rohan Bhatt']._id,
        name: 'Rohan Bhatt',
        phone: customers['Rohan Bhatt'].phone,
        plan: plans['Gold Voyager']._id,
        planName: 'Gold Voyager',
        branch: 'Mumbai',
        members: 2,
        amount: 23598,
        paid: 23598,
        status: 'Active',
        startedOn: new Date('2025-09-10'),
        expiresOn: daysFromNow(20),
        expert: users['Sneha Kulkarni']._id,
        activation: { stage: 'Activated', activatedOn: new Date('2025-09-11'), contacted: true, explained: true, documents: true },
        benefits: [{ name: 'Free nights', total: 2, used: 1, expiresOn: daysFromNow(20) }],
      },
      {
        customer: customers['Ananya Deshmukh']._id,
        name: 'Ananya Deshmukh',
        phone: customers['Ananya Deshmukh'].phone,
        plan: plans['Platinum Elite']._id,
        planName: 'Platinum Elite',
        branch: 'Pune',
        members: 4,
        amount: 35396,
        paid: 15000,
        status: 'New',
        movement: 'Upgrade',
        expert: users['Priya Nair']._id,
        activation: { stage: 'Payment pending', deadline: daysFromNow(7), contacted: true },
      },
    ]);
  }

  // -- Leads ----------------------------------------------------------------
  if (!(await models.Lead.countDocuments())) {
    await models.Lead.create([
      { name: 'Meera Iyer', phone: '+91 98676 33421', destination: 'Andaman', pax: 4, budget: 210000, status: 'Contacted', source: 'Instagram', score: 'Hot', owner: users['Rahul Sharma']._id, branch: 'Mumbai', nextFollowUpAt: daysFromNow(0) },
      { name: 'Nikhil Sethi', phone: '+91 99870 21134', destination: 'Bali', pax: 2, budget: 180000, status: 'Presentation', source: 'Website', score: 'Warm', owner: users['Kabir Menon']._id, branch: 'Mumbai', nextFollowUpAt: daysFromNow(-2) },
      { name: 'Sanjana Kapoor', phone: '+91 98191 77234', destination: 'Europe', pax: 4, budget: 640000, status: 'Closing', source: 'Referral', score: 'Hot', owner: users['Priya Nair']._id, branch: 'Pune', nextFollowUpAt: daysFromNow(1) },
      { name: 'Dhruv Malhotra', phone: '+91 98202 11983', destination: 'Maldives', pax: 2, budget: 240000, status: 'Lost', source: 'Google Ads', score: 'Cold', owner: users['Rahul Sharma']._id, branch: 'Mumbai', lostReason: 'Went with another agency', lostAt: new Date() },
    ]);
  }

  // -- Partners and stock ----------------------------------------------------
  const partnerSeed = [
    { name: 'Ayana Resort & Spa', phone: '+91 98450 11201', contact: 'Made Wirawan', category: 'Hotel', location: 'Jimbaran, Bali', commission: 12, status: 'Active', stage: 'Live', verification: 'Verified', approval: 'Approved', bookings: 125, confirmed: 118, cancelled: 5, revenue: 420000, commissionEarned: 50400, payable: 121000, responseMins: 12, rating: 4.7, contractEndsOn: daysFromNow(120) },
    { name: 'Atlantis The Palm', phone: '+91 98450 11202', contact: 'Sara Haddad', category: 'Hotel', location: 'Dubai', commission: 10, status: 'Active', stage: 'Live', verification: 'Verified', approval: 'Approved', bookings: 64, confirmed: 58, cancelled: 4, revenue: 380000, commissionEarned: 38000, payable: 186000, responseMins: 34, rating: 4.4, contractEndsOn: daysFromNow(20) },
    { name: 'Skyline Transfers', phone: '+91 98450 11203', contact: 'Anil Kadam', category: 'Transport', location: 'Mumbai', commission: 15, status: 'Active', stage: 'Live', verification: 'Verified', approval: 'Approved', bookings: 42, confirmed: 41, revenue: 84000, commissionEarned: 12600, payable: 18000, responseMins: 5, rating: 4.9, contractEndsOn: daysFromNow(200) },
  ];
  const partners = {};
  for (const p of partnerSeed) {
    partners[p.name] = await models.Partner.findOneAndUpdate({ name: p.name }, p, { upsert: true, new: true });
  }

  if (!(await models.InventoryItem.countDocuments())) {
    await models.InventoryItem.create([
      {
        category: 'Hotels',
        name: 'Ayana Resort & Spa',
        reference: 'AYA-BAL',
        destination: 'Bali, Indonesia',
        grade: '5 star',
        partner: partners['Ayana Resort & Spa']._id,
        vendorName: 'Ayana Resort & Spa',
        units: 42,
        booked: 24,
        blocked: 2,
        baseRate: 34000,
        markup: 8000,
        memberDiscount: 4200,
        status: 'Active',
        confirmation: 'Confirmed',
        contractEndsOn: daysFromNow(120),
        allocation: { tiers: { Silver: 4, Gold: 5, Platinum: 5, Diamond: 3, Crown: 1 }, channels: { Website: 5, App: 2, CRM: 5, WhatsApp: 1, 'Travel expert': 3, Branch: 2, 'Corporate or B2B': 4 }, buffer: 2 },
        rooms: [
          { type: 'Ocean view suite', count: 20, occupancy: 2, extraBed: true, mealPlan: 'Breakfast', rack: 46000, b2b: 34000, smira: 42000, member: 37800, weekend: 48300, seasonal: 52500 },
        ],
      },
      {
        category: 'Transport',
        name: 'Airport transfer — sedan',
        reference: 'SKY-BOM',
        destination: 'Mumbai',
        partner: partners['Skyline Transfers']._id,
        vendorName: 'Skyline Transfers',
        units: 12,
        booked: 6,
        baseRate: 2400,
        markup: 600,
        memberDiscount: 300,
        status: 'Active',
        confirmation: 'Confirmed',
      },
    ]);
  }

  // -- A booking, an invoice and a receipt ------------------------------------
  if (!(await models.Booking.countDocuments())) {
    const booking = await models.Booking.create({
      customer: customers['Rohan Bhatt']._id,
      customerName: 'Rohan Bhatt',
      bookingType: 'Package',
      hotel: 'Ayana Resort & Spa',
      destination: 'Bali, Indonesia',
      vendor: partners['Ayana Resort & Spa']._id,
      vendorName: 'Ayana Resort & Spa',
      checkIn: daysFromNow(18),
      checkOut: daysFromNow(23),
      nights: 5,
      rooms: 1,
      pax: 2,
      charges: { base: 168000, membershipDiscount: 16800, meals: 12000, taxes: 21800 },
      paid: 100000,
      vendorCost: 121000,
      status: 'Confirmed',
      owner: users['Sneha Kulkarni']._id,
      branch: 'Mumbai',
      handledBy: { created: users['Sneha Kulkarni']._id, handled: users['Sneha Kulkarni']._id },
    });

    const invoice = await models.Invoice.create({
      customer: customers['Rohan Bhatt']._id,
      customerName: 'Rohan Bhatt',
      booking: booking._id,
      forWhat: 'Bali package',
      baseAmount: 168000,
      discount: 16800,
      tax: 21800,
      paid: 100000,
      issuedOn: new Date(),
      dueOn: daysFromNow(-3),
      owner: users['Sneha Kulkarni']._id,
      branch: 'Mumbai',
    });

    await models.Payment.create({
      customer: customers['Rohan Bhatt']._id,
      customerName: 'Rohan Bhatt',
      invoice: invoice._id,
      booking: booking._id,
      product: 'Bali package',
      amount: 100000,
      mode: 'UPI',
      gateway: 'Razorpay',
      collectedBy: users['Sneha Kulkarni']._id,
      branch: 'Mumbai',
    });
  }

  // -- One complaint ----------------------------------------------------------
  if (!(await models.Ticket.countDocuments())) {
    await models.Ticket.create({
      customer: customers['Ananya Deshmukh']._id,
      customerName: 'Ananya Deshmukh',
      phone: customers['Ananya Deshmukh'].phone,
      category: 'Payment',
      subCategory: 'Payment pending',
      description: 'The balance payment link did not open, and the membership fee still shows as pending.',
      priority: 'Critical',
      stage: 'Assigned',
      executive: users['Neha Pillai']._id,
      department: 'Payments',
      branch: 'Pune',
      timeline: [{ who: 'Ananya Deshmukh', channel: 'WhatsApp', text: 'Payment link is not opening' }],
    });
  }

  // -- Expenses, so the profit line means something ---------------------------
  if (!(await models.Expense.countDocuments())) {
    await models.Expense.create([
      { category: 'Rent', detail: 'Andheri office', amount: 85000, stage: 'Paid', raisedBy: users['Neha Pillai']._id },
      { category: 'Marketing', detail: 'Instagram campaign', amount: 96000, stage: 'Approved', raisedBy: users['Neha Pillai']._id },
      { category: 'Staff salary', detail: 'August payroll', amount: 246000, stage: 'Paid', raisedBy: users['Neha Pillai']._id },
    ]);
  }

  // -- One automation rule, so the builder has something to show --------------
  if (!(await models.AutomationRule.countDocuments())) {
    await models.AutomationRule.create({
      name: 'Website lead to the Mumbai desk',
      when: 'New lead',
      conditions: [{ field: 'source', op: 'is', value: 'Website', join: 'AND' }],
      steps: [
        { wait: 'Immediately', action: 'Assign to the Mumbai team' },
        { wait: 'Immediately', action: 'Send the WhatsApp welcome message' },
        { wait: 'After 10 minutes', action: 'Create a first-call task' },
      ],
      status: 'On',
      createdBy: admin._id,
    });
  }

  // A couple of bookings, a ticket and papers for each demo partner.
  console.log('\nPartner demo data:');
  await seedPartnerDemo();

  const counts = {};
  for (const [name, Model] of Object.entries(models)) {
    counts[name] = await Model.countDocuments();
  }
  console.log('\nWhat is in the database now:');
  Object.entries(counts)
    .filter(([, n]) => n > 0)
    .forEach(([name, n]) => console.log(`  ${name.padEnd(18)} ${n}`));

  await mongoose.connection.close();
  console.log('\nDone.');
}

seed().catch(async (err) => {
  console.error('Seed failed:', err);
  await mongoose.connection.close();
  process.exit(1);
});
