import { Router, Request, Response } from 'express';

const router = Router();

router.get('/me', (req: Request, res: Response) => {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    res.status(401).json({
      error: 'ADMIN_UNAUTHORIZED',
      message: '管理者セッションがありません',
      details: {}
    });
    return;
  }

  res.json({
    admin: {
      id: req.user.id,
      email: req.user.email
    }
  });
});

export default router;
