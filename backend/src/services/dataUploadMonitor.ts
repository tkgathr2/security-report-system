import pool from '../db/pool';

function getSlackWebhookUrl(): string {
  return process.env.SLACK_WEBHOOK_URL || '';
}

const CHECK_HOURS_JST = [17, 19, 21, 0, 9, 12];
const PRE_DAY_HOURS = new Set([17, 19, 21]);
// プロキャストからの自動取り込みは「JST 10:00」と「JST 22:00」に走る。
// したがって 0:00 / 9:00 のチェック時点では「当日分の自動取り込み」はまだ走っていない＝
// "自動取り込み後も入っていない" と書くのは事実誤認になる（西村さん・社長混乱の元）。
// 0:00 / 9:00 は「当日の事前チェック（取り込み前）」、12:00 だけが「取り込み後の本物チェック」。
const SAME_DAY_PREFETCH_HOURS = new Set([0, 9]);
const SAME_DAY_POSTFETCH_HOURS = new Set([12]);

export type NotificationKind = 'pre_day' | 'same_day_prefetch' | 'same_day_postfetch';

/**
 * 2026年の主要祝日 (JST, YYYY-MM-DD)。
 * 深掘りせず固定リスト運用。年度更新時はここを差し替える。
 */
const JST_HOLIDAYS_2026: ReadonlySet<string> = new Set([
  '2026-01-01', // 元日
  '2026-01-12', // 成人の日
  '2026-02-11', // 建国記念の日
  '2026-02-23', // 天皇誕生日
  '2026-03-20', // 春分の日
  '2026-04-29', // 昭和の日
  '2026-05-03', // 憲法記念日
  '2026-05-04', // みどりの日
  '2026-05-05', // こどもの日
  '2026-05-06', // 振替休日
  '2026-07-20', // 海の日
  '2026-08-11', // 山の日
  '2026-09-21', // 敬老の日
  '2026-09-22', // 国民の休日
  '2026-09-23', // 秋分の日
  '2026-10-12', // スポーツの日
  '2026-11-03', // 文化の日
  '2026-11-23', // 勤労感謝の日
]);

export function getJSTHolidayList(): ReadonlySet<string> {
  return JST_HOLIDAYS_2026;
}

export function getJSTDate(offset = 0): { dateStr: string; hour: number; minute: number; dayOfWeek: number } {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  if (offset !== 0) {
    jst.setUTCDate(jst.getUTCDate() + offset);
  }
  const dateStr = jst.toISOString().split('T')[0];
  const hour = jst.getUTCHours();
  const minute = jst.getUTCMinutes();
  const dayOfWeek = jst.getUTCDay(); // 0=Sun, 6=Sat
  return { dateStr, hour, minute, dayOfWeek };
}

export function classifyKind(hour: number): NotificationKind | null {
  if (PRE_DAY_HOURS.has(hour)) return 'pre_day';
  if (SAME_DAY_PREFETCH_HOURS.has(hour)) return 'same_day_prefetch';
  if (SAME_DAY_POSTFETCH_HOURS.has(hour)) return 'same_day_postfetch';
  return null;
}

export function isJSTHoliday(dateStr: string): boolean {
  return JST_HOLIDAYS_2026.has(dateStr);
}

export function isJSTWeekend(dayOfWeek: number): boolean {
  return dayOfWeek === 0 || dayOfWeek === 6;
}

async function checkProjectData(targetDate: string): Promise<number> {
  const result = await pool.query(
    'SELECT COUNT(*) as cnt FROM projects WHERE work_date = $1 AND deleted_at IS NULL',
    [targetDate]
  );
  return parseInt(result.rows[0].cnt, 10);
}

/**
 * すでに同じ (targetDate, kind) で通知済みなら true。
 * UPSERT で INSERT を試み、競合(=既存)なら通知済みと判定する。
 * 単一クエリで race condition を吸収できる。
 */
