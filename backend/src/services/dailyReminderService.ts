import crypto from 'crypto';
import pool from '../db/pool';
import { sendDailyReminderEmail } from '../utils/email';

const MORNING_HOUR_JST = 7;  // 7:00 JST → 今日の現場（日勤向け）
const EVENING_HOUR_JST = 18; // 18:00 JST → 明日の現場（夜勤向け）
const SERVICE_START_DATE = '2026-04-20';

const alreadySent = new Set<string>();

function getJSTNow(): { dateStr: string; hour: number; minute: number } {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = jst.toISOString().split('T')[0];
  const hour = jst.getUTCHours();
  const minute = jst.getUTCMinutes();
  return { dateStr, hour, minute };
}

function getJSTDateOffset(days: number): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jst.setUTCDate(jst.getUTCDate() + days);
  return jst.toISOString().split('T')[0];
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

interface ProjectInfo {
  project_id: string;
  work_name: string;
  location: string;
  work_date: string;
}

interface CastWithProjects {
  cast_user_id: string;
  email: string;
  staff_name: string;
  staff_id: string;
  projects: ProjectInfo[];
}

async function getCastMembers(dateStr: string): Promise<CastWithProjects[]> {
  const result = await pool.query(
    `SELECT DISTINCT
       cu.id as cast_user_id,
       cu.email,
       sm.display_name_kanji as staff_name,
       sm.id as staff_id,
       p.id as project_id,
       p.work_name,
       p.location,
       p.work_date::text as work_date
     FROM projects p
     JOIN project_casts pc ON pc.project_id = p.id AND pc.deleted_at IS NULL
     JOIN staff_master sm ON pc.staff_id = sm.id AND sm.deleted_at IS NULL
     JOIN cast_users cu ON cu.staff_id = sm.id AND cu.deleted_at IS NULL
       AND cu.email_verified = true AND cu.pin_hash IS NOT NULL
     WHERE p.work_date = $1 AND p.deleted_at IS NULL
       AND p.status IS DISTINCT FROM 'cancelled'
     ORDER BY sm.display_name_kanji, p.work_name`,
    [dateStr]
  );

  const castMap = new Map<string, CastWithProjects>();
  for (const row of result.rows) {
    const existing = castMap.get(row.cast_user_id);
    const project: ProjectInfo = {
      project_id: row.project_id,
      work_name: row.work_name || '',
      location: row.location || '',
      work_date: row.work_date,
    };
    if (existing) {
      existing.projects.push(project);
    } else {
      castMap.set(row.cast_user_id, {
        cast_user_id: row.cast_user_id,
        email: row.email,
        staff_name: row.staff_name,
        staff_id: row.staff_id,
        projects: [project],
      });
    }
  }

  return Array.from(castMap.values());
}

