import { Router, Request, Response } from 'express';

const router = Router();

/**
 * GET /health — process-level health check (no auth required).
 * SRV-03: Returns uptime and timestamp for load balancer / orchestrator checks.
 * Rate-limited in app.ts via publicRateLimiter.
 */
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status:    'ok',
    uptime:    process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