async function tryClaimNotification(
  targetDate: string,
  kind: NotificationKind,
  hour: number
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO data_monitor_notifications (target_date, notification_kind, notified_hour)
     VALUES ($1, $2, $3)
     ON CONFLICT (target_date, notification_kind) DO NOTHING
     RETURNING target_date`,
    [targetDate, kind, hour]
  );
  return result.rowCount === 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Slack API 呼び出し用の内部リトライヘルパー。
 * レスポンスが 429 または 5xx (non-2xx) の場合のみ 1 秒待って 1 回だけ再試行する。
 * それ以外の non-2xx（4xx 等）はリトライしても解決しないため即座に失敗扱いにする。
 * 2 回目（リトライ後）も失敗した場合は null を返す（呼び出し元でエラーハンドリングする）。
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response | null> {
  let response = await fetch(url, init);
  if (!response.ok && (response.status === 429 || response.status >= 500)) {
    await sleep(1000);
    response = await fetch(url, init);
  }
  return response.ok ? response : null;
}

/**
 * Slack にアラートを送信する。
 *
 * SLACK_BOT_TOKEN + SLACK_CHANNEL_ID が設定されていれば chat.postMessage（Web API）を優先して使う。
 * 未設定の環境向けに Incoming Webhook (SLACK_WEBHOOK_URL) へのフォールバックも維持する。
 * 429/5xx はトランジェント障害の可能性が高いため fetchWithRetry で 1 回だけ再試行する。
 */
async function sendSlackAlert(
  targetDate: string,
  checkLabel: string,
  useChannelMention: boolean,
  kind: NotificationKind
): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN || '';
  const channelId = process.env.SLACK_CHANNEL_ID || '';
  const webhookUrl = getSlackWebhookUrl();

  if (!botToken && !webhookUrl) {
    console.log(`[DataMonitor] SLACK_WEBHOOK_URL/SLACK_BOT_TOKEN not set. Would alert: ${targetDate} (${checkLabel}, ${kind})`);
    return;
  }

  const mention = useChannelMention ? '<!channel> ' : '';
  const mentionBlock = useChannelMention ? '<!channel>\n' : '';

  // 通知文言は kind で3分岐：
  //  - pre_day              (前夜 17/19/21): 翌朝10時の自動取り込み前。軽い「事前チェック」表記。
  //  - same_day_prefetch    (当日 0/9):     当日朝10時の自動取り込み前。事実誤認しないよう「取り込み前」と明記。
  //  - same_day_postfetch   (当日 12):      自動取り込み後でも入っていない＝本物の未登録。強めに出す。
  const isPreDay = kind === 'pre_day';
  const isPrefetch = kind === 'same_day_prefetch';
  const isPostfetch = kind === 'same_day_postfetch';

  const headerIcon = isPostfetch ? ':warning:' : ':memo:';
  const headerLabel = isPreDay
    ? '事前チェック（明日分）'
    : isPrefetch
      ? '事前チェック（本日分・取り込み前）'
      : '案件データ未登録アラート';

  const dateSuffix = isPreDay ? '（明日）' : isPrefetch ? '（本日・取り込み前）' : '';

  const textSummary = isPostfetch
    ? `${mention}【ほうこちゃん】${targetDate} の案件データが未登録です（${checkLabel}チェック）`
    : isPreDay
      ? `【ほうこちゃん】${targetDate}（明日）分の案件は ${checkLabel} 時点ではまだ未取り込み（事前チェック）`
      : `【ほうこちゃん】${targetDate}（本日）分の案件は ${checkLabel} 時点ではまだ未取り込み（取り込み前の事前チェック）`;

  const guidanceLines = isPreDay
    ? [
        '※ プロキャストからの自動取り込みは翌朝10時に走るため、いまの時点では未取り込みでも正常です。',
        '※ 翌朝10時の取り込み後にも入っていなければ、当日チェックで再度お知らせします（その時は対応が必要）。',
      ]
    : isPrefetch
      ? [
          '※ プロキャストからの自動取り込みは本日10時に走るため、いまの時点では未取り込みでも正常です。',
          '※ 本日10時の取り込み後にも入っていなければ、12時の当日チェックで再度お知らせします（その時は対応が必要）。',
        ]
      : [
          '自動取り込み後も案件データが入っていません。CSVインポートで案件データをアップロードしてください。',
        ];

  const message = {
    text: textSummary,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${isPostfetch ? mentionBlock : ''}${headerIcon} *【ほうこちゃん】${headerLabel}*\n\n` +
            `*対象日:* ${targetDate}${dateSuffix}\n` +
            `*チェック時刻:* ${checkLabel}\n\n` +
            guidanceLines.join('\n')
        }
      }
    ]
  };

  if (botToken && channelId) {
    const response = await fetchWithRetry('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ channel: channelId, ...message })
    });

    if (!response) {
      console.error('[DataMonitor] Slack API (chat.postMessage) failed after retry');
      return;
    }

    const data = await response.json() as { ok: boolean; error?: string };
    if (!data.ok) {
      throw new Error(`Slack API (chat.postMessage) error: ${data.error}`);
    }
    return;
  }

  const response = await fetchWithRetry(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });

  if (!response) {
    console.error('[DataMonitor] Slack API (webhook) failed after retry');
  }
}

