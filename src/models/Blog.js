const mongoose = require('mongoose');
const { BLOG_CATEGORY_KEYS } = require('../config/constants');
const { withCode } = require('../helpers/ids');

/**
 * One section of an article.
 *
 * A post is not one block of prose — the website draws a heading, then
 * paragraphs, then a bulleted list, in whatever order the writer put them.
 * So the body is a list of sections and each one carries only the parts it
 * has; an empty heading or an empty list is simply not drawn.
 */
const sectionSchema = new mongoose.Schema(
  {
    h: String,
    p: [String],
    list: [String],
  },
  { _id: false }
);

/**
 * A blog post, written here and read by the website.
 *
 * The desk writes these; nothing else does. `slug` is what the website puts
 * in the address, so it is the one field a reader ever sees and the one that
 * must not change once a post is out — a changed slug is a broken link in
 * somebody's bookmarks. `code` stays the key the desk quotes internally.
 *
 * `latest` and `popular` are the two rails the blogs screen draws, and both
 * are an editor's choice rather than a counter. A view count exists, but
 * promoting a post is a decision, not an outcome.
 */
const blogSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },

    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },

    /** Which chip on the website files it. */
    category: { type: String, enum: BLOG_CATEGORY_KEYS, default: 'guide', index: true },
    /** The words printed on the card, which need not match the chip. */
    tag: { type: String, trim: true },

    excerpt: { type: String, trim: true },
    coverUrl: String,

    readMins: { type: Number, default: 5 },
    publishedOn: Date,

    latest: { type: Boolean, default: true },
    popular: { type: Boolean, default: false },

    body: [sectionSchema],

    status: { type: String, enum: ['Draft', 'Published'], default: 'Draft', index: true },

    /** How often the website opened the article. */
    views: { type: Number, default: 0 },

    author: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

withCode(blogSchema, 'BLG', { pad: 3, start: 0 });

/**
 * A post goes out dated.
 *
 * Without this, a post published today and printed "— min read" with no
 * date looks half-written on the website, and the desk has no reason to
 * think of the date as something it has to fill in.
 */
blogSchema.pre('save', function datePublished(next) {
  if (this.status === 'Published' && !this.publishedOn) this.publishedOn = new Date();
  next();
});

module.exports = mongoose.model('Blog', blogSchema);
