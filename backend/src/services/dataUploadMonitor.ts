import pool from '../db/pool';

function getSlackWebhookUrl(): string {
  return process.env.SLACK_WEBHOOK_URL || '';
}

const CHECK_HOURS_JST = [17, 19, 21, 0, 9, 12];
const PRE_DAY_HOURS = new Set([17, 19, 21]);
const SAME_DAY_HOURS = new Set([0, 9, 12]);

export type NotificationKind = 'pre_day' | 'same_day';

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
  if (SAME_DAY_HOURS.has(hour)) return 'same_day';
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

async function sendSlackAlert(
  targetDate: string,
  checkLabel: string,
  useChannelMention: boolean,
  kind: NotificationKind
): Promise<void> {
  const webhookUrl = getSlackWebhookUrl();
  if (!webhookUrl) {
    console.log(`[DataMonitor] SLACK_WEBHOOK_URL not set. Would alert: ${targetDate} (${checkLabel}, ${kind})`);
    return;
  }

  const mention = useChannelMention ? '<!channel> ' : '';
  const mentionBlock = useChannelMention ? '<!channel>\n' : '';

  // 通知文言は kind で出し分け：
  //  - pre_day (前夜の事前チェック): 翌朝10時の自動取り込み前なので「まだ入っていない」のは正常。
  //    紛らわしい「アラート」ではなく軽い「事前チェック」表記にする。
  //  - same_day (当日チェック): 自動取り込み後でも入っていない＝本物の未登録。強めに出す。
  const isPreDay = kind === 'pre_day';
  const headerIcon = isPreDay ? ':memo:' : ':warning:';
  const headerLabel = isPreDay ? '事前チェック（明日分）' : '案件データ未登録アラート';
  const textSummary = isPreDay
    ? `【ほうこちゃん】${targetDate}（明日）分の案件は ${checkLabel} 時点ではまだ未取り込み（事前チェック）`
    : `${mention}【ほうこちゃん】${targetDate} の案件データが未登録です（${checkLabel}チェック）`;
  const guidanceLines = isPreDay
    ? [
        '※ プロキャストからの自動取り込みは翌朝10時に走るため、いまの時点では未取り込みでも正常です。',
        '※ 翌朝10時の取り込み後にも入っていなければ、当日チェックで再度お知らせします（その時は対応が必要）。',
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
          text: `${isPreDay ? '' : mentionBlock}${headerIcon} *【ほうこちゃん】${headerLabel}*\n\n` +
            `*対象日:* ${targetDate}${isPreDay ? '（明日）' : ''}\n` +
            `*チェック時刻:* ${checkLabel}\n\n` +
            guidanceLines.join('\n')
        }
      }
    ]
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });

  if (!response.ok) {
    throw new Error(`Slack API returned ${response.status}`);
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
      // pre_day（前夜の事前チェック）は @channel を使わない＝紛らわしい「アラート」感を消す。
      // same_day は従来通り平日のみ @channel。
      const mentionForSend = kind === 'pre_day' ? false : useChannelMention;
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
