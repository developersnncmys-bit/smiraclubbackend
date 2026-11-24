/**
 * Every WhatsApp chat where the customer has written is a lead in Sales &
 * Leads. A number that already has a lead is linked to it — never a second
 * lead for the same number. Creating the lead sends nothing to the customer.
 */
const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const byNumber = (ten) => ({ phone: new RegExp(`${ten.split('').join('\\D*')}$`) });

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
  let lead = await Lead.findOne(byNumber(ten)).sort({ createdAt: -1 }).select('_id').lean();
  if (!lead) {
    const name = String(conversation.name || '').trim();
    const first = fromThem[0];
    lead = await Lead.create({
      name: name && !/^\+?[\d\s-]+$/.test(name) ? name : `WhatsApp ${ten}`,
      phone: conversation.phone,
      source: 'WhatsApp',
      status: 'New',
      score: conversation.score || 'Warm',
      owner: conversation.owner || undefined,
      lastContactAt: first.at || new Date(),
      notes: `First WhatsApp message: ${String(first.text || '').slice(0, 500)}`,
      activities: [
        { kind: 'whatsapp', text: `Came in on WhatsApp: ${String(first.text || '').slice(0, 500)}`, byName: 'WhatsApp', at: first.at || new Date() },
      ],
    });
  }
  conversation.lead = lead._id;
  await conversation.save();
  return lead._id;
}

/**
 * Once at start-up: every chat already in the inbox without a lead gets one
 * (or is linked to the lead it already has). Nothing is deleted.
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
  return n;
}

module.exports = { ensureLead, linkAllChats };
