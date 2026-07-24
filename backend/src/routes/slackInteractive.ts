/**
 * Slack Interactive Components 受信口。
 *
 * 役割: procast-sync が Slack に投げた「1日1現場」重複カードのボタン押下
 *       (block_actions) を受け取り、duplicate_acks に記録してカードを書き換える。
 *
 * 認証方式:
 *   - 管理者 JWT/セッション認証はかけない（Slack からの直接呼び出しのため）。
 *   - 代わりに Slack 署名検証（x-slack-signature / x-slack-request-timestamp）を
 *     必須のゲートとする。SLACK_SIGNING_SECRET が未設定なら 503 で明示的に機能無効化する
 *     （フェイルクローズ＝検証をスキップして通す、は絶対にしない）。
 *   - Slack は interactive payload を `application/x-www-form-urlencoded` で送る
 *     （`payload=<urlencoded JSON>`）。署名は生ボディに対して計算されるため、
 *     express.json() でパースされる前の raw body を route 単位で取得する。
 *     index.ts 側で express.json() は content-type が application/json のときだけ
 *     ボディを消費するため、x-www-form-urlencoded のこのルートでは未消費のまま
 *     ここまで届く（express.raw() で安全に取得できる）。
 *   - index.ts では本 router を requireJsonContentType / csrfOriginGuard より前に
 *     マウントし、それらの「Content-Type: application/json 必須」「Origin一致必須」
 *     チェックの対象から外している（Slack はどちらも満たさないため）。
 */
import { Router, Request, Response, raw } from 'express';
import crypto from 'crypto';
import pool from '../db/pool';
import { logAudit } from '../utils/auditLog';

const router = Router();

const TIMESTAMP_TOLERANCE_SEC = 5 * 60; // ±5分

interface SlackBlockActionValue {
  staffKey: string;
  workDate: string; // YYYY-MM-DD
  castName: string;
  existingWork?: string;
  newWork?: string;
  displayText?: string;
}

/**
 * Slack 署名検証。x-slack-signature (v0=...) と
 * HMAC-SHA256("v0:{timestamp}:{rawBody}", secret) を定数時間比較する。
 */
function verifySlackSignature(secret: string, timestamp: string, rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** YYYY-MM-DD → M/D（Slack表示用の簡易日本語日付） */
function formatDateJp(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

router.post('/interactive', raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error('[slackInteractive] SLACK_SIGNING_SECRET が未設定のため機能を無効化しています');
    res.status(503).json({ error: 'SLACK_SIGNING_SECRET が未設定です' });
    return;
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];
  const timestampStr = Array.isArray(timestamp) ? timestamp[0] : timestamp;
  const signatureStr = Array.isArray(signature) ? signature[0] : signature;

  if (!timestampStr) {
    res.status(401).json({ error: 'x-slack-request-timestamp がありません' });
    return;
  }

  // リプレイ攻撃対策: タイムスタンプが±5分を超えていたら拒否
  const nowSec = Math.floor(Date.now() / 1000);
  const tsSec = parseInt(timestampStr, 10);
  if (!Number.isFinite(tsSec) || Math.abs(nowSec - tsSec) > TIMESTAMP_TOLERANCE_SEC) {
    res.status(401).json({ error: 'リクエストのタイムスタンプが古すぎます' });
    return;
  }

  if (!verifySlackSignature(signingSecret, timestampStr, rawBody, signatureStr)) {
    res.status(401).json({ error: '署名検証に失敗しました' });
    return;
  }

  // 署名OK。ここから先は正当な Slack リクエストとして処理する。
  const params = new URLSearchParams(rawBody);
  const payloadRaw = params.get('payload');
  if (!payloadRaw) {
    res.status(400).json({ error: 'payload がありません' });
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    res.status(400).json({ error: 'payload のJSON解析に失敗しました' });
    return;
  }

  if (payload?.type !== 'block_actions') {
    // dup_ok 以外（url型ボタン等）はSlack側で完結するため、ここでは何もせず200を返す
    res.status(200).send('');
    return;
  }

  const action = Array.isArray(payload.actions)
    ? payload.actions.find((a: any) => a?.action_id === 'dup_ok')
    : undefined;

  if (!action) {
    // dup_ok 以外のアクションは対象外
    res.status(200).send('');
    return;
  }

  let value: SlackBlockActionValue;
  try {
    value = JSON.parse(action.value);
  } catch {
    res.status(400).json({ error: 'ボタンvalueのJSON解析に失敗しました' });
    return;
  }

  if (!value?.staffKey || !value?.workDate) {
    res.status(400).json({ error: 'staffKey/workDate がありません' });
    return;
  }

  const ackedByDisplay: string = payload.user?.username || payload.user?.id || 'unknown';

  try {
    // 二重押し防止: DB条件付きINSERT（ON CONFLICT DO NOTHING）で先着1件だけ確定させる。
    const insertResult = await pool.query(
      `INSERT INTO duplicate_acks (staff_key, work_date, acked_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (staff_key, work_date) DO NOTHING
       RETURNING acked_by, acked_at`,
      [value.staffKey, value.workDate, ackedByDisplay]
    );

    let ackedBy: string = ackedByDisplay;
    let ackedAt: Date = new Date();
    if (insertResult.rows.length > 0) {
      ackedBy = insertResult.rows[0].acked_by;
      ackedAt = insertResult.rows[0].acked_at;
    } else {
      // 既にACK済み（二重押し）。既存の記録をそのままカードに反映する。
      const existing = await pool.query(
        `SELECT acked_by, acked_at FROM duplicate_acks WHERE staff_key = $1 AND work_date = $2`,
        [value.staffKey, value.workDate]
      );
      if (existing.rows.length > 0) {
        ackedBy = existing.rows[0].acked_by ?? ackedByDisplay;
        ackedAt = existing.rows[0].acked_at ?? ackedAt;
      }
    }

    logAudit({
      actorEmail: ackedByDisplay,
      actorType: 'system',
      action: 'DUPLICATE_ACK',
      targetType: 'duplicate_acks',
      targetId: `${value.staffKey}::${value.workDate}`,
      payload: { staffKey: value.staffKey, workDate: value.workDate, castName: value.castName },
    }).catch(() => { /* 監査ログ失敗は無視（本処理は継続） */ });

    const ackedAtDisplay = new Date(ackedAt).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const castNameDisplay = value.castName || value.staffKey;
    const cardText = `〔OK済み〕${castNameDisplay} ${formatDateJp(value.workDate)} の重複は今後通知されません（${ackedBy}さんが承認・${ackedAtDisplay}）`;

    // カード更新は response_url 経由で行う（chat.update は使わない＝社内ルール）。
    if (payload.response_url) {
      try {
        await fetch(payload.response_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replace_original: true, text: cardText }),
          signal: AbortSignal.timeout(5_000),
        });
      } catch (responseUrlErr) {
        console.error('[slackInteractive] response_url へのカード更新に失敗:', responseUrlErr);
      }
    }

    res.status(200).send('');
  } catch (err) {
    console.error('[slackInteractive] duplicate_acks 処理エラー:', err);
    res.status(500).json({ error: 'ACK処理に失敗しました' });
  }
});

export default router;
