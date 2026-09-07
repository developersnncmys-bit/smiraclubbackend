/**
 * What Vercel invokes.
 *
 * Nothing calls listen() here — the platform hands us a request and expects
 * the app to answer it. The database has to be up before Express sees the
 * request, or every query queues against nothing.
 */
const app = require('../src/app');
const { connectDB } = require('../src/config/db');

module.exports = async (req, res) => {
  try {
    await connectDB();
  } catch (err) {
    console.error('Database unavailable:', err.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(
      JSON.stringify({ success: false, message: 'The database is unavailable — try again shortly' })
    );
  }

  return app(req, res);
};
