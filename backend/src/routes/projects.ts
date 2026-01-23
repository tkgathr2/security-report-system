import { Router, Request, Response } from 'express';
import pool from '../db/pool';

const router = Router();

interface Project {
  id: string;
  project_key: string;
  client_id: string | null;
  client_name_raw: string;
  work_date: string;
  work_name: string;
  location: string;
  start_time: string | null;
  end_time: string | null;
  break_time: string | null;
  work_title_raw: string;
  qualifier_hint: string | null;
  unique_url: string;
  url_expires_at: Date;
  status: string;
  created_at: Date;
  updated_at: Date;
}

router.get('/:unique_url', async (req: Request, res: Response) => {
  try {
    const { unique_url } = req.params;

    const result = await pool.query(
      `SELECT id, project_key, client_id, client_name_raw, work_date, work_name, 
              location, start_time, end_time, break_time, work_title_raw, 
              qualifier_hint, unique_url, url_expires_at, status, created_at, updated_at
       FROM projects 
       WHERE unique_url = $1`,
      [unique_url]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '案件が見つかりません',
        details: {}
      });
      return;
    }

    const project: Project = result.rows[0];

    if (project.status === 'pending_client') {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: '未登録会社のため保留',
        details: {}
      });
      return;
    }

    const now = new Date();
    const expiresAt = new Date(project.url_expires_at);
    if (expiresAt < now) {
      res.status(410).json({
        error: 'EXPIRED_URL',
        message: '期限切れ',
        details: {}
      });
      return;
    }

    res.status(200).json({
      project: {
        id: project.id,
        project_key: project.project_key,
        client_name_raw: project.client_name_raw,
        work_date: project.work_date,
        work_name: project.work_name,
        location: project.location,
        start_time: project.start_time,
        end_time: project.end_time,
        break_time: project.break_time,
        work_title_raw: project.work_title_raw,
        qualifier_hint: project.qualifier_hint,
        unique_url: project.unique_url,
        status: project.status
      }
    });
  } catch (error) {
    console.error('Project fetch error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: '案件取得中にエラーが発生しました',
      details: {}
    });
  }
});

export default router;
