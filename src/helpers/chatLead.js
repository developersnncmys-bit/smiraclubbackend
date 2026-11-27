/**
 * Every WhatsApp chat where the customer has written is a lead in Sales &
 * Leads. A number that already has a lead is linked to it — never a second
 * lead for the same number. Creating the lead sends nothing to the customer.
 *
 * The lead's source is where they came from — a Facebook or Instagram ad, the
 * website, a form, a QR code — read by helpers/leadSource.js, not simply
 * "WhatsApp".
 */
const leadSource = require('./leadSource');

const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const byNumber = (ten) => ({ phone: new RegExp(`${ten.split('').join('\\D*')}$`) });
const looksLikeNumber = (s) => !s || /^\+?[\d\s-]+$/.test(s);

/** The lead fields a source (and any form answers in it) fills. */
function fieldsFor(origin, conversation) {
  const f = origin.fields || {};
  const name = String(conversation.name || '').trim();
  return {
    name: f.name || (!looksLikeNumber(name) ? name : undefined),
    source: origin.source,
    ...(origin.campaign ? { campaign: origin.campaign } : {}),
    ...(f.email ? { email: f.email } : {}),
    ...(f.pax ? { pax: f.pax } : {}),
    ...(f.travelDate ? { travelDate: f.travelDate } : {}),
    ...(f.trip && Object.keys(f.trip).length ? { trip: f.trip } : {}),
  };
}

const sourceNote = (o) =>
  `Source: ${o.source}${o.campaign ? ` · ${o.campaign}` : ''} (${o.how || 'WhatsApp'})${o.adId ? ` · ad ${o.adId}` : ''}${o.url ? ` · ${o.url}` : ''}`;

/**
 * Link this conversation (a Mongoose document) to its lead, making one if the
 * number has none. Saves the conversation when it changes. Returns the lead id.
 */
async function ensureLead(conversation) {
  if (!conversation || conversation.lead) return conversation?.lead || null;
  const ten = tenDigits(conversation.phone);
  if (ten.length !== 10) return null;
  const fromThem = (conversation.messages || []).filter((m) => m.from === 'them');
  if (!fromThem.length) return null; // only our own messages so far: not an enquiry

  const Lead = require('../models/Lead');
  const origin = leadSource.forConversation(conversation);
  const first = fromThem[0];
  let lead = await Lead.findOne(byNumber(ten)).sort({ createdAt: -1 }).select('_id').lean();
  if (!lead) {
    const f = fieldsFor(origin, conversation);
    lead = await Lead.create({
      ...f,
      name: f.name || `WhatsApp ${ten}`,
      phone: conversation.phone,
      status: 'New',
      score: conversation.score || 'Warm',
      owner: conversation.owner || undefined,
      lastContactAt: first.at || new Date(),
      notes: `${sourceNote(origin)}\nFirst WhatsApp message: ${String(first.text || '').slice(0, 1500)}`,
      activities: [
        { kind: 'whatsapp', text: `Came in on WhatsApp: ${String(first.text || '').slice(0, 500)}`, byName: 'WhatsApp', at: first.at || new Date() },
        { kind: 'note', text: sourceNote(origin), byName: 'WhatsApp', at: first.at || new Date() },
      ],
    });
  } else if (origin.source !== 'WhatsApp') {
    // Already a lead (from calling data, say) and now back through an ad or a form: note it.
    await Lead.updateOne(
      { _id: lead._id },
      { $push: { activities: { kind: 'whatsapp', text: `Wrote in on WhatsApp again — ${sourceNote(origin)}`, byName: 'WhatsApp' } } }
    );
  }
  conversation.lead = lead._id;
  if (!conversation.source || conversation.source === 'WhatsApp') conversation.source = origin.source;
  await conversation.save();
  return lead._id;
}

/**
 * Leads this module already made as plain "WhatsApp": read their first
 * message again and give them their real source. Only those leads — never
 * one somebody created or re-sourced by hand.
 */
async function resourceOld() {
  const Lead = require('../models/Lead');
  const Conversation = require('../models/Conversation');
  const leads = await Lead.find({ source: 'WhatsApp', 'activities.byName': 'WhatsApp', 'activities.text': /^Came in on WhatsApp/ })
    .select('_id name email pax travelDate trip campaign activities.text')
    .lean();
  let n = 0;
  for (const l of leads) {
    if ((l.activities || []).some((a) => /^Source: /.test(a.text || ''))) continue; // already looked at
    const c = await Conversation.findOne({ lead: l._id }).select('name phone origin messages.from messages.text').lean();
    if (!c) continue;
    const origin = leadSource.forConversation(c);
    const f = fieldsFor(origin, c);
    const set = { source: origin.source };
    if (origin.campaign && !l.campaign) set.campaign = origin.campaign;
    if (f.email && !l.email) set.email = f.email;
    if (f.pax && !(l.pax > 1)) set.pax = f.pax;
    if (f.travelDate && !l.travelDate) set.travelDate = f.travelDate;
    if (f.name && /^WhatsApp \d+$/.test(l.name || '')) set.name = f.name;
    if (f.trip) Object.entries(f.trip).forEach(([k, v]) => { if (l.trip?.[k] == null) set[`trip.${k}`] = v; });
    await Lead.updateOne({ _id: l._id }, { $set: set, $push: { activities: { kind: 'note', text: sourceNote(origin), byName: 'WhatsApp' } } });
    if (origin.source !== 'WhatsApp') n += 1;
  }
  if (n) console.log(`WhatsApp leads: ${n} given their real source`);
  return n;
}

/**
 * Once at start-up: every chat already in the inbox without a lead gets one
 * (or is linked to the lead it already has), and leads made before sources
 * were read get theirs. Nothing is deleted.
 */
async function linkAllChats() {
  const Conversation = require('../models/Conversation');
  const list = await Conversation.find({ lead: null, 'messages.from': 'them' });
  let n = 0;
  for (const c of list) {
    try {
      if (await ensureLead(c)) n += 1;
    } catch (err) {
      console.error('WhatsApp lead for', c.phone, err.message);
    }
  }
  if (n) console.log(`WhatsApp: ${n} chat(s) linked to a lead`);
  await resourceOld().catch((e) => console.error('WhatsApp lead sources:', e.message));
  return n;
}

module.exports = { ensureLead, linkAllChats };
