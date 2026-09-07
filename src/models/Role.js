const mongoose = require('mongoose');
const { MODULES, PERMISSIONS, SCOPES, APPROVAL_AREAS } = require('../config/constants');

/**
 * A role, exactly as the Users & Roles sheet defines one: a department, who
 * it reports to, the dashboard it opens on, the modules it may reach, what it
 * may do in them, how far it can see, and what it may sign off.
 */
const roleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    department: { type: String, trim: true },
    reportsTo: { type: String, trim: true, default: '—' },
    dashboard: { type: String, default: 'My sales dashboard' },

    modules: [{ type: String, enum: MODULES }],
    permissions: [{ type: String, enum: PERMISSIONS }],
    scope: { type: String, enum: SCOPES, default: 'own' },
    approvals: [{ type: String, enum: APPROVAL_AREAS }],

    /** The one role that skips every check. */
    superAdmin: { type: Boolean, default: false },
    description: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Role', roleSchema);
