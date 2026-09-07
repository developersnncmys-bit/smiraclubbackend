const mongoose = require('mongoose');
const { AUTOMATION_TRIGGERS, OPERATORS } = require('../config/constants');
const { withCode } = require('../helpers/ids');

/**
 * WHEN → IF → THEN → WAIT → THEN → ELSE, which is the shape the Automation
 * sheet draws the core builder as.
 */
const conditionSchema = new mongoose.Schema(
  {
    field: String,
    op: { type: String, enum: OPERATORS, default: 'is' },
    value: String,
    join: { type: String, enum: ['AND', 'OR'], default: 'AND' },
  },
  { _id: false }
);

const stepSchema = new mongoose.Schema(
  { wait: { type: String, default: 'Immediately' }, action: String },
  { _id: false }
);

const ruleSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    name: { type: String, required: true },
    when: { type: String, enum: AUTOMATION_TRIGGERS, required: true },
    conditions: [conditionSchema],
    steps: [stepSchema],
    otherwise: String,

    /** A rule can be narrowed to a branch, a team or a role. */
    branch: String,
    department: String,
    role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role' },

    status: { type: String, enum: ['On', 'Off'], default: 'On', index: true },
    runs: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    lastRunAt: Date,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(ruleSchema, 'AUT', { pad: 2, start: 0 });

module.exports = mongoose.model('AutomationRule', ruleSchema);
