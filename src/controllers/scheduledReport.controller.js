const ScheduledReport = require('../models/ScheduledReport');
const { crud } = require('../helpers/crud');

const base = crud(ScheduledReport, {
  name: 'Scheduled report',
  searchable: ['name', 'module', 'code'],
  defaultSort: 'name',
});

exports.list = base.list;
exports.getOne = base.getOne;
exports.create = base.create;
exports.update = base.update;
exports.remove = base.remove;
