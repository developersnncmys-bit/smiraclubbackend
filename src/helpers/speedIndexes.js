/**
 * Indexes the admin panel's lists need to be quick.
 *
 * Every list is read newest-first, and the background refresh asks "what
 * changed last" — without an index on those dates MongoDB sorted the whole
 * collection in memory each time (35,000 leads, 18 pages, on every load).
 * Added here once, on start-up, in the background; they only add indexes.
 */
const WANTED = {
  Lead: [{ createdAt: -1 }, { updatedAt: -1 }, { nextFollowUpAt: 1 }],
  Task: [{ createdAt: -1 }, { updatedAt: -1 }],
  Customer: [{ createdAt: -1 }, { updatedAt: -1 }],
  Membership: [{ createdAt: -1 }, { updatedAt: -1 }],
  Booking: [{ createdAt: -1 }, { updatedAt: -1 }, { checkIn: 1 }],
  Ticket: [{ createdAt: -1 }, { updatedAt: -1 }],
  Partner: [{ createdAt: -1 }, { updatedAt: -1 }],
  Payment: [{ updatedAt: -1 }],
  Conversation: [{ lastMessageAt: -1 }, { updatedAt: -1 }],
  Reward: [{ updatedAt: -1 }],
  InventoryItem: [{ updatedAt: -1 }],
  Invoice: [{ updatedAt: -1 }],
  User: [{ updatedAt: -1 }],
  Approval: [{ updatedAt: -1 }],
  Referral: [{ updatedAt: -1 }],
  Offer: [{ updatedAt: -1 }],
};

async function ensureSpeedIndexes() {
  let made = 0;
  for (const [name, keys] of Object.entries(WANTED)) {
    let Model;
    try {
      Model = require(`../models/${name}`);
    } catch {
      continue;
    }
    for (const key of keys) {
      try {
        await Model.collection.createIndex(key, { background: true });
        made += 1;
      } catch (err) {
        console.error(`Index ${name} ${JSON.stringify(key)}:`, err.message);
      }
    }
  }
  console.log(`Speed indexes checked (${made})`);
}

module.exports = { ensureSpeedIndexes };
