/**
 * The Data Visibility rules the Users & Roles sheet calls critical: not every
 * employee should see everything.
 *
 *   own    — only what they own
 *   team   — anything owned by their department
 *   branch — anything owned by their branch
 *   all    — the whole business
 *
 * Scoping runs on the owner rather than on a department stamped onto the
 * record, because a lead has an owner but no department of its own — filtering
 * on the record's field left a manager staring at an empty panel.
 *
 * `ownerField` is whatever the collection calls its owner: a lead has an
 * `owner`, a membership an `expert`, a ticket an `executive`.
 */

/** Everyone whose records this user is allowed to see, themselves included. */
async function peersOf(user) {
  const scope = user.role?.scope || 'own';
  if (scope === 'own') return [user._id];

  const User = require('../models/User');
  const where =
    scope === 'branch'
      ? { branch: user.branch }
      : { department: user.department };

  // A user with neither set can still see their own work.
  if (!where.branch && !where.department) return [user._id];

  const peers = await User.find(where).select('_id').lean();
  const ids = peers.map((p) => p._id);
  return ids.length ? ids : [user._id];
}

/** Resolved once per request in `protect`, so a list does not re-query. */
function scopeFilter(req, ownerField) {
  const user = req.user;
  if (!user || !ownerField) return {};

  const scope = user.role?.scope || 'own';
  if (scope === 'all' || user.role?.superAdmin) return {};

  if (scope === 'own') return { [ownerField]: user._id };

  const ids = req.visibleUserIds;
  if (!ids) return { [ownerField]: user._id };
  return { [ownerField]: { $in: ids } };
}

/** Blocks a write against a record the user is not allowed to touch. */
function ownsOrForbidden(doc, req, ownerField) {
  const scope = req.user?.role?.scope || 'own';
  if (scope === 'all' || req.user?.role?.superAdmin) return true;
  if (scope === 'own') return String(doc[ownerField]) === String(req.user._id);

  const ids = (req.visibleUserIds || []).map(String);
  return ids.includes(String(doc[ownerField]));
}

module.exports = { scopeFilter, ownsOrForbidden, peersOf };
