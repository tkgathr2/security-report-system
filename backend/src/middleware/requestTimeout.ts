import { Request, Response, NextFunction } from 'express';

const DEFAULT_TIMEOUT_MS = 30_000;
const LONG_TIMEOUT_MS = 60_000;

const LONG_TIMEOUT_PATTERNS = [
  '/api/reports/approve',
  '/api/admin/csv',
];

function matchesLongTimeout(path: string): boolean {
  return LONG_TIMEOUT_PATTERNS.some((pattern) => path.startsWith(pattern));
}

export function requestTimeout(req: Request, res: Response, next: NextFunction): void {
  const timeoutMs = matchesLongTimeout(req.path) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

  const timer = setTimeout(() => {
    if (!res.headersSent) {
      console.error(`[Timeout] ${req.method} ${req.path} exceeded ${timeoutMs}ms`);
      res.status(408).json({
        error: 'REQUEST_TIMEOUT',
        message: 'リクエストがタイムアウトしました',
        details: {},
      });
    }
  }, timeoutMs);

  res.on('close', () => clearTimeout(timer));
  res.on('finish', () => clearTimeout(timer));

  next();
}
