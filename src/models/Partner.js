const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/**
 * A hotel, villa, transport or activity supplier. The Partners sheet's
 * onboarding record, their contract, and how they are actually performing.
 */
const str = { type: String, trim: true, maxlength: 400 };
const num = { type: Number, min: 0 };

/**
 * The five steps of the listing form, as the client's partner sheet lays them
 * out. A partner fills these in the portal; the desk reviews them.
 */
const listingSchema = new mongoose.Schema(
  {
    // Step 1 — account and property
    account: {
      fullName: str,
      email: str,
      alternatePhone: str,
      accountType: { type: String, enum: ['Hotel / Property', 'Channel manager', ''] },
    },
    property: {
      /**
       * What kind of place this is, which decides what the listing form
       * asks for. The list was stays only, so a restaurant or a spa had to
       * register as a hotel and then be asked for bed types.
       */
      type: {
        type: String,
        enum: [
          // The services the website sells, in the order it lists them.
          'Hotel', 'Resort', 'Villa', 'Homestay', 'Free Stay',
          'International Trip', 'Group Departure', 'Package',
          'Restaurant', 'Water Park', 'Theme Park', 'Games Zone', 'Spa & Salon',
          'Luxury Experience', 'Camp', 'Activity',
          'Flight', 'Train & Bus', 'Transport',
          // What Luxury Experience was called before. Kept so partners
          // saved under it stay valid; the forms no longer offer it.
          'Lifestyle',
          '',
        ],
      },
      name: str,
      starCategory: str,
      contactName: str,
      contactPhone: str,
      contactEmail: str,
      bookingStartDate: str,
      description: { type: String, trim: true, maxlength: 3000 },
    },
    location: {
      line1: str,
      line2: str,
      landmark: str,
      city: str,
      state: str,
      country: str,
      pin: str,
      latitude: str,
      longitude: str,
      mapsUrl: str,
    },

    // Step 2 — rooms and photographs
    rooms: [
      {
        _id: false,
        name: str,
        type: str,
        count: num,
        size: str,
        bedType: str,
        adults: num,
        children: num,
        maxOccupancy: num,
        extraBed: Boolean,
        amenities: str,
        description: { type: String, trim: true, maxlength: 1000 },
      },
    ],
    photos: {
      property: [{ type: String, trim: true, maxlength: 500 }],
      rooms: [{ type: String, trim: true, maxlength: 500 }],
    },

    /**
     * Everything the website's own detail pages print.
     *
     * The form asked for rooms, rates and a description, and the pages
     * show a great deal more than that: how the place is laid out, who
     * hosts it, what is nearby, what the rules are. A partner listing
     * that only fills a third of the page looks like an afterthought
     * beside the hand-written ones, so the form asks for the rest.
     *
     * None of it is compulsory. A partner who leaves a section empty
     * simply does not get that section, which is how the screens already
     * behave.
     */
    details: {
      /**
       * What the cards print beside the name.
       *
       * A rating and a review count are the first thing a member looks at,
       * and a partner listing without them read as untrusted next to the
       * site's own. The desk sets them — they are not the partner's to
       * claim — and `tag` is the line under the name, "Spa & Wellness"
       * or "Hair, skin, Spa & grooming".
       */
      tag: { type: String, trim: true, maxlength: 80 },
      rating: { type: Number, min: 0, max: 5 },
      reviews: { type: Number, min: 0 },
      hours: { type: String, trim: true, maxlength: 60 },
      /** "Entire 3-Bedroom Villa", "Deluxe Double Room". */
      layout: { type: String, trim: true, maxlength: 120 },
      bedrooms: num,
      beds: { type: String, trim: true, maxlength: 80 },
      baths: num,
      sleeps: num,
      extraGuests: num,
      unitType: { type: String, trim: true, maxlength: 60 },

      /** The one line on the card, under the price. */
      highlight: { type: String, trim: true, maxlength: 400 },
      /** "Breakfast available at extra charges", and the like. */
      notes: [{ type: String, trim: true, maxlength: 160 }],
      freeCancellation: { type: Boolean, default: false },
      taxes: num,

      /** Who runs it, in their own words. */
      host: {
        title: { type: String, trim: true, maxlength: 120 },
        speaks: { type: String, trim: true, maxlength: 160 },
        blurb: { type: String, trim: true, maxlength: 1000 },
      },

      /** What is near enough to walk or drive to. */
      nearby: [
        { _id: false, place: { type: String, trim: true, maxlength: 120 }, km: { type: String, trim: true, maxlength: 30 } },
      ],

      /** The rooms of the property itself, as the layout section draws them. */
      spaces: [
        {
          _id: false,
          name: { type: String, trim: true, maxlength: 80 },
          floor: { type: String, trim: true, maxlength: 60 },
          tag: { type: String, trim: true, maxlength: 40 },
          images: [{ type: String, trim: true, maxlength: 600 }],
          lines: [{ type: String, trim: true, maxlength: 200 }],
        },
      ],

      /** What the price covers. */
      included: [{ type: String, trim: true, maxlength: 160 }],

      /** The rules, said in full rather than ticked. */
      ruleNotes: [
        { _id: false, title: { type: String, trim: true, maxlength: 80 }, body: { type: String, trim: true, maxlength: 400 } },
      ],

      /** Check-in, guests, cancellation, house rules. */
      guidelines: [
        {
          _id: false,
          title: { type: String, trim: true, maxlength: 80 },
          lines: [{ type: String, trim: true, maxlength: 300 }],
        },
      ],
    },

    // Step 3 — amenities and rules
    amenities: [{ type: String, trim: true, maxlength: 60 }],
    facilities: [{ type: String, trim: true, maxlength: 60 }],
    rules: [{ type: String, trim: true, maxlength: 60 }],

    // Step 4 — pricing, inventory and policies
    pricing: {
      standardTariff: num,
      partnerRate: num,
      weekdayRate: num,
      weekendRate: num,
      extraAdultRate: num,
      childRate: num,
      mealPlans: [{ type: String, enum: ['EP — Room only', 'CP — Breakfast', 'MAP — Breakfast + Dinner', 'AP — All meals'] }],
    },
    inventory: {
      totalRooms: num,
      availableRooms: num,
      closedDates: str,
      blackoutDates: str,
    },
    policies: {
      checkIn: str,
      checkOut: str,
      freeCancellationUntil: str,
      cancellationCharge: str,
      noShowPolicy: str,
    },

    // Step 5 — ownership, documents and bank
    ownership: {
      type: { type: String, enum: ['Self owned', 'Company owned', 'Family owned', 'Lease', 'Other', ''] },
      pan: str,
      gst: str,
      tan: str,
      documentLinks: {
        ownershipProof: str,
        leaseAgreement: str,
        authorisation: str,
      },
    },
    /**
     * Where Smira settles up, asked as two things rather than one.
     *
     * A bank transfer needs an account, an IFSC and a proof; a UPI payout
     * needs a handle and nothing else. They were one block, so a partner
     * who only takes UPI had to leave four boxes empty and the desk could
     * not tell "not filled in" from "does not apply".
     */
    bank: {
      holder: str,
      bankName: str,
      accountNumber: str,
      ifsc: str,
      branch: str,
      proofLink: str,
      /** e.g. name@okhdfcbank. Either this or the account, or both. */
      upiId: { type: String, trim: true, maxlength: 80 },
      upiName: { type: String, trim: true, maxlength: 120 },
      preferred: { type: String, enum: ['Bank transfer', 'UPI', ''], default: '' },
    },
    agreementAccepted: { type: Boolean, default: false },
    agreementAcceptedAt: Date,

    /** The furthest step the partner has saved. */
    step: { type: Number, min: 1, max: 5, default: 1 },
  },
  { _id: false }
);

const partnerSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ['Hotel', 'Villa', 'Package', 'Lifestyle', 'Transport', 'Restaurant', 'Activity', 'Spa'],
      default: 'Hotel',
    },
    businessType: String,
    location: String,

    contact: String,
    phone: String,
    /** The last ten digits of `phone`, which is what sign-in looks up. */
    phoneDigits: { type: String, index: true },
    whatsapp: String,
    email: { type: String, lowercase: true, trim: true },

    // -- Papers -------------------------------------------------------------
    gst: String,
    pan: String,
    upi: String,
    bank: String,
    registration: String,
    contract: String,
    contractEndsOn: Date,
    documents: [
      { name: String, url: String, status: { type: String, default: 'Waiting' }, _id: false },
    ],

    commission: { type: Number, default: 0 },
    ratePlan: String,
    rooms: { type: Number, default: 0 },

    // -- Onboarding ---------------------------------------------------------
    submittedOn: Date,
    verification: { type: String, enum: ['Waiting', 'Verified', 'Rejected'], default: 'Waiting' },
    approval: { type: String, enum: ['Waiting', 'Needs changes', 'Approved', 'Rejected'], default: 'Waiting' },
    stage: { type: String, default: 'Enquiry' },
    status: { type: String, enum: ['Active', 'Paused', 'Blacklisted', 'Pending'], default: 'Pending' },
    /** The partner's own switch: taking bookings tonight, or not. */
    acceptingBookings: { type: Boolean, default: true },
    rejectedReason: String,
    /** What the desk asked to be changed, shown to the partner in the portal. */
    reviewNote: { type: String, trim: true, maxlength: 2000 },
    contractSignedOn: Date,

    listing: { type: listingSchema, default: () => ({}) },

    // -- How they are doing --------------------------------------------------
    bookings: { type: Number, default: 0 },
    confirmed: { type: Number, default: 0 },
    cancelled: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    commissionEarned: { type: Number, default: 0 },
    payable: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    responseMins: { type: Number, default: 0 },
    rating: { type: Number, min: 0, max: 5, default: 0 },
    repeatRate: { type: Number, default: 0 },

    activities: [{ at: Date, text: String, _id: false }],

    // -- Signing in to the partner portal ------------------------------------
    otp: {
      /** Hashed. The digits themselves are never stored. */
      codeHash: { type: String, select: false },
      expiresAt: Date,
      attempts: { type: Number, default: 0 },
      lastSentAt: Date,
    },
    lastLoginAt: Date,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(partnerSchema, 'PTR', { pad: 2, start: 0 });

