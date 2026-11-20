/**
 * Calls onChange(doc, { isNew, changed }) after a document is created or one
 * of the watched fields changes — however it was written: doc.save() or a
 * findOneAndUpdate / findByIdAndUpdate. It runs after the write, on its own,
 * and can never fail the request that made the change.
 */
const get = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);
const same = (a, b) => String(a instanceof Date ? a.getTime() : a ?? '') === String(b instanceof Date ? b.getTime() : b ?? '');

function later(onChange, doc, info) {
  setImmediate(() => {
    Promise.resolve()
      .then(() => onChange(doc, info))
      .catch((err) => console.error('Notification failed:', err.message));
  });
}

function watchChanges(schema, fields, onChange) {
  schema.pre('save', function rememberChanges(next) {
    this.$locals.watchNew = this.isNew;
    this.$locals.watchChanged = this.isNew ? [] : fields.filter((f) => this.isModified(f));
    next();
  });
  schema.post('save', function afterSave(doc) {
    const isNew = Boolean(doc.$locals.watchNew);
    const changed = doc.$locals.watchChanged || [];
    if (isNew || changed.length) later(onChange, doc.toObject(), { isNew, changed });
  });

  schema.pre('findOneAndUpdate', async function rememberBefore(next) {
    try {
      this._watchBefore = await this.model.findOne(this.getQuery()).lean();
    } catch {
      this._watchBefore = null;
    }
    next();
  });
  schema.post('findOneAndUpdate', async function afterUpdate(res) {
    const before = this._watchBefore;
    const id = before?._id || res?._id;
    if (!id) return;
    const after = await this.model.findById(id).lean().catch(() => null);
    if (!after) return;
    if (!before) return later(onChange, after, { isNew: true, changed: [] });
    const changed = fields.filter((f) => !same(get(before, f), get(after, f)));
    if (changed.length) later(onChange, after, { isNew: false, changed, before });
  });
}

module.exports = { watchChanges };
