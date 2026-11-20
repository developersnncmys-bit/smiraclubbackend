const catchAsync = require('../helpers/catchAsync');

/**
 * GET /sync/versions?paths=/bookings,/tasks,/leads
 *
 * A cheap "has this list changed?" for the admin panel's background refresh.
 * For each list it answers how many records there are and when the newest
 * change was — two indexed lookups, no documents — so the panel downloads a
 * list again only when one of those two moved, instead of every list every
 * 15 seconds.
 */
const MODELS = {
  '/users': 'User',
  '/roles': 'Role',
  '/approvals': 'Approval',
  '/leads': 'Lead',
  '/tasks': 'Task',
  '/customers': 'Customer',
  '/membership-plans': 'MembershipPlan',
  '/memberships': 'Membership',
  '/bookings': 'Booking',
  '/scheduled-reports': 'ScheduledReport',
  '/tickets': 'Ticket',
  '/partners': 'Partner',
  '/inventory': 'InventoryItem',
  '/invoices': 'Invoice',
  '/payments': 'Payment',
  '/whatsapp/conversations': 'Conversation',
  '/whatsapp/flows': 'BotFlow',
  '/automations': 'AutomationRule',
  '/rewards': 'Reward',
  '/referrals': 'Referral',
  '/offers': 'Offer',
  '/blogs': 'Blog',
  '/home-banners': 'HomeBanner',
  '/home-offers': 'HomeOffer',
};

const modelFor = (path) => {
  const name = MODELS[path];
  if (!name) return null;
  try {
    return require(`../models/${name}`);
  } catch {
    return null;
  }
};

exports.versions = catchAsync(async (req, res) => {
  const paths = String(req.query.paths || '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => MODELS[p])
    .slice(0, 40);

  const answers = await Promise.all(
    paths.map(async (path) => {
      const Model = modelFor(path);
      if (!Model) return [path, null];
      const [count, newest] = await Promise.all([
        Model.estimatedDocumentCount(),
        Model.findOne().sort({ updatedAt: -1 }).select('updatedAt').lean(),
      ]);
      return [path, `${count}:${newest?.updatedAt ? new Date(newest.updatedAt).getTime() : 0}`];
    })
  );

  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: Object.fromEntries(answers.filter(([, v]) => v)), at: Date.now() });
});
