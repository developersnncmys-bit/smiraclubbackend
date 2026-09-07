const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

/**
 * One connection, however many times this module is loaded.
 *
 * A serverless platform keeps a warm instance around and calls it again, so
 * the connection is cached on globalThis rather than in module scope — module
 * scope is not guaranteed to survive, and a fresh connection per request will
 * exhaust an Atlas cluster's connection limit.
 */
const cache = globalThis.__smiraMongo || (globalThis.__smiraMongo = { conn: null, promise: null });

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set — copy .env.example to .env');

  if (cache.conn && mongoose.connection.readyState === 1) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(uri, {
        serverSelectionTimeoutMS: 10000,
        // Fail a query outright rather than queue it against a database that
        // is not there — a buffered request just times out slowly.
        bufferCommands: false,
        maxPoolSize: 10,
      })
      .then((m) => {
        console.log(`MongoDB connected — ${m.connection.name}`);
        return m;
      })
      .catch((err) => {
        // Let the next request try again rather than cache the failure.
        cache.promise = null;
        throw err;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected');
  cache.conn = null;
  cache.promise = null;
});

module.exports = { connectDB, mongoose };
