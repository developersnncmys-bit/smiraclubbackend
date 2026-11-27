/**
 * Running it locally. On Vercel the entry is api/index.js instead, because a
 * serverless platform never calls listen().
 */
require('dotenv').config();

const app = require('./src/app');
const { connectDB } = require('./src/config/db');

const PORT = process.env.PORT || 9100;

/**
 * Nothing listens until the database is up — a half-connected API that
 * answers 200 with no data is worse than one that has not started.
 */
connectDB()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`Smira API listening on http://localhost:${PORT}`);
    });

    // Rules that assign keep handing out waiting leads, up to each person's number a day.
    const { fillAll } = require('./src/helpers/leadAutomation');
    const FILL_EVERY = 5 * 60 * 1000;
    setTimeout(() => fillAll().catch(() => {}), 30 * 1000);
    setInterval(() => fillAll().catch(() => {}), FILL_EVERY);

    // Indexes the lists need to be quick (only ever adds them).
    require('./src/helpers/speedIndexes').ensureSpeedIndexes().catch((e) => console.error('Indexes:', e.message));

    // WhatsApp chats from AdsEra every 2 minutes — a backup for the webhook.
    const chats = require('./src/helpers/adseraSync');
    // Chats already in the inbox without a lead get one (or their existing one), once.
    setTimeout(() => require('./src/helpers/chatLead').linkAllChats().catch((e) => console.error('WhatsApp leads:', e.message)), 15 * 1000);
    setTimeout(() => chats.syncRecent().catch((e) => console.error('WhatsApp sync:', e.message)), 20 * 1000);
    setInterval(() => chats.syncRecent().catch((e) => console.error('WhatsApp sync:', e.message)), 2 * 60 * 1000);

    // The 6-day WhatsApp follow-up for new leads, every 5 minutes.
    const drip = require('./src/helpers/followupDrip');
    setInterval(() => drip.run().catch((e) => console.error('6-day follow-up:', e.message)), 5 * 60 * 1000);

    // Dated WhatsApp messages: activation, profile, renewal, expiry, check-in/out, thanks, feedback, birthdays.
    const lifecycle = require('./src/helpers/lifecycle');
    setInterval(() => lifecycle.run().catch((e) => console.error('Dated messages:', e.message)), 30 * 60 * 1000);

    // WhatsApp timers: booking reminders (2 days before) and staff follow-up reminders.
    const notify = require('./src/helpers/notify');
    setInterval(() => notify.sendBookingReminders().catch((e) => console.error('Booking reminders:', e.message)), 60 * 60 * 1000);
    setInterval(() => notify.sendFollowupReminders().catch((e) => console.error('Follow-up reminders:', e.message)), 10 * 60 * 1000);

    // Paid memberships from before Member IDs existed get theirs (SCS-1…).
    const { backfillMemberIds } = require('./src/helpers/memberId');
    setTimeout(() => backfillMemberIds().catch((e) => console.error('Member IDs:', e.message)), 10 * 1000);

    const shutdown = (signal) => () => {
      console.log(`\n${signal} received — closing the server`);
      server.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown('SIGINT'));
    process.on('SIGTERM', shutdown('SIGTERM'));

    process.on('unhandledRejection', (err) => {
      console.error('Unhandled rejection:', err);
      server.close(() => process.exit(1));
    });
  })
  .catch((err) => {
    console.error('Could not start:', err.message);
    process.exit(1);
  });
