const crypto = require('crypto');

/**
 * Razorpay, called over its REST API — no SDK needed.
 *
 * The keys live only in the server's .env:
 *   RAZORPAY_KEY_ID          rzp_live_… (also sent to the website, it is public)
 *   RAZORPAY_KEY_SECRET      never leaves this server
 *   RAZORPAY_WEBHOOK_SECRET  the secret typed in Razorpay → Webhooks
 */
const API = 'https://api.razorpay.com/v1';

const keyId = () => (process.env.RAZORPAY_KEY_ID || '').trim();
const keySecret = () => (process.env.RAZORPAY_KEY_SECRET || '').trim();
const webhookSecret = () => (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();

const configured = () => Boolean(keyId() && keySecret());

async function call(path, { method = 'GET', body } = {}) {
  const auth = Buffer.from(`${keyId()}:${keySecret()}`).toString('base64');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.description || `Razorpay answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** An order for this many rupees. Razorpay counts in paise. */
const createOrder = ({ rupees, receipt, notes }) =>
  call('/orders', {
    method: 'POST',
    body: {
      amount: Math.round(Number(rupees) * 100),
      currency: 'INR',
      receipt: String(receipt || '').slice(0, 40),
      payment_capture: 1,
      notes: notes || {},
    },
  });

const fetchPayment = (id) => call(`/payments/${encodeURIComponent(id)}`);

const capture = (id, paise) =>
  call(`/payments/${encodeURIComponent(id)}/capture`, { method: 'POST', body: { amount: paise, currency: 'INR' } });

const same = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** The signature Checkout hands back: HMAC(order_id|payment_id, key secret). */
const checkoutSignatureOk = (orderId, paymentId, signature) =>
  same(crypto.createHmac('sha256', keySecret()).update(`${orderId}|${paymentId}`).digest('hex'), signature);

/** The webhook's X-Razorpay-Signature over the raw body. */
const webhookSignatureOk = (raw, signature) =>
  Boolean(webhookSecret()) &&
  same(crypto.createHmac('sha256', webhookSecret()).update(raw).digest('hex'), signature);

module.exports = {
  keyId,
  configured,
  createOrder,
  fetchPayment,
  capture,
  checkoutSignatureOk,
  webhookSignatureOk,
};