export async function runCheck(): Promise<void> {
  const { dateStr: todayStr, hour, minute, dayOfWeek } = getJSTDate();

  if (minute > 5) return;

  if (!CHECK_HOURS_JST.includes(hour)) return;

  const kind = classifyKind(hour);
  if (!kind) return;

  const targetDate = kind === 'pre_day' ? getJSTDate(1).dateStr : todayStr;
  const checkLabel = `${hour}:00 JST`;

  // Bug-C: 土日 0時のチェックはスキップ（深夜の現場を起こさない）
  if (hour === 0 && isJSTWeekend(dayOfWeek)) {
    console.log(`[DataMonitor] Skip ${checkLabel} on weekend (dow=${dayOfWeek})`);
    return;
  }

  // Bug-C: @channel mention の抑制条件 (土日 or 対象日が祝日)
  const useChannelMention = !isJSTWeekend(dayOfWeek) && !isJSTHoliday(targetDate);

  try {
    const count = await checkProjectData(targetDate);
    console.log(`[DataMonitor] ${checkLabel} check: ${targetDate} (${kind}) has ${count} projects`);

    if (count === 0) {
      // Bug-A/B: DB UPSERT で (対象日 × 種別) の重複判定を行う
      const claimed = await tryClaimNotification(targetDate, kind, hour);
      if (!claimed) {
        console.log(`[DataMonitor] Skip duplicate notification: ${targetDate} ${kind}`);
        return;
      }
      console.log(`[DataMonitor] No data for ${targetDate}, sending Slack alert (${kind})`);
      // @channel メンションは「本物の未登録アラート (same_day_postfetch=12時)」のときだけ。
      // 事前チェック (pre_day / same_day_prefetch) は静かに通知する。
      const mentionForSend = kind === 'same_day_postfetch' ? useChannelMention : false;
      await sendSlackAlert(targetDate, checkLabel, mentionForSend, kind);
      console.log(`[DataMonitor] Slack alert sent for ${targetDate} (${kind})`);
    }
  } catch (err) {
    console.error(`[DataMonitor] Error during ${checkLabel} check:`, err);
  }
}

let monitorTimer: ReturnType<typeof setInterval> | null = null;

export function startDataUploadMonitor(): void {
  console.log('[DataMonitor] Starting data upload monitor (checks at 17:00, 19:00, 21:00, 00:00, 09:00, 12:00 JST)');
  monitorTimer = setInterval(() => {
    runCheck().catch(err => console.error('[DataMonitor] Unexpected error:', err));
  }, 60_000);
  monitorTimer.unref();

  runCheck().catch(err => console.error('[DataMonitor] Initial check error:', err));
}

export function stopDataUploadMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    console.log('[DataMonitor] Stopped');
  }
}
