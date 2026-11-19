/**
 * Permanently deletes the memberships (and the payments recorded against
 * them) for the phone numbers given. The customer and their leads are kept.
 *
 *   node src/scripts/deleteMemberships.js 9821116669 9035300961        ← only shows what it would delete
 *   node src/scripts/deleteMemberships.js 9821116669 9035300961 --yes  ← deletes
 */
require('dotenv').config();
const { connectDB, mongoose } = require('../config/db');
const Membership = require('../models/Membership');
const Payment = require('../models/Payment');

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const phones = args.filter((a) => a !== '--yes').map((a) => a.replace(/\D/g, '').slice(-10)).filter((p) => p.length === 10);

(async () => {
  if (!phones.length) {
    console.log('Give the 10-digit phone numbers, e.g. node src/scripts/deleteMemberships.js 9821116669');
    process.exit(1);
  }
  await connectDB();

  const byPhone = phones.map((p) => ({ phone: new RegExp(`${p.split('').join('\\D*')}$`) }));
  const memberships = await Membership.find({ $or: byPhone }).select('code memberId name phone planName status amount paid').lean();
  const ids = memberships.map((m) => m._id);
  const payments = await Payment.find({ membership: { $in: ids } }).select('code amount gateway gatewayTxnId').lean();

  console.log(`\nMemberships (${memberships.length}):`);
  memberships.forEach((m) =>
    console.log(`  ${m.code}  ${m.memberId || '-'}  ${m.name}  ${m.phone}  ${m.planName}  ${m.status}  paid ₹${m.paid || 0}`)
  );
  console.log(`Payments for them (${payments.length}):`);
  payments.forEach((p) => console.log(`  ${p.code}  ₹${p.amount}  ${p.gateway}  ${p.gatewayTxnId || ''}`));

  if (!yes) {
    console.log('\nNothing deleted. Run again with --yes at the end to delete these permanently.\n');
  } else {
    const pm = await Payment.deleteMany({ _id: { $in: payments.map((p) => p._id) } });
    const mm = await Membership.deleteMany({ _id: { $in: ids } });
    console.log(`\nDeleted ${mm.deletedCount} membership(s) and ${pm.deletedCount} payment(s).\n`);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
