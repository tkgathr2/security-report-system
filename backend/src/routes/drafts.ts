import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';

const router = Router();

const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret-key';

interface CastJwtPayload {
  userId: string;
  email: string;
}

function authenticateCast(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: '認証が必要です',
      details: {}
    });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, AUTH_SECRET) as CastJwtPayload;
    (req as Request & { castUser: CastJwtPayload }).castUser = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'トークンが無効または期限切れです',
      details: {}
    });
  }
}

router.put('/:project_unique_url', authenticateCast, async (req: Request, res: Response) => {
  try {
    const { project_unique_url } = req.params;
    const { payload_json, client_updated_at } = req.body;
    const castUserId = (req as Request & { castUser: CastJwtPayload }).castUser.userId;

    if (!payload_json || !client_updated_at) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'payload_json と client_updated_at は必須です',
        details: {}
      });
      return;
    }

    const projectResult = await pool.query(
      'SELECT id FROM projects WHERE unique_url = $1',
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

    const existingDraft = await pool.query(
      'SELECT id, client_updated_at, server_updated_at FROM report_drafts WHERE project_id = $1 AND cast_user_id = $2',
      [projectId, castUserId]
    );

    const now = new Date();

    if (existingDraft.rows.length === 0) {
      await pool.query(
        `INSERT INTO report_drafts (project_id, cast_user_id, payload_json, client_updated_at, server_updated_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [projectId, castUserId, payload_json, clientUpdatedAtDate, now]
      );

      res.status(200).json({
        ok: true,
        server_updated_at: now.toISOString()
      });
      return;
    }

    const existing = existingDraft.rows[0];
    const existingClientUpdatedAt = new Date(existing.client_updated_at);

    if (clientUpdatedAtDate > existingClientUpdatedAt) {
      await pool.query(
        `UPDATE report_drafts 
         SET payload_json = $1, client_updated_at = $2, server_updated_at = $3
         WHERE id = $4`,
        [payload_json, clientUpdatedAtDate, now, existing.id]
      );

      res.status(200).json({
        ok: true,
        server_updated_at: now.toISOString()
      });
      return;
    }

    if (clientUpdatedAtDate.getTime() === existingClientUpdatedAt.getTime()) {
      const existingServerUpdatedAt = new Date(existing.server_updated_at);
      if (now > existingServerUpdatedAt) {
        await pool.query(
          `UPDATE report_drafts 
           SET payload_json = $1, client_updated_at = $2, server_updated_at = $3
           WHERE id = $4`,
          [payload_json, clientUpdatedAtDate, now, existing.id]
        );

        res.status(200).json({
          ok: true,
          server_updated_at: now.toISOString()
        });
        return;
      }
    }

    res.status(200).json({
      ok: false,
      message: '競合により更新されませんでした（既存データの方が新しい）',
      server_updated_at: existing.server_updated_at
    });

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
    const castUserId = (req as Request & { castUser: CastJwtPayload }).castUser.userId;

    const projectResult = await pool.query(
      'SELECT id FROM projects WHERE unique_url = $1',
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
