/**
 * The vocabulary the client's sheets use. Keeping it in one place means a
 * status can never drift between a model, a controller and a report.
 */

// -- Users and roles --------------------------------------------------------
const MODULES = [
  'CRM',
  'Membership',
  'Booking',
  'Finance',
  'Customer',
  'Inventory',
  'Vendors',
  'WhatsApp',
  'Reports',
  'Users',
];

const PERMISSIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
  'financial',
  'export',
  'assign',
];

/** How far a role can see. */
const SCOPES = ['own', 'team', 'branch', 'all'];

const LIVE_STATES = ['Online', 'Away', 'Offline', 'On call', 'Customer meeting', 'Follow-up', 'On leave'];

// -- Sales ------------------------------------------------------------------
const LEAD_STAGES = [
  'New',
  'Contacted',
  'Interested',
  'Details sent',
  'Presentation',
  'Visit scheduled',
  'Closing',
  'Won',
  'Lost',
];

const LEAD_SOURCES = [
  'Facebook Ads',
  'Instagram',
  'WhatsApp',
  'Website',
  'Google Ads',
  'Referral',
  'Field team',
  'Existing member',
  'Campaign',
  'Walk-in',
  'Other',
];

const LEAD_SCORES = ['Hot', 'Warm', 'Cold'];

// -- Booking ----------------------------------------------------------------
const BOOKING_STATUSES = [
  'Pending',
  'Confirmed',
  'Part paid',
  'Completed',
  'Cancelled',
  'Rescheduled',
  'Failed',
  'No-show',
];

const BOOKING_TYPES = ['Hotel', 'Villa', 'Package', 'Transport', 'International trip', 'Restaurant', 'Activity'];

// -- Membership -------------------------------------------------------------
const MEMBERSHIP_STATUSES = [
  'Quoted',
  'New',
  'Active',
  'Pending activation',
  'Expiring soon',
  'Expired',
  'Suspended',
  'Cancelled',
];

const ACTIVATION_STAGES = ['Sold', 'Payment pending', 'Documents pending', 'Activated'];

const MOVEMENTS = ['New', 'Renewal', 'Upgrade', 'Downgrade'];

// -- Support ----------------------------------------------------------------
const TICKET_STAGES = [
  'New',
  'Assigned',
  'In progress',
  'Waiting',
  'Escalated',
  'Resolved',
  'Customer confirmed',
  'Closed',
];

const TICKET_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

/** First response in minutes, resolution in hours, straight off the sheet. */
const SLA = {
  Critical: { firstResponse: 15, resolution: 4 },
  High: { firstResponse: 30, resolution: 8 },
  Medium: { firstResponse: 60, resolution: 24 },
  Low: { firstResponse: 120, resolution: 48 },
};

const SLA_STATES = ['Within', 'Approaching', 'Breached'];

const TICKET_CATEGORIES = [
  'Booking',
  'Membership',
  'Payment',
  'Hotel or partner',
  'Customer service',
  'Gift or reward',
];

// -- Money ------------------------------------------------------------------
const PAYMENT_STATUSES = ['Paid', 'Partially paid', 'Pending', 'Failed', 'Refunded', 'Cancelled'];

const PAYMENT_MODES = ['UPI', 'Card', 'Net banking', 'Cash', 'Bank transfer', 'Cheque', 'Payment gateway'];

const GATEWAYS = ['Razorpay', 'Cashfree', 'PhonePe', 'UPI', 'Bank transfer', 'Credit or debit card', 'Cheque', 'Cash'];

const APPROVAL_AREAS = ['Membership', 'Discount', 'Refund', 'Booking', 'Inventory', 'Reward', 'Payment'];

const APPROVAL_STAGES = ['Waiting', 'Approved', 'Rejected'];

const EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Internet',
  'Marketing',
  'Office expenses',
  'Travel',
  'Staff salary',
  'Incentives',
  'Software',
  'Vendor payments',
  'Bank charges',
  'Gateway charges',
  'Miscellaneous',
];

// -- Inventory --------------------------------------------------------------
const INVENTORY_CATEGORIES = [
  'Hotels',
  'Villas',
  'Flights',
  'Transport',
  'Packages',
  'Activities',
  'Restaurants',
  'Spa and salon',
  'Attractions',
  'Experiences',
];

const RATE_TYPES = [
  'Standard rate',
  'B2B rate',
  'Member rate',
  'Weekend rate',
  'Seasonal rate',
  'Festival rate',
  'Corporate rate',
  'Promotional rate',
  'Package rate',
  'Last-minute rate',
];

const MEMBERSHIP_TIERS = ['Silver', 'Gold', 'Platinum', 'Diamond', 'Crown'];

const SALES_CHANNELS = ['Website', 'App', 'CRM', 'WhatsApp', 'Travel expert', 'Branch', 'Corporate or B2B'];

// -- WhatsApp ---------------------------------------------------------------
const CONVERSATION_CATEGORIES = [
  'New lead',
  'Hot lead',
  'Follow-up',
  'Membership enquiry',
  'Hotel booking',
  'Package enquiry',
  'Payment',
  'Cancellation or reschedule',
  'Complaint',
  'Existing member',
  'VIP member',
  'Closed',
];

// -- Automation -------------------------------------------------------------
const AUTOMATION_TRIGGERS = [
  'New lead',
  'Lead status changed',
  'Lead assigned',
  'Call completed',
  'No answer',
  'Follow-up due',
  'Presentation scheduled',
  'Presentation completed',
  'Customer visit',
  'Membership sold',
  'Payment received',
  'Payment failed',
  'Payment overdue',
  'Membership activated',
  'Membership expiring',
  'Booking created',
  'Booking confirmed',
  'Booking cancelled',
  'Travel completed',
  'Feedback received',
  'Referral created',
  'Staff login or logout',
  'Attendance status changed',
  'Target achieved',
  'Custom date or time',
  'Manual trigger',
];

const OPERATORS = ['is', 'is not', 'contains', 'is greater than', 'is less than', 'is empty'];

module.exports = {
  MODULES,
  PERMISSIONS,
  SCOPES,
  LIVE_STATES,
  LEAD_STAGES,
  LEAD_SOURCES,
  LEAD_SCORES,
  BOOKING_STATUSES,
  BOOKING_TYPES,
  MEMBERSHIP_STATUSES,
  ACTIVATION_STAGES,
  MOVEMENTS,
  TICKET_STAGES,
  TICKET_PRIORITIES,
  SLA,
  SLA_STATES,
  TICKET_CATEGORIES,
  PAYMENT_STATUSES,
  PAYMENT_MODES,
  GATEWAYS,
  APPROVAL_AREAS,
  APPROVAL_STAGES,
  EXPENSE_CATEGORIES,
  INVENTORY_CATEGORIES,
  RATE_TYPES,
  MEMBERSHIP_TIERS,
  SALES_CHANNELS,
  CONVERSATION_CATEGORIES,
  AUTOMATION_TRIGGERS,
  OPERATORS,
};
