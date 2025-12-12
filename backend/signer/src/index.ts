import express from 'express';
import helmet from 'helmet';
import { config } from './config';
import cors from 'cors';
import { corsMiddleware, optionsHandler } from './middleware/cors';
import { apiLimiter } from './middleware/rateLimit';
import passportRoutes from './routes/passport';
import profileRoutes from './routes/profile';
import delegationRoutes from './routes/delegation';
import governanceRoutes from './routes/governance';
import treasuryRoutes from './routes/treasury';
import redemptionRoutes from './routes/redemption';
import delegateScoringRoutes from './routes/delegateScoring';
import vpRefreshRoutes from './routes/vpRefresh';
import auctionRoutes from './routes/auction';
import whitelistRoutes from './routes/whitelist';
import disputeRoutes from './routes/dispute';
import githubRoutes from './routes/github';
import backupRoutes from './routes/backup';
import slowTrackRoutes from './routes/slowTrack';
import { getSignerAddress } from './services/signer';
import { runMigrations } from './db/migrate';
import { waitForDatabase } from './db/pool';
import { startRebalanceCron } from './cron/rebalance';
import { startNavHistoryCron } from './cron/nav-history';
import { startDelegateScoringCron } from './cron/delegateScoring';
import { startBackupCron } from './cron/backup';
import { startVPRefreshWatcher } from './services/vpRefresh';
import { startDepositWatcher } from './services/depositWatcher';
import { startRedemptionWatcher } from './services/redemptionWatcher';
import { startTaskWatcher } from './services/taskWatcher';
import { startDisputeWatcher } from './services/disputeWatcher';
import { startStakerIndexer } from './services/stakerIndexer';
import { startSlowTrackWatcher } from './services/slowTrackWatcher';
import { startSnapshotWatcher } from './cron/snapshotWatcher';

const app = express();

// Trust first proxy (Akash ingress) for correct IP detection in rate limiting
app.set('trust proxy', 1);

// CORS — ONE middleware, first
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
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
app.use('/api/delegation', delegationRoutes);
app.use('/api/governance', governanceRoutes);
app.use('/api/treasury', treasuryRoutes);
app.use('/api/treasury', redemptionRoutes);
app.use('/api/delegate-scoring', delegateScoringRoutes);
app.use('/api/vp-refresh', vpRefreshRoutes);
app.use('/api/auction', auctionRoutes);
app.use('/api/whitelist', whitelistRoutes);
app.use('/api/dispute', disputeRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/slow-track', slowTrackRoutes);

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

  // Start scheduled tasks
  startRebalanceCron();
  startNavHistoryCron();
  startDelegateScoringCron();
  startBackupCron();

  // Start event watchers (Phase 4)
  startVPRefreshWatcher();

  // Start deposit watcher for LiFi diversification (Phase 3)
  startDepositWatcher().catch((err) => {
    console.error('[DepositWatcher] Failed to start:', err);
  });

  // Start redemption watcher for on-demand liquidation (Phase 5)
  startRedemptionWatcher().catch((err) => {
    console.error('[RedemptionWatcher] Failed to start:', err);
  });

  // Start task watcher for GitHub PR auto-merge
  startTaskWatcher().catch((err) => {
    console.error('[TaskWatcher] Failed to start:', err);
  });

  // Start dispute watcher to sync disputes to database for admin panel
  startDisputeWatcher().catch((err) => {
    console.error('[DisputeWatcher] Failed to start:', err);
  });

  // Start staker indexer for VP snapshot support
  startStakerIndexer().catch((err) => {
    console.error('[StakerIndexer] Failed to start:', err);
  });

  // Start snapshot watcher for Fast Track proposal VP snapshots
  startSnapshotWatcher().catch((err) => {
    console.error('[SnapshotWatcher] Failed to start:', err);
  });

  // Start slow track watcher for VP allocation sync
  startSlowTrackWatcher().catch((err) => {
    console.error('[SlowTrackWatcher] Failed to start:', err);
  });

  app.listen(config.port, () => {
    console.log(`Passport signer running on port ${config.port}`);
    console.log(`Signer address: ${getSignerAddress()}`);
    if (config.database.url) {
      console.log('Database: connected');
    }
  });
}

start();
