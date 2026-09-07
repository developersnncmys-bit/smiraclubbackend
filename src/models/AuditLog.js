const mongoose = require('mongoose');

/**
 * Every write, and every automated action. Read-only from the API — nothing
 * is allowed to edit the trail it left.
 */
const auditSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: String,
    action: { type: String, required: true },
    entity: String,
    entityId: String,
    message: String,
    ip: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditSchema.index({ createdAt: -1 });
auditSchema.index({ entity: 1, entityId: 1 });

module.exports = mongoose.model('AuditLog', auditSchema);
