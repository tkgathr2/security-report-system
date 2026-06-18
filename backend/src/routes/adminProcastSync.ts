/**
 * 管理画面「🔄 プロキャストから今すぐ取り込み」ボタンの backend エンドポイント。
 *
 * 役割: ブラウザに TRIGGER_API_TOKEN を渡さず、backend が proxy として
 *       procast-sync の `/trigger` を Bearer 認証で叩く。
 *
 * 制約:
 *  - requireAdmin（admin 認可のみ）
 *  - 同プロセス内で 5 分以内の連打を防止（in-memory・プロセス再起動でリセット）
 *  - procast-sync 側にも独自の二重実行ロック機構あり（ダブルガード）
 *  - PROCAST_SYNC_TRIGGER_TOKEN が未設定なら 503 を返し、機能を明示無効化
 */
import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/auth';
import { logAudit } from '../utils/auditLog';

const router = Router();

const DEFAULT_TRIGGER_URL = 'https://procast-sync-production-ebc1.up.railway.app/trigger';
const COOLDOWN_MS = 5 * 60 * 1000;

let lastTriggeredAtMs: number | null = null;

export function _resetCooldownForTests(): void {
  lastTriggeredAtMs = null;
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
  if (lastTriggeredAtMs !== null && now - lastTriggeredAtMs < COOLDOWN_MS) {
    const remainSec = Math.ceil((COOLDOWN_MS - (now - lastTriggeredAtMs)) / 1000);
    res.status(429).json({
      error: `直前の取り込みから5分以内です。あと約 ${remainSec} 秒お待ちください。`,
      retryAfterSec: remainSec,
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
      const bodyText = await upstream.text().catch(() => '');
      res.status(502).json({
        error: `取り込み係に繋がりませんでした（upstream ${upstream.status}）`,
        upstreamBody: bodyText.slice(0, 500),
      });
      return;
    }

    lastTriggeredAtMs = now;

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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      error: '取り込み係に繋がりませんでした（タイムアウトまたは接続失敗）',
      detail: msg,
    });
  }
});

export default router;
