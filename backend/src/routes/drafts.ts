import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { authenticateCast } from '../middleware/auth';
import { AuthenticatedCastRequest } from '../types';
import { MAX_LENGTHS } from '../utils/validation';

const router = Router();

router.put('/:project_unique_url', authenticateCast, async (req: Request, res: Response) => {
  try {
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
    const clientUpdatedAtDate = new Date(client_updated_at);

    const now = new Date();

    const upsertResult = await pool.query(
      `INSERT INTO report_drafts (project_id, cast_user_id, payload_json, client_updated_at, server_updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, cast_user_id) DO UPDATE
         SET payload_json = EXCLUDED.payload_json,
             client_updated_at = EXCLUDED.client_updated_at,
             server_updated_at = EXCLUDED.server_updated_at
         WHERE report_drafts.client_updated_at <= EXCLUDED.client_updated_at
       RETURNING server_updated_at`,
      [projectId, castUserId, payload_json, clientUpdatedAtDate, now]
    );

    if (upsertResult.rows.length > 0) {
      res.status(200).json({
        ok: true,
        server_updated_at: upsertResult.rows[0].server_updated_at
      });
    } else {
      const existing = await pool.query(
        'SELECT server_updated_at FROM report_drafts WHERE project_id = $1 AND cast_user_id = $2',
        [projectId, castUserId]
      );
      res.status(200).json({
        ok: false,
        message: '競合により更新されませんでした（既存データの方が新しい）',
        server_updated_at: existing.rows[0]?.server_updated_at
      });
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
