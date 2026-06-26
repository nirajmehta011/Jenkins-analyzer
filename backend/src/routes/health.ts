import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'jenkins-analyzer-backend',
    version: '1.0.0',
  });
});

export default router;
