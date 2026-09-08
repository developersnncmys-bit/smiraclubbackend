/**
 * Sending the one-time code.
 *
 * No SMS provider is wired yet. Until one is, the code can be handed back in
 * the response so a desk can still sign in — but understand what that is: an
 * authentication bypass. Anybody who can reach the API can ask for a code for
 * any number and be told what it is.
 *
 * So it never happens by accident. It requires ALLOW_DEV_OTP=true, which is a
 * deliberate choice somebody has to make and can see in the environment.
 * Relying on NODE_ENV was not enough — a platform that does not set it left
 * the bypass wide open on a public URL.
 *
 * To go live properly: implement send() against your provider — MSG91,
 * Twilio, Gupshup — and unset ALLOW_DEV_OTP.
 */
const ApiError = require('./ApiError');

const allowDevOtp = () => String(process.env.ALLOW_DEV_OTP || '') === 'true';

let warned = false;

async function send(phone, code) {
  if (!allowDevOtp()) {
    // Refuse rather than pretend. An OTP nobody can receive is a lock; an OTP
    // handed back over the wire is not authentication at all.
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
      '\n  ⚠  ALLOW_DEV_OTP is on — one-time codes come back in the API response.\n' +
        '     Anyone who can reach this API can sign in as anyone. Development only.\n'
    );
  }

  console.log(`\n  ── OTP for ${phone}: ${code} ──\n`);
  return { delivered: false, devCode: code };
}

module.exports = { send, allowDevOtp };
