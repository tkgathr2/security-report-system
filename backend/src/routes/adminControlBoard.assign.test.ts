import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db/pool', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../middleware/auth', () => ({
  requireAdmin: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request).user = {
      id: 'admin-id',
      email: 'admin@takagi.bz',
      is_active: true,
      role: 'admin',
    };
    next();
  },
}));
vi.mock('../utils/auditLog', () => ({
  logAudit: vi.fn(),
}));

import pool from '../db/pool';
import adminControlBoardRouter from './adminControlBoard';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/control-board', adminControlBoardRouter);
  return app;
}

const PROJ_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STAFF_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('POST /api/admin/control-board/assign', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });
  afterEach(() => {
    mockedQuery.mockReset();
  });

  it('returns 400 for invalid project_id UUID', async () => {
    const res = await request(buildApp())
      .post('/api/admin/control-board/assign')
      .send({ project_id: 'not-uuid', staff_id: STAFF_ID });
    expect(res.status).toBe(400);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid staff_id UUID', async () => {
    const res = await request(buildApp())
      .post('/api/admin/control-board/assign')
      .send({ project_id: PROJ_ID, staff_id: 'bad' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when project does not exist', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // projects lookup
    const res = await request(buildApp())
      .post('/api/admin/control-board/assign')
      .send({ project_id: PROJ_ID, staff_id: STAFF_ID });
    expect(res.status).toBe(404);
  });

  it('returns 404 when staff does not exist', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: PROJ_ID }], rowCount: 1 } as never) // projects
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // staff
    const res = await request(buildApp())
      .post('/api/admin/control-board/assign')
      .send({ project_id: PROJ_ID, staff_id: STAFF_ID });
    expect(res.status).toBe(404);
  });

  it('returns 409 when assignment already exists', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: PROJ_ID }], rowCount: 1 } as never) // projects
      .mockResolvedValueOnce({ rows: [{ id: STAFF_ID, procast_staff_no: '123', display_name_kanji: 'A' }], rowCount: 1 } as never) // staff
      .mockResolvedValueOnce({ rows: [{ id: 'existing' }], rowCount: 1 } as never); // dup
    const res = await request(buildApp())
      .post('/api/admin/control-board/assign')
      .send({ project_id: PROJ_ID, staff_id: STAFF_ID });
    expect(res.status).toBe(409);
  });

  it('returns 201 on success and inserts with staff_no from master', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: PROJ_ID }], rowCount: 1 } as never) // projects
      .mockResolvedValueOnce({ rows: [{ id: STAFF_ID, procast_staff_no: 'no-42', display_name_kanji: 'A' }], rowCount: 1 } as never) // staff
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // no dup
      .mockResolvedValueOnce({ rows: [{ id: 'new-pc-id' }], rowCount: 1 } as never); // INSERT
    const res = await request(buildApp())
      .post('/api/admin/control-board/assign')
      .send({ project_id: PROJ_ID, staff_id: STAFF_ID });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('new-pc-id');
    const insertCall = mockedQuery.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO project_casts')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual([PROJ_ID, STAFF_ID, 'no-42']);
    // INSERT クエリに row_index 算出ロジックが含まれていること（NOT NULL違反防止）
    expect(String(insertCall![0])).toContain('row_index');
  });
});

describe('DELETE /api/admin/control-board/assign', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('returns 400 for invalid project_id UUID', async () => {
    const res = await request(buildApp())
      .delete(`/api/admin/control-board/assign?project_id=bad&staff_id=${STAFF_ID}`);
    expect(res.status).toBe(400);
  });

  it('returns 404 when no active assignment matches', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const res = await request(buildApp())
      .delete(`/api/admin/control-board/assign?project_id=${PROJ_ID}&staff_id=${STAFF_ID}`);
    expect(res.status).toBe(404);
  });

  it('returns 200 (ok) when soft-delete succeeds', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'pc-id' }], rowCount: 1 } as never);
    const res = await request(buildApp())
      .delete(`/api/admin/control-board/assign?project_id=${PROJ_ID}&staff_id=${STAFF_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('GET /api/admin/control-board/range', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('returns 400 for invalid from', async () => {
    const res = await request(buildApp()).get('/api/admin/control-board/range?from=bad');
    expect(res.status).toBe(400);
  });

  it('returns 7-day range structure', async () => {
    // 7日 × 6クエリ = 42回 mock。最小限のスタブで全部空配列を返す。
    for (let i = 0; i < 7 * 6; i++) {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    }
    const res = await request(buildApp()).get('/api/admin/control-board/range?from=2026-06-16&days=7');
    expect(res.status).toBe(200);
    expect(res.body.from).toBe('2026-06-16');
    expect(res.body.days).toBe(7);
    expect(Array.isArray(res.body.range)).toBe(true);
    expect(res.body.range.length).toBe(7);
    expect(res.body.range[0].date).toBe('2026-06-16');
    expect(res.body.range[6].date).toBe('2026-06-22');
  });
});
