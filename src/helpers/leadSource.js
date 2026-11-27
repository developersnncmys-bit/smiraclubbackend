/**
 * Where a WhatsApp lead came from.
 *
 * WhatsApp itself only says "a message arrived". The source has to be read
 * from what came with it, in this order:
 *
 *  1. Meta's ad details (a Click-to-WhatsApp ad on Facebook or Instagram puts
 *     them on the first message) — passed on by the AdsEra webhook.
 *  2. A Ref code typed into the message by a link we made, e.g. "(Ref: WEB)"
 *     from the website button or "Ref: QR-EXPO" on a poster.
 *  3. A filled-in enquiry form sent as a message ("*Free stay pay for food*
 *     *Response* #10548 …") — its title is the campaign, its answers fill
 *     the lead.
 *  4. Meta's standard ad greeting ("Can I get more info on this?").
 *  5. Otherwise: somebody who wrote to the number directly.
 */

const clip = (v, n = 80) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Meta's referral block, wherever this payload keeps it. */
function referralOf(d = {}) {
  const r = d.referral || d.context?.referral || d.message?.referral || d.raw?.referral || d.data?.referral
    || d.ad || d.adReferral || null;
  if (!r || typeof r !== 'object') return null;
  const url = r.source_url || r.sourceUrl || r.url || '';
  const type = r.source_type || r.sourceType || '';
  const app = String(r.source_app || r.sourceApp || r.app || '').toLowerCase();
  const insta = /instagram/i.test(url) || app.includes('instagram') || app === 'ig';
  return {
    source: insta ? 'Instagram' : 'Facebook Ads',
    campaign: clip(r.headline || r.ad_name || r.adName || r.body || (type === 'ad' ? 'Click-to-WhatsApp ad' : 'Meta post')),
    adId: clip(r.source_id || r.sourceId || r.ad_id || r.adId, 40),
    url: clip(url, 300),
    how: 'Meta ad details',
  };
}

const REF_SOURCES = [
  [/^(WEB|SITE|WEBSITE)/i, 'Website'],
  [/^(FB|FACEBOOK|META)/i, 'Facebook Ads'],
  [/^(IG|INSTA)/i, 'Instagram'],
  [/^(GOOGLE|GADS|GA)/i, 'Google Ads'],
  [/^(REF|REFER|FRIEND)/i, 'Referral'],
];

/** The answers of a "*Question :* answer" form message. */
function formFields(text) {
  const out = {};
  for (const m of String(text).matchAll(/\*\s*([^*:\n]{2,60}?)\s*:\s*\*\s*([^\n]*)/g)) {
    const v = m[2].trim();
    if (v) out[m[1].trim().toLowerCase()] = v;
  }
  return out;
}

const dmy = (v) => {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(String(v || '').trim());
  if (!m) return undefined;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  const d = new Date(`${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const int = (v) => {
  const n = parseInt(String(v || '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
};

/** What the form answers fill on a lead. */
function leadFieldsFrom(f) {
  const get = (...keys) => keys.map((k) => Object.entries(f).find(([q]) => q.includes(k))?.[1]).find(Boolean);
  const adults = int(get('adult'));
  const kids = Object.entries(f).filter(([q]) => /kid|child/.test(q)).reduce((s, [, v]) => s + (int(v) || 0), 0);
  const email = get('email');
  const trip = {
    checkIn: dmy(get('check in', 'check-in', 'checkin')),
    checkOut: dmy(get('check out', 'check-out', 'checkout')),
    adults,
    children: kids || undefined,
    roomsRequired: int(get('room')),
    transport: get('transport') ? [clip(get('transport'), 60)] : undefined,
    note: clip(get('special', 'request', 'message'), 1000) || undefined,
  };
  Object.keys(trip).forEach((k) => trip[k] === undefined && delete trip[k]);
  return {
    name: clip(get('full name', 'name'), 80) || undefined,
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim()) ? String(email).trim().toLowerCase() : undefined,
    pax: adults ? adults + (kids || 0) : undefined,
    travelDate: trip.checkIn,
    location: clip(get('location', 'city'), 80) || undefined,
    trip,
  };
}

/** Read the source from the first thing they wrote. */
function fromText(text) {
  const t = String(text || '');

  const ref = /\bref(?:erence)?\s*[:#-]\s*([A-Za-z0-9][\w-]{1,30})/i.exec(t);
  if (ref) {
    const code = ref[1].toUpperCase();
    const hit = REF_SOURCES.find(([re]) => re.test(code));
    return { source: hit ? hit[1] : 'Campaign', campaign: code, how: `Ref code ${code}` };
  }

  const form = /^\s*\*([^*\n]{3,80})\*\s*\n\s*\*Response\*\s*#?\s*(\d+)/i.exec(t);
  if (form) {
    return {
      source: 'Website',
      campaign: clip(form[1]),
      how: `Enquiry form response #${form[2]}`,
      fields: leadFieldsFrom(formFields(t)),
    };
  }

  if (/can i (get|have) more (info|information|details)|i'?m interested in this|more info(rmation)? (on|about) this/i.test(t)) {
    return { source: 'Facebook Ads', campaign: 'Click-to-WhatsApp ad', how: "Meta's ad greeting" };
  }

  return { source: 'WhatsApp', campaign: '', how: 'Wrote to the number directly' };
}

/** The source for a chat: the ad details it carries, else its first message. */
function forConversation(conversation) {
  const o = conversation?.origin;
  if (o?.source) return { ...o, fields: fromText(firstText(conversation)).fields };
  return fromText(firstText(conversation));
}
const firstText = (c) => (c?.messages || []).find((m) => m.from === 'them')?.text || '';

module.exports = { referralOf, fromText, forConversation, firstText };
