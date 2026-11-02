const catchAsync = require('../helpers/catchAsync');
const ApiError = require('../helpers/ApiError');
const { record } = require('../helpers/audit');
const wa = require('../helpers/openwa');

/** What the panel shows: set up or not, and the session's state. */
const shape = (s) =>
  s
    ? {
        configured: true,
        status: s.status, // created · initializing · qr_ready · authenticating · ready · disconnected · failed
        connected: s.status === 'ready',
        phone: s.phone || null,
        name: s.pushName || null,
        connectedAt: s.connectedAt || null,
      }
    : { configured: true, status: 'not_connected', connected: false };

exports.status = catchAsync(async (req, res) => {
  if (!wa.configured()) return res.json({ success: true, data: { configured: false, status: 'not_set_up', connected: false } });
  try {
    res.json({ success: true, data: shape(await wa.findSession()) });
  } catch (err) {
    res.json({ success: true, data: { configured: true, status: 'gateway_down', connected: false, message: err.message } });
  }
});

/** Connect: make the session if needed and start it, so a QR code comes up. */
exports.connect = catchAsync(async (req, res) => {
  const session = await wa.ensureSession();
  if (!['ready', 'qr_ready', 'initializing', 'authenticating'].includes(session.status)) {
    await wa.call(`/sessions/${session.id}/start`, { method: 'POST' }).catch((err) => {
      // Already starting is fine.
      if (err.statusCode !== 409) throw err;
    });
  }
  await record(req, 'update', 'WhatsApp', session.id, 'Started connecting the WhatsApp number');
  res.json({ success: true, data: shape(await wa.findSession()) });
});

/** The QR code to scan, while there is one. */
exports.qr = catchAsync(async (req, res) => {
  const session = await wa.findSession();
  if (!session) throw ApiError.notFound('Press Connect first');
  if (session.status !== 'qr_ready') return res.json({ success: true, data: { ...shape(session), qrCode: null } });
  const q = await wa.call(`/sessions/${session.id}/qr`).catch(() => null);
  res.json({ success: true, data: { ...shape(session), qrCode: q?.qrCode || null } });
});

/** Unlink the number from this desk. */
exports.disconnect = catchAsync(async (req, res) => {
  const session = await wa.findSession();
  if (session) {
    await wa.call(`/sessions/${session.id}/logout`, { method: 'POST' }).catch(() => {});
    await wa.call(`/sessions/${session.id}/stop`, { method: 'POST' }).catch(() => {});
  }
  await record(req, 'update', 'WhatsApp', session?.id || '-', 'Disconnected the WhatsApp number');
  res.json({ success: true, data: shape(await wa.findSession()) });
});

async function readySession() {
  const session = await wa.findSession();
  if (!session || session.status !== 'ready') throw new ApiError(409, 'WhatsApp is not connected — open WhatsApp → Connect and scan the QR code');
  return session;
}

/** One message to one number. */
exports.send = catchAsync(async (req, res) => {
  const { phone, text } = req.body || {};
  if (!phone || !String(text || '').trim()) throw ApiError.badRequest('A phone number and a message are both needed');
  const session = await readySession();
  const sent = await wa.call(`/sessions/${session.id}/messages/send-text`, {
    method: 'POST',
    body: { chatId: wa.chatIdFor(phone), text: String(text).slice(0, 4096) },
  });
  await record(req, 'create', 'WhatsApp', phone, `WhatsApp sent to ${phone}`);
  res.status(201).json({ success: true, data: { id: sent?.id || sent?.messageId || null } });
});

/**
 * One message to many numbers. Sent one by one, a few seconds apart, after
 * the reply — firing hundreds at once is the quickest way to get a number
 * banned. {name} in the text becomes each person's name.
 */
exports.sendMany = catchAsync(async (req, res) => {
  const { recipients = [], text } = req.body || {};
  const list = (Array.isArray(recipients) ? recipients : []).filter((r) => r && r.phone);
  if (!list.length) throw ApiError.badRequest('Pick at least one number');
  if (!String(text || '').trim()) throw ApiError.badRequest('Write the message first');
  if (list.length > 1000) throw ApiError.badRequest('Send to at most 1000 people at a time');
  const session = await readySession();

  res.status(202).json({ success: true, data: { queued: list.length } });

  let ok = 0;
  let failed = 0;
  for (const r of list) {
    try {
      const body = String(text).replace(/\{name\}/gi, String(r.name || '').split(' ')[0] || 'there').slice(0, 4096);
      await wa.call(`/sessions/${session.id}/messages/send-text`, { method: 'POST', body: { chatId: wa.chatIdFor(r.phone), text: body } });
      ok += 1;
    } catch {
      failed += 1;
    }
    await new Promise((done) => setTimeout(done, 3000 + Math.random() * 3000));
  }
  await record(req, 'create', 'WhatsApp', `${list.length} numbers`, `Bulk WhatsApp: ${ok} sent, ${failed} failed`).catch(() => {});
});
