const Upload = require('../models/Upload');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');

/** Scans and photographs of paperwork. Nothing else gets in. */
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * A file arrives as a data URL rather than multipart.
 *
 * The browser has already read the file to show a preview, so it costs
 * nothing to send the same string, and it keeps the API to plain JSON —
 * no multipart parser, no temporary files on a filesystem that does not
 * survive the next request.
 */
function decode(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || '').trim());
  if (!m) throw ApiError.badRequest('That file could not be read');
  const contentType = m[1].toLowerCase();
  if (!ALLOWED.includes(contentType)) {
    throw ApiError.badRequest('Send a PDF or a photograph — JPG, PNG or WebP');
  }
  const data = Buffer.from(m[2], 'base64');
  if (!data.length) throw ApiError.badRequest('That file is empty');
  if (data.length > MAX_BYTES) throw ApiError.badRequest('That file is over 5 MB — send a smaller scan');
  return { contentType, data };
}

const publicUrl = (req, doc) => `${req.protocol}://${req.get('host')}/api/uploads/${doc._id}`;

/**
 * Keep a file and hand back the address it now lives at.
 *
 * The address is what goes into the listing, in the same field that used
 * to hold a pasted link — so a partner who gave us a Drive link before
 * still has a working one, and everything new is ours.
 */
exports.create = catchAsync(async (req, res) => {
  const { file, filename, label } = req.body || {};
  const { contentType, data } = decode(file);

  const doc = await Upload.create({
    filename: String(filename || 'document').slice(0, 200),
    contentType,
    size: data.length,
    data,
    label: label ? String(label).slice(0, 120) : undefined,
    partner: req.partner?._id || req.body.partner || undefined,
    uploadedBy: req.user?.name || req.partner?.name || 'Partner',
  });

  res.status(201).json({
    success: true,
    data: { id: doc._id, url: publicUrl(req, doc), filename: doc.filename, contentType, size: doc.size },
  });
});

/**
 * Give the file back.
 *
 * Open, like the images on the site: the address is an unguessable id, the
 * contents are a partner's own paperwork rather than anything about a
 * member, and the desk has to be able to open one in a new tab without
 * carrying a token into the address bar.
 */
exports.read = catchAsync(async (req, res) => {
  const doc = await Upload.findById(req.params.id).select('+data').lean();
  if (!doc) throw ApiError.notFound('That file is not here');

  /**
   * A lean read hands back the driver's own Binary wrapper, not a Node
   * Buffer — and Express, handed an object, turns it into JSON. So every
   * photograph was served as its own base64 text in quotation marks: the
   * right length, the right content type, and not an image. Unwrap it.
   */
  const bytes = Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data?.buffer || doc.data);

  res.type(doc.contentType);
  res.set('Content-Length', String(bytes.length));
  res.set('Cache-Control', 'private, max-age=3600');
  res.set('Content-Disposition', `inline; filename="${doc.filename.replace(/"/g, '')}"`);
  res.end(bytes);
});
