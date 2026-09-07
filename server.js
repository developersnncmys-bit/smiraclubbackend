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
