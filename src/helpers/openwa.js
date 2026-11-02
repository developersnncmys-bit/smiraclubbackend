/**
 * OpenWA — the WhatsApp gateway the desk's own number sends through.
 *
 * OpenWA runs beside the API (OPENWA_URL) and holds one WhatsApp Web session,
 * linked by scanning a QR code with the desk phone. The panel never talks to
 * it directly: its key would be in every browser. Everything goes through
 * these few calls instead.
 */
const ApiError = require('./ApiError');

const BASE = () => (process.env.OPENWA_URL || 'http://localhost:2785').replace(/\/+$/, '');
const KEY = () => process.env.OPENWA_API_KEY || '';
/** The one session the desk uses, by name. */
const SESSION_NAME = () => process.env.OPENWA_SESSION || 'smira-desk';

const configured = () => Boolean(KEY());

async function call(path, { method = 'GET', body } = {}) {
  if (!configured()) throw new ApiError(503, 'WhatsApp gateway is not set up — add OPENWA_URL and OPENWA_API_KEY to the server');
  let res;
  try {
    res = await fetch(`${BASE()}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY() },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new ApiError(503, 'The WhatsApp gateway is not running or cannot be reached');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(json.message) ? json.message.join(', ') : json.message;
    throw new ApiError([404, 409].includes(res.status) ? res.status : 502, message || `WhatsApp gateway said ${res.status}`);
  }
  return json.data !== undefined ? json.data : json;
}

/** The desk's session, or null if it was never made. */
async function findSession() {
  const list = await call('/sessions');
  const rows = Array.isArray(list) ? list : list.rows || list.items || [];
  return rows.find((s) => s.name === SESSION_NAME()) || null;
}

/** The desk's session, made if missing. */
async function ensureSession() {
  return (await findSession()) || call('/sessions', { method: 'POST', body: { name: SESSION_NAME() } });
}

/** 9035300961, +91 90353 00961, 919035300961 → 919035300961@c.us */
function chatIdFor(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  if (d.length < 11) throw ApiError.badRequest(`"${phone}" is not a full mobile number`);
  return `${d}@c.us`;
}

module.exports = { call, configured, findSession, ensureSession, chatIdFor, SESSION_NAME };
