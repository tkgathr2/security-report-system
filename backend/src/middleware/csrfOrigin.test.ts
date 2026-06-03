import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { csrfOriginCheck } from './csrfOrigin';

const SELF_HOST = 'security-report.up.railway.app';

function makeReq(overrides: Partial<Request> = {}): Request {
  const headers: Record<string, string | undefined> = { host: SELF_HOST };
  return {
    method: 'POST',
    originalUrl: '/api/admin/clients',
    headers,
    ...overrides,
    // allow callers to pass headers partially while keeping host default
    ...(overrides.headers ? { headers: { host: SELF_HOST, ...(overrides.headers as object) } } : {}),
  } as unknown as Request;
}

function makeRes(): Response & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as unknown as Response['status'];
  res.json = vi.fn((payload: unknown) => {
    res.body = payload;
    return res as Response;
  }) as unknown as Response['json'];
  return res as Response & { statusCode?: number; body?: unknown };
}

describe('csrfOriginCheck', () => {
  beforeEach(() => {
    delete process.env.CSRF_ENFORCEMENT;
    delete process.env.ALLOWED_ORIGINS;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('safe メソッド(GET)は素通りする', () => {
    const req = makeReq({ method: 'GET', headers: { origin: 'https://evil.example.com' } as never });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    csrfOriginCheck(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('同一オリジンのPOSTは通過する', () => {
    const req = makeReq({ headers: { origin: `https://${SELF_HOST}` } as never });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    csrfOriginCheck(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('クロスオリジンのPOSTは403でブロックする', () => {
    const req = makeReq({ headers: { origin: 'https://evil.example.com' } as never });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    csrfOriginCheck(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.body as { error: string }).error).toBe('CSRF_ORIGIN_MISMATCH');
  });

  it('Origin が無い場合は Referer で判定する（クロスオリジンはブロック）', () => {
    const req = makeReq({ headers: { referer: 'https://evil.example.com/attack.html' } as never });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    csrfOriginCheck(req, res, next);
    expect(res.statusCode).toBe(403);
  });

  it('Referer が同一オリジンなら通過する', () => {
    const req = makeReq({ headers: { referer: `https://${SELF_HOST}/admin/clients` } as never });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    csrfOriginCheck(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('Origin も Referer も無い（サーバー間/非ブラウザ）は通過する', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    csrfOriginCheck(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('x-api-key 付き(サーバー間)はクロスオリジンでも除外＝通過する', () => {
    const req = makeReq({ headers: { 'x-api-key': 'secret', origin: 'https://procast.example.com' } as never });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    csrfOriginCheck(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('Authorization: Bearer 付き(キャストJWT)は除外＝通過する', () => {
    const req = makeReq({ headers: { authorization: 'Bearer abc.def.ghi', origin: 'https://evil.example.com' } as never });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    csrfOriginCheck(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('ALLOWED_ORIGINS で追加した別ホストは通過する', () => {
    process.env.ALLOWED_ORIGINS = 'https://app.example.com, https://www.example.com';
    const req = makeReq({ headers: { origin: 'https://app.example.com' } as never });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    csrfOriginCheck(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('CSRF_ENFORCEMENT=report はブロックせずログのみ（通過）', () => {
    process.env.CSRF_ENFORCEMENT = 'report';
    const req = makeReq({ headers: { origin: 'https://evil.example.com' } as never });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    csrfOriginCheck(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('DELETE もクロスオリジンはブロックする', () => {
    const req = makeReq({ method: 'DELETE', headers: { origin: 'https://evil.example.com' } as never });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    csrfOriginCheck(req, res, next);
    expect(res.statusCode).toBe(403);
  });
});
