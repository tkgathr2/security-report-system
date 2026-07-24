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
  // payload 由来の値は型が保証されないため、文字列以外が来ても throw させない
  // （ここで throw すると呼び出し元の非同期処理が未処理Promise拒否になり、
  //   index.ts の unhandledRejection ハンドラがプロセスごと落とす）。
  if (typeof dateStr !== 'string') return String(dateStr ?? '');
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

/** work_date として受け入れる形式（DBは date 型なので厳密に絞る） */
const WORK_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Slack の mrkdwn 制御記法を無害化する。
 * castName 等は CSV 由来の外部データで、`<!channel>` や
 * `<https://evil/|正規リンクに見えるテキスト>` を仕込めてしまうため、
 * Slack 公式のエスケープ規則どおり & < > を実体参照へ置換する（& を先に処理する）。
 */
function escapeSlack(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Slack が発行する response_url だけを許可する。
 * payload はリクエストボディ由来なので、検証せず fetch すると
 * 内部ネットワークへ任意 POST できる SSRF になる。
 */
function isSlackResponseUrl(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' && parsed.hostname === 'hooks.slack.com';
  } catch {
    return false;
  }
}

/**
 * 投稿先チャンネルの許可判定。
 * payload.channel.id をそのまま信じると、署名を作れる相手に
 * Bot が参加する任意チャンネルへ任意文面を投稿させられる。
 * 既定は SLACK_CHANNEL_ID（本来の通知先）のみ許可する。
 */
