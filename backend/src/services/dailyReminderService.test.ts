import { describe, it, expect, vi, beforeEach } from 'vitest';

// KZ-145: 日次リマインダー送信は、ログインセッションと共有の magic_link_token ではなく
// 専用列 reminder_link_token を更新すること、および reminder_sends への記録が
// 実在するユニーク索引の列指定（ON CONFLICT (columns)）で行われることを固定する。
// 修正前は ON CONFLICT ON CONSTRAINT reminder_sends_unique_per_user_date_timing で、
// マイグレーションが作るのは「制約」ではなく「ユニークインデックス」だったため
// 本番で毎回 42704 (constraint does not exist) になっていた。

const queryMock = vi.fn();
const sendDailyReminderEmailMock = vi.fn();

vi.mock('../db/pool', () => ({
  default: {
    query: (...args: unknown[]) => queryMock(...args),
  },
}));

vi.mock('../utils/email', () => ({
  sendDailyReminderEmail: (...args: unknown[]) => sendDailyReminderEmailMock(...args),
}));

describe('sendRemindersNow (KZ-145)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendDailyReminderEmailMock.mockReset();
    sendDailyReminderEmailMock.mockResolvedValue({ success: true, data: { id: 'email-1' } });
  });

  it('magic_link_token ではなく reminder_link_token を更新し、reminder_sends は列指定の ON CONFLICT で記録する', async () => {
    const { sendRemindersNow } = await import('./dailyReminderService');

    queryMock
      .mockResolvedValueOnce({ rows: [] }) // dbCheck: data_monitor_notifications
      .mockResolvedValueOnce({
        rows: [{
          cast_user_id: 'cast-1',
          email: 'cast1@example.com',
          staff_name: '現場 太郎',
          staff_id: 'staff-1',
          project_id: 'proj-1',
          work_name: '警備業務',
          location: '現場A',
          work_date: '2026-09-10',
        }],
      }) // getCastMembers
      .mockResolvedValueOnce({ rows: [] }) // perUserCheck: reminder_sends
      .mockResolvedValueOnce({ rows: [] }) // UPDATE cast_users SET reminder_link_token...
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO reminder_sends
      .mockResolvedValueOnce({ rows: [] }); // INSERT INTO data_monitor_notifications

    const result = await sendRemindersNow('morning');

    expect(result.sent).toBe(1);
    expect(result.errors).toBe(0);

    const calledSql = queryMock.mock.calls.map(call => call[0] as string);

    const updateCall = calledSql.find(sql => sql.includes('UPDATE cast_users SET'));
    expect(updateCall).toBeDefined();
    expect(updateCall).toContain('reminder_link_token');
    expect(updateCall).not.toContain('magic_link_token');

    const insertCall = calledSql.find(sql => sql.includes('INSERT INTO reminder_sends'));
    expect(insertCall).toBeDefined();
    expect(insertCall).toContain('ON CONFLICT (cast_user_id, target_date, timing)');
    expect(insertCall).not.toContain('ON CONFLICT ON CONSTRAINT');
  });
});
