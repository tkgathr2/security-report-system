import { Response } from 'express';
import * as Sentry from '@sentry/node';
import { ErrorResponse } from '../types';

export const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  DUPLICATE: 'DUPLICATE',
  EXPIRED: 'EXPIRED'
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export function sendError(
  res: Response,
  statusCode: number,
  errorCode: ErrorCode,
  message: string,
  details: Record<string, unknown> = {}
): void {
  const response: ErrorResponse = {
    error: errorCode,
    message,
    details
  };
  res.status(statusCode).json(response);
}

export function sendNotFound(res: Response, message: string): void {
  sendError(res, 404, ErrorCodes.NOT_FOUND, message);
}

export function sendBadRequest(res: Response, message: string, details?: Record<string, unknown>): void {
  sendError(res, 400, ErrorCodes.INVALID_PAYLOAD, message, details);
}

export function sendInternalError(res: Response, message: string = 'データベースエラーが発生しました'): void {
  sendError(res, 500, ErrorCodes.INTERNAL_ERROR, message);
}

export function sendUnauthorized(res: Response, message: string = '認証が必要です'): void {
  sendError(res, 401, ErrorCodes.UNAUTHORIZED, message);
}

export function sendForbidden(res: Response, message: string): void {
  sendError(res, 403, ErrorCodes.FORBIDDEN, message);
}

export function sendConflict(res: Response, message: string): void {
  sendError(res, 409, ErrorCodes.DUPLICATE, message);
}

export function sendExpired(res: Response, message: string = '期限切れ'): void {
  sendError(res, 410, ErrorCodes.EXPIRED, message);
}

export function handleDbError(res: Response, error: unknown, context: string): void {
  console.error(`${context} error:`, error);
  Sentry.captureException(error, { tags: { context } });
  sendInternalError(res);
}
