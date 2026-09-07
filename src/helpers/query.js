/**
 * Turns `?status=Active&sort=-createdAt&page=2&limit=50&q=rohan` into a
 * mongoose query. Every list endpoint reads the same, so the admin panel can
 * filter any of them the same way.
 */

const RESERVED = ['page', 'limit', 'sort', 'fields', 'q', 'from', 'to', 'dateField'];

/** `gte`, `lte`, `ne`, `in` come through as `price[gte]=100`. */
function buildFilter(query, { searchable = [], allowed = null } = {}) {
  const filter = {};

  Object.entries(query).forEach(([key, value]) => {
    if (RESERVED.includes(key)) return;
    if (allowed && !allowed.includes(key)) return;
    if (value === '' || value === 'All' || value === undefined) return;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const ops = {};
      Object.entries(value).forEach(([op, v]) => {
        if (['gt', 'gte', 'lt', 'lte', 'ne'].includes(op)) ops['$' + op] = Number.isNaN(Number(v)) ? v : Number(v);
        if (op === 'in') ops.$in = String(v).split(',');
        if (op === 'nin') ops.$nin = String(v).split(',');
      });
      if (Object.keys(ops).length) filter[key] = ops;
      return;
    }

    if (typeof value === 'string' && value.includes(',')) {
      filter[key] = { $in: value.split(',').map((v) => v.trim()) };
      return;
    }

    if (value === 'true' || value === 'false') {
      filter[key] = value === 'true';
      return;
    }

    filter[key] = value;
  });

  const q = String(query.q || '').trim();
  if (q && searchable.length) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = searchable.map((field) => ({ [field]: rx }));
  }

  // A date window, on whichever field the caller names.
  const dateField = query.dateField || 'createdAt';
  if (query.from || query.to) {
    filter[dateField] = {};
    if (query.from) filter[dateField].$gte = new Date(query.from);
    if (query.to) {
      const to = new Date(query.to);
      to.setHours(23, 59, 59, 999);
      filter[dateField].$lte = to;
    }
  }

  return filter;
}

function buildOptions(query, { defaultSort = '-createdAt', maxLimit = 200 } = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(query.limit) || 25));
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    sort: String(query.sort || defaultSort).split(',').join(' '),
    select: query.fields ? String(query.fields).split(',').join(' ') : undefined,
  };
}

/** Runs the list and its count together, and shapes the envelope. */
async function paginate(Model, filter, options, { populate } = {}) {
  let q = Model.find(filter).sort(options.sort).skip(options.skip).limit(options.limit);
  if (options.select) q = q.select(options.select);
  if (populate) q = q.populate(populate);

  const [rows, total] = await Promise.all([q.lean(), Model.countDocuments(filter)]);

  return {
    rows,
    page: options.page,
    limit: options.limit,
    total,
    pages: Math.max(1, Math.ceil(total / options.limit)),
  };
}

module.exports = { buildFilter, buildOptions, paginate };