const digitsOf = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

partnerSchema.statics.digits = digitsOf;

partnerSchema.pre('save', function keepDigits(next) {
  if (this.isModified('phone')) this.phoneDigits = digitsOf(this.phone);
  next();
});

/** Upserts skip document middleware, and the seed upserts partners. */
partnerSchema.pre('findOneAndUpdate', function keepDigitsOnUpdate(next) {
  const update = this.getUpdate() || {};
  const phone = update.phone ?? update.$set?.phone;
  if (phone !== undefined) {
    if (update.$set) update.$set.phoneDigits = digitsOf(phone);
    else update.phoneDigits = digitsOf(phone);
  }
  next();
});

partnerSchema.index({ name: 'text', location: 'text', contact: 'text' });

partnerSchema.virtual('confirmationRate').get(function rate() {
  return this.bookings ? Math.round((this.confirmed / this.bookings) * 100) : 0;
});

partnerSchema.virtual('cancellationRate').get(function rate() {
  return this.bookings ? Math.round((this.cancelled / this.bookings) * 100) : 0;
});

partnerSchema.virtual('pendingConfirmations').get(function pending() {
  return Math.max(0, (this.bookings || 0) - (this.confirmed || 0) - (this.cancelled || 0) - (this.failed || 0));
});

partnerSchema.virtual('balance').get(function balance() {
  return Math.max(0, (this.payable || 0) - (this.paid || 0));
});

module.exports = mongoose.model('Partner', partnerSchema);
