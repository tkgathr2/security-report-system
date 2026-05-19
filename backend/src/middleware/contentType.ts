import { Request, Response, NextFunction } from 'express';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

export function requireJsonContentType(req: Request, res: Response, next: NextFunction): void {
  if (!METHODS_WITH_BODY.has(req.method)) {
    next();
    return;
  }

  const contentLength = req.headers['content-length'];
  const hasBody = contentLength !== undefined && contentLength !== '0';
  if (!hasBody && req.method !== 'POST') {
    next();
    return;
  }

  const contentType = (req.headers['content-type'] || '').toString().toLowerCase();
  if (!contentType) {
    if (!hasBody) {
      next();
      return;
    }
    res.status(400).json({
      error: 'INVALID_CONTENT_TYPE',
      message: 'Content-Type ヘッダは application/json を指定してください',
      details: {}
    });
    return;
  }

  if (contentType.includes('multipart/form-data')) {
    next();
    return;
  }

  if (!contentType.includes('application/json')) {
    res.status(400).json({
      error: 'INVALID_CONTENT_TYPE',
      message: 'Content-Type は application/json を指定してください',
      details: {}
    });
    return;
  }

  next();
}
