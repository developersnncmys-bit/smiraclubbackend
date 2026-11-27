/**
 * Facebook and Instagram lead forms (Meta Lead Ads), straight into Sales & Leads.
 *
 * Meta calls this when somebody submits a lead form on an ad. The call only
 * carries the lead's id; the answers are read from the Graph API with the
 * page's token. The lead gets source Facebook Ads or Instagram and the
 * campaign / ad name, and a number that already has a lead is not added twice.
 *
 * Settings (.env):
 *   META_VERIFY_TOKEN   any word you choose — typed into Meta when adding the webhook
 *   META_APP_SECRET     the Meta app's secret, to check each call really is Meta
 *   META_PAGE_TOKEN     a long-lived Page access token with leads_retrieval
 */
const crypto = require('crypto');
const Lead = require('../models/Lead');

const GRAPH = 'https://graph.facebook.com/v21.0';
const env = (k) => String(process.env[k] || '').trim();
const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const byNumber = (ten) => ({ phone: new RegExp(`${ten.split('').join('\\D*')}$`) });
const clip = (v, n = 80) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Meta checks the address once, when the webhook is added. */
exports.verify = (req, res) => {
  const token = env('META_VERIFY_TOKEN');
  if (token && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token) {
    return res.status(200).send(String(req.query['hub.challenge'] || ''));
  }
  return res.sendStatus(403);
};

function signedByMeta(req) {
  const secret = env('META_APP_SECRET');
  const sig = String(req.get('x-hub-signature-256') || '');
  if (!secret || !sig.startsWith('sha256=') || !Buffer.isBuffer(req.body)) return false;
  const want = `sha256=${crypto.createHmac('sha256', secret).update(req.body).digest('hex')}`;
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

async function graph(path) {
  const res = await fetch(`${GRAPH}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(env('META_PAGE_TOKEN'))}`, {
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Meta said ${res.status}`);
  return json;
}

/** One submitted form → a lead (or a note on the lead the number already has). */
async function takeLead(leadgenId) {
  const g = await graph(`${leadgenId}?fields=created_time,field_data,ad_name,adset_name,campaign_name,form_id,platform,is_organic`);
  const answers = {};
  (g.field_data || []).forEach((f) => { answers[String(f.name || '').toLowerCase()] = (f.values || []).join(', '); });
  const get = (...keys) => keys.map((k) => Object.entries(answers).find(([q]) => q.includes(k))?.[1]).find(Boolean);

  const phone = get('phone', 'mobile', 'whatsapp');
  const ten = tenDigits(phone);
  if (ten.length !== 10) {
    console.warn(`Meta lead ${leadgenId} has no usable phone number — skipped`);
    return null;
  }
  const source = String(g.platform || '').toLowerCase() === 'ig' ? 'Instagram' : 'Facebook Ads';
  const campaign = clip(g.campaign_name || g.ad_name || g.adset_name || `Lead form ${g.form_id || ''}`);
  const lines = Object.entries(answers).map(([q, v]) => `${q.replace(/_/g, ' ')}: ${v}`);
  const note = `Source: ${source} lead form · ${campaign}${g.ad_name ? ` · ad "${g.ad_name}"` : ''}${g.is_organic ? ' (organic)' : ''}`;

  const existing = await Lead.findOne(byNumber(ten)).sort({ createdAt: -1 }).select('_id').lean();
  if (existing) {
    await Lead.updateOne(
      { _id: existing._id },
      { $push: { activities: { kind: 'note', text: `Filled a ${source} form again — ${note}\n${lines.join('\n')}`, byName: 'Meta' } } }
    );
    return existing._id;
  }

  const email = get('email');
  const lead = await Lead.create({
    name: clip(get('full_name', 'name') || `Meta lead ${ten}`),
    phone: `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`,
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim()) ? String(email).trim().toLowerCase() : undefined,
    destination: clip(get('destination', 'where', 'place')) || undefined,
    source,
    campaign,
    status: 'New',
    score: 'Hot',
    priority: 'High',
    notes: `${note}\n${lines.join('\n')}`,
    activities: [{ kind: 'note', text: `${note}\n${lines.join('\n')}`, byName: 'Meta', at: g.created_time ? new Date(g.created_time) : new Date() }],
  });
  require('../helpers/notify').welcome(lead).catch(() => {});
  return lead._id;
}

/** Meta's calls: answer at once, then read each lead. */
exports.receive = async (req, res) => {
  if (!signedByMeta(req)) return res.sendStatus(401);
  res.sendStatus(200);
  let body;
  try {
    body = JSON.parse(req.body.toString('utf8'));
  } catch {
    return;
  }
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen' || !change.value?.leadgen_id) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await takeLead(change.value.leadgen_id);
      } catch (err) {
        console.error('Meta lead', change.value.leadgen_id, err.message);
      }
    }
  }
};

/** For the panel: is it set up? */
exports.status = (req, res) => {
  res.json({
    success: true,
    data: {
      verifyToken: Boolean(env('META_VERIFY_TOKEN')),
      appSecret: Boolean(env('META_APP_SECRET')),
      pageToken: Boolean(env('META_PAGE_TOKEN')),
      webhookUrl: `${req.protocol}://${req.get('host')}/api/meta/webhook`,
    },
  });
};
