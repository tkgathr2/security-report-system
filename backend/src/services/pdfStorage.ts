import pool from '../db/pool';

export interface PdfStorageResult {
  buffer: Buffer;
  generationStatus: string;
}

export interface PdfStorage {
  savePdf(reportId: string, buffer: Buffer, status: string): Promise<void>;
  getPdf(reportId: string): Promise<PdfStorageResult | null>;
}

class DatabasePdfStorage implements PdfStorage {
  async savePdf(reportId: string, buffer: Buffer, status: string): Promise<void> {
    await pool.query(
      'UPDATE reports SET pdf_bytes = $1, pdf_generation_status = $2, pdf_generated_at = $3 WHERE id = $4',
      [buffer, status, new Date(), reportId]
    );
  }

  async getPdf(reportId: string): Promise<PdfStorageResult | null> {
    const result = await pool.query(
      'SELECT pdf_bytes, pdf_generation_status FROM reports WHERE id = $1 AND deleted_at IS NULL',
      [reportId]
    );
    if (result.rows.length === 0) return null;
    const { pdf_bytes, pdf_generation_status } = result.rows[0];
    if (!pdf_bytes || pdf_bytes.length === 0 || pdf_generation_status !== 'success') return null;
    return { buffer: pdf_bytes, generationStatus: pdf_generation_status };
  }
}

const storage: PdfStorage = new DatabasePdfStorage();

export default storage;
