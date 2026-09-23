const InventoryItem = require('../models/InventoryItem');
const Hold = require('../models/Hold');
const ApiError = require('../helpers/ApiError');
const catchAsync = require('../helpers/catchAsync');
const { crud } = require('../helpers/crud');
const { record } = require('../helpers/audit');
const { RATE_TYPES, INVENTORY_CATEGORIES } = require('../config/constants');
const { sellingRate } = require('../helpers/money');

const base = crud(InventoryItem, {
  name: 'Inventory item',
  searchable: ['name', 'destination', 'vendorName', 'reference', 'code'],
  populate: { path: 'partner', select: 'name category rating' },
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;

/** How each rate type is worked out from the vendor rate. */
const RULES = {
  'Standard rate': 0,
  'B2B rate': -12,
  'Member rate': null,
  'Weekend rate': 15,
  'Seasonal rate': 25,
  'Festival rate': 35,
  'Corporate rate': -8,
  'Promotional rate': -18,
  'Package rate': -15,
  'Last-minute rate': -22,
};

/** Every rate an item carries, priced off the one vendor rate. */
exports.rates = catchAsync(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw ApiError.notFound('Inventory item not found');

  const selling = sellingRate(item.baseRate, item.markup);

  res.json({
    success: true,
    data: {
      item: { id: item._id, name: item.name, baseRate: item.baseRate, markup: item.markup, selling },
      rates: RATE_TYPES.map((type) => {
        const pct = RULES[type];
        const value = pct === null ? Math.max(0, selling - Number(item.memberDiscount || 0)) : Math.round(selling * (1 + pct / 100));
        return { type, adjustment: pct === null ? 'member discount' : `${pct}%`, rate: value };
      }),
    },
  });
});

/** Day by day, what is left and what it costs. */
exports.availability = catchAsync(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw ApiError.notFound('Inventory item not found');

  const from = req.query.from ? new Date(req.query.from) : new Date();
  const days = Math.min(90, Number(req.query.days) || 30);

  /**
   * Whole days, not instants. A blackout saved as a date lands on midnight
   * UTC, while a day here begins at midnight where the desk is — compared as
   * timestamps, an Indian day falls before its own blackout and stays on sale.
   */
  const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
  const isBlackout = (d) => {
    const on = dayKey(new Date(d.getTime() - d.getTimezoneOffset() * 60000));
    return (item.blackouts || []).some((b) => on >= dayKey(b.from) && on <= dayKey(b.to || b.from));
  };

  const rows = Array.from({ length: days }, (_, i) => {
    const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const override = (item.availability || []).find(
      (a) => new Date(a.date).toDateString() === date.toDateString()
    );
    return {
      date,
      left: isBlackout(date) ? 0 : override ? override.left : item.available,
      rate: override?.rate ?? sellingRate(item.baseRate, item.markup),
      note: isBlackout(date) ? 'Blackout' : override?.note || '',
    };
  });

  res.json({ success: true, data: { item: { id: item._id, name: item.name, units: item.units }, days: rows } });
});

/** Increase, reduce, block, open, change the rate or override the vendor. */
exports.setDay = catchAsync(async (req, res) => {
  const { date, left, rate, note } = req.body;
  if (!date) throw ApiError.badRequest('Which day?');

  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw ApiError.notFound('Inventory item not found');

  const on = new Date(date);
  const existing = (item.availability || []).find((a) => new Date(a.date).toDateString() === on.toDateString());

  if (existing) {
    if (left !== undefined) existing.left = Number(left);
    if (rate !== undefined) existing.rate = Number(rate);
    if (note !== undefined) existing.note = note;
  } else {
    item.availability.push({
      date: on,
      left: left !== undefined ? Number(left) : item.available,
      rate: rate !== undefined ? Number(rate) : sellingRate(item.baseRate, item.markup),
      note,
    });
  }

  await item.save();
  await record(req, 'update', 'Inventory item', item._id, `${item.code} changed for ${on.toDateString()}`);
  res.json({ success: true, data: item });
});

exports.addBlackout = catchAsync(async (req, res) => {
  const { from, to, reason } = req.body;
  if (!from) throw ApiError.badRequest('A blackout needs a start date');

  const item = await InventoryItem.findByIdAndUpdate(
    req.params.id,
    { $push: { blackouts: { from, to: to || from, reason } } },
    { new: true }
  );
  if (!item) throw ApiError.notFound('Inventory item not found');
  res.json({ success: true, data: item });
});

