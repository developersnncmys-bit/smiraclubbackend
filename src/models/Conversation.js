const mongoose = require('mongoose');
const { CONVERSATION_CATEGORIES, LEAD_SCORES } = require('../config/constants');
const { withCode } = require('../helpers/ids');

const messageSchema = new mongoose.Schema(
  {
    from: { type: String, enum: ['them', 'bot', 'me'], default: 'them' },
    text: String,
    at: { type: Date, default: Date.now },
    templateName: String,
    delivered: { type: Boolean, default: true },
    read: { type: Boolean, default: false },
  },
  { _id: false }
);

/** A WhatsApp thread, and everything the CRM knows about who is on it. */
const conversationSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    name: { type: String, required: true },
    phone: { type: String, required: true, index: true },

    category: { type: String, enum: CONVERSATION_CATEGORIES, default: 'New lead' },
    score: { type: String, enum: LEAD_SCORES, default: 'Warm' },
    source: String,

    membershipName: String,
    planName: String,
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    handledBy: { type: String, enum: ['Bot', 'Staff'], default: 'Bot' },

    unread: { type: Number, default: 0 },
    lastMessageAt: Date,
    followUpAt: Date,

    tags: [String],
    note: String,
    messages: [messageSchema],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(conversationSchema, 'WAC', { pad: 3, start: 0 });

conversationSchema.index({ name: 'text', phone: 'text' });

module.exports = mongoose.model('Conversation', conversationSchema);
