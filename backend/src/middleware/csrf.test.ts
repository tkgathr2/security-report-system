import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { csrfOriginGuard } from './csrf';

const SELF = 'https://app.example.com';

/** テスト用に最小限の Request を組み立てる */
function makeReq(opts: {
  method: string;
  headers?: Record<string, string>;
  host?: string;
  protocol?: string;
}): Request {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers || {})) {
    headers[k.toLowerCase()] = v;
  }
  return {
    method: opts.method,
    headers,
    protocol: opts.protocol || 'https',
    get(name: string) {
      if (name.toLowerCase() === 'host') return opts.host ?? 'app.example.com';
      return undefined;
    }
  } as unknown as Request;
}

function makeRes(): Response & { _status: number; _body: unknown } {
  const res = {
    _status: 0,
    _body: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    }
  };
  return res as unknown as Response & { _status: number; _body: unknown };
}

describe('csrfOriginGuard', () => {
  let next: NextFunction & { called: boolean };

  beforeEach(() => {
    const fn = vi.fn();
    next = Object.assign(fn, { called: false }) as NextFunction & { called: boolean };
    delete process.env.CSRF_PROTECTION_DISABLED;
    delete process.env.CSRF_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    delete process.env.CSRF_PROTECTION_DISABLED;
    delete process.env.CSRF_ALLOWED_ORIGINS;
  });

  it('passes safe methods (GET/HEAD/OPTIONS) without Origin', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const fn = vi.fn();
      const res = makeRes();
      csrfOriginGuard(makeReq({ method }), res, fn as NextFunction);
      expect(fn).toHaveBeenCalledOnce();
      expect(res._status).toBe(0);
    }
  });

  it('allows same-origin POST', () => {
    const res = makeRes();
    csrfOriginGuard(makeReq({ method: 'POST', headers: { Origin: SELF } }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBe(0);
  });

  // FAIL-25 の教訓: PATCH も状態変更メソッド。保護対象に含める。
  it('protects PATCH (FAIL-25 regression): rejects cross-origin', () => {
    const res = makeRes();
    csrfOriginGuard(
      makeReq({ method: 'PATCH', headers: { Origin: 'https://evil.example.net' } }),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect((res._body as { error: string }).error).toBe('CSRF_ORIGIN_MISMATCH');
  });

  it('protects PATCH with matching Origin: passes', () => {
    const res = makeRes();
    csrfOriginGuard(makeReq({ method: 'PATCH', headers: { Origin: SELF } }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects cross-origin POST/PUT/DELETE', () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const fn = vi.fn();
      const res = makeRes();
      csrfOriginGuard(
        makeReq({ method, headers: { Origin: 'https://evil.example.net' } }),
        res,
        fn as NextFunction
      );
      expect(fn).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
    }
  });

  it('rejects state-changing request with no Origin/Referer', () => {
    const res = makeRes();
    csrfOriginGuard(makeReq({ method: 'POST' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect((res._body as { error: string }).error).toBe('CSRF_ORIGIN_MISSING');
  });

  it('falls back to Referer when Origin is absent', () => {
    const res = makeRes();
    csrfOriginGuard(
      makeReq({ method: 'POST', headers: { Referer: `${SELF}/admin/reports` } }),
      res,
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('exempts machine clients carrying x-api-key', () => {
    const res = makeRes();
    csrfOriginGuard(
      makeReq({ method: 'POST', headers: { 'x-api-key': 'secret', Origin: 'https://evil.example.net' } }),
      res,
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('exempts Bearer (JWT) clients', () => {
    const res = makeRes();
    csrfOriginGuard(
      makeReq({ method: 'POST', headers: { authorization: 'Bearer abc.def.ghi', Origin: 'https://evil.example.net' } }),
      res,
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('honors CSRF_PROTECTION_DISABLED escape hatch', () => {
    process.env.CSRF_PROTECTION_DISABLED = 'true';
    const res = makeRes();
    csrfOriginGuard(
      makeReq({ method: 'POST', headers: { Origin: 'https://evil.example.net' } }),
      res,
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('honors CSRF_ALLOWED_ORIGINS allowlist', () => {
    process.env.CSRF_ALLOWED_ORIGINS = 'https://custom.example.org, https://other.example.org/';
    const res = makeRes();
    csrfOriginGuard(
      makeReq({ method: 'POST', headers: { Origin: 'https://custom.example.org' } }),
      res,
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });
});
