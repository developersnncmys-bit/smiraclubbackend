const mongoose = require('mongoose');

/**
 * A one-time code sent to a number that has no account yet.
 *
 * A partner who has never registered has no record to hold their code, and
 * creating a partner the moment somebody types a number would let anyone fill
 * the database by pressing "send". So the code lives here until it is proved,
 * and the partner is only created once it has been.
 *
 * Documents expire on their own an hour after they are written.
 */
const otpChallengeSchema = new mongoose.Schema(
  {
    phoneDigits: { type: String, required: true },
    purpose: { type: String, required: true, enum: ['partner-signup'] },
    codeHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now, expires: 3600 },
  },
  { versionKey: false }
);

otpChallengeSchema.index({ phoneDigits: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.model('OtpChallenge', otpChallengeSchema);
