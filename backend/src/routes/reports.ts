import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';
import { sendReportApprovalNotifications } from '../services/notifications';

const router = Router();

const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret-key';

interface CastJwtPayload {
  userId: string;
  email: string;
}

function authenticateCast(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: '認証が必要です',
      details: {}
    });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, AUTH_SECRET) as CastJwtPayload;
    (req as Request & { castUser: CastJwtPayload }).castUser = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'トークンが無効または期限切れです',
      details: {}
    });
  }
}

function generateDummyPdf(): Buffer {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT
/F1 12 Tf
100 700 Td
(Dummy PDF) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000206 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
300
%%EOF`;
  return Buffer.from(pdfContent, 'utf-8');
}

router.post('/approve', authenticateCast, async (req: Request, res: Response) => {
  try {
    const castUser = (req as Request & { castUser: CastJwtPayload }).castUser;
    const {
      project_unique_url,
      supervisor_name,
      weather,
      guard_contents,
      guard_other_text,
      overtime_hours,
      has_qualifier,
      qualifier_name,
      signature_png_base64
    } = req.body;

    if (!signature_png_base64) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: '署名は必須です',
        details: {}
      });
      return;
    }

    if (!guard_contents || !Array.isArray(guard_contents) || guard_contents.length === 0) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: '警備内容は1件以上必須です',
        details: {}
      });
      return;
    }

    if (has_qualifier === true && (!qualifier_name || qualifier_name.trim() === '')) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: '資格者有の場合、資格者氏名は必須です',
        details: {}
      });
      return;
    }

    if (!project_unique_url) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'project_unique_urlは必須です',
        details: {}
      });
      return;
    }

    const projectResult = await pool.query(
      `SELECT p.id, p.status, p.url_expires_at, p.client_name_raw, p.work_date, p.work_title_raw,
              c.emails as client_emails
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.unique_url = $1`,
      [project_unique_url]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '案件が見つかりません',
        details: {}
      });
      return;
    }

    const project = projectResult.rows[0];

    if (project.status === 'pending_client') {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: '未登録会社のため保留',
        details: {}
      });
      return;
    }

    const now = new Date();
    const expiresAt = new Date(project.url_expires_at);
    if (expiresAt < now) {
      res.status(410).json({
        error: 'EXPIRED_URL',
        message: '期限切れ',
        details: {}
      });
      return;
    }

    const signaturePngBuffer = Buffer.from(signature_png_base64, 'base64');
    const pdfBuffer = generateDummyPdf();

    const reportResult = await pool.query(
      `INSERT INTO reports (
        project_id, cast_user_id, supervisor_name, writer_name, weather,
        guard_contents, guard_other_text, overtime_hours, has_qualifier, qualifier_name,
        signature_png, pdf_bytes, status, approved_at, pdf_generation_status, pdf_generated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id`,
      [
        project.id,
        castUser.userId,
        supervisor_name || '',
        castUser.email,
        weather || 'sunny',
        guard_contents,
        guard_other_text || null,
        overtime_hours || null,
        has_qualifier || false,
        qualifier_name || null,
        signaturePngBuffer,
        pdfBuffer,
        'approved',
        now,
        'success',
        now
      ]
    );

    const reportId = reportResult.rows[0].id;

    const clientEmails = project.client_emails || [];
    const workDateStr = project.work_date instanceof Date 
      ? project.work_date.toISOString().split('T')[0]
      : String(project.work_date).split('T')[0];

    const notificationResult = await sendReportApprovalNotifications({
      reportId,
      companyName: project.client_name_raw,
      workDate: workDateStr,
      projectName: project.work_title_raw,
      clientEmails,
      pdfBytes: pdfBuffer
    });

    res.status(201).json({
      ok: true,
      report_id: reportId,
      pdf_saved: true,
      signature_saved: true,
      notifications: {
        email_sent: notificationResult.emailSent,
        slack_sent: notificationResult.slackSent
      },
      warnings: notificationResult.warnings.length > 0 ? notificationResult.warnings : undefined
    });

  } catch (error) {
    console.error('Approve error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: '承認処理中にエラーが発生しました',
      details: {}
    });
  }
});

export default router;
