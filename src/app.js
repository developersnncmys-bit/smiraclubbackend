const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const routes = require('./routes');
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
 * everyone's afternoon. In production only the listed origins get through.
 */
const isDev = process.env.NODE_ENV !== 'production';
const localhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  cors({
    origin(origin, done) {
      if (!origin) return done(null, true); // curl, Postman, server to server
      if (isDev && localhost.test(origin)) return done(null, true);
      if (origins.includes(origin)) return done(null, true);
      return done(new Error(`${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);

if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

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

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
