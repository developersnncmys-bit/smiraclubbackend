/**
 * AdsEra — the official WhatsApp Business API the desk sends through.
 *
 * Docs: https://docs.adsera.in/api-reference/introduction
 * The keys live only in the server's .env:
 *   ADSERA_API_KEY          App Id      (Settings → API Keys)
 *   ADSERA_API_SECRET       App Secret
 *   ADSERA_WHATSAPP_ID      optional — the WhatsApp account's _id; the first
 *                           connected account is used when it is not set
 *   ADSERA_WEBHOOK_SECRET   the secret typed in Settings → Webhooks (x-secret)
 *
 * A free-text message only reaches somebody who has written to us in the last
 * 24 hours; anybody else needs an approved template (sendTemplate).
 */
const ApiError = require('./ApiError');

const BASE = () => (process.env.ADSERA_URL || 'https://app.adsera.in').replace(/\/+$/, '');
const KEY = () => (process.env.ADSERA_API_KEY || '').trim();
const SECRET = () => (process.env.ADSERA_API_SECRET || '').trim();

const configured = () => Boolean(KEY() && SECRET());

async function call(path, { method = 'GET', body } = {}) {
  if (!configured()) throw new ApiError(503, 'WhatsApp is not set up — add ADSERA_API_KEY and ADSERA_API_SECRET to the server');
  let res;
  try {
    res = await fetch(`${BASE()}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY(), 'x-api-secret': SECRET() },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new ApiError(503, 'AdsEra could not be reached — try again in a moment');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const raw = json.error || json.msg || json.message;
    const message = typeof raw === 'string' && raw ? raw : `AdsEra said ${res.status}`;
    throw new ApiError(res.status === 404 ? 404 : res.status === 401 ? 502 : 400, message);
  }
  return json;
}

/** The connected WhatsApp account (cached for 5 minutes). */
let cached = null;
async function account({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value;
  const json = await call('/api/pub/wa/waba/list');
  const list = Array.isArray(json.accounts) ? json.accounts : [];
  const wanted = (process.env.ADSERA_WHATSAPP_ID || '').trim();
  const value = (wanted && list.find((a) => a._id === wanted)) || list.find((a) => a.status === 'connected') || list[0] || null;
  cached = { at: Date.now(), value };
  return value;
}

/** 9035300961, +91 90353 00961, 919035300961 → +919035300961 */
function e164(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  if (d.length < 11) throw ApiError.badRequest(`"${phone}" is not a full mobile number`);
  return `+${d}`;
}

async function sendText(phone, text) {
  const acc = await account();
  if (!acc) throw new ApiError(409, 'No WhatsApp number is connected in AdsEra');
  return call('/api/pub/wa/send/msg', {
    method: 'POST',
    body: {
      whatsapp: acc._id,
      phone: e164(phone),
      msg: { messageType: 'text', text: { body: String(text).slice(0, 4096), preview_url: false } },
    },
  });
}

/** An approved template, by its AdsEra _id, with its {{variables}} filled in. */
async function sendTemplate(template, phone, vars = {}) {
  const acc = await account().catch(() => null);
  return call('/api/pub/wa/send/template', {
    method: 'POST',
    body: { template, ...(acc ? { whatsapp: acc._id } : {}), phone: e164(phone), dynamicData: vars },
  });
}

/** The variable names a template's body and header use, e.g. ['customer_name'] or ['1','2']. */
function templateParams(t) {
  const names = new Set();
  for (const c of t.components || []) {
    for (const p of c.example?.body_text_named_params || []) names.add(p.param_name);
    for (const p of c.example?.header_text_named_params || []) names.add(p.param_name);
    for (const m of String(c.text || '').matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) names.add(m[1]);
  }
  return [...names];
}

/** Approved templates, in the shape the panel needs. */
async function templates() {
  const json = await call('/api/pub/wa/template/all/list?page=1&perPage=100');
  return (json.templates || [])
    .filter((t) => t.status === 'APPROVED')
    .map((t) => ({
      id: t._id,
      name: t.name,
      category: t.category,
      language: t.language,
      body: (t.components || []).find((c) => c.type === 'BODY')?.text || '',
      params: templateParams(t),
    }));
}

module.exports = { configured, call, account, e164, sendText, sendTemplate, templates };
