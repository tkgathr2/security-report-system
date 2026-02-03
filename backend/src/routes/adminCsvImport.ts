import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import crypto from 'crypto';
import pool from '../db/pool';

const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

interface AdminUser {
  id: string;
  email: string;
  is_active: boolean;
}

interface CsvRow {
  [key: string]: string | undefined;
}

type CsvFormat = 'staff_assignment' | 'job_export';

interface HeaderMapping {
  projectName: string;
  clientName: string;
  location: string;
  workDate: string;
  workContent?: string;
  startTime?: string;
  endTime?: string;
  breakTime?: string;
  staffNo?: string;
  staffName?: string;
}

const STAFF_ASSIGNMENT_HEADERS = ['No.', 'スタッフNo.', '氏名', '実施日', 'クライアント名', '案件名', '実施場所'];
const JOB_EXPORT_HEADERS = ['案件名', 'クライアント名', '実施場所', '実施日'];

function detectCsvFormat(headers: string[]): { format: CsvFormat; mapping: HeaderMapping } | null {
  const headerSet = new Set(headers);
  
  if (STAFF_ASSIGNMENT_HEADERS.every(h => headerSet.has(h))) {
    return {
      format: 'staff_assignment',
      mapping: {
        projectName: '案件名',
        clientName: 'クライアント名',
        location: '実施場所',
        workDate: '実施日',
        workContent: '業務内容(2)',
        startTime: '開始時間',
        endTime: '終了時間',
        breakTime: '休憩時間',
        staffNo: 'スタッフNo.',
        staffName: '氏名'
      }
    };
  }
  
  if (JOB_EXPORT_HEADERS.every(h => headerSet.has(h))) {
    return {
      format: 'job_export',
      mapping: {
        projectName: '案件名',
        clientName: 'クライアント名',
        location: '実施場所',
        workDate: '実施日',
        workContent: '業務内容(2)',
        startTime: '開始時間',
        endTime: '終了時間',
        breakTime: '休憩時間'
      }
    };
  }
  
  return null;
}

function detectEncoding(buffer: Buffer): string {
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return 'utf8_bom';
  }
  
  try {
    const utf8Text = buffer.toString('utf8');
    if (!utf8Text.includes('\ufffd')) {
      const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(utf8Text);
      if (hasJapanese || /^[\x00-\x7F]*$/.test(utf8Text)) {
        return 'utf8';
      }
    }
  } catch (e) {
    // Not UTF-8
  }
  
  try {
    const cp932Text = iconv.decode(buffer, 'cp932');
    if (!cp932Text.includes('\ufffd')) {
      return 'cp932';
    }
  } catch (e) {
    // Not CP932
  }
  
  return 'unknown';
}

function normalizeClientName(name: string): string {
  return name
    .replace(/[（）\(\)]/g, '')
    .replace(/[\s　]+/g, '')
    .replace(/株式会社|有限会社|合同会社/g, '')
    .toLowerCase()
    .trim();
}

function generateProjectKey(workDate: string, projectName: string, location: string, clientName: string): string {
  const normalized = `${workDate}|${projectName}|${location}|${clientName}`;
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

function generateUniqueUrl(): string {
  return crypto.randomUUID();
}

function parseDate(dateStr: string): Date | null {
  const match = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }
  return null;
}

function extractQualifierHint(projectName: string): string | null {
  const match = projectName.match(/[（\(]([^）\)]+)[）\)]$/);
  return match ? match[1] : null;
}

function hasQualifierFromProjectName(projectName: string): boolean {
  const hint = extractQualifierHint(projectName);
  return hint !== null && hint.includes('有');
}

function requireAdminAuth(req: Request, res: Response, next: () => void): void {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    res.status(401).json({
      error: 'ADMIN_UNAUTHORIZED',
      message: '管理者認証が必要です',
      details: {}
    });
    return;
  }
  next();
}

