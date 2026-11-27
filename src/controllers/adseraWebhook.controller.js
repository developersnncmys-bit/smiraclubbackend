const crypto = require('crypto');
const Conversation = require('../models/Conversation');
const Customer = require('../models/Customer');

/**
 * POST /api/adsera/webhook — AdsEra's events, set up in AdsEra under
 * Settings → Webhooks with the secret in ADSERA_WEBHOOK_SECRET (x-secret).
 *
 * A customer's message lands in the CRM's WhatsApp inbox: their thread is
 * found by number (or started), the message added and counted unread.
 * AdsEra does not retry and may repeat an event, so it answers at once and
 * skips a message it already has.
 */
const same = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const pretty = (digits) => `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
const byNumber = (ten) => ({ phone: new RegExp(`${ten.split('').join('\\D*')}$`) });

/** What to show for a message that is not plain text. */
function textOf(d) {
  if (d.text?.body) return d.text.body;
  if (d.preview) return d.preview;
  const caption = d[d.type]?.caption;
  return `[${d.type || 'message'}]${caption ? ` ${caption}` : ''}`;
}

async function inbound(d) {
  const ten = tenDigits(d.contact);
  if (ten.length !== 10) return;

  let conversation = await Conversation.findOne(byNumber(ten)).sort({ lastMessageAt: -1 });
  if (d.messageId && conversation?.messages?.some((m) => m.waId === d.messageId)) return; // already have it

  if (!conversation) {
    const Lead = require('../models/Lead');
    const [customer, lead] = await Promise.all([
      Customer.findOne(byNumber(ten)).select('_id name').lean(),
      Lead.findOne(byNumber(ten)).sort({ createdAt: -1 }).select('_id name').lean(),
    ]);
    conversation = await Conversation.create({
      phone: pretty(ten),
      name: customer?.name || d.name || lead?.name || pretty(ten),
      customer: customer?._id,
      lead: lead?._id,
      source: 'WhatsApp',
      handledBy: 'Staff',
    });
  }

  // Came from a Facebook or Instagram ad? Meta puts the ad on the first message.
  const ref = require('../helpers/leadSource').referralOf(d);
  if (ref && !conversation.origin?.source) conversation.origin = ref;

  const at = d.timestamp ? new Date(d.timestamp) : new Date();
  conversation.messages.push({ from: 'them', text: textOf(d).slice(0, 4096), at, waId: d.messageId });
  conversation.lastMessageAt = at;
  conversation.unread = (conversation.unread || 0) + 1;
  await conversation.save();
  // A lead in Sales & Leads for this number (the existing one, or a new one).
  await require('../helpers/chatLead').ensureLead(conversation);
  // "STOP" ends their 6-day follow-up.
  await require('../helpers/followupDrip').stopIfAsked(ten, textOf(d));
}

exports.receive = async (req, res) => {
  const secret = (process.env.ADSERA_WEBHOOK_SECRET || '').trim();
  if (!secret || !same(req.get('x-secret'), secret)) return res.sendStatus(401);
  res.sendStatus(200); // answer within AdsEra's 5 seconds, then do the work

  const { event, data } = req.body || {};
  // The last few deliveries, as sent, so what AdsEra includes (ad details and
  // all) can be checked from the panel's settings without guessing.
  require('../models/Setting')
    .findOneAndUpdate(
      { key: 'adseraWebhookSamples' },
      { $push: { value: { $each: [{ at: new Date(), body: req.body }], $slice: -15 } } },
      { upsert: true }
    )
    .catch(() => {});
  try {
    if (event === 'message.new' && data && data.direction !== 'outbound') await inbound(data);
  } catch (err) {
    console.error('AdsEra webhook:', err.message);
  }
};
