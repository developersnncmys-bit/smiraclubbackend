const router = require('express').Router();

/**
 * Every module hangs off /api. The admin panel talks to exactly these, and
 * nothing here knows the panel exists.
 */
router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/roles', require('./role.routes'));

router.use('/leads', require('./lead.routes'));
router.use('/tasks', require('./task.routes'));
router.use('/customers', require('./customer.routes'));

router.use('/membership-plans', require('./membershipPlan.routes'));
router.use('/memberships', require('./membership.routes'));

router.use('/bookings', require('./booking.routes'));
router.use('/tickets', require('./ticket.routes'));
router.use('/partners', require('./partner.routes'));
router.use('/inventory', require('./inventory.routes'));

router.use('/payments', require('./payment.routes'));
router.use('/invoices', require('./invoice.routes'));
router.use('/refunds', require('./refund.routes'));
router.use('/expenses', require('./expense.routes'));
router.use('/approvals', require('./approval.routes'));

router.use('/whatsapp', require('./whatsapp.routes'));
router.use('/automations', require('./automation.routes'));

router.use('/rewards', require('./reward.routes'));
router.use('/referrals', require('./referral.routes'));
router.use('/offers', require('./offer.routes'));

router.use('/dashboard', require('./dashboard.routes'));
router.use('/reports', require('./report.routes'));
router.use('/revenue', require('./revenue.routes'));
router.use('/audit-logs', require('./auditLog.routes'));

// Partners sign in here, and only here. See middleware/partnerAuth.js.
router.use('/partner-portal', require('./partnerPortal.routes'));

// What the public website sends in, with nobody signed in.
router.use('/website', require('./website.routes'));

/** A map of what is on offer, handy when wiring the panel up later. */
router.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'Smira Club API',
    modules: [
      'auth', 'users', 'roles', 'leads', 'tasks', 'customers',
      'membership-plans', 'memberships', 'bookings', 'tickets', 'partners',
      'inventory', 'payments', 'invoices', 'refunds', 'expenses', 'approvals',
      'whatsapp', 'automations', 'rewards', 'referrals', 'offers',
      'dashboard', 'reports', 'revenue', 'audit-logs', 'partner-portal', 'website',
    ],
  });
});

module.exports = router;
