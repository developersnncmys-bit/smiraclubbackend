const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/** A gift owed to a member, and how far along handing it over has got. */
const rewardSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: String,
    membership: { type: mongoose.Schema.Types.ObjectId, ref: 'Membership' },

    gift: { type: String, required: true },
    kind: {
      type: String,
      enum: [
        'Joining gift',
        'Birthday gift',
        'Anniversary gift',
        'Referral reward',
        'Booking milestone',
        'Festival gift',
        'Loyalty gift',
        'Special reward',
      ],
      default: 'Joining gift',
    },
    value: { type: Number, default: 0 },
    eligibility: String,

    assignedOn: Date,
    dueOn: Date,
    fieldOfficer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    proof: String,

    stage: {
      type: String,
      enum: ['Eligible', 'Approved', 'Assigned', 'Out for delivery', 'Delivered', 'Cancelled'],
      default: 'Eligible',
      index: true,
    },
    deliveredOn: Date,
    note: String,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(rewardSchema, 'RWD', { pad: 3, start: 0 });

module.exports = mongoose.model('Reward', rewardSchema);
