import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import pool from '../db/pool';
import { sendNotFound, sendForbidden, sendExpired, handleDbError } from '../utils/errorHandler';

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
  supervisor_name: string | null;
  created_at: Date;
  updated_at: Date;
}

router.get('/:unique_url', async (req: Request, res: Response) => {
  try {
    const { unique_url } = req.params;

    const result = await pool.query(
      `SELECT id, project_key, client_id, client_name_raw, work_date, work_name, 
              location, start_time, end_time, break_time, work_title_raw, 
              qualifier_hint, unique_url, url_expires_at, status, supervisor_name, created_at, updated_at
       FROM projects 
       WHERE unique_url = $1`,
      [unique_url]
    );

    if (result.rows.length === 0) {
      sendNotFound(res, '案件が見つかりません');
      return;
    }

    const project: Project = result.rows[0];

    // Check if report already exists for this project
    const existingReportResult = await pool.query(
      'SELECT id FROM reports WHERE project_id = $1',
      [project.id]
    );

    if (existingReportResult.rows.length > 0) {
      res.status(303).json({
        error: 'ALREADY_SUBMITTED',
        message: 'この案件の報告書は既に提出されています',
        details: {}
      });
      return;
    }

    const castsResult = await pool.query(
      `SELECT staff_no, cast_name FROM project_casts WHERE project_id = $1 ORDER BY row_index`,
      [project.id]
    );
    const casts = castsResult.rows;

    const hasQualifier = project.qualifier_hint !== null && project.qualifier_hint.includes('有');

    const now = new Date();
    const expiresAt = new Date(project.url_expires_at);
    if (expiresAt < now) {
      sendExpired(res, '期限切れ');
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
        status: project.status,
        supervisor_name: project.supervisor_name || null,
        has_qualifier: hasQualifier,
        casts: casts.map(c => ({ staff_no: c.staff_no, name: c.cast_name }))
      }
    });
  } catch (error) {
    handleDbError(res, error, 'Project fetch');
  }
});

router.post('/test/create', async (req: Request, res: Response) => {
  try {
    const { client_email } = req.body;
    const uniqueUrl = crypto.randomUUID();
    const projectKey = crypto.randomBytes(8).toString('hex');
    const workDate = new Date();
    workDate.setDate(workDate.getDate() + 2);
    const urlExpiresAt = new Date();
    urlExpiresAt.setDate(urlExpiresAt.getDate() + 7);

    let clientId = null;
    if (client_email) {
      // First try to find existing client
      const existingClient = await pool.query(
        `SELECT id FROM clients WHERE name = $1`,
        ['テスト株式会社']
      );
      
      if (existingClient.rows.length > 0) {
        // Update existing client's emails
        await pool.query(
          `UPDATE clients SET emails = $1 WHERE id = $2`,
          [[client_email], existingClient.rows[0].id]
        );
        clientId = existingClient.rows[0].id;
      } else {
        // Create new client with name_normalized
        const clientResult = await pool.query(
          `INSERT INTO clients (name, name_normalized, emails) VALUES ($1, $2, $3) RETURNING id`,
          ['テスト株式会社', 'テスト株式会社', [client_email]]
        );
        clientId = clientResult.rows[0].id;
      }
    }

    const result = await pool.query(
      `INSERT INTO projects (
        project_key, client_id, client_name_raw, work_date, work_name, location,
        work_title_raw, unique_url, url_expires_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, unique_url`,
      [
        projectKey,
        clientId,
        'テスト株式会社',
        workDate,
        'テスト警備業務',
        '東京都渋谷区テストビル',
        'テスト案件',
        uniqueUrl,
        urlExpiresAt,
        'active'
      ]
    );

    res.status(201).json({
      ok: true,
      project: {
        id: result.rows[0].id,
        unique_url: result.rows[0].unique_url,
        report_url: `/report/${result.rows[0].unique_url}`,
        client_email: client_email || null
      }
    });
  } catch (error) {
    handleDbError(res, error, 'Test project creation');
  }
});

export default router;
