const mongoose = require('mongoose');
const { withCode } = require('../helpers/ids');

/** One step the bot walks a customer through. */
const stepSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['message', 'question', 'buttons', 'condition', 'qualify', 'handover', 'faq'],
      default: 'message',
    },
    text: String,
    buttons: [String],
  },
  { _id: false }
);

/** A chatbot journey, built in the no-code flow builder. */
const botFlowSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    name: { type: String, required: true },
    trigger: { type: String, default: 'Any first message' },
    status: { type: String, enum: ['Draft', 'Live', 'Paused'], default: 'Draft' },
    steps: [stepSchema],

    sessions: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    transferred: { type: Number, default: 0 },
    abandoned: { type: Number, default: 0 },
    leadsCreated: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(botFlowSchema, 'FLW', { pad: 2, start: 0 });

module.exports = mongoose.model('BotFlow', botFlowSchema);
