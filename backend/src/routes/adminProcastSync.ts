/**
 * 管理画面「🔄 プロキャストから今すぐ取り込み」ボタンの backend エンドポイント。
 *
 * 役割: ブラウザに TRIGGER_API_TOKEN を渡さず、backend が proxy として
 *       procast-sync の `/trigger` を Bearer 認証で叩く。
 *
 * 制約:
 *  - requireAdmin（admin 認可のみ）
 *  - 同じキーで 5 分以内の連打を防止（DB 永続化・プロセス再起動後も有効）
 *  - procast-sync 側にも独自の二重実行ロック機構あり（ダブルガード）
 *  - PROCAST_SYNC_TRIGGER_TOKEN が未設定なら 503 を返し、機能を明示無効化
 */
import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/auth';
import { logAudit } from '../utils/auditLog';
import pool from '../db/pool';

const router = Router();

const DEFAULT_TRIGGER_URL = 'https://procast-sync-production-ebc1.up.railway.app/trigger';
const COOLDOWN_MS = 5 * 60 * 1000;
const COOLDOWN_KEY = 'procast_sync_cooldown';

/**
 * rate_limits テーブルに COOLDOWN_KEY 行が存在しなければクールダウン未使用。
 * 行があり locked_until が未来ならクールダウン中。
 * 返り値: { allowed: true } or { allowed: false, remainSec: number }
 */
async function checkAndClaimCooldown(now: number): Promise<{ allowed: boolean; remainSec?: number }> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      locked_until BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT locked_until FROM rate_limits WHERE key = $1 FOR UPDATE',
      [COOLDOWN_KEY]
    );

    if (existing.rows.length > 0) {
      const lockedUntil = Number(existing.rows[0].locked_until);
      if (lockedUntil > now) {
        await client.query('COMMIT');
        return { allowed: false, remainSec: Math.ceil((lockedUntil - now) / 1000) };
      }
      // 期限切れ → 上書き
      await client.query(
        'UPDATE rate_limits SET locked_until = $1, updated_at = NOW() WHERE key = $2',
        [now + COOLDOWN_MS, COOLDOWN_KEY]
      );
    } else {
      await client.query(
        `INSERT INTO rate_limits (key, count, locked_until, updated_at)
         VALUES ($1, 1, $2, NOW())`,
        [COOLDOWN_KEY, now + COOLDOWN_MS]
      );
    }

    await client.query('COMMIT');
    return { allowed: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** テスト専用: クールダウン状態を DB からリセットする */
export async function _resetCooldownForTests(): Promise<void> {
  await pool.query('DELETE FROM rate_limits WHERE key = $1', [COOLDOWN_KEY]);
}

router.post('/trigger', requireAdmin, async (req: Request, res: Response) => {
  const triggerUrl = process.env.PROCAST_SYNC_TRIGGER_URL || DEFAULT_TRIGGER_URL;
  const triggerToken = process.env.PROCAST_SYNC_TRIGGER_TOKEN || '';

  if (!triggerToken) {
    res.status(503).json({
      error: '今すぐ取り込み機能は未設定です（PROCAST_SYNC_TRIGGER_TOKEN）。',
    });
    return;
  }

  const now = Date.now();
  const cooldown = await checkAndClaimCooldown(now);
  if (!cooldown.allowed) {
    res.status(429).json({
      error: `直前の取り込みから5分以内です。あと約 ${cooldown.remainSec} 秒お待ちください。`,
      retryAfterSec: cooldown.remainSec,
    });
    return;
  }

  try {
    const upstream = await fetch(triggerUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${triggerToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) {
      // upstream 失敗時はクールダウンを解除して即再試行を許す
      await pool.query('DELETE FROM rate_limits WHERE key = $1', [COOLDOWN_KEY]);

      const bodyText = await upstream.text().catch(() => '');
      res.status(502).json({
        error: `取り込み係に繋がりませんでした（upstream ${upstream.status}）`,
        upstreamBody: bodyText.slice(0, 500),
      });
      return;
    }

    const adminUser = req.user as { email?: string } | undefined;
    logAudit({
      req,
      actorEmail: adminUser?.email ?? 'unknown',
      action: 'TRIGGER_PROCAST_SYNC',
      targetType: 'procast_sync',
      targetId: 'manual_trigger',
      payload: { triggeredAtMs: now },
    });

    res.status(202).json({
      message: '取り込みを開始しました。約1〜2分で完了通知がSlackに届きます。',
      triggeredAtMs: now,
    });
  } catch (err) {
    // fetch 例外（タイムアウト等）時もクールダウンを解除
    await pool.query('DELETE FROM rate_limits WHERE key = $1', [COOLDOWN_KEY]).catch(() => {});

    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      error: '取り込み係に繋がりませんでした（タイムアウトまたは接続失敗）',
      detail: msg,
    });
  }
});

export default router;
