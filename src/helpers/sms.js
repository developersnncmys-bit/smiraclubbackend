/**
 * Sending the one-time code.
 *
 * No provider is wired yet. Until one is, development prints the code to the
 * server log and hands it back in the response so the desk can sign in; in
 * production that is refused outright, because an OTP nobody can receive is
 * not a login, it is a lock.
 *
 * To go live: implement send() against your provider — MSG91, Twilio,
 * Gupshup — and delete the development branch below.
 */
const isProduction = () => process.env.NODE_ENV === 'production';

async function send(phone, code) {
  if (isProduction()) {
    // Nothing is configured, so say so rather than pretend it was sent.
    throw new Error('No SMS provider is configured — the code cannot be delivered');
  }

  console.log(`\n  ── OTP for ${phone}: ${code} ──\n`);
  return { delivered: false, devCode: code };
}

module.exports = { send, isProduction };
