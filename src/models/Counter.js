const mongoose = require('mongoose');

/** Backs the readable codes — one document per prefix. */
const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
  start: { type: Number, default: 1000 },
});

module.exports = mongoose.model('Counter', counterSchema);
