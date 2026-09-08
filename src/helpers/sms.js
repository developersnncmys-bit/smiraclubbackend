/**
 * Sending the one-time code.
 *
 * No SMS provider is wired yet, so until one is the code comes back in the
 * response and the sign-in screen shows it. Be clear about what that is: an
 * authentication bypass. Anybody who can reach this API can ask for a code
 * for any registered number and be told what it is.
 *
 * It is on because the panel is a demo running on seeded data and has to open
 * for the people being shown it. It is not a setting to leave alone once real
 * customer records are in the database.
 *
 * Two ways out, in order of preference:
 *   1. Implement send() against a provider — MSG91, Twilio, Gupshup. Return
 *      { delivered: true } and no devCode, and the bypass is gone.
 *   2. Set SMS_DEMO_CODES=false, which turns it off immediately. Nobody can
 *      then sign in until (1) is done — which is the correct trade the moment
 *      the data is real.
 */
const ApiError = require('./ApiError');

/**
 * On unless someone says otherwise. The previous default — off unless
 * ALLOW_DEV_OTP=true — meant a fresh deploy could not be signed into at all,
 * and the error it gave read like the server was broken.
 */
const demoCodes = () => String(process.env.SMS_DEMO_CODES ?? 'true') !== 'false';

let warned = false;

/** Whether the code is being handed back rather than texted. */
const isDemo = () => demoCodes();

async function send(phone, code) {
  if (!demoCodes()) {
    // 503, not a 500. Nothing broke — this server has simply never been given
    // a way to send an SMS, and the desk staring at the sign-in screen should
    // be told that rather than 'something went wrong at our end'.
    throw new ApiError(
      503,
      'One-time codes cannot be sent — this server has no SMS provider configured'
    );
  }

  if (!warned) {
    warned = true;
    console.warn(
      '\n  ⚠  No SMS provider — one-time codes come back in the API response.\n' +
        '     Anyone who can reach this API can sign in as anyone.\n' +
        '     Wire a provider in src/helpers/sms.js, or set SMS_DEMO_CODES=false.\n'
    );
  }

  console.log(`\n  ── OTP for ${phone}: ${code} ──\n`);
  return { delivered: false, devCode: code, demo: true };
}

module.exports = { send, isDemo };
