import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { isValidEmail, validateStringField, MAX_LENGTHS } from '../utils/validation';
import { logAudit } from '../utils/auditLog';

const router = Router();

// Admin authentication middleware
function requireAdmin(req: Request, res: Response, next: () => void) {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    res.status(401).json({
      error: 'ADMIN_UNAUTHORIZED',
      message: '管理者セッションがありません',
      details: {}
    });
    return;
  }
  next();
}

// Normalize email: trim + lowercase
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

interface Recipient {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface RecipientInput {
  company_name: string;
  contact_name: string;
  email: string;
}

// GET /api/admin/recipients - Get all recipients grouped by company
router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, company_name, contact_name, email, is_active, created_at, updated_at 
       FROM recipients 
       WHERE is_active = true AND deleted_at IS NULL
       ORDER BY company_name, contact_name`
    );

    const recipients: Recipient[] = result.rows;

    // Group by company_name
    const grouped: Record<string, Recipient[]> = {};
    for (const recipient of recipients) {
      if (!grouped[recipient.company_name]) {
        grouped[recipient.company_name] = [];
      }
      grouped[recipient.company_name].push(recipient);
    }

    res.status(200).json({
      recipients: recipients,
      grouped: grouped,
      total_count: recipients.length,
      company_count: Object.keys(grouped).length
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

// POST /api/admin/recipients - Create a new recipient
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const { company_name, contact_name, email } = req.body as RecipientInput;

  // Validation
  if (!company_name || !contact_name || !email) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: '会社名、担当者名、メールアドレスは必須です',
      details: {
        missing: [
          !company_name && 'company_name',
          !contact_name && 'contact_name',
          !email && 'email'
        ].filter(Boolean)
      }
    });
    return;
  }

  const companyErr = validateStringField(company_name, '会社名', MAX_LENGTHS.COMPANY_NAME);
  if (companyErr) { res.status(400).json({ error: 'VALIDATION_ERROR', message: companyErr, details: {} }); return; }
  const contactErr = validateStringField(contact_name, '担当者名', MAX_LENGTHS.PERSON_NAME);
  if (contactErr) { res.status(400).json({ error: 'VALIDATION_ERROR', message: contactErr, details: {} }); return; }

  if (!isValidEmail(email)) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: '正しいメールアドレスを入力してください',
      details: {}
    });
    return;
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const result = await pool.query(
      `INSERT INTO recipients (company_name, contact_name, email) 
       VALUES ($1, $2, $3) 
       RETURNING id, company_name, contact_name, email, is_active, created_at, updated_at`,
      [company_name.trim(), contact_name.trim(), normalizedEmail]
    );

    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'CREATE_RECIPIENT', targetType: 'recipient', targetId: result.rows[0].id, payload: { company_name: company_name.trim(), contact_name: contact_name.trim(), email: normalizedEmail } });

    res.status(201).json({
      message: '送付先を登録しました',
      recipient: result.rows[0]
    });
  } catch (error: unknown) {
    const pgError = error as { code?: string };
    if (pgError.code === '23505') {
      // Unique constraint violation
      res.status(409).json({
        error: 'DUPLICATE_RECIPIENT',
        message: '同じ会社名・担当者名・メールアドレスの組み合わせが既に存在します',
        details: {}
      });
      return;
    }
    console.error('Database error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

// POST /api/admin/recipients/for-report/:reportId - Save selected recipients for a report
// Note: This is mounted at /api/admin/recipients, so full path is /api/admin/recipients/for-report/:reportId
router.post('/for-report/:reportId', requireAdmin, async (req: Request, res: Response) => {
  const { reportId } = req.params;
  const { recipient_ids } = req.body as { recipient_ids: string[] };

  // Validation
  if (!recipient_ids || !Array.isArray(recipient_ids)) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'recipient_ids は配列で指定してください',
      details: {}
    });
    return;
  }

  try {
    // Check if report exists
    const reportResult = await pool.query(
      'SELECT id FROM reports WHERE id = $1 AND deleted_at IS NULL',
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '指定された報告書が見つかりません',
        details: {}
      });
      return;
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete existing recipients for this report
      await client.query(
        'UPDATE report_recipients SET deleted_at = NOW() WHERE report_id = $1 AND deleted_at IS NULL',
        [reportId]
      );

      // Insert new recipients (with email deduplication at server side)
      if (recipient_ids.length > 0) {
        // Get unique recipient_ids
        const uniqueRecipientIds = [...new Set(recipient_ids)];

        // Verify all recipient_ids exist and get their emails for deduplication
        const recipientsResult = await client.query(
          `SELECT id, email FROM recipients WHERE id = ANY($1) AND is_active = true AND deleted_at IS NULL`,
          [uniqueRecipientIds]
        );

        // Deduplicate by email (keep first occurrence)
        const seenEmails = new Set<string>();
        const deduplicatedRecipients: string[] = [];
        
        for (const recipient of recipientsResult.rows) {
          const normalizedEmail = normalizeEmail(recipient.email);
          if (!seenEmails.has(normalizedEmail)) {
            seenEmails.add(normalizedEmail);
            deduplicatedRecipients.push(recipient.id);
          }
        }

        // Insert deduplicated recipients
        for (const recipientId of deduplicatedRecipients) {
          await client.query(
            'INSERT INTO report_recipients (report_id, recipient_id) VALUES ($1, $2)',
            [reportId, recipientId]
          );
        }
      }

      await client.query('COMMIT');

      // Get saved recipients with details
      const savedResult = await client.query(
        `SELECT r.id, r.company_name, r.contact_name, r.email 
         FROM recipients r 
         INNER JOIN report_recipients rr ON r.id = rr.recipient_id 
         WHERE rr.report_id = $1 AND rr.deleted_at IS NULL AND r.deleted_at IS NULL
         ORDER BY r.company_name, r.contact_name`,
        [reportId]
      );

      // Get unique emails
      const uniqueEmails = [...new Set(savedResult.rows.map(r => normalizeEmail(r.email)))];

      const adminUser = req.user as { email: string };
      logAudit({ req, actorEmail: adminUser.email, action: 'SET_REPORT_RECIPIENTS', targetType: 'report_recipients', targetId: reportId, payload: { recipient_count: savedResult.rows.length, unique_email_count: uniqueEmails.length } });

      res.status(200).json({
        message: '宛先を保存しました',
        report_id: reportId,
        recipients: savedResult.rows,
        recipient_count: savedResult.rows.length,
        unique_email_count: uniqueEmails.length,
        unique_emails: uniqueEmails
      });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

// GET /api/admin/recipients/for-report/:reportId - Get selected recipients for a report
// Note: This is mounted at /api/admin/recipients, so full path is /api/admin/recipients/for-report/:reportId
router.get('/for-report/:reportId', requireAdmin, async (req: Request, res: Response) => {
  const { reportId } = req.params;

  try {
    // Check if report exists
    const reportResult = await pool.query(
      'SELECT id FROM reports WHERE id = $1 AND deleted_at IS NULL',
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '指定された報告書が見つかりません',
        details: {}
      });
      return;
    }

    // Get recipients for this report
    const result = await pool.query(
      `SELECT r.id, r.company_name, r.contact_name, r.email 
       FROM recipients r 
       INNER JOIN report_recipients rr ON r.id = rr.recipient_id 
       WHERE rr.report_id = $1 AND rr.deleted_at IS NULL AND r.deleted_at IS NULL
       ORDER BY r.company_name, r.contact_name`,
      [reportId]
    );

    // Group by company_name
    const grouped: Record<string, Recipient[]> = {};
    for (const recipient of result.rows) {
      if (!grouped[recipient.company_name]) {
        grouped[recipient.company_name] = [];
      }
      grouped[recipient.company_name].push(recipient);
    }

    // Get unique emails
    const uniqueEmails = [...new Set(result.rows.map((r: { email: string }) => normalizeEmail(r.email)))];

    res.status(200).json({
      report_id: reportId,
      recipients: result.rows,
      grouped: grouped,
      recipient_count: result.rows.length,
      unique_email_count: uniqueEmails.length,
      unique_emails: uniqueEmails
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

export default router;
