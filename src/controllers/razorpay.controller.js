const Membership = require('../models/Membership');
const Payment = require('../models/Payment');
const Lead = require('../models/Lead');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const rzp = require('../helpers/razorpay');

/**
 * Paying for a membership on the website, through Razorpay.
 *
 *  1. POST /website/membership       raises the membership (Payment pending)
 *  2. POST /website/pay/order        opens a Razorpay order for its amount
 *  3. Razorpay Checkout on the page  the member pays (UPI, card, net banking)
 *  4. POST /website/pay/verify       the page hands back the signed result
 *  5. POST /website/razorpay/webhook Razorpay tells us itself — so a payment
 *                                    is never lost if the page was closed
 *
 * Steps 4 and 5 both end in settle(), which only ever counts a payment once.
 */

const notReady = () => ApiError.badRequest('Online payment is not switched on yet — please call us to pay');

/** Money confirmed by Razorpay: record it and activate the membership. */
async function settle(membership, payment) {
  // Claimed atomically, so the page and the webhook arriving together count it once.
  const claimed = await Membership.findOneAndUpdate(
    { _id: membership._id, razorpayPaymentId: { $ne: payment.id } },
    { $set: { razorpayPaymentId: payment.id } },
    { new: true }
  ).populate('plan', 'durationMonths name');
  if (!claimed) return Membership.findById(membership._id);
  if (await Payment.exists({ gatewayTxnId: payment.id })) return claimed;

  const rupees = Number(payment.amount || 0) / 100;
  const how = { upi: 'UPI', card: 'Card', netbanking: 'Net banking' }[payment.method] || 'Payment gateway';
  const now = new Date();

  claimed.paid = Number(claimed.paid || 0) + rupees;
  claimed.paidVia = 'Razorpay';
  claimed.timeline.push({
    step: 'Payment received',
    at: now,
    note: `₹${rupees.toLocaleString('en-IN')} paid online via Razorpay (${payment.method || 'online'}) · ${payment.id}`,
  });

  await Payment.create({
    customer: claimed.customer,
    customerName: claimed.name,
    membership: claimed._id,
    product: `${claimed.planName} membership`,
    amount: rupees,
    mode: how,
    gateway: 'Razorpay',
    gatewayTxnId: payment.id,
    gatewayFee: Number(payment.fee || 0) / 100,
    reference: payment.order_id,
    branch: claimed.branch,
    paidOn: payment.created_at ? new Date(payment.created_at * 1000) : now,
    status: 'Success',
    note: payment.vpa ? `UPI ${payment.vpa}` : undefined,
  });

  const full = Number(claimed.paid || 0) >= Number(claimed.amount || 0);
  if (full) {
    const months = claimed.plan?.durationMonths || 12;
    const until = new Date(now);
    until.setMonth(until.getMonth() + months);
    claimed.status = 'Active';
    claimed.startedOn = claimed.startedOn || now;
    claimed.expiresOn = until;
    claimed.activation.stage = 'Activated';
    claimed.activation.activatedOn = now;
    claimed.timeline.push({ step: 'Membership activated', at: now, note: 'Automatically, after the online payment' });
  } else {
    claimed.activation.stage = 'Payment pending';
  }
  await claimed.save();

  if (full) {
    // Copies of the same request (Pay tapped more than once) close with it.
    await Membership.updateMany(
      { _id: { $ne: claimed._id }, customer: claimed.customer, plan: claimed.plan?._id || claimed.plan, status: 'New', paid: { $in: [0, null] } },
      { $set: { status: 'Cancelled' }, $push: { timeline: { step: 'Closed', at: now, note: `Same request as ${claimed.code}, which was paid online` } } }
    );
    const ten = String(claimed.phone || '').replace(/\D/g, '').slice(-10);
    if (ten.length === 10) {
      await Lead.updateMany(
        { phone: { $regex: `${ten}$` }, tags: 'Payment pending' },
        {
          $pull: { tags: 'Payment pending' },
          $push: { activities: { kind: 'status', text: `Membership ${claimed.code} paid online (Razorpay) and activated`, byName: 'Website', at: now } },
        }
      );
    }
  }
  return claimed;
}

