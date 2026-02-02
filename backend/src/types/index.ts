import { Request } from 'express';

export interface CastJwtPayload {
  userId: string;
  email: string;
}

export interface AuthenticatedCastRequest extends Request {
  castUser: CastJwtPayload;
}

export interface AdminUser {
  id: string;
  email: string;
  is_active: boolean;
}

export interface ErrorResponse {
  error: string;
  message: string;
  details: Record<string, unknown>;
}
