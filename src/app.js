const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const routes = require('./routes');
const { isProduction, isTest } = require('./config/env');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const origins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * In development any localhost port is fine — Vite moves to 5174, 5175 and on
 * whenever a port is busy, and chasing that in a config file is a waste of
 * everyone's afternoon.
 */
const isDev = !isProduction;
const localhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * The panel's own deployments, allowed without anybody having to set an
 * environment variable. Vercel gives every build its own hostname — the
 * production one, plus a preview per commit — so the whole family is matched
 * rather than one URL that goes stale on the next deploy. CORS_ORIGIN still
 * adds to this, which is where a custom domain goes.
 */
const ownDeployments = /^https:\/\/smiraclub[a-z0-9-]*\.vercel\.app$/;

const allowed = (origin) =>
  (isDev && localhost.test(origin)) || origins.includes(origin) || ownDeployments.test(origin);

app.use(
  cors({
    /**
     * A disallowed origin is not a server error. Throwing here turned every
     * preflight into a 500, which reads in the browser as "the API is broken"
     * rather than "that origin is not on the list" — so answer without the
     * CORS headers and let the browser do the blocking, which is its job.
     */
    origin(origin, done) {
      if (!origin) return done(null, true); // curl, Postman, server to server
      return done(null, allowed(origin));
    },
    credentials: true,
  })
);

if (!isTest) app.use(morgan('dev'));

// Signing in is the one route worth throttling — everything else sits
// behind a token already.
const signInLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', signInLimiter);
app.use('/api/auth/otp', signInLimiter);

app.get('/health', (req, res) =>
  res.json({ ok: true, service: 'smira-api', at: new Date().toISOString() })
);

/** Landing on the root should say what this is, not 404. */
app.get('/', (req, res) =>
  res.json({
    success: true,
    service: 'Smira Club API',
    docs: 'Every module is under /api — GET /api lists them',
    health: '/health',
  })
);

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
