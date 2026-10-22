/**
 * Sending the one-time code.
 *
 * Three ways this can go, in order of preference:
 *
 *   1. A provider is configured — the code is texted and nothing about it
 *      comes back in the response. This is the only safe one.
 *   2. No provider and SMS_DEMO_CODES is off — nobody can sign in, and the
 *      screen says why rather than pretending the server broke.
 *   3. No provider and demo codes on — the code comes back in the response
 *      so a demo can be given. Be clear about what that is: an
 *      authentication bypass. Anybody who can reach this API can ask for a
 *      code for any registered number and be told what it is.
 *
 * Configure the provider and (3) turns itself off.
 */
const ApiError = require('./ApiError');

/* -- The provider ---------------------------------------------------------
 *
 * Nimbus IT (nimbusit.biz), whose HTTP API is one GET:
 *
 *   /api/SmsApi/SendSingleApi
 *     ?UserID&Password&SenderID&Phno&Msg&EntityID&TemplateID
 *
 * EntityID and TemplateID are the DLT registration India requires: the
 * message has to match the registered template word for word or the
 * operator drops it, which is why the wording is configuration rather than
 * a string in this file.
 */

const URL_DEFAULT = 'https://www.nimbusit.biz/api/SmsApi/SendSingleApi';

/** `{code}` is where the number goes; the rest must match DLT exactly. */
const TEMPLATE_DEFAULT = '{code} is your Smira Club verification code. Do not share it with anyone.';

const conf = () => ({
  url: process.env.SMS_API_URL || URL_DEFAULT,
  userId: process.env.SMS_USER_ID || '',
  password: process.env.SMS_PASSWORD || '',
  senderId: process.env.SMS_SENDER_ID || '',
  entityId: process.env.SMS_ENTITY_ID || '',
  templateId: process.env.SMS_TEMPLATE_ID || '',
  template: process.env.SMS_TEMPLATE || TEMPLATE_DEFAULT,
});

/** Configured enough to try: an account, a password and a sender. */
const haveProvider = () => {
  const c = conf();
  return Boolean(c.userId && c.password && c.senderId);
};

/**
 * Ten digits, which is what the gateway wants.
 *
 * Numbers reach here written every way a person writes them —
 * "+91 98765 43210", "098765 43210", "9876543210" — and the country code
 * is not part of what is sent.
 */
function tenDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.slice(-10);
}

/**
 * Did it go?
 *
 * The gateway answers in plain text and does not document the wording, so
 * this errs towards believing a failure: a reply naming an error, an empty
 * reply, or any status but 200. Every reply is logged either way, so the
 * first real send tells us its exact words and this can be tightened.
 */
function accepted(status, body) {
  if (status !== 200) return false;
  const said = String(body || '').trim();
  if (!said) return false;
  if (/error|invalid|fail|insufficient|denied|unauthor/i.test(said)) return false;
  return true;
}

/**
 * Whether the code is being handed back rather than texted.
 *
 * A provider settles it: nothing is handed back once one is configured,
 * whatever SMS_DEMO_CODES happens to say.
 */
const demoCodes = () =>
  !haveProvider() && String(process.env.SMS_DEMO_CODES ?? 'true') !== 'false';

const isDemo = () => demoCodes();

let warned = false;

async function send(phone, code) {
  const c = conf();

  // -- (1) A provider ------------------------------------------------------
  if (haveProvider()) {
    const to = tenDigits(phone);
    if (to.length !== 10) throw ApiError.badRequest('That does not look like a mobile number');

    const params = new URLSearchParams({
      UserID: c.userId,
      Password: c.password,
      SenderID: c.senderId,
      Phno: to,
      Msg: c.template.replace('{code}', code),
      EntityID: c.entityId,
      TemplateID: c.templateId,
    });

    let status = 0;
    let body = '';
    try {
      const res = await fetch(`${c.url}?${params.toString()}`, {
        method: 'GET',
        // Somebody is waiting on a sign-in screen, so this fails rather
        // than hangs.
        signal: AbortSignal.timeout(10000),
      });
      status = res.status;
      body = await res.text();
    } catch (e) {
      console.error(`  SMS to ${to} could not be sent: ${e.message}`);
      throw new ApiError(503, 'The code could not be sent just now — please try again');
    }

    // Logged whatever happens: the gateway's wording is not documented and
    // this is how we learn it.
    console.log(`  SMS to ${to} → ${status} ${String(body).slice(0, 180)}`);

    if (!accepted(status, body)) {
      throw new ApiError(503, 'The code could not be sent just now — please try again');
    }

    return { delivered: true };
  }

  // -- (2) No provider, and demo codes turned off --------------------------
  if (!demoCodes()) {
    // 503, not a 500. Nothing broke — this server has simply never been given
    // a way to send an SMS, and the desk staring at the sign-in screen should
    // be told that rather than 'something went wrong at our end'.
    throw new ApiError(
      503,
      'One-time codes cannot be sent — this server has no SMS provider configured'
    );
  }

  // -- (3) The demo --------------------------------------------------------
  if (!warned) {
    warned = true;
    console.warn(
      '\n  ⚠  No SMS provider — one-time codes come back in the API response.\n' +
        '     Anyone who can reach this API can sign in as anyone.\n' +
        '     Set SMS_USER_ID, SMS_PASSWORD and SMS_SENDER_ID to stop this.\n'
    );
  }

  console.log(`\n  ── OTP for ${phone}: ${code} ──\n`);
  return { delivered: false, devCode: code, demo: true };
}

module.exports = { send, isDemo };
