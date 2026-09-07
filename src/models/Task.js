const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/**
 * A job somebody has to do. Raised by hand from the desk, or on its own by an
 * automation, a poor support rating or a renewal falling due.
 */
const taskSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: [
        'Call',
        'Follow-up',
        'WhatsApp',
        'Presentation',
        'Customer Visit',
        'Payment Follow-up',
        'Membership Activation',
        'Documentation',
        'Booking Follow-up',
        'Send itinerary',
        'Documents',
      ],
      default: 'Follow-up',
    },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    createdByName: String,
    branch: String,
    department: String,

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    customerName: String,
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },

    dueAt: Date,
    priority: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium' },
    status: {
      type: String,
      enum: ['Pending', 'In progress', 'Completed', 'Overdue', 'Cancelled'],
      default: 'Pending',
    },
    completedAt: Date,

    lastAction: String,
    nextAction: String,
    note: String,

    /** Set when an automation raised it rather than a person. */
    raisedBy: { type: String, default: 'Person' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

withCode(taskSchema, 'TSK', { pad: 4, start: 300 });

taskSchema.index({ owner: 1, status: 1, dueAt: 1 });

/** today, overdue or done — the bucket the desk sorts by. */
taskSchema.virtual('bucket').get(function bucket() {
  if (['Completed', 'Cancelled'].includes(this.status)) return 'done';
  if (this.dueAt && this.dueAt < new Date()) return 'overdue';
  return 'today';
});

module.exports = mongoose.model('Task', taskSchema);
