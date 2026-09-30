const router = require('express').Router();
const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const { protectPartner } = require('../middleware/partnerAuth');
const c = require('../controllers/upload.controller');

/**
 * Paperwork, from the desk or from the partner themselves.
 *
 * A 15 MB photograph is about 20 MB once it is base64, so these routes
 * take a much bigger body than the rest of the API, which stays at 2 MB.
 * The cap is enforced on the decoded bytes in the controller either way.
 */
const body = express.json({ limit: '22mb' });

const perAddress = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  message: { success: false, message: 'That is a lot of uploads — try again shortly' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Anyone with the address can read a file; the id is the secret. */
router.get('/:id', c.read);

/**
 * Somebody filling in the website's Become a Partner form, with no account
 * yet. It is open, so it is capped hard: ten files an hour from one address
 * is plenty for one application and useless to anybody filling the database
 * with five-megabyte pictures.
 */
router.post(
  '/apply',
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    message: { success: false, message: 'That is a lot of files — try again shortly, or call the desk' },
    standardHeaders: true,
    legacyHeaders: false,
  }),
  body,
  c.create,
);

/** A partner sending in their own papers, mid-application. */
router.post('/partner', perAddress, body, protectPartner, c.create);

/** The desk, filling a listing in on a partner's behalf. */
router.post('/', perAddress, body, protect, c.create);

module.exports = router;
