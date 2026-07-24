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
    channel: { id: 'C0AAQRA7RGW' },
    message: { ts: '1784931816.055029' },
  };
  return `payload=${encodeURIComponent(JSON.stringify(payload))}`;
}

/** 署名付きで POST するテスト用ヘルパー */
async function postSigned(body: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign('test-signing-secret', ts, body);
  return request(buildApp())
    .post('/api/slack/interactive')
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .set('x-slack-request-timestamp', ts)
    .set('x-slack-signature', sig)
    .send(body);
}

/** 非同期の記録処理（ack後に走る）が終わるのを待つ */
async function flushAsync() {
  await new Promise((r) => setTimeout(r, 20));
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

  describe('dup_fix（修正するボタン）', () => {
    beforeEach(() => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    });

    it('「修正する」を押すとスレッドに足跡を残す（誰がいつ選んだか）', async () => {
      const res = await postSigned(buildBlockActionsBody({ actionId: 'dup_fix' }));
      expect(res.status).toBe(200);
      await flushAsync();

      const postCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes('chat.postMessage'));
      expect(postCall).toBeTruthy();

      const sent = JSON.parse((postCall![1] as any).body);
      expect(sent.channel).toBe('C0AAQRA7RGW');
      expect(sent.thread_ts).toBe('1784931816.055029'); // カードのスレッドに付く
      expect(sent.text).toContain('修正する');
      expect(sent.text).toContain('nishimura'); // 誰が押したか
      expect(sent.text).toContain('川面 直人'); // 対象が分かる
    });

    it('「修正する」ではACKを記録しない（まだ直っていないので通知は継続する）', async () => {
      const res = await postSigned(buildBlockActionsBody({ actionId: 'dup_fix' }));
      expect(res.status).toBe(200);
      await flushAsync();

      const insertCalls = mockPool.query.mock.calls.filter((c) => /INSERT INTO duplicate_acks/.test(c[0]));
      expect(insertCalls.length).toBe(0);
    });

    it('カード本体は書き換えない（ボタンは押せるまま残る）', async () => {
      const res = await postSigned(buildBlockActionsBody({ actionId: 'dup_fix' }));
      expect(res.status).toBe(200);
      await flushAsync();

      const replaceCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes('hooks.slack.com'));
      expect(replaceCall).toBeFalsy();
    });

    it('SLACK_BOT_TOKEN 未設定でも 200 を返す（ユーザーのブラウザ遷移を妨げない）', async () => {
      delete process.env.SLACK_BOT_TOKEN;
      const res = await postSigned(buildBlockActionsBody({ actionId: 'dup_fix' }));
      expect(res.status).toBe(200);
      await flushAsync();

      const postCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes('chat.postMessage'));
      expect(postCall).toBeFalsy();
    });
  });
});
