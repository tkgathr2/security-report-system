import { Router, Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import pool from '../db/pool';

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

// pdf_generation_status values
const PDF_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed'
} as const;

interface ReportData {
  id: string;
  project_id: string;
  cast_user_id: string;
  supervisor_name: string;
  writer_name: string;
  weather: string;
  guard_contents: string[];
  guard_other_text: string | null;
  overtime_hours: number | null;
  has_qualifier: boolean;
  qualifier_name: string | null;
  signature_png: Buffer | null;
  pdf_bytes: Buffer | null;
  status: string;
  approved_at: Date;
  created_at: Date;
  pdf_generation_status: string;
  pdf_generated_at: Date | null;
}

interface ProjectData {
  project_key: string;
  client_name_raw: string;
  work_date: Date;
  work_name: string;
  location: string;
  start_time: string | null;
  end_time: string | null;
}

// Generate PDF from report data
async function generatePdfBuffer(report: ReportData, project: ProjectData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Register Japanese font (use built-in Helvetica for now)
      // For production, should use a Japanese font like NotoSansJP
      
      // Title
      doc.fontSize(20).text('Security Report', { align: 'center' });
      doc.moveDown();

      // Report details
      doc.fontSize(12);
      doc.text(`Project: ${project.work_name}`);
      doc.text(`Client: ${project.client_name_raw}`);
      doc.text(`Location: ${project.location}`);
      doc.text(`Date: ${project.work_date}`);
      if (project.start_time && project.end_time) {
        doc.text(`Time: ${project.start_time} - ${project.end_time}`);
      }
      doc.moveDown();

      doc.text(`Supervisor: ${report.supervisor_name}`);
      doc.text(`Writer: ${report.writer_name}`);
      doc.text(`Weather: ${report.weather}`);
      doc.moveDown();

      doc.text('Guard Contents:');
      report.guard_contents.forEach((content, index) => {
        doc.text(`  ${index + 1}. ${content}`);
      });
      if (report.guard_other_text) {
        doc.text(`  Other: ${report.guard_other_text}`);
      }
      doc.moveDown();

      if (report.overtime_hours) {
        doc.text(`Overtime Hours: ${report.overtime_hours}`);
      }
      if (report.has_qualifier && report.qualifier_name) {
        doc.text(`Qualifier: ${report.qualifier_name}`);
      }
      doc.moveDown();

      doc.text(`Status: ${report.status}`);
      doc.text(`Created: ${report.created_at}`);
      doc.text(`Approved: ${report.approved_at}`);
      doc.moveDown();

      // Signature
      if (report.signature_png && report.signature_png.length > 0) {
        doc.text('Signature:');
        try {
          doc.image(report.signature_png, { width: 200 });
        } catch (imgErr) {
          doc.text('[Signature image could not be rendered]');
        }
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// POST /api/admin/reports/:reportId/pdf/generate
router.post('/:reportId/pdf/generate', requireAdmin, async (req: Request, res: Response) => {
  const { reportId } = req.params;

  try {
    // Get report data
    const reportResult = await pool.query(
      'SELECT * FROM reports WHERE id = $1',
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

    const report: ReportData = reportResult.rows[0];

    // Get project data
    const projectResult = await pool.query(
      'SELECT project_key, client_name_raw, work_date, work_name, location, start_time, end_time FROM projects WHERE id = $1',
      [report.project_id]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '関連する案件が見つかりません',
        details: {}
      });
      return;
    }

    const project: ProjectData = projectResult.rows[0];

    // Update status to pending
    await pool.query(
      'UPDATE reports SET pdf_generation_status = $1 WHERE id = $2',
      [PDF_STATUS.PENDING, reportId]
    );

    try {
      // Generate PDF
      const pdfBuffer = await generatePdfBuffer(report, project);

      // Update report with PDF data
      await pool.query(
        `UPDATE reports 
         SET pdf_bytes = $1, 
             pdf_generation_status = $2, 
             pdf_generated_at = CURRENT_TIMESTAMP 
         WHERE id = $3`,
        [pdfBuffer, PDF_STATUS.SUCCESS, reportId]
      );

      res.status(200).json({
        message: 'PDF生成が完了しました',
        reportId: reportId,
        pdf_generation_status: PDF_STATUS.SUCCESS,
        pdf_size: pdfBuffer.length
      });
    } catch (pdfError) {
      // Update status to failed
      await pool.query(
        'UPDATE reports SET pdf_generation_status = $1 WHERE id = $2',
        [PDF_STATUS.FAILED, reportId]
      );

      console.error('PDF generation error:', pdfError);
      res.status(500).json({
        error: 'PDF_GENERATION_FAILED',
        message: 'PDF生成に失敗しました',
        details: {}
      });
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

// GET /api/admin/reports/:reportId/pdf
router.get('/:reportId/pdf', requireAdmin, async (req: Request, res: Response) => {
  const { reportId } = req.params;

  try {
    const result = await pool.query(
      'SELECT pdf_bytes, pdf_generation_status FROM reports WHERE id = $1',
      [reportId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '指定された報告書が見つかりません',
        details: {}
      });
      return;
    }

    const { pdf_bytes, pdf_generation_status } = result.rows[0];

    // Check if PDF has been generated
    if (!pdf_bytes || pdf_bytes.length === 0 || pdf_generation_status !== PDF_STATUS.SUCCESS) {
      res.status(404).json({
        error: 'PDF_NOT_GENERATED',
        message: 'PDFがまだ生成されていません',
        details: {
          pdf_generation_status: pdf_generation_status
        }
      });
      return;
    }

    // Return PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-${reportId}.pdf"`);
    res.send(pdf_bytes);
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
