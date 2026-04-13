import crypto from 'crypto';
import pool from '../db/pool';
import { sendDailyReminderEmail } from '../utils/email';

const REMINDER_HOUR_JST = 11; // 11:00 JST
const SERVICE_START_DATE = '2026-04-20'; // 来週月曜日から送信開始

const alreadySent = new Set<string>();

function getJSTNow(): { dateStr: string; hour: number; minute: number } {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = jst.toISOString().split('T')[0];
  const hour = jst.getUTCHours();
  const minute = jst.getUTCMinutes();
  return { dateStr, hour, minute };
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

async function getTodaysCastMembers(dateStr: string): Promise<CastWithProjects[]> {
  // Get all casts assigned to today's projects who have registered (email_verified + pin_hash)
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
     ORDER BY sm.display_name_kanji, p.work_name`,
    [dateStr]
  );

  // Group by cast user
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

async function sendReminders(): Promise<void> {
  const { dateStr } = getJSTNow();

  const sendKey = dateStr;
  if (alreadySent.has(sendKey)) {
    return;
  }

  console.log(`[DailyReminder] Sending reminders for ${dateStr}`);

  const casts = await getTodaysCastMembers(dateStr);

  if (casts.length === 0) {
    console.log(`[DailyReminder] No registered cast members with projects for ${dateStr}`);
    alreadySent.add(sendKey);
    return;
  }

  console.log(`[DailyReminder] Found ${casts.length} cast members with projects for ${dateStr}`);

  let sentCount = 0;
  let errorCount = 0;

  // Get base URL from environment
  const baseUrl = process.env.BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
    || 'https://security-report.up.railway.app';

  for (const cast of casts) {
    try {
      // Generate magic link token for auto-login
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
        workDate: dateStr,
      });

      if (emailResult.success) {
        sentCount++;
        console.log(`[DailyReminder] Sent to ${cast.staff_name} (${cast.email})`);
      } else {
        errorCount++;
        console.error(`[DailyReminder] Failed to send to ${cast.email}: ${emailResult.error}`);
      }
    } catch (err) {
      errorCount++;
      console.error(`[DailyReminder] Error sending to ${cast.email}:`, err);
    }
  }

  console.log(`[DailyReminder] Completed for ${dateStr}: sent=${sentCount}, errors=${errorCount}`);
  alreadySent.add(sendKey);

  // Cleanup old entries
  if (alreadySent.size > 30) {
    const entries = Array.from(alreadySent);
    entries.slice(0, entries.length - 14).forEach(k => alreadySent.delete(k));
  }
}

async function runCheck(): Promise<void> {
  const { hour, minute } = getJSTNow();

  // Only run at 11:00 JST (within first 5 minutes of the hour)
  if (hour !== REMINDER_HOUR_JST || minute > 5) return;

  // Don't send before the service start date
  const { dateStr } = getJSTNow();
  if (dateStr < SERVICE_START_DATE) {
    return;
  }

  try {
    await sendReminders();
  } catch (err) {
    console.error('[DailyReminder] Error during reminder send:', err);
  }
}

let reminderTimer: ReturnType<typeof setInterval> | null = null;

export function startDailyReminderService(): void {
  console.log(`[DailyReminder] Starting daily reminder service (sends at ${REMINDER_HOUR_JST}:00 JST)`);
  reminderTimer = setInterval(() => {
    runCheck().catch(err => console.error('[DailyReminder] Unexpected error:', err));
  }, 60_000); // Check every minute
  reminderTimer.unref();

  // Run initial check
  runCheck().catch(err => console.error('[DailyReminder] Initial check error:', err));
}

export function stopDailyReminderService(): void {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
    console.log('[DailyReminder] Stopped');
  }
}
