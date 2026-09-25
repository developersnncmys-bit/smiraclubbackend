const Partner = require('../models/Partner');
const Booking = require('../models/Booking');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');

const base = crud(Partner, {
  name: 'Partner',
  searchable: ['name', 'location', 'contact', 'email', 'code'],
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/**
 * A property owner applying from the public website.
 *
 * The only route on this module that is not behind a sign-in, so it is written
 * defensively: the fields are copied one by one rather than spread from the
 * body, and where the application sits in the onboarding flow is decided here
 * rather than accepted from the form. Otherwise anyone could post themselves
 * an approved, active partner record.
 *
 * It lands where the desk expects to find it — Partners → Onboarding, on
 * Registration, waiting on papers.
 */
exports.apply = catchAsync(async (req, res) => {
  const b = req.body || {};
  const text = (v, max = 120) => String(v ?? '').trim().slice(0, max);

  const name = text(b.name);
  const phone = text(b.phone, 20);
  if (!name) throw ApiError.badRequest('Tell us the property name');
  if (!phone) throw ApiError.badRequest('Tell us a phone number we can reach you on');

  /**
   * One number, one partner. Sign-in finds a partner by their number, so a
   * second application on the same one would leave it ambiguous which
   * account the code lets you into.
   */
  const digits = Partner.digits(phone);
  if (digits && (await Partner.exists({ phoneDigits: digits }))) {
    throw ApiError.badRequest('That number is already registered — sign in to the partner portal instead');
  }

  const CATEGORIES = ['Hotel', 'Villa', 'Package', 'Lifestyle', 'Transport', 'Restaurant', 'Activity', 'Spa'];
  const category = CATEGORIES.includes(b.category) ? b.category : 'Hotel';

  const rooms = Math.max(0, Math.min(9999, Number(b.rooms) || 0));

  const partner = await Partner.create({
    name,
    category,
    businessType: text(b.businessType, 60),
    location: text(b.location, 80),

    contact: text(b.contact, 80),
    phone,
    whatsapp: text(b.whatsapp, 20),
    email: text(b.email, 120).toLowerCase(),

    gst: text(b.gst, 20),
    pan: text(b.pan, 20),
    registration: text(b.registration, 60),
    upi: text(b.upi, 60),
    bank: text(b.bank, 120),
    rooms,

    /**
     * The five steps, when they were filled in.
     *
     * The website's partner form walks the same steps the portal does, so
     * the whole listing can arrive with the application rather than being
     * chased afterwards. The schema decides what is kept — anything it does
     * not declare is dropped on the way in — so this cannot be used to set
     * fields that are not the applicant's.
     */
    ...(b.listing && typeof b.listing === 'object' ? { listing: b.listing } : {}),

    // Not the applicant's to decide.
    submittedOn: new Date(),
    stage: 'Registration',
    verification: 'Waiting',
    approval: 'Waiting',
    status: 'Pending',
    activities: [{ at: new Date(), text: 'Applied through the website' }],
  });

  // The reference is all they get back. The record itself is the desk's.
  res.status(201).json({
    success: true,
    message: 'Application received',
    data: { reference: partner.code, name: partner.name },
  });
});

/**
 * Sent back to the partner with a note of what to change.
 *
 * The listing opens for editing again in their portal, and the note is the
 * first thing they see. They resubmit, and it comes back to review.
 */
exports.requestChanges = catchAsync(async (req, res) => {
  const note = String(req.body.note || '').trim();
  if (!note) throw ApiError.badRequest('Say what needs changing');

  const partner = await Partner.findById(req.params.id);
  if (!partner) throw ApiError.notFound('Partner not found');
  if (partner.stage !== 'Admin review') {
    throw ApiError.badRequest('Only a listing that is in review can be sent back');
  }

  partner.stage = 'Needs changes';
  partner.approval = 'Needs changes';
  partner.reviewNote = note.slice(0, 2000);
  partner.activities.push({ at: new Date(), text: `Changes requested by ${req.user.name} — ${note}` });
  await partner.save();

  await record(req, 'update', 'Partner', partner._id, `${partner.name} sent back for changes`);
  res.json({ success: true, data: partner });
});

/** Contract signed — the partner goes live and their dashboard opens. */
exports.goLive = catchAsync(async (req, res) => {
  const partner = await Partner.findById(req.params.id);
  if (!partner) throw ApiError.notFound('Partner not found');
  if (partner.stage !== 'Contract' || partner.approval !== 'Approved') {
    throw ApiError.badRequest('A partner goes live only after approval, once the contract is signed');
  }

  partner.stage = 'Live';
  partner.status = 'Active';
  partner.contractSignedOn = new Date();
  partner.activities.push({ at: new Date(), text: `Contract signed — put live by ${req.user.name}` });
  await partner.save();

  await record(req, 'approve', 'Partner', partner._id, `${partner.name} is live`);
  res.json({ success: true, data: partner });
});

/** Papers checked. */
exports.verify = catchAsync(async (req, res) => {
  const partner = await Partner.findByIdAndUpdate(
    req.params.id,
    {
      verification: 'Verified',
      stage: 'Verified',
      $push: { activities: { at: new Date(), text: `Papers verified by ${req.user.name}` } },
    },
    { new: true }
  );
  if (!partner) throw ApiError.notFound('Partner not found');
  await record(req, 'verify', 'Partner', partner._id, `${partner.name} verified`);
  res.json({ success: true, data: partner });
});

/**
 * Approved after review — the contract comes next.
 *
 * The client's flow puts a contract between approval and going live, so
 * approving no longer switches the partner on. Reviewing the listing is also
 * where the papers are checked, so approval marks them verified.
 */
exports.approve = catchAsync(async (req, res) => {
  const partner = await Partner.findById(req.params.id);
  if (!partner) throw ApiError.notFound('Partner not found');
  if (partner.status === 'Active' && !['Registration', 'Admin review', 'Needs changes', 'Contract'].includes(partner.stage)) {
    throw ApiError.badRequest('That partner is already live');
  }

  partner.approval = 'Approved';
  partner.verification = 'Verified';
  partner.stage = 'Contract';
  partner.reviewNote = undefined;
  partner.activities.push({ at: new Date(), text: `Approved by ${req.user.name} — contract next` });
  await partner.save();

  await record(req, 'approve', 'Partner', partner._id, `${partner.name} approved`);
  res.json({ success: true, data: partner });
});

exports.reject = catchAsync(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw ApiError.badRequest('A rejection needs a reason');

  const partner = await Partner.findByIdAndUpdate(
    req.params.id,
    {
      approval: 'Rejected',
      verification: 'Rejected',
      status: 'Paused',
      stage: 'Rejected',
      rejectedReason: reason,
      $push: { activities: { at: new Date(), text: `Rejected — ${reason}` } },
    },
    { new: true }
  );
  if (!partner) throw ApiError.notFound('Partner not found');
  res.json({ success: true, data: partner });
});

/** What each supplier is actually doing, from the bookings placed with them. */
exports.performance = catchAsync(async (req, res) => {
  const partners = await Partner.find().lean();
  const bookings = await Booking.aggregate([
    { $match: { vendor: { $ne: null } } },
    {
      $group: {
        _id: '$vendor',
        bookings: { $sum: 1 },
        value: { $sum: '$amount' },
        cost: { $sum: '$vendorCost' },
        paid: { $sum: '$vendorPaid' },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] } },
        confirmed: { $sum: { $cond: [{ $eq: ['$status', 'Confirmed'] }, 1, 0] } },
      },
    },
  ]);

  const totalCommission = partners.reduce((s, p) => s + Number(p.commissionEarned || 0), 0);

  res.json({
    success: true,
    data: partners.map((p) => {
      const b = bookings.find((x) => String(x._id) === String(p._id)) || {};
      const booked = b.bookings || p.bookings || 0;
      return {
        id: p._id,
        name: p.name,
        category: p.category,
        bookings: booked,
        revenue: b.value || p.revenue || 0,
        commission: p.commissionEarned || 0,
        cancellationRate: booked ? Math.round(((b.cancelled || p.cancelled || 0) / booked) * 100) : 0,
        confirmationRate: booked ? Math.round(((b.confirmed || p.confirmed || 0) / booked) * 100) : 0,
        rating: p.rating,
        responseMins: p.responseMins,
        pendingConfirmations: Math.max(0, booked - (b.confirmed || p.confirmed || 0) - (b.cancelled || p.cancelled || 0)),
        payable: Math.max(0, (b.cost || p.payable || 0) - (b.paid || p.paid || 0)),
        profitShare: totalCommission ? Math.round((Number(p.commissionEarned || 0) / totalCommission) * 100) : 0,
        contractEndsOn: p.contractEndsOn,
      };
    }),
  });
});

/** What the hotels are owed against each booking. */
exports.payables = catchAsync(async (req, res) => {
  const rows = await Booking.find({ vendorCost: { $gt: 0 } })
    .select('code customerName vendorName vendorCost vendorPaid checkIn status vendor')
    .populate('vendor', 'name')
    .lean();

  res.json({
    success: true,
    data: rows.map((b) => ({
      ...b,
      pending: Math.max(0, Number(b.vendorCost || 0) - Number(b.vendorPaid || 0)),
    })),
  });
});
