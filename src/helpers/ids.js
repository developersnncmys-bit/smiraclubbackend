const crypto = require('crypto');
const Counter = require('../models/Counter');

/**
 * Readable codes — LEAD-2291, BKG-8820, TCK-1043 — because the desk quotes
 * them to each other and to customers. Mongo's _id stays the real key.
 */
async function nextCode(prefix, { pad = 4, start = 1000 } = {}) {
  const doc = await Counter.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 }, $setOnInsert: { start } },
    { new: true, upsert: true }
  );
  const seq = (doc.seq || 0) + (doc.start || start);
  return `${prefix}-${String(seq).padStart(pad, '0')}`;
}

/**
 * Attaches an auto code to a schema. Both write paths are covered: `save`
 * for ordinary creates, and `findOneAndUpdate` for upserts, which skip
 * document middleware entirely and would otherwise leave the code null.
 */
function withCode(schema, prefix, options) {
  schema.pre('save', async function attachOnSave(next) {
    if (this.isNew && !this.code) {
      try {
        this.code = await nextCode(prefix, options);
      } catch (err) {
        return next(err);
      }
    }
    next();
  });

  schema.pre('findOneAndUpdate', async function attachOnUpsert(next) {
    if (!this.getOptions().upsert) return next();

    const update = this.getUpdate() || {};
    const setting = update.$set?.code || update.code;
    const inserting = update.$setOnInsert?.code;
    if (setting || inserting) return next();

    // Only mint one if nothing matches — an update must not renumber a record.
    try {
      const existing = await this.model.findOne(this.getQuery()).select('code').lean();
      if (existing) return next();
      this.setUpdate({ ...update, $setOnInsert: { ...(update.$setOnInsert || {}), code: await nextCode(prefix, options) } });
    } catch (err) {
      return next(err);
    }
    next();
  });
}

/**
 * The reference a payment gateway is given for a booking or a membership.
 *
 * The code the desk quotes — BKG-8889 — counts up one at a time, which is
 * right for reading out over the phone and wrong for a gateway: the next
 * one is always guessable, and if a counter is ever reset, or a second
 * environment shares the same merchant account, two different bookings
 * can ask to be paid under one reference.
 *
 * So the code stays as it is and this travels beside it. The number is
 * kept, so a reference can still be traced back by eye, and four random
 * characters make it its own. Look-alike letters and digits are left out
 * of the alphabet, because these get read aloud and typed in.
 */
const REF_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679';

function payRefFor(code) {
  let tail = '';
  for (let i = 0; i < 4; i += 1) tail += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
  const digits = String(code || '').replace(/^[A-Z]+-/, '') || 'X';
  return `SMB-${digits}-${tail}`;
}

/**
 * Attaches one to a schema, after the code it borrows its number from.
 * A record that somehow has no code still gets a reference.
 */
function withPayRef(schema) {
  schema.pre('save', function attachPayRef(next) {
    if (this.isNew && !this.payRef) this.payRef = payRefFor(this.code);
    next();
  });
}

module.exports = { nextCode, withCode, payRefFor, withPayRef };