/**
 * Holding stock rather than consuming it — the sheet calls this critical for
 * preventing leakage.
 */
exports.hold = catchAsync(async (req, res) => {
  const { units = 1, customer, customerName, channel = 'CRM', minutes = 30 } = req.body;

  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw ApiError.notFound('Inventory item not found');
  if (item.available < units) throw ApiError.badRequest(`Only ${item.available} left`);

  const held = await Hold.create({
    inventory: item._id,
    inventoryName: item.name,
    units,
    customer,
    customerName,
    channel,
    heldForMinutes: minutes,
    heldBy: req.user._id,
    createdBy: req.user._id,
  });

  item.blocked += Number(units);
  await item.save();

  await record(req, 'hold', 'Inventory item', item._id, `${units} held on ${item.code} for ${minutes} min`);
  res.status(201).json({ success: true, data: held });
});

/** The timer running out, or the desk letting it go. */
exports.release = catchAsync(async (req, res) => {
  const held = await Hold.findById(req.params.holdId);
  if (!held) throw ApiError.notFound('Hold not found');
  if (held.stage !== 'Awaiting payment') throw ApiError.conflict('That hold is already closed');

  held.stage = 'Released';
  await held.save();
  await InventoryItem.findByIdAndUpdate(held.inventory, { $inc: { blocked: -held.units } });

  res.json({ success: true, data: held });
});

/** Anything whose timer has run out goes straight back on sale. */
exports.sweepHolds = catchAsync(async (req, res) => {
  const stale = await Hold.find({ stage: 'Awaiting payment', expiresAt: { $lt: new Date() } });

  await Promise.all(
    stale.map(async (h) => {
      h.stage = 'Expired';
      await h.save();
      await InventoryItem.findByIdAndUpdate(h.inventory, { $inc: { blocked: -h.units } });
    })
  );

  res.json({ success: true, data: { released: stale.length } });
});

/** How hard the stock is working, by category. */
exports.analytics = catchAsync(async (req, res) => {
  const rows = await InventoryItem.aggregate([
    {
      $group: {
        _id: '$category',
        items: { $sum: 1 },
        units: { $sum: '$units' },
        booked: { $sum: '$booked' },
        blocked: { $sum: '$blocked' },
      },
    },
  ]);

  res.json({
    success: true,
    data: INVENTORY_CATEGORIES.map((category) => {
      const r = rows.find((x) => x._id === category) || {};
      const units = r.units || 0;
      return {
        category,
        items: r.items || 0,
        units,
        booked: r.booked || 0,
        blocked: r.blocked || 0,
        available: Math.max(0, units - (r.booked || 0) - (r.blocked || 0)),
        utilisation: units ? Math.round(((r.booked || 0) / units) * 100) : 0,
      };
    }),
  });
});

/** Sold out, running low, missing a rate, waiting on a vendor, expiring. */
exports.alerts = catchAsync(async (req, res) => {
  const items = await InventoryItem.find().lean();
  const soon = new Date(Date.now() + 30 * 86400000);
  const alerts = [];

  items.forEach((i) => {
    const available = Math.max(0, (i.units || 0) - (i.booked || 0) - (i.blocked || 0));
    if (available === 0) alerts.push({ kind: 'Sold out', item: i.name, level: 'critical' });
    else if (available <= 2) alerts.push({ kind: 'Low availability', item: i.name, level: 'warning', note: `${available} left` });
    if (!i.baseRate || !i.markup) alerts.push({ kind: 'Missing rate', item: i.name, level: 'critical' });
    if (i.confirmation !== 'Confirmed') alerts.push({ kind: 'Waiting on the vendor', item: i.name, level: 'warning' });
    if (i.contractEndsOn && new Date(i.contractEndsOn) < soon)
      alerts.push({ kind: 'Contract expiring', item: i.name, level: 'warning', note: i.contractEndsOn });
    if (i.rateEndsOn && new Date(i.rateEndsOn) < soon)
      alerts.push({ kind: 'Rate expiring', item: i.name, level: 'warning', note: i.rateEndsOn });
  });

  res.json({ success: true, data: alerts });
});