router.post('/import', requireAdminAuth, upload.single('file'), async (req: Request, res: Response) => {
  const adminUser = req.user as AdminUser;
  
  if (!req.file) {
    res.status(400).json({
      error: 'INVALID_PAYLOAD',
      message: 'CSVファイルが必要です',
      details: {}
    });
    return;
  }

  const buffer = req.file.buffer;
  const originalFileName = req.file.originalname;
  
  const detectedEncoding = detectEncoding(buffer);
  
  if (detectedEncoding === 'unknown') {
    res.status(422).json({
      error: 'CSV_ENCODING_UNKNOWN',
      message: '文字コードを判定できませんでした。UTF-8またはCP932を選択してください。',
      details: { detected: 'unknown' }
    });
    return;
  }

  let csvText: string;
  if (detectedEncoding === 'utf8_bom') {
    csvText = buffer.slice(3).toString('utf8');
  } else if (detectedEncoding === 'utf8') {
    csvText = buffer.toString('utf8');
  } else {
    csvText = iconv.decode(buffer, 'cp932');
  }

  let records: CsvRow[];
  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  } catch (error) {
    res.status(400).json({
      error: 'CSV_PARSE_ERROR',
      message: 'CSVの解析に失敗しました',
      details: { error: String(error) }
    });
    return;
  }

  if (records.length === 0) {
    res.status(400).json({
      error: 'CSV_EMPTY',
      message: 'CSVにデータがありません',
      details: {}
    });
    return;
  }

  const firstRow = records[0];
  const headers = Object.keys(firstRow);
  const formatInfo = detectCsvFormat(headers);
  
  if (!formatInfo) {
    res.status(400).json({
      error: 'CSV_HEADER_MISMATCH',
      message: '必須ヘッダーが不足しています。案件名、クライアント名、実施場所、実施日が必要です。',
      details: { 
        found_headers: headers.slice(0, 20),
        required: JOB_EXPORT_HEADERS
      }
    });
    return;
  }

  const { format, mapping } = formatInfo;
  const errors: Array<{ row: number; reason: string }> = [];
  let createdProjectsCount = 0;
  let skippedRowsCount = 0;
  let pendingClientRowsCount = 0;
  let staffAutoAddedCount = 0;

  const projectMap = new Map<string, { projectId: string; casts: Set<string> }>();
  const processedStaffKana = new Set<string>();
  const processedWorkDates = new Map<string, Set<string>>();

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const rowNum = i + 2;

    const projectName = row[mapping.projectName]?.trim();
    const clientNameRaw = row[mapping.clientName]?.trim();
    const location = row[mapping.location]?.trim();
    const workDateStr = row[mapping.workDate]?.trim();

    if (!projectName || !clientNameRaw || !location || !workDateStr) {
      errors.push({ row: rowNum, reason: '必須列（案件名、クライアント名、実施場所、実施日）が空です' });
      skippedRowsCount++;
      continue;
    }

    const workDates = workDateStr.includes('・') ? workDateStr.split('・') : [workDateStr];
    
    for (const singleDateStr of workDates) {
      const trimmedDate = singleDateStr.trim();
      if (!trimmedDate) continue;

      const workDate = parseDate(trimmedDate);
      if (!workDate) {
        errors.push({ row: rowNum, reason: `実施日の形式が不正です: ${trimmedDate}` });
        skippedRowsCount++;
        continue;
      }

      const projectKey = generateProjectKey(
        workDate.toISOString().split('T')[0],
        projectName,
        location,
        clientNameRaw
      );

      if (!processedWorkDates.has(projectName)) {
        processedWorkDates.set(projectName, new Set());
      }
      const dateKey = workDate.toISOString().split('T')[0];
      if (processedWorkDates.get(projectName)!.has(dateKey)) {
        continue;
      }
      processedWorkDates.get(projectName)!.add(dateKey);

      const workName = (mapping.workContent && row[mapping.workContent]?.trim()) || projectName;
      const startTime = (mapping.startTime && row[mapping.startTime]?.trim()) || null;
      const endTime = (mapping.endTime && row[mapping.endTime]?.trim()) || null;
      const breakTime = (mapping.breakTime && row[mapping.breakTime]?.trim()) || null;
      const qualifierHint = extractQualifierHint(projectName);

      try {
        if (!projectMap.has(projectKey)) {
          const existingProject = await pool.query(
            'SELECT id FROM projects WHERE project_key = $1',
            [projectKey]
          );

          if (existingProject.rows.length > 0) {
            const existingCasts = await pool.query(
              'SELECT staff_no FROM project_casts WHERE project_id = $1',
              [existingProject.rows[0].id]
            );
            const castSet = new Set(existingCasts.rows.map((c: { staff_no: string }) => c.staff_no));
            projectMap.set(projectKey, { projectId: existingProject.rows[0].id, casts: castSet });
          } else {
            const clientNameNormalized = normalizeClientName(clientNameRaw);
            const clientResult = await pool.query(
              'SELECT id FROM clients WHERE name_normalized = $1 AND is_active = true',
              [clientNameNormalized]
            );

            const clientId = clientResult.rows.length > 0 ? clientResult.rows[0].id : null;
            const status = clientId ? 'active' : 'pending_client';

            if (!clientId) {
              pendingClientRowsCount++;
            }

            const uniqueUrl = generateUniqueUrl();
            const urlExpiresAt = new Date(workDate);
            urlExpiresAt.setDate(urlExpiresAt.getDate() + 3);
            urlExpiresAt.setHours(23, 59, 59, 999);

            const insertResult = await pool.query(
              `INSERT INTO projects (
                project_key, client_id, client_name_raw, work_date, work_name, location,
                start_time, end_time, break_time, work_title_raw, qualifier_hint,
                unique_url, url_expires_at, status
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              RETURNING id`,
              [
                projectKey, clientId, clientNameRaw, workDate, workName, location,
                startTime, endTime, breakTime, projectName, qualifierHint,
                uniqueUrl, urlExpiresAt, status
              ]
            );

            projectMap.set(projectKey, { projectId: insertResult.rows[0].id, casts: new Set() });
            createdProjectsCount++;
          }
        }

        if (format === 'staff_assignment' && mapping.staffNo && mapping.staffName) {
          const staffNo = row[mapping.staffNo]?.trim();
          const castName = row[mapping.staffName]?.trim();
          
          if (staffNo && castName) {
            const projectInfo = projectMap.get(projectKey)!;

            if (!projectInfo.casts.has(staffNo)) {
              await pool.query(
                `INSERT INTO project_casts (project_id, staff_no, cast_name, row_index)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (project_id, staff_no) DO NOTHING`,
                [projectInfo.projectId, staffNo, castName, i]
              );
              projectInfo.casts.add(staffNo);
            }

            const castNameKana = row['フリガナ']?.trim() || row['カナ']?.trim() || row['氏名カナ']?.trim();
            const staffKanaKey = castNameKana || castName;

            if (staffKanaKey && !processedStaffKana.has(staffKanaKey)) {
              processedStaffKana.add(staffKanaKey);
              try {
                const existingStaff = await pool.query(
                  'SELECT id FROM staff_master WHERE display_name_kana = $1',
                  [staffKanaKey]
                );

                if (existingStaff.rows.length === 0) {
                  await pool.query(
                    `INSERT INTO staff_master (display_name_kanji, display_name_kana, created_at, updated_at, created_by)
                     VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $3)`,
                    [castName, staffKanaKey, adminUser.email]
                  );
                  staffAutoAddedCount++;
                }
              } catch (staffError) {
                console.error('Staff auto-add error:', staffError);
              }
            }
          }
        }

      } catch (error) {
        console.error('Row processing error:', error);
        errors.push({ row: rowNum, reason: `処理エラー: ${String(error)}` });
        skippedRowsCount++;
      }
    }
  }

  const importStatus = skippedRowsCount === records.length ? 'failed' :
                       skippedRowsCount > 0 ? 'partial' : 'success';

  await pool.query(
    `INSERT INTO csv_imports (
      imported_by_admin_email, original_file_name, detected_encoding, status,
      created_projects_count, skipped_rows_count, pending_client_rows_count, errors_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      adminUser.email,
      originalFileName,
      detectedEncoding,
      importStatus,
      createdProjectsCount,
      skippedRowsCount,
      pendingClientRowsCount,
      JSON.stringify(errors)
    ]
  );

  // スタッフ自動追加の監査ログ
  if (staffAutoAddedCount > 0) {
    await pool.query(
      `INSERT INTO admin_audit_logs (admin_email, action, target_type, payload_json)
       VALUES ($1, $2, $3, $4)`,
      [
        adminUser.email,
        'staff_auto_add',
        'staff_master',
        JSON.stringify({ source: 'project_csv', file_name: originalFileName, inserted: staffAutoAddedCount })
      ]
    );
  }

  res.status(200).json({
    ok: true,
    status: importStatus,
    created_projects_count: createdProjectsCount,
    skipped_rows_count: skippedRowsCount,
    pending_client_rows_count: pendingClientRowsCount,
    staff_auto_added_count: staffAutoAddedCount,
    errors: errors.slice(0, 10)
  });
});

export default router;
