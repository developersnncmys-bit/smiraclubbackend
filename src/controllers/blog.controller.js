const Blog = require('../models/Blog');
const { crud } = require('../helpers/crud');
const { BLOG_CATEGORIES } = require('../config/constants');

/** "Top 10 Beach Destinations" becomes "top-10-beach-destinations". */
const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

/**
 * A slug nothing else is using.
 *
 * Two posts about Goa are not unusual, and the second one must not fail to
 * save because of the first. The second becomes goa-weekend-2, which is
 * uglier than the writer intended but better than an error they cannot act
 * on, and they can still type whatever they like into the slug field.
 */
async function freeSlug(wanted, exceptId = null) {
  const root = slugify(wanted) || 'post';
  for (let n = 1; n < 50; n += 1) {
    const slug = n === 1 ? root : `${root}-${n}`;
    // eslint-disable-next-line no-await-in-loop
    const clash = await Blog.findOne({ slug, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })
      .select('_id')
      .lean();
    if (!clash) return slug;
  }
  return `${root}-${Date.now().toString(36)}`;
}

const labelFor = (key) => BLOG_CATEGORIES.find((c) => c.key === key)?.label || '';

/** Whatever the writer left out, as close to what they meant as we can get. */
const fill = async (body, exceptId) => {
  const patch = { ...body };

  /*
   * A new post takes its address from its title. An existing one keeps the
   * address it went out with unless the desk edits the slug itself — fixing
   * a typo in a headline should not quietly break every link to the piece.
   */
  if (patch.slug !== undefined) patch.slug = await freeSlug(patch.slug, exceptId);
  else if (!exceptId) patch.slug = await freeSlug(patch.title, null);
  if (patch.category && !patch.tag) patch.tag = labelFor(patch.category);
  // Publishing something with no date on it prints a blank line on the site.
  if (patch.status === 'Published' && !patch.publishedOn) patch.publishedOn = new Date();

  return patch;
};

const base = crud(Blog, {
  name: 'Blog',
  searchable: ['title', 'slug', 'code', 'excerpt', 'tag'],
  defaultSort: '-publishedOn -createdAt',
  beforeCreate: (body) => fill(body, null),
  beforeUpdate: (body, req) => fill(body, req.params.id),
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;
