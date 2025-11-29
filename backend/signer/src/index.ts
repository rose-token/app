import express from 'express';
import helmet from 'helmet';
import { config } from './config';
import cors from 'cors';
import { corsMiddleware, optionsHandler } from './middleware/cors';
import { apiLimiter } from './middleware/rateLimit';
import passportRoutes from './routes/passport';
import profileRoutes from './routes/profile';
import { getSignerAddress } from './services/signer';
import { runMigrations } from './db/migrate';
import { waitForDatabase } from './db/pool';

const app = express();

// Trust first proxy (Akash ingress) for correct IP detection in rate limiting
app.set('trust proxy', 1);

// CORS — ONE middleware, first
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));



// Helmet AFTER cors
app.use(helmet({
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false,
}));

// Parsing
app.use(express.json());

// Rate limiting
app.use('/api/', apiLimiter);

// Routes
app.use('/api/passport', passportRoutes);
app.use('/api/profile', profileRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 404
app.use((_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Unhandled error:', err);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: 'Internal server error' });
  }
);

// Start server with migrations
async function start() {
  // Run database migrations if DATABASE_URL is configured
  if (config.database.url) {
    try {
      await waitForDatabase();
      await runMigrations();
    } catch (err) {
      console.error('Failed to connect to database or run migrations:', err);
      process.exit(1);
    }
  } else {
    console.log('DATABASE_URL not configured, skipping migrations');
  }

  app.listen(config.port, () => {
    console.log(`Passport signer running on port ${config.port}`);
    console.log(`Signer address: ${getSignerAddress()}`);
    if (config.database.url) {
      console.log('Database: connected');
    }
  });
}

start();
