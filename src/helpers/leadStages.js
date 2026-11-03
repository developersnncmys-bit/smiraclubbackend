const Setting = require('../models/Setting');
const { LEAD_STAGES } = require('../config/constants');

/**
 * The stages a lead can be in.
 *
 * The desk can add, rename and reorder them from Move stage → Customize;
 * the list is the setting `leadStages`. New, Won and Lost are always in it,
 * because a new lead starts at New and the reports count Won and Lost.
 */
const KEY = 'leadStages';
const FIXED = ['New', 'Won', 'Lost'];

const clean = (list) => [
  ...new Set((Array.isArray(list) ? list : []).map((s) => String(s || '').trim().slice(0, 40)).filter(Boolean)),
];

function withFixed(list) {
  const middle = clean(list).filter((s) => !FIXED.includes(s));
  return ['New', ...middle, 'Won', 'Lost'];
}

async function leadStages() {
  const row = await Setting.findOne({ key: KEY }).lean();
  const list = clean(row?.value);
  return list.length ? withFixed(list) : LEAD_STAGES;
}

module.exports = { KEY, FIXED, clean, withFixed, leadStages };