/** A payment Razorpay says is for this order — captured, or captured now. */
async function confirmedPayment(paymentId, orderId) {
  let payment = await rzp.fetchPayment(paymentId);
  if (payment.order_id !== orderId) throw ApiError.badRequest('That payment is not for this order');
  if (payment.status === 'authorized') payment = await rzp.capture(payment.id, payment.amount);
  if (payment.status !== 'captured') throw ApiError.badRequest(`Payment is ${payment.status} — nothing was charged`);
  return payment;
}

/**
 * The membership an order belongs to. Opening Pay twice makes a second order,
 * so a payment on the first is still found through the code in its notes.
 */
const membershipFor = async (orderId, notes) =>
  (await Membership.findOne({ razorpayOrderId: orderId })) ||
  (notes?.membership ? await Membership.findOne({ code: String(notes.membership) }) : null);

const result = (m) => ({
  reference: m.code,
  status: m.status === 'Active' ? 'Active' : 'Payment pending',
  plan: m.planName,
  expiresOn: m.expiresOn,
});

/** POST /website/pay/order { ref } — a Razorpay order for that membership. */
exports.order = catchAsync(async (req, res) => {
  if (!rzp.configured()) throw notReady();
  const ref = String(req.body?.ref || '').trim();
  if (!ref) throw ApiError.badRequest('Which membership is this for?');

  const membership = await Membership.findOne({ payRef: ref });
  if (!membership) throw ApiError.notFound('We could not find that membership — please try again');
  if (membership.status === 'Active') return res.json({ success: true, data: { paid: true, ...result(membership) } });

  const due = Math.max(0, Number(membership.amount || 0) - Number(membership.paid || 0));
  if (due < 1) throw ApiError.badRequest('Nothing is due on this membership');

  const order = await rzp.createOrder({
    rupees: due,
    receipt: membership.code,
    notes: { membership: membership.code, plan: membership.planName || '', phone: membership.phone || '' },
  });
  membership.razorpayOrderId = order.id;
  membership.timeline.push({ step: 'Website', at: new Date(), note: `Opened Razorpay to pay ₹${due.toLocaleString('en-IN')} · ${order.id}` });
  await membership.save();

  res.json({
    success: true,
    data: {
      keyId: rzp.keyId(),
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      name: membership.name,
      phone: membership.phone,
      email: membership.email,
      description: `${membership.planName} membership`,
    },
  });
});

/** POST /website/pay/verify — what Checkout handed the page, checked here. */
exports.verify = catchAsync(async (req, res) => {
  if (!rzp.configured()) throw notReady();
  const orderId = String(req.body?.razorpay_order_id || '');
  const paymentId = String(req.body?.razorpay_payment_id || '');
  const signature = String(req.body?.razorpay_signature || '');
  if (!orderId || !paymentId || !signature) throw ApiError.badRequest('The payment details are incomplete');
  if (!rzp.checkoutSignatureOk(orderId, paymentId, signature)) throw ApiError.badRequest('The payment could not be verified');

  const payment = await confirmedPayment(paymentId, orderId);
  const membership = await membershipFor(orderId, payment.notes);
  if (!membership) throw ApiError.notFound('We could not find the membership for this payment — please call us');
  const done = await settle(membership, payment);
  res.json({ success: true, message: 'Payment received', data: result(done) });
});

/**
 * POST /website/razorpay/webhook — Razorpay's own word, signed with the
 * webhook secret. Mounted with a raw body parser in app.js so the signature
 * can be checked against the exact bytes Razorpay sent.
 */
exports.webhook = async (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    if (!rzp.webhookSignatureOk(raw, req.get('x-razorpay-signature'))) {
      return res.status(400).json({ success: false, message: 'Bad signature' });
    }
    const event = JSON.parse(raw.toString('utf8'));
    const payment = event?.payload?.payment?.entity;
    if (['payment.captured', 'order.paid'].includes(event?.event) && payment?.order_id && payment.status === 'captured') {
      const membership = await membershipFor(payment.order_id, payment.notes);
      if (membership) await settle(membership, payment);
    }
    return res.json({ success: true });
  } catch (err) {
    // A 500 makes Razorpay retry, which is what we want if the database blinked.
    console.error('Razorpay webhook failed:', err.message);
    return res.status(500).json({ success: false });
  }
};
