import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// dataUploadMonitor imports `pool` from ../db/pool which requires DATABASE_URL.
// Mock it so we can drive query() outcomes from tests.
vi.mock('../db/pool', () => ({
  default: { query: vi.fn() },
}));

import pool from '../db/pool';
import {
  classifyKind,
  getJSTDate,
  getJSTHolidayList,
  isJSTHoliday,
  isJSTWeekend,
  runCheck,
} from './dataUploadMonitor';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('classifyKind', () => {
  it('classifies 17/19/21 JST as pre_day', () => {
    expect(classifyKind(17)).toBe('pre_day');
    expect(classifyKind(19)).toBe('pre_day');
    expect(classifyKind(21)).toBe('pre_day');
  });

  it('classifies 0/9 JST as same_day_prefetch (取り込み前)', () => {
    expect(classifyKind(0)).toBe('same_day_prefetch');
    expect(classifyKind(9)).toBe('same_day_prefetch');
  });

  it('classifies 12 JST as same_day_postfetch (取り込み後の本物アラート)', () => {
    expect(classifyKind(12)).toBe('same_day_postfetch');
  });

  it('returns null for non-check hours', () => {
    expect(classifyKind(1)).toBeNull();
    expect(classifyKind(8)).toBeNull();
    expect(classifyKind(15)).toBeNull();
    expect(classifyKind(23)).toBeNull();
  });
});

describe('isJSTWeekend', () => {
  it('returns true for Sunday(0) and Saturday(6)', () => {
    expect(isJSTWeekend(0)).toBe(true);
    expect(isJSTWeekend(6)).toBe(true);
  });
  it('returns false for weekdays', () => {
    expect(isJSTWeekend(1)).toBe(false);
    expect(isJSTWeekend(3)).toBe(false);
    expect(isJSTWeekend(5)).toBe(false);
  });
});

describe('isJSTHoliday', () => {
  it('recognizes known 2026 holidays', () => {
    expect(isJSTHoliday('2026-01-01')).toBe(true);
    expect(isJSTHoliday('2026-05-05')).toBe(true);
    expect(isJSTHoliday('2026-11-23')).toBe(true);
  });
  it('returns false for non-holidays', () => {
    expect(isJSTHoliday('2026-06-15')).toBe(false);
    expect(isJSTHoliday('2026-07-21')).toBe(false);
  });
  it('exposes the holiday list', () => {
    const list = getJSTHolidayList();
    expect(list.has('2026-01-01')).toBe(true);
    expect(list.size).toBeGreaterThan(10);
  });
});

describe('getJSTDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('crosses JST date boundary at 15:00 UTC -> 00:00 next day JST', () => {
    // 2026-06-14 15:00 UTC == 2026-06-15 00:00 JST
    vi.setSystemTime(new Date('2026-06-14T15:00:00Z'));
    const { dateStr, hour } = getJSTDate();
    expect(dateStr).toBe('2026-06-15');
    expect(hour).toBe(0);
  });

  it('handles 17:00 JST (08:00 UTC) on a Monday', () => {
    // 2026-06-15 is Monday. 2026-06-15 08:00 UTC == 2026-06-15 17:00 JST
    vi.setSystemTime(new Date('2026-06-15T08:00:00Z'));
    const { dateStr, hour, dayOfWeek } = getJSTDate();
    expect(dateStr).toBe('2026-06-15');
    expect(hour).toBe(17);
    expect(dayOfWeek).toBe(1);
  });

  it('offset=1 returns next JST date without mutating today', () => {
    vi.setSystemTime(new Date('2026-06-15T08:00:00Z')); // 17:00 JST on 6/15
    const today = getJSTDate();
    const tomorrow = getJSTDate(1);
    expect(today.dateStr).toBe('2026-06-15');
    expect(tomorrow.dateStr).toBe('2026-06-16');
  });

  it('reports Sunday correctly (dow=0)', () => {
    // 2026-06-14 is Sunday. 03:00 UTC == 12:00 JST
    vi.setSystemTime(new Date('2026-06-14T03:00:00Z'));
    const { dayOfWeek, hour, dateStr } = getJSTDate();
    expect(dayOfWeek).toBe(0);
    expect(hour).toBe(12);
    expect(dateStr).toBe('2026-06-14');
  });
});

