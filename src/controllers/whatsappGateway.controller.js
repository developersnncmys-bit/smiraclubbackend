const catchAsync = require('../helpers/catchAsync');
const ApiError = require('../helpers/ApiError');
const { record } = require('../helpers/audit');
const adsera = require('../helpers/adsera');

/**
 * The desk's WhatsApp number, through AdsEra (the official WhatsApp API).
 *
 * There is no QR code any more: the number is connected inside AdsEra, and
 * this only reports which number that is and sends through it. Connect and
 * Disconnect are kept so an older panel does not break, and say so.
 */
const shape = (a) =>
  a
    ? {
        configured: true,
        provider: 'AdsEra',
        status: a.status === 'connected' ? 'ready' : a.status || 'disconnected',
        connected: a.status === 'connected',
        phone: String(a.phone || '').replace(/\D/g, '') || null,
        name: a.name || null,
        quality: a.quality_rating || null,
        tier: a.messaging_limit || a.tier || null,
      }
    : { configured: true, provider: 'AdsEra', status: 'not_connected', connected: false };

exports.status = catchAsync(async (req, res) => {
  if (!adsera.configured()) return res.json({ success: true, data: { configured: false, provider: 'AdsEra', status: 'not_set_up', connected: false } });
  try {
    res.json({ success: true, data: shape(await adsera.account({ fresh: true })) });
  } catch (err) {
    res.json({ success: true, data: { configured: true, provider: 'AdsEra', status: 'gateway_down', connected: false, message: err.message } });
  }
});

/** Nothing to scan: the number is connected in AdsEra. */
exports.connect = catchAsync(async (req, res) => {
  res.json({ success: true, data: shape(await adsera.account({ fresh: true })) });
});

exports.qr = catchAsync(async (req, res) => {
  res.json({ success: true, data: { ...shape(await adsera.account({ fresh: true })), qrCode: null } });
});

exports.disconnect = catchAsync(async () => {
  throw ApiError.badRequest('The WhatsApp number is managed in AdsEra — disconnect it there (app.adsera.in)');
});

/** POST /whatsapp/gateway/import { days } — bring existing AdsEra chats into the inbox. */
exports.importChats = catchAsync(async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.body?.days) || 30));
  const r = await require('../helpers/adseraSync').importChats({ since: new Date(Date.now() - days * 86400000) });
  if (r.skipped) return res.json({ success: true, message: 'An import is already running — try again in a minute', data: r });
  await record(req, 'update', 'WhatsApp', '-', `Imported ${r.messages} WhatsApp message(s) from ${r.contacts} chat(s)`);
  res.json({ success: true, message: `${r.messages} message(s) from ${r.contacts} chat(s) brought in`, data: r });
});

/** Approved templates, for messages to people who have not written in 24 hours. */
exports.templates = catchAsync(async (req, res) => {
  res.json({ success: true, data: await adsera.templates() });
});

/** One message to one number. */
exports.send = catchAsync(async (req, res) => {
  const { phone, text } = req.body || {};
  if (!phone || !String(text || '').trim()) throw ApiError.badRequest('A phone number and a message are both needed');
  const sent = await adsera.sendText(phone, text);
  await record(req, 'create', 'WhatsApp', phone, `WhatsApp sent to ${phone}`);
  res.status(201).json({ success: true, data: { id: sent?.data?._id || sent?.message?._id || null } });
});

/** One approved template to one number: { phone, template, vars }. */
exports.sendTemplate = catchAsync(async (req, res) => {
  const { phone, template, vars } = req.body || {};
  if (!phone || !template) throw ApiError.badRequest('A phone number and a template are both needed');
  await adsera.sendTemplate(template, phone, vars && typeof vars === 'object' ? vars : {});
  await record(req, 'create', 'WhatsApp', phone, `WhatsApp template sent to ${phone}`);
  res.status(201).json({ success: true, data: { sent: true } });
});

/**
 * One message to many numbers, paced after the reply. {name} in the text
 * becomes each person's name. With a template, it goes to everybody; plain
 * text only reaches those who wrote in the last 24 hours.
 */
exports.sendMany = catchAsync(async (req, res) => {
  const { recipients = [], text, template, vars } = req.body || {};
  const list = (Array.isArray(recipients) ? recipients : []).filter((r) => r && r.phone);
  if (!list.length) throw ApiError.badRequest('Pick at least one number');
  if (!template && !String(text || '').trim()) throw ApiError.badRequest('Write the message first');
  if (list.length > 1000) throw ApiError.badRequest('Send to at most 1000 people at a time');
  if (!adsera.configured()) throw new ApiError(503, 'WhatsApp is not set up on the server');

  res.status(202).json({ success: true, data: { queued: list.length } });

  let ok = 0;
  let failed = 0;
  for (const r of list) {
    const first = String(r.name || '').split(' ')[0] || 'there';
    try {
      if (template) {
        const filled = Object.fromEntries(
          Object.entries(vars || {}).map(([k, v]) => [k, String(v).replace(/\{name\}/gi, first)])
        );
        await adsera.sendTemplate(template, r.phone, filled);
      } else {
        await adsera.sendText(r.phone, String(text).replace(/\{name\}/gi, first));
      }
      ok += 1;
    } catch {
      failed += 1;
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  await record(req, 'create', 'WhatsApp', `${list.length} numbers`, `Bulk WhatsApp: ${ok} sent, ${failed} failed`).catch(() => {});
});
