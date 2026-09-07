/**
 * Every write is logged. The Users & Roles sheet asks for an audit trail and
 * the Automation sheet asks that "every automated action should be logged" —
 * this is the one place both land.
 */
async function record(req, action, entity, entityId, message) {
  try {
    const AuditLog = require('../models/AuditLog');
    await AuditLog.create({
      actor: req?.user?._id || null,
      actorName: req?.user?.name || 'System',
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      message,
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
  } catch (err) {
    // A failed log must never fail the request it was describing.
    console.warn('Audit log failed:', err.message);
  }
}

module.exports = { record };
