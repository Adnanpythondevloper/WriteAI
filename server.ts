import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { handleGenerateRequest } from './server/aiHandler.ts';
import {
  verifyGooglePlayPurchase,
  queryVerifiedSubscription,
} from './server/billingHandler.ts';
import { EntitlementService } from './server/entitlementHandler.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // JSON Body Parser for API routes
  app.use(express.json({ limit: '10mb' }));

  // Health Check Endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      app: 'WriteAI – Smart AI Writer',
      package: 'com.writeai.smartwriter',
      hasApiKey: !!process.env.GEMINI_API_KEY,
    });
  });

  // User Entitlement & Usage Status
  app.get('/api/user/status', (req, res) => {
    const userId = (req.query.userId as string) || 'anon_default';
    const clientTrialStart = req.query.trialStart
      ? parseInt(req.query.trialStart as string, 10)
      : undefined;
    const user = EntitlementService.getOrCreateUser(userId, clientTrialStart);
    const limit = EntitlementService.getDailyLimit(user);
    const remaining = EntitlementService.getGenerationsRemaining(user);
    res.json({
      userId: user.userId,
      trialStartDate: user.trialStartDate,
      trialEndDate: user.trialEndDate,
      status: user.status,
      isPremium: user.isPremium,
      premiumExpiryDate: user.premiumExpiryDate,
      planId: user.planId,
      dailyLimit: limit,
      generationsCount: user.generationsCount,
      bonusGenerations: user.bonusGenerations,
      generationsRemaining: remaining,
    });
  });

  // QA & Developer Testing: Trial Simulation Endpoint
  app.post('/api/user/simulate-trial', (req, res) => {
    const { userId, daysLeft } = req.body || {};
    if (!userId || typeof daysLeft !== 'number') {
      res.status(400).json({ error: 'Missing userId or daysLeft parameter.' });
      return;
    }
    const user = EntitlementService.simulateUserTrialDays(userId, daysLeft);
    const limit = EntitlementService.getDailyLimit(user);
    const remaining = EntitlementService.getGenerationsRemaining(user);
    res.json({
      userId: user.userId,
      trialStartDate: user.trialStartDate,
      trialEndDate: user.trialEndDate,
      status: user.status,
      isPremium: user.isPremium,
      dailyLimit: limit,
      generationsRemaining: remaining,
    });
  });

  // Rewarded Ad completion bonus callback (Server Authority)
  app.post('/api/ads/reward-grant', (req, res) => {
    const { userId, adUnitId } = req.body || {};
    if (!userId) {
      res.status(400).json({ error: 'Missing userId parameter.' });
      return;
    }
    const result = EntitlementService.grantRewardedAdBonus(userId);
    res.json({
      success: true,
      rewardGranted: 1,
      generationsRemaining: result.remaining,
      adUnitId,
    });
  });

  // Centralized AI Generation with server rate-limiting
  app.post('/api/generate', async (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object') {
        res.status(400).json({ error: 'Invalid request body.' });
        return;
      }
      const result = await handleGenerateRequest(req.body);
      res.setHeader('Content-Type', 'application/json');
      res.json(result);
    } catch (error: any) {
      console.error('API /api/generate error:', error);
      const status = error.status || 500;
      res.status(status).setHeader('Content-Type', 'application/json').json({
        error: error.message || 'Error occurred while generating content with AI.',
      });
    }
  });

  // Google Play Billing Entitlement Verification
  app.post('/api/billing/verify', async (req, res) => {
    try {
      const result = await verifyGooglePlayPurchase(req.body);
      res.setHeader('Content-Type', 'application/json');
      res.json(result);
    } catch (error: any) {
      console.error('API /api/billing/verify error:', error);
      res.status(500).setHeader('Content-Type', 'application/json').json({
        error: error.message || 'Billing verification failed.',
      });
    }
  });

  // Google Play Restore Purchases Query
  app.post('/api/billing/restore', (req, res) => {
    const { userId } = req.body || {};
    if (!userId) {
      res.status(400).json({ error: 'Missing userId.' });
      return;
    }
    const check = queryVerifiedSubscription(userId);
    if (check.hasActive && check.record) {
      res.json({
        restored: true,
        entitlement: 'premium',
        message: 'Active WriteAI Premium subscription successfully verified and restored.',
        record: check.record,
      });
    } else {
      res.json({
        restored: false,
        entitlement: 'none',
        message: 'No active Google Play subscription was found for this Google account.',
      });
    }
  });

  // Check if we are running in development or production
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    // In dev mode, mount Vite middleware to serve client SPA & HMR
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve built dist files
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WriteAI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
