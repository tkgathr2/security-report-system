import pool from '../db/pool';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

const CHECK_HOURS_JST = [17, 19, 21, 0, 9, 12];

const alreadyNotified = new Set<string>();

function getJSTDate(offset = 0): { dateStr: string; hour: number; minute: number } {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  if (offset !== 0) {
    jst.setDate(jst.getDate() + offset);
  }
  const dateStr = jst.toISOString().split('T')[0];
  const hour = jst.getUTCHours();
  const minute = jst.getUTCMinutes();
  return { dateStr, hour, minute };
}

async function checkProjectData(targetDate: string): Promise<number> {
  const result = await pool.query(
    'SELECT COUNT(*) as cnt FROM projects WHERE work_date = $1 AND deleted_at IS NULL',
    [targetDate]
  );
  return parseInt(result.rows[0].cnt, 10);
}

async function sendSlackAlert(targetDate: string, checkLabel: string): Promise<void> {
  if (!SLACK_WEBHOOK_URL) {
    console.log(`[DataMonitor] SLACK_WEBHOOK_URL not set. Would alert: ${targetDate} (${checkLabel})`);
    return;
  }

  const message = {
    text: `<!channel> 【ほうこちゃん】${targetDate} の案件データが未登録です（${checkLabel}チェック）`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<!channel>\n:warning: *【ほうこちゃん】案件データ未登録アラート*\n\n` +
            `*対象日:* ${targetDate}\n` +
            `*チェック時刻:* ${checkLabel}\n\n` +
            `CSVインポートで案件データをアップロードしてください。`
        }
      }
    ]
  };

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });

  if (!response.ok) {
    throw new Error(`Slack API returned ${response.status}`);
  }
}

async function runCheck(): Promise<void> {
  const { dateStr: todayStr, hour, minute } = getJSTDate();

  if (minute > 5) return;

  if (!CHECK_HOURS_JST.includes(hour)) return;

  const isBefore = hour === 17 || hour === 19 || hour === 21;
  const targetDate = isBefore ? getJSTDate(1).dateStr : todayStr;
  const checkLabel = `${hour}:00 JST`;

  const notifyKey = `${targetDate}-${hour}`;
  if (alreadyNotified.has(notifyKey)) return;

  try {
    const count = await checkProjectData(targetDate);
    console.log(`[DataMonitor] ${checkLabel} check: ${targetDate} has ${count} projects`);

    if (count === 0) {
      console.log(`[DataMonitor] No data for ${targetDate}, sending Slack alert`);
      await sendSlackAlert(targetDate, checkLabel);
      console.log(`[DataMonitor] Slack alert sent for ${targetDate}`);
    }

    alreadyNotified.add(notifyKey);

    if (alreadyNotified.size > 100) {
      const entries = Array.from(alreadyNotified);
      entries.slice(0, entries.length - 50).forEach(k => alreadyNotified.delete(k));
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
