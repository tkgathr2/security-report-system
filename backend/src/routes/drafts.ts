import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { authenticateCast } from '../middleware/auth';
import { AuthenticatedCastRequest } from '../types';
import { MAX_LENGTHS } from '../utils/validation';

const router = Router();

router.put('/:project_unique_url', authenticateCast, async (req: Request, res: Response) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'リクエストボディはJSON形式で送信してください',
        details: {}
      });
      return;
    }

    const { project_unique_url } = req.params;
    const { payload_json, client_updated_at } = req.body;
    const castUserId = (req as AuthenticatedCastRequest).castUser.userId;

    if (!payload_json || !client_updated_at) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'payload_json と client_updated_at は必須です',
        details: {}
      });
      return;
    }

    const payloadStr = typeof payload_json === 'string' ? payload_json : JSON.stringify(payload_json);
    if (payloadStr.length > MAX_LENGTHS.DRAFT_PAYLOAD) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: '下書きデータが大きすぎます',
        details: {}
      });
      return;
    }

    const projectResult = await pool.query(
      'SELECT id, status FROM projects WHERE unique_url = $1 AND deleted_at IS NULL',
      [project_unique_url]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '案件が見つかりません',
        details: {}
      });
      return;
    }

    // ③ 案件取消: 中止案件には下書きを保存させない（read/submit ガードと基準を揃え、書き込みの裏口を塞ぐ）
    if (projectResult.rows[0].status === 'cancelled') {
      res.status(409).json({
        error: 'CANCELLED',
        message: 'この案件は中止されたため、下書きを保存できません',
        details: {}
      });
      return;
    }

    const projectId = projectResult.rows[0].id;
    const clientUpdatedAtDate = new Date(client_updated_at);

    const now = new Date();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const upsertResult = await client.query(
        `INSERT INTO report_drafts (project_id, cast_user_id, payload_json, client_updated_at, server_updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (project_id, cast_user_id) DO UPDATE
           SET payload_json = EXCLUDED.payload_json,
               client_updated_at = EXCLUDED.client_updated_at,
               server_updated_at = EXCLUDED.server_updated_at
           WHERE report_drafts.client_updated_at <= EXCLUDED.client_updated_at
         RETURNING server_updated_at, client_updated_at`,
        [projectId, castUserId, payload_json, clientUpdatedAtDate, now]
      );

      await client.query('COMMIT');

      if (upsertResult.rows.length > 0) {
        res.status(200).json({
          ok: true,
          server_updated_at: upsertResult.rows[0].server_updated_at
        });
      } else {
        const existing = await client.query(
          'SELECT server_updated_at, client_updated_at FROM report_drafts WHERE project_id = $1 AND cast_user_id = $2',
          [projectId, castUserId]
        );
        res.status(200).json({
          ok: false,
          message: '競合により更新されませんでした（既存データの方が新しい）',
          server_updated_at: existing.rows[0]?.server_updated_at,
          existing_client_updated_at: existing.rows[0]?.client_updated_at
        });
      }
    } catch (txErr: unknown) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Draft PUT error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: '下書き保存中にエラーが発生しました',
      details: {}
    });
  }
});

router.get('/:project_unique_url', authenticateCast, async (req: Request, res: Response) => {
  try {
    const { project_unique_url } = req.params;
    const castUserId = (req as AuthenticatedCastRequest).castUser.userId;

    const projectResult = await pool.query(
      'SELECT id FROM projects WHERE unique_url = $1 AND deleted_at IS NULL',
      [project_unique_url]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '案件が見つかりません',
        details: {}
      });
      return;
    }

    const projectId = projectResult.rows[0].id;

    const draftResult = await pool.query(
      'SELECT payload_json, client_updated_at, server_updated_at FROM report_drafts WHERE project_id = $1 AND cast_user_id = $2',
      [projectId, castUserId]
    );

    if (draftResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '下書きが見つかりません',
        details: {}
      });
      return;
    }

    const draft = draftResult.rows[0];

    res.status(200).json({
      payload_json: draft.payload_json,
      client_updated_at: draft.client_updated_at,
      server_updated_at: draft.server_updated_at
    });

  } catch (error) {
    console.error('Draft GET error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: '下書き取得中にエラーが発生しました',
      details: {}
    });
  }
});

export default router;
