const Hold = require('../models/Hold');
const { crud } = require('../helpers/crud');

const base = crud(Hold, {
  name: 'Hold',
  searchable: ['customerName', 'inventoryName', 'code'],
  populate: { path: 'inventory', select: 'name category units' },
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.remove = base.remove;
