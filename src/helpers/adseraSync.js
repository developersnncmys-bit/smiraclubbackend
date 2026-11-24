/**
 * Brings WhatsApp chats from AdsEra into the CRM inbox.
 *
 * The webhook delivers each new message as it happens; this is the other
 * half: it reads the contacts AdsEra has touched since the last look and
 * copies their messages into Conversations, so chats that came in before
 * the webhook was set up (or while it was down) are not missing. Each chat
 * is linked to the lead with the same number. Nothing is ever deleted.
 */
const adsera = require('./adsera');

const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const byNumber = (ten) => ({ phone: new RegExp(`${ten.split('').join('\\D*')}$`) });
const pretty = (ten) => `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;

let lastRun = 0;
let running = false;

async function chatFor(contact) {
  const Conversation = require('../models/Conversation');
  const Lead = require('../models/Lead');
  const Customer = require('../models/Customer');
  const ten = tenDigits(contact.phone);
  if (ten.length !== 10) return null;

  let c = await Conversation.findOne(byNumber(ten)).sort({ lastMessageAt: -1 });
  if (!c) {
    const [lead, customer] = await Promise.all([
      Lead.findOne(byNumber(ten)).sort({ createdAt: -1 }).select('_id name').lean(),
      Customer.findOne(byNumber(ten)).select('_id name').lean(),
    ]);
    c = new Conversation({
      phone: pretty(ten),
      name: contact.attributes?.FIRSTNAME || lead?.name || customer?.name || pretty(ten),
      source: 'WhatsApp',
      handledBy: 'Staff',
      lead: lead?._id,
      customer: customer?._id,
    });
  } else if (!c.lead) {
    const lead = await Lead.findOne(byNumber(ten)).sort({ createdAt: -1 }).select('_id').lean();
    if (lead) c.lead = lead._id;
  }
  return c;
}

/** Copy one contact's recent messages into their CRM chat. Returns how many were added. */
async function syncContact(contact, accountId) {
  const digits = String(contact.phone || '').replace(/\D/g, '');
  if (digits.length < 11) return 0;
  const res = await adsera.call(`/api/pub/wa/messages?phone=${digits}&whatsapp=${accountId}&limit=50`);
  const messages = (res.data?.messages || []).slice().reverse(); // oldest first
  if (!messages.length) return 0;

  const c = await chatFor(contact);
  if (!c) return 0;
  const have = new Set((c.messages || []).map((m) => m.waId).filter(Boolean));
  let added = 0;
  let unread = 0;
  for (const m of messages) {
    if (!m.messageId || have.has(m.messageId)) continue;
    const at = m.at ? new Date(m.at) : new Date();
    // AdsEra shows a template as `[Template "name"] text`: keep the text,
    // and the name on its own.
    const raw = String(m.preview || `[${m.type || 'message'}]`);
    const tpl = raw.match(/^\[Template "([^"]*)"\]\s*/);
    const text = (tpl ? raw.slice(tpl[0].length) : raw).slice(0, 4096);
    const inbound = m.direction === 'inbound';
    // A message the CRM itself sent is already on the thread (without an id).
    if (!inbound) {
      const dup = (c.messages || []).find(
        (x) => x.from !== 'them' && !x.waId && x.text && x.text.slice(0, 60) === text.slice(0, 60) && Math.abs(new Date(x.at) - at) < 10 * 60 * 1000
      );
      if (dup) {
        dup.waId = m.messageId;
        continue;
      }
    }
    c.messages.push({ from: inbound ? 'them' : m.sentBy === 'AI' ? 'bot' : 'me', text, at, waId: m.messageId, ...(tpl ? { templateName: tpl[1] } : {}) });
    have.add(m.messageId);
    added += 1;
    if (inbound) unread += 1;
  }
  if (!added && !c.isNew) {
    if (c.isModified()) await c.save();
    return 0;
  }
  c.messages.sort((a, b) => new Date(a.at) - new Date(b.at));
  const last = c.messages[c.messages.length - 1];
  c.lastMessageAt = last?.at || new Date();
  // Unread only while the customer had the last word.
  c.unread = last?.from === 'them' ? (c.unread || 0) + unread : 0;
  await c.save();
  // A lead in Sales & Leads for this number (the existing one, or a new one).
  await require('./chatLead').ensureLead(c);
  return added;
}

/**
 * Contacts AdsEra changed since `since` (a Date), and their messages.
 * Returns { contacts, messages } counts.
 */
async function importChats({ since } = {}) {
  if (!adsera.configured() || running) return { contacts: 0, messages: 0, skipped: running };
  running = true;
  const started = Date.now();
  try {
    const acc = await adsera.account();
    if (!acc) return { contacts: 0, messages: 0 };
    const from = since || new Date(Date.now() - 30 * 86400000);
    let page = 1;
    let contacts = 0;
    let messages = 0;
    for (;;) {
      const res = await adsera.call(
        `/api/pub/crm/contacts?perPage=100&page=${page}&updatedSince=${encodeURIComponent(from.toISOString())}`
      );
      const items = res.data?.items || [];
      for (const contact of items) {
        try {
          messages += await syncContact(contact, acc._id);
          contacts += 1;
        } catch (err) {
          if (/429|Too many/i.test(err.message)) throw err;
        }
      }
      const total = Number(res.data?.total || 0);
      if (!items.length || page * 100 >= total || page >= 20) break;
      page += 1;
    }
    lastRun = started;
    return { contacts, messages };
  } finally {
    running = false;
  }
}

/** The every-few-minutes backup for the webhook: only what changed since last time. */
async function syncRecent() {
  const since = lastRun ? new Date(lastRun - 5 * 60 * 1000) : new Date(Date.now() - 3 * 86400000);
  const r = await importChats({ since });
  if (r.messages) console.log(`WhatsApp sync: ${r.messages} new message(s) from ${r.contacts} chat(s)`);
  return r;
}

module.exports = { importChats, syncRecent, syncContact };
