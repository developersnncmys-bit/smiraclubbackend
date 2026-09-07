const mongoose = require('mongoose');
const { APPROVAL_AREAS, APPROVAL_STAGES } = require('../config/constants');
const { withCode } = require('../helpers/ids');

/**
 * Anything that cannot happen until somebody signs it off — the six flows the
 * Users & Roles sheet lists, plus whatever a configurable rule adds.
 */
const approvalSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    area: { type: String, enum: APPROVAL_AREAS, required: true },
    what: { type: String, required: true },
    value: { type: Number, default: 0 },

    entity: String,
    entityId: String,

    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    branch: String,

    level: { type: Number, default: 1 },
    levels: { type: Number, default: 1 },

    status: { type: String, enum: APPROVAL_STAGES, default: 'Waiting', index: true },
    decidedAt: Date,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    remark: String,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(approvalSchema, 'APR', { pad: 3, start: 0 });

module.exports = mongoose.model('Approval', approvalSchema);
