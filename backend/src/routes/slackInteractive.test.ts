import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

// db/pool をモックして DATABASE_URL 不要にする
vi.mock('../db/pool', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../utils/auditLog', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import pool from '../db/pool';
import slackInteractiveRouter from './slackInteractive';

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

function sign(secret: string, timestamp: string, body: string): string {
  const base = `v0:${timestamp}:${body}`;
  return 'v0=' + crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex');
}

function buildApp() {
  const app = express();
  app.use('/api/slack', slackInteractiveRouter);
  return app;
}

function buildBlockActionsBody(overrides: Partial<{ actionId: string; value: unknown }> = {}): string {
  const payload = {
    type: 'block_actions',
    actions: [
      {
        action_id: overrides.actionId ?? 'dup_ok',
        value: JSON.stringify(
          overrides.value ?? {
            staffKey: 'no-123',
            workDate: '2026-07-21',
            castName: '川面 直人',
            existingWork: '現任教育',
            newWork: '新曽根崎本町線ケーブル取替工事',
          }
        ),
      },
    ],
    user: { id: 'U0AR8F63YBA', username: 'nishimura' },
    response_url: 'https://hooks.slack.com/actions/T000/AAA/BBB',
  };
  return `payload=${encodeURIComponent(JSON.stringify(payload))}`;
}

describe('POST /api/slack/interactive', () => {
  const origEnv = { ...process.env };
  const fetchSpy = vi.spyOn(global, 'fetch');

  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));
    mockPool.query.mockReset();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.clearAllMocks();
  });

  it('returns 503 when SLACK_SIGNING_SECRET is not set (fail-closed)', async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const body = buildBlockActionsBody();
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await request(buildApp())
      .post('/api/slack/interactive')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('x-slack-request-timestamp', ts)
      .set('x-slack-signature', 'v0=irrelevant')
      .send(body);
    expect(res.status).toBe(503);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('returns 401 when signature is invalid', async () => {
    const body = buildBlockActionsBody();
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await request(buildApp())
      .post('/api/slack/interactive')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('x-slack-request-timestamp', ts)
      .set('x-slack-signature', 'v0=' + '0'.repeat(64))
      .send(body);
    expect(res.status).toBe(401);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('returns 401 when timestamp is too old (replay protection)', async () => {
    const body = buildBlockActionsBody();
    const oldTs = String(Math.floor(Date.now() / 1000) - 60 * 60); // 1時間前
    const sig = sign('test-signing-secret', oldTs, body);
    const res = await request(buildApp())
      .post('/api/slack/interactive')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('x-slack-request-timestamp', oldTs)
      .set('x-slack-signature', sig)
      .send(body);
    expect(res.status).toBe(401);
  });

  it('dup_ok 初回押下: duplicate_acks に ACK を作成し response_url へカード更新を送る', async () => {
    mockPool.query.mockImplementation((sql: string) => {
      if (/INSERT INTO duplicate_acks/.test(sql)) {
        return Promise.resolve({ rows: [{ acked_by: 'nishimura', acked_at: new Date('2026-07-24T10:00:00Z') }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const body = buildBlockActionsBody();
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign('test-signing-secret', ts, body);

    const res = await request(buildApp())
      .post('/api/slack/interactive')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('x-slack-request-timestamp', ts)
      .set('x-slack-signature', sig)
      .send(body);

    expect(res.status).toBe(200);
    // INSERT ON CONFLICT DO NOTHING で ACK作成
    const insertCall = mockPool.query.mock.calls.find((c) => /INSERT INTO duplicate_acks/.test(c[0]));
    expect(insertCall).toBeTruthy();
    expect(insertCall![1]).toEqual(['no-123', '2026-07-21', 'nishimura']);

    // response_url へ replace_original のカード更新
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/actions/T000/AAA/BBB');
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.replace_original).toBe(true);
    expect(sentBody.text).toContain('OK済み');
    expect(sentBody.text).toContain('川面 直人');
  });

  it('二重押し: ON CONFLICT DO NOTHING で新規ACKは作られず、既存ACK情報でカードを更新する', async () => {
    mockPool.query.mockImplementation((sql: string) => {
      if (/INSERT INTO duplicate_acks/.test(sql)) {
        // ON CONFLICT DO NOTHING がヒット → RETURNING 行なし
        return Promise.resolve({ rows: [] });
      }
      if (/SELECT acked_by, acked_at FROM duplicate_acks/.test(sql)) {
        return Promise.resolve({ rows: [{ acked_by: 'nishimura', acked_at: new Date('2026-07-24T09:00:00Z') }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const body = buildBlockActionsBody();
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign('test-signing-secret', ts, body);

    const res = await request(buildApp())
      .post('/api/slack/interactive')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('x-slack-request-timestamp', ts)
      .set('x-slack-signature', sig)
      .send(body);

    expect(res.status).toBe(200);
    const insertCalls = mockPool.query.mock.calls.filter((c) => /INSERT INTO duplicate_acks/.test(c[0]));
    expect(insertCalls.length).toBe(1); // INSERTは試みるが ON CONFLICT DO NOTHING で新規行は作られない
    const selectCalls = mockPool.query.mock.calls.filter((c) => /SELECT acked_by, acked_at FROM duplicate_acks/.test(c[0]));
    expect(selectCalls.length).toBe(1); // 既存ACKを取得してカードに反映する
  });
});
