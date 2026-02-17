import pool from '../db/pool';
import { Request } from 'express';

interface AuditLogParams {
  req?: Request;
  actorEmail: string;
  actorType?: 'admin' | 'cast' | 'system';
  action: string;
  targetType: string;
  targetId?: string | string[];
  payload: Record<string, unknown>;
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  const {
    req,
    actorEmail,
    actorType = 'admin',
    action,
    targetType,
    targetId,
    payload
  } = params;

  const ipAddress = req
    ? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
    : 'system';

  try {
    await pool.query(
      `INSERT INTO admin_audit_logs (admin_email, action, target_type, target_id, payload_json, actor_type, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actorEmail, action, targetType, targetId || null, JSON.stringify(payload), actorType, ipAddress]
    );
  } catch (error) {
    console.error('[AUDIT] Failed to write audit log:', error, { action, targetType, targetId });
  }
}
