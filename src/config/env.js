/**
 * Is this a real deployment?
 *
 * NODE_ENV alone was not enough to answer that. Vercel does not set it, so a
 * public URL was running with development's manners on: any localhost origin
 * accepted, and a full stack trace returned to anyone who could provoke a 500.
 *
 * So a deployment is anything that is not explicitly development or test —
 * being careless has to be a choice somebody makes, not the default a missing
 * variable falls into.
 */
const NODE_ENV = String(process.env.NODE_ENV || '').toLowerCase();

/** True on any host that is not explicitly running as development or test. */
const isProduction = !['development', 'test'].includes(NODE_ENV);

const isTest = NODE_ENV === 'test';

module.exports = { isProduction, isTest, NODE_ENV };
