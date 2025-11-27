import express from 'express';
import helmet from 'helmet';
import { config } from './config';
import { corsMiddleware } from './middleware/cors';
import { apiLimiter } from './middleware/rateLimit';
import passportRoutes from './routes/passport';
import { getSignerAddress } from './services/signer';

const app = express();

// Security
app.use(helmet());
app.use(corsMiddleware);

// Parsing
app.use(express.json());

// Rate limiting
app.use('/api/', apiLimiter);

// Routes
app.use('/api/passport', passportRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((_req, res) => {
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
    res.status(500).json({ error: 'Internal server error' });
  }
);

// Start server
app.listen(config.port, () => {
  console.log(`Passport signer running on port ${config.port}`);
  console.log(`Signer address: ${getSignerAddress()}`);
});
