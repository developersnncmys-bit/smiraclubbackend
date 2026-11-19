/**
 * Member IDs by tier, numbered from 1 within each tier:
 *   Silver SCS-1 · Gold SCG-1 · Platinum SCP-1 · Diamond SCD-1 · Crown SCC-1
 * Given once, when the membership is paid, and never changed after.
 */
const PREFIX = { silver: 'SCS', gold: 'SCG', platinum: 'SCP', diamond: 'SCD', crown: 'SCC' };

const prefixFor = (planName) => {
  const word = String(planName || '').trim().split(/\s+/)[0].toLowerCase();
  if (PREFIX[word]) return PREFIX[word];
  const key = Object.keys(PREFIX).find((k) => String(planName || '').toLowerCase().includes(k));
  return key ? PREFIX[key] : `SC${(word[0] || 'M').toUpperCase()}`;
};

/** Paid for (or Active), so it is somebody's membership. */
const isPaidMembership = (m) =>
  m.status === 'Active' ||
  m.status === 'Expiring soon' ||
  m.activation?.stage === 'Activated' ||
  (Number(m.amount || 0) > 0 && Number(m.paid || 0) >= Number(m.amount || 0));

/**
 * The next number after the highest one still held, so deleting test
 * memberships frees their numbers and the first real Silver member is SCS-1.
 */
async function nextMemberId(planName) {
  const Membership = require('../models/Membership');
  const prefix = prefixFor(planName);
  const held = await Membership.find({ memberId: new RegExp(`^${prefix}-\\d+$`) }).select('memberId').lean();
  const top = held.reduce((max, m) => Math.max(max, Number(String(m.memberId).split('-')[1]) || 0), 0);
  return `${prefix}-${top + 1}`;
}

/**
 * Gives an ID to paid memberships that do not have one yet, oldest first.
 * Only adds the field — nothing else on the membership is touched.
 */
async function backfillMemberIds() {
  const Membership = require('../models/Membership');
  const rows = await Membership.find({
    memberId: { $in: [null, ''] },
    status: { $nin: ['Cancelled', 'Quoted'] },
  })
    .select('planName status activation amount paid receivedOn startedOn')
    .sort({ 'activation.activatedOn': 1, startedOn: 1, receivedOn: 1 })
    .lean();
  let given = 0;
  for (const m of rows) {
    if (!isPaidMembership(m)) continue;
    const id = await nextMemberId(m.planName);
    const res = await Membership.updateOne({ _id: m._id, memberId: { $in: [null, ''] } }, { $set: { memberId: id } });
    if (res.modifiedCount) given += 1;
  }
  if (given) console.log(`Member IDs given to ${given} paid membership(s)`);
}

module.exports = { prefixFor, isPaidMembership, nextMemberId, backfillMemberIds };
