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

module.exports = { nextCode, withCode };
