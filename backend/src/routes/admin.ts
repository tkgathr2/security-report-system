import { Router, Request, Response } from 'express';
import pool from '../db/pool';

const router = Router();

function requireAdmin(req: Request, res: Response, next: () => void): void {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    res.status(401).json({
      error: 'ADMIN_UNAUTHORIZED',
      message: '管理者セッションがありません',
      details: {}
    });
    return;
  }
  next();
}

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

router.get('/projects', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.project_key, p.client_name_raw, p.work_date, p.work_name, 
              p.location, p.status, p.unique_url, p.url_expires_at, p.created_at,
              c.name as client_name
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       ORDER BY p.work_date DESC, p.created_at DESC
       LIMIT 100`
    );

    res.json({
      projects: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Projects list error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

router.get('/reports', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.project_id, r.supervisor_name, r.writer_name, r.weather,
              r.status, r.approved_at, r.created_at, r.pdf_generation_status,
              length(r.pdf_bytes) as pdf_size,
              p.client_name_raw, p.work_date, p.work_name, p.location
       FROM reports r
       JOIN projects p ON r.project_id = p.id
       ORDER BY r.approved_at DESC, r.created_at DESC
       LIMIT 100`
    );

    res.json({
      reports: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Reports list error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

export default router;