describe('runCheck dedup (pre_day vs same_day_prefetch vs same_day_postfetch are independent)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedQuery.mockReset();
    process.env.SLACK_WEBHOOK_URL = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function mockProjectCount(count: number) {
    mockedQuery.mockResolvedValueOnce({ rows: [{ cnt: String(count) }], rowCount: 1 } as never);
  }
  function mockClaim(success: boolean) {
    mockedQuery.mockResolvedValueOnce({
      rows: success ? [{ target_date: 'x' }] : [],
      rowCount: success ? 1 : 0,
    } as never);
  }

  it('pre_day at 21:00 sends, then 19:00 retry is deduped (same target_date)', async () => {
    // 21:00 JST Mon 2026-06-15 == 12:00 UTC -> target_date = 2026-06-16
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    mockProjectCount(0); // SELECT projects
    mockClaim(true);     // INSERT claim succeeds
    await runCheck();
    expect(mockedQuery).toHaveBeenCalledTimes(2);

    // 19:00 JST same day (10:00 UTC) — duplicate pre_day for target 2026-06-16
    mockedQuery.mockReset();
    vi.setSystemTime(new Date('2026-06-15T10:00:00Z'));
    mockProjectCount(0);
    mockClaim(false); // already claimed -> dedup
    await runCheck();
    // SELECT + INSERT attempted, but no Slack call. Since SLACK_WEBHOOK_URL is empty
    // we can't directly assert no fetch — but rowCount=0 path returns before send.
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });

  it('same_day_prefetch at 09:00 is independent from earlier pre_day claim', async () => {
    // 09:00 JST Mon 2026-06-15 == 00:00 UTC -> target_date = 2026-06-15, kind = same_day_prefetch
    vi.setSystemTime(new Date('2026-06-15T00:00:00Z'));
    mockProjectCount(0);
    mockClaim(true); // independent slot (target=2026-06-15, kind=same_day_prefetch)
    await runCheck();

    const insertCall = mockedQuery.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO data_monitor_notifications')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(['2026-06-15', 'same_day_prefetch', 9]);
  });

  it('same_day_postfetch at 12:00 is independent from prefetch claim earlier the same day', async () => {
    // 12:00 JST Mon 2026-06-15 == 03:00 UTC -> target_date = 2026-06-15, kind = same_day_postfetch
    vi.setSystemTime(new Date('2026-06-15T03:00:00Z'));
    mockProjectCount(0);
    mockClaim(true);
    await runCheck();

    const insertCall = mockedQuery.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO data_monitor_notifications')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(['2026-06-15', 'same_day_postfetch', 12]);
  });

  it('skips send when projects exist (count > 0) and does not touch claim table', async () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z')); // 21:00 JST
    mockProjectCount(5);
    await runCheck();
    // Only the SELECT runs, no INSERT claim
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('skips outside check minute window (minute > 5)', async () => {
    // 21:30 JST -> 12:30 UTC, minute=30 > 5
    vi.setSystemTime(new Date('2026-06-15T12:30:00Z'));
    await runCheck();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('skips outside check hour list (e.g. 15:00 JST)', async () => {
    // 15:00 JST == 06:00 UTC
    vi.setSystemTime(new Date('2026-06-15T06:00:00Z'));
    await runCheck();
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});

describe('runCheck weekend/holiday handling (Bug-C)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedQuery.mockReset();
    process.env.SLACK_WEBHOOK_URL = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips 0:00 JST check on Saturday entirely', async () => {
    // 2026-06-13 is Saturday. 2026-06-12 15:00 UTC == 2026-06-13 00:00 JST
    vi.setSystemTime(new Date('2026-06-12T15:00:00Z'));
    const { dayOfWeek, hour } = getJSTDate();
    expect(dayOfWeek).toBe(6);
    expect(hour).toBe(0);

    await runCheck();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('skips 0:00 JST check on Sunday entirely', async () => {
    // 2026-06-14 is Sunday. 2026-06-13 15:00 UTC == 2026-06-14 00:00 JST
    vi.setSystemTime(new Date('2026-06-13T15:00:00Z'));
    const { dayOfWeek, hour } = getJSTDate();
    expect(dayOfWeek).toBe(0);
    expect(hour).toBe(0);
    await runCheck();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('runs 9:00 JST on Saturday but suppresses @channel mention', async () => {
    // 2026-06-13 Saturday 09:00 JST == 2026-06-13 00:00 UTC
    vi.setSystemTime(new Date('2026-06-13T00:00:00Z'));
    process.env.SLACK_WEBHOOK_URL = 'https://example.invalid/webhook';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 })
    );
    mockedQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 } as never); // SELECT
    mockedQuery.mockResolvedValueOnce({ rows: [{ target_date: 'x' }], rowCount: 1 } as never); // claim

    await runCheck();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body.text).not.toContain('<!channel>');
    expect(JSON.stringify(body.blocks)).not.toContain('<!channel>');
    fetchSpy.mockRestore();
  });

  it('weekday 09:00 (prefetch) does NOT use @channel — 取り込み前の事前チェックなので静かに', async () => {
    // 2026-06-15 Monday 09:00 JST == 2026-06-15 00:00 UTC
    vi.setSystemTime(new Date('2026-06-15T00:00:00Z'));
    process.env.SLACK_WEBHOOK_URL = 'https://example.invalid/webhook';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 })
    );
    mockedQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 } as never);
    mockedQuery.mockResolvedValueOnce({ rows: [{ target_date: 'x' }], rowCount: 1 } as never);

    await runCheck();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body.text).not.toContain('<!channel>');
    fetchSpy.mockRestore();
  });

  it('weekday 12:00 (postfetch) USES @channel — 取り込み後の本物アラート', async () => {
    // 2026-06-15 Monday 12:00 JST == 2026-06-15 03:00 UTC
    vi.setSystemTime(new Date('2026-06-15T03:00:00Z'));
    process.env.SLACK_WEBHOOK_URL = 'https://example.invalid/webhook';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 })
    );
    mockedQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 } as never);
    mockedQuery.mockResolvedValueOnce({ rows: [{ target_date: 'x' }], rowCount: 1 } as never);

    await runCheck();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body.text).toContain('<!channel>');
    fetchSpy.mockRestore();
  });

  it('on weekday but target_date is a holiday, suppresses @channel', async () => {
    // 2026-04-28 Tue 17:00 JST == 2026-04-28 08:00 UTC. target=2026-04-29 (昭和の日)
    vi.setSystemTime(new Date('2026-04-28T08:00:00Z'));
    process.env.SLACK_WEBHOOK_URL = 'https://example.invalid/webhook';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 })
    );
    mockedQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 } as never);
    mockedQuery.mockResolvedValueOnce({ rows: [{ target_date: 'x' }], rowCount: 1 } as never);

    await runCheck();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body.text).not.toContain('<!channel>');
    fetchSpy.mockRestore();
  });
});