async function sendReminders(
  targetDate: string,
  timing: 'morning' | 'evening'
): Promise<{ sent: number; errors: number }> {
  const sendKey = `${targetDate}-${timing}`;
  if (alreadySent.has(sendKey)) {
    return { sent: 0, errors: 0 };
  }

  // DB でも送信済みを確認（再起動後の重複メール防止・バッチ単位）
  const notificationKind = timing === 'morning' ? 'morning_reminder' : 'evening_reminder';
  const dbCheck = await pool.query(
    `SELECT 1 FROM data_monitor_notifications
     WHERE target_date = $1 AND notification_kind = $2
     LIMIT 1`,
    [targetDate, notificationKind]
  );
  if (dbCheck.rows.length > 0) {
    console.log(`[DailyReminder] Already sent (DB record exists) for ${targetDate} (${timing}), skipping`);
    alreadySent.add(sendKey);
    return { sent: 0, errors: 0 };
  }

  console.log(`[DailyReminder] Sending ${timing} reminders for ${targetDate}`);

  const casts = await getCastMembers(targetDate);

  if (casts.length === 0) {
    console.log(`[DailyReminder] No registered cast members for ${targetDate} (${timing})`);
    alreadySent.add(sendKey);
    return { sent: 0, errors: 0 };
  }

  console.log(`[DailyReminder] Found ${casts.length} cast members for ${targetDate} (${timing})`);

  let sentCount = 0;
  let errorCount = 0;

  const baseUrl = process.env.BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
    || 'https://security-report.up.railway.app';

  for (const cast of casts) {
    try {
      // reminder_sends テーブルで個人単位の送信済みチェック（再起動・重複呼び出し対策）
      const perUserCheck = await pool.query(
        `SELECT 1 FROM reminder_sends
         WHERE cast_user_id = $1 AND target_date = $2 AND timing = $3
         LIMIT 1`,
        [cast.cast_user_id, targetDate, timing]
      );
      if (perUserCheck.rows.length > 0) {
        console.log(`[DailyReminder] Already sent to ${cast.staff_name} (${cast.email}) [${timing}] — skipping`);
        continue;
      }

      const token = generateToken();
      const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await pool.query(
        `UPDATE cast_users SET magic_link_token = $1, magic_link_expires = $2
         WHERE id = $3`,
        [token, tokenExpires, cast.cast_user_id]
      );

      const magicLoginUrl = `${baseUrl}/cast/magic?token=${token}`;

      const emailResult = await sendDailyReminderEmail({
        email: cast.email,
        name: cast.staff_name,
        magicLoginUrl,
        projects: cast.projects.map(p => ({
          workName: p.work_name,
          location: p.location,
        })),
        workDate: targetDate,
        timing,
      });

      if (emailResult.success) {
        sentCount++;
        console.log(`[DailyReminder] Sent to ${cast.staff_name} (${cast.email}) [${timing}]`);

        // 送信成功後に個人単位の記録を挿入（冪等: ON CONFLICT DO NOTHING）
        await pool.query(
          `INSERT INTO reminder_sends (cast_user_id, target_date, timing)
           VALUES ($1, $2, $3)
           ON CONFLICT ON CONSTRAINT reminder_sends_unique_per_user_date_timing DO NOTHING`,
          [cast.cast_user_id, targetDate, timing]
        );
      } else {
        errorCount++;
        console.error(`[DailyReminder] Failed to send to ${cast.email}: ${emailResult.error}`);
      }
    } catch (err) {
      errorCount++;
      console.error(`[DailyReminder] Error sending to ${cast.email}:`, err);
    }
  }

  console.log(`[DailyReminder] Completed ${timing} for ${targetDate}: sent=${sentCount}, errors=${errorCount}`);

  // 送信済みを DB に記録（バッチ単位・再起動後の重複メール防止）
  const { hour: currentHour } = getJSTNow();
  try {
    await pool.query(
      `INSERT INTO data_monitor_notifications (target_date, notification_kind, notified_hour)
       VALUES ($1, $2, $3)
       ON CONFLICT (target_date, notification_kind) DO NOTHING`,
      [targetDate, notificationKind, currentHour]
    );
  } catch (dbErr) {
    console.error(`[DailyReminder] Failed to record notification in DB:`, dbErr);
  }

  alreadySent.add(sendKey);

  if (alreadySent.size > 60) {
    const entries = Array.from(alreadySent);
    entries.slice(0, entries.length - 30).forEach(k => alreadySent.delete(k));
  }

  return { sent: sentCount, errors: errorCount };
}

async function runCheck(): Promise<void> {
  const { hour, minute, dateStr } = getJSTNow();

  if (minute > 5) return;
  if (dateStr < SERVICE_START_DATE) return;

  // 朝7:00: 今日の現場を配信（日勤向け）
  if (hour === MORNING_HOUR_JST) {
    try {
      await sendReminders(dateStr, 'morning');
    } catch (err) {
      console.error('[DailyReminder] Error during morning send:', err);
    }
  }

  // 夜18:00: 明日の現場を配信（夜勤向け）
  if (hour === EVENING_HOUR_JST) {
    try {
      const tomorrow = getJSTDateOffset(1);
      await sendReminders(tomorrow, 'evening');
    } catch (err) {
      console.error('[DailyReminder] Error during evening send:', err);
    }
  }
}

let reminderTimer: ReturnType<typeof setInterval> | null = null;

export function startDailyReminderService(): void {
  console.log(`[DailyReminder] Starting daily reminder service (morning=${MORNING_HOUR_JST}:00 JST / evening=${EVENING_HOUR_JST}:00 JST)`);
  reminderTimer = setInterval(() => {
    runCheck().catch(err => console.error('[DailyReminder] Unexpected error:', err));
  }, 60_000); // Check every minute
  reminderTimer.unref();

  runCheck().catch(err => console.error('[DailyReminder] Initial check error:', err));
}

export function stopDailyReminderService(): void {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
    console.log('[DailyReminder] Stopped');
  }
}

// 手動即時配信（時刻チェック・送信済みチェックをスキップ）
// timing: 'morning'=今日の現場, 'evening'=明日の現場
export async function sendRemindersNow(
  timing: 'morning' | 'evening' = 'morning'
): Promise<{ sent: number; errors: number; date: string }> {
  const targetDate = timing === 'evening' ? getJSTDateOffset(1) : getJSTNow().dateStr;
  console.log(`[DailyReminder] Manual ${timing} send triggered for ${targetDate}`);

  // 送信済みフラグをリセットして強制送信
  alreadySent.delete(`${targetDate}-${timing}`);
  const result = await sendReminders(targetDate, timing);
  return { ...result, date: targetDate };
}