function isAllowedChannel(channelId: unknown): channelId is string {
  if (typeof channelId !== 'string' || !channelId) return false;
  const allowed = (process.env.SLACK_ALLOWED_CHANNEL_IDS || process.env.SLACK_CHANNEL_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // 許可リストが未設定なら塞ぐ（fail-closed）
  if (allowed.length === 0) return false;
  return allowed.includes(channelId);
}

/**
 * 「修正する」を押したことを記録に残す。
 *
 * duplicate_acks には入れない：修正するを選んだ時点ではまだ直っていないため、
 * 次回同期でも重複として通知され続けるのが正しい（ACK＝もう通知しない、とは意味が違う）。
 * 監査ログと、カードのスレッドへの足跡だけを残す。
 *
 * 失敗しても呼び出し元には影響させない（ack済み・ユーザーのブラウザ遷移も妨げない）。
 */
async function recordFixSelection(payload: any, fixAction: any): Promise<void> {
  // 関数全体を try で包む。ここから漏れた例外は ack 済みで誰も待っていない Promise の
  // reject になり、index.ts の unhandledRejection ハンドラが gracefulShutdown を
  // 呼んでプロセスごと落とす（＝Slackボタン1回で全断）。記録の失敗で本体を殺さない。
  try {
    let value: SlackBlockActionValue | undefined;
    try {
      value = JSON.parse(fixAction?.value);
    } catch {
      // value が無い/壊れている場合も、押されたこと自体は残す
    }

    const actor: string = payload.user?.username || payload.user?.id || 'unknown';
    const slackUserId: string = payload.user?.id || 'unknown';
    const castNameDisplay = value?.castName || value?.staffKey || '対象不明';
    const workDateDisplay = value?.workDate ? formatDateJp(value.workDate) : '日付不明';

    logAudit({
      // 管理者の実メールと混ざらないよう名前空間を付ける（監査証跡の名寄せ用）
      actorEmail: `slack:${slackUserId}`,
      actorType: 'system',
      action: 'DUPLICATE_FIX_SELECTED',
      targetType: 'duplicate_acks',
      targetId: `${value?.staffKey ?? 'unknown'}::${value?.workDate ?? 'unknown'}`,
      payload: {
        staffKey: value?.staffKey,
        workDate: value?.workDate,
        castName: value?.castName,
        slackUserName: payload.user?.username,
        channelId: payload.channel?.id,
      },
    }).catch(() => { /* 監査ログ失敗は無視 */ });

    // カードのスレッドに足跡を残す。カード本体は書き換えない
    // （まだ直っていないので、ボタンは押せるままにしておく）。
    const botToken = process.env.SLACK_BOT_TOKEN;
    const channelId = payload.channel?.id;
    const threadTs = payload.message?.ts;
    if (!botToken) {
      console.warn('[slackInteractive] dup_fix: SLACK_BOT_TOKEN 未設定のためスレッド記録をスキップ');
      return;
    }
    if (!threadTs) {
      console.warn('[slackInteractive] dup_fix: message.ts が無いためスレッド記録をスキップ');
      return;
    }
    // 投稿先は許可リストで固定する（payload のチャンネルを鵜呑みにしない）
    if (!isAllowedChannel(channelId)) {
      console.warn('[slackInteractive] dup_fix: 許可外チャンネルのため破棄:', channelId);
      return;
    }

    const nowDisplay = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: threadTs,
        text:
          `〔修正する〕${escapeSlack(castNameDisplay)} ${escapeSlack(workDateDisplay)} の重複について、` +
          `${escapeSlack(actor)}さんが「修正する」を選びました（${nowDisplay}）`,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    // fetch は 4xx/5xx でも reject しない。Slack API は ok:false を本文で返すため明示的に見る
    const body: any = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      console.error('[slackInteractive] dup_fix のスレッド記録に失敗:', res.status, body?.error);
    }
  } catch (err) {
    console.error('[slackInteractive] dup_fix の記録処理で例外:', err);
  }
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

  const actions: any[] = Array.isArray(payload.actions) ? payload.actions : [];
  const action = actions.find((a: any) => a?.action_id === 'dup_ok');
  const fixAction = actions.find((a: any) => a?.action_id === 'dup_fix');

  // 「修正する」は url 付きボタンなのでブラウザは Slack が開くが、
  // block_actions 自体は飛んでくる（Slack公式仕様）。どちらを選んだかを
  // 記録に残すため、ここで受け取ってスレッドへ足跡を残す。
  // https://docs.slack.dev/reference/block-kit/block-elements/button-element/
  if (!action && fixAction) {
    // Slack は3秒以内の ack を要求するため、先に200を返してから記録する
    // （記録に失敗してもユーザーのブラウザ遷移は妨げない）。
    // void で投げ捨てると万一の例外が未処理Promise拒否になりプロセスが落ちるため、
    // 必ず catch を繋いで握る（recordFixSelection 内でも二重に守っている）。
    res.status(200).send('');
    recordFixSelection(payload, fixAction).catch((err) => {
      console.error('[slackInteractive] dup_fix の記録に失敗（ack済みのため処理は継続）:', err);
    });
    return;
  }

  if (!action) {
    // dup_ok / dup_fix 以外のアクションは対象外
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

  // work_date は DB の date 型に入る。書式次第で INSERT が落ちたり
  // 日時付き文字列が黙って通ったりするため、ここで厳密に絞る。
  if (typeof value.workDate !== 'string' || !WORK_DATE_RE.test(value.workDate)) {
    res.status(400).json({ error: 'workDate の形式が不正です（YYYY-MM-DD）' });
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
    // castName は CSV 由来の外部データ。エスケープしないと <!channel> や
    // リンクテキスト偽装をカードに流し込まれる。
    const cardText =
      `〔OK済み〕${escapeSlack(castNameDisplay)} ${formatDateJp(value.workDate)} の重複は今後通知されません` +
      `（${escapeSlack(ackedBy)}さんが承認・${ackedAtDisplay}）`;

    // 先に ack を返す。response_url への更新は最大5秒待つ可能性があり、
    // DB 応答と合わせると Slack の3秒制限を超えて「操作に失敗しました」が出る
    // （DBには記録済みなのに失敗表示＝西村さんが押し直す）ため、順序を分離する。
    res.status(200).send('');

    // カード更新は response_url 経由で行う（chat.update は使わない＝社内ルール）。
    // payload 由来のURLをそのまま叩くと内部ネットワークへ任意POSTできる SSRF になるため、
    // Slack が発行するホストに限定する。
    if (!isSlackResponseUrl(payload.response_url)) {
      if (payload.response_url) {
        console.warn('[slackInteractive] 想定外の response_url を破棄しました');
      }
      return;
    }
    try {
      const updateRes = await fetch(payload.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace_original: true, text: cardText }),
        signal: AbortSignal.timeout(5_000),
      });
      // fetch は 4xx/5xx でも reject しない。失効した response_url は
      // ここで非2xx / エラー本文が返るので、黙って成功扱いにしない。
      if (!updateRes.ok) {
        const detail = await updateRes.text().catch(() => '');
        console.error(
          '[slackInteractive] カード更新に失敗（ACKはDBに記録済み）:',
          updateRes.status,
          detail.slice(0, 200)
        );
      }
    } catch (responseUrlErr) {
      console.error('[slackInteractive] response_url へのカード更新に失敗:', responseUrlErr);
    }
  } catch (err) {
    console.error('[slackInteractive] duplicate_acks 処理エラー:', err);
    // ack を先に返した後（カード更新中など）に来た例外では、
    // 二重送信になるため再度レスポンスを書かない。
    if (!res.headersSent) {
      res.status(500).json({ error: 'ACK処理に失敗しました' });
    }
  }
});

export default router;
