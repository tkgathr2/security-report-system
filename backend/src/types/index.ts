import { Request } from 'express';

export interface CastJwtPayload {
  userId: string;
  email: string;
  /**
   * magic_link_token SHA-256 hash の先頭16バイト(hex)。
   * cast_users.magic_link_token のローテーションでJWTを失効させるためのバインド。
   * 旧JWT（mlh無し）は段階移行のため当面許容するが、新規発行は必ず付与する。
   */
  mlh?: string;
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