describe('runCheck DB persistence (Bug-A)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedQuery.mockReset();
    process.env.SLACK_WEBHOOK_URL = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses ON CONFLICT DO NOTHING to dedupe (idempotent across restarts)', async () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z')); // 21:00 JST Mon
    mockedQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 } as never);
    mockedQuery.mockResolvedValueOnce({ rows: [{ target_date: 'x' }], rowCount: 1 } as never);

    await runCheck();

    const insertCall = mockedQuery.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO data_monitor_notifications')
    );
    expect(insertCall).toBeDefined();
    expect(String(insertCall![0])).toContain('ON CONFLICT (target_date, notification_kind) DO NOTHING');
    // Inserts the *next* JST date (pre_day) with the actual hour
    expect(insertCall![1]).toEqual(['2026-06-16', 'pre_day', 21]);
  });

  it('does not call any SELECT/INSERT when minute>5', async () => {
    vi.setSystemTime(new Date('2026-06-15T12:30:00Z'));
    await runCheck();
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});

describe('sendSlackAlert transport selection', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    mockedQuery.mockReset();
    process.env.SLACK_WEBHOOK_URL = '';
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  it('prefers chat.postMessage (Bot Token) when SLACK_BOT_TOKEN/SLACK_CHANNEL_ID are set', async () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z')); // 21:00 JST Mon -> target 2026-06-16, pre_day
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    process.env.SLACK_CHANNEL_ID = 'C12345';

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: '1700000000.000100' }), { status: 200 })
    );

    mockedQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 } as never); // SELECT count
    mockedQuery.mockResolvedValueOnce({ rows: [{ target_date: 'x' }], rowCount: 1 } as never); // claim

    await runCheck();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe(
      'Bearer xoxb-test-token'
    );
    const body = JSON.parse(String((init as RequestInit).body ?? '{}'));
    expect(body.channel).toBe('C12345');
    // ACK機能削除に伴い、SELECT + claim の2クエリのみ（slack_message_ts の UPDATE は発行しない）
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });

  it('falls back to Incoming Webhook when Bot Token is not configured', async () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    process.env.SLACK_WEBHOOK_URL = 'https://example.invalid/webhook';

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    mockedQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 } as never); // SELECT count
    mockedQuery.mockResolvedValueOnce({ rows: [{ target_date: 'x' }], rowCount: 1 } as never); // claim

    await runCheck();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://example.invalid/webhook');
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });
});

describe('sendSlackAlert retry on 429/5xx (fetchWithRetry)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedQuery.mockReset();
    process.env.SLACK_WEBHOOK_URL = 'https://example.invalid/webhook';
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries once after a 429 and succeeds on the second attempt', async () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    mockedQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 } as never);
    mockedQuery.mockResolvedValueOnce({ rows: [{ target_date: 'x' }], rowCount: 1 } as never);

    const runPromise = runCheck();
    await vi.advanceTimersByTimeAsync(1000);
    await runPromise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries once after a 500 and does not throw if the retry also fails', async () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('server error', { status: 500 }))
      .mockResolvedValueOnce(new Response('server error', { status: 500 }));

    mockedQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 } as never);
    mockedQuery.mockResolvedValueOnce({ rows: [{ target_date: 'x' }], rowCount: 1 } as never);

    const runPromise = runCheck();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(runPromise).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a non-retryable 4xx status', async () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('bad request', { status: 400 }));

    mockedQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 } as never);
    mockedQuery.mockResolvedValueOnce({ rows: [{ target_date: 'x' }], rowCount: 1 } as never);

    await runCheck();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
