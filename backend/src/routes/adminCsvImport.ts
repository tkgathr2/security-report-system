import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import Encoding from 'encoding-japanese';
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
  supervisorName?: string;
}

const STAFF_ASSIGNMENT_HEADERS = ['No.', 'スタッフNo.', '氏名', '実施日', 'クライアント名', '案件名', '実施場所'];
const JOB_EXPORT_HEADERS = ['案件名', 'クライアント名', '実施場所', '実施日'];

const HEADER_ALIASES: Record<string, string[]> = {
  '案件名': ['案件名', '作業名', '業務名', 'プロジェクト名', 'project_name', 'work_name'],
  'クライアント名': ['クライアント名', '会社名', '顧客名', '取引先', 'client_name', 'company_name'],
  '実施場所': ['実施場所', '場所', '現場', '住所', 'location', 'address'],
  '実施日': ['実施日', '日付', '作業日', '勤務日', 'date', 'work_date'],
  '氏名': ['氏名', 'キャスト', 'スタッフ名', '名前', 'name', 'cast_name', 'staff_name'],
  'スタッフNo.': ['スタッフNo.', 'スタッフNo', 'スタッフ番号', 'staff_no', 'No.'],
  '監督者名': ['監督者名', '監督者', '現場監督', '責任者', 'supervisor_name', 'supervisor'],
};

function normalizeForComparison(str: string): string {
  return str
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ');
}

function findHeaderMatch(headers: string[], targetHeader: string): string | null {
  const aliases = HEADER_ALIASES[targetHeader] || [targetHeader];
  for (const alias of aliases) {
    const normalizedAlias = normalizeForComparison(alias);
    const found = headers.find(h => normalizeForComparison(h) === normalizedAlias);
    if (found) return found;
  }
  return null;
}

function detectCsvFormat(headers: string[]): { format: CsvFormat; mapping: HeaderMapping } | null {
  const headerSet = new Set(headers);
  
  if (STAFF_ASSIGNMENT_HEADERS.every(h => headerSet.has(h))) {
    const supervisorHeader = findHeaderMatch(headers, '監督者名');
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
        staffName: '氏名',
        supervisorName: supervisorHeader || undefined
      }
    };
  }
  
  if (JOB_EXPORT_HEADERS.every(h => headerSet.has(h))) {
    // Check if staff info columns exist even in job_export format
    const staffNameHeader = findHeaderMatch(headers, '氏名');
    const staffNoHeader = findHeaderMatch(headers, 'スタッフNo.');
    const hasStaffInfo = staffNameHeader !== null;
    
    const supervisorHeader = findHeaderMatch(headers, '監督者名');
    return {
      format: hasStaffInfo ? 'staff_assignment' : 'job_export',
      mapping: {
        projectName: '案件名',
        clientName: 'クライアント名',
        location: '実施場所',
        workDate: '実施日',
        workContent: '業務内容(2)',
        startTime: '開始時間',
        endTime: '終了時間',
        breakTime: '休憩時間',
        staffNo: staffNoHeader || undefined,
        staffName: staffNameHeader || undefined,
        supervisorName: supervisorHeader || undefined
      }
    };
  }
  
  const projectNameHeader = findHeaderMatch(headers, '案件名');
  const clientNameHeader = findHeaderMatch(headers, 'クライアント名');
  const locationHeader = findHeaderMatch(headers, '実施場所');
  const workDateHeader = findHeaderMatch(headers, '実施日');
  const staffNameHeader = findHeaderMatch(headers, '氏名');
  const staffNoHeader = findHeaderMatch(headers, 'スタッフNo.');
  const supervisorHeader = findHeaderMatch(headers, '監督者名');
  
  if (projectNameHeader && clientNameHeader && locationHeader && workDateHeader) {
    const hasStaffInfo = staffNameHeader !== null;
    return {
      format: hasStaffInfo ? 'staff_assignment' : 'job_export',
      mapping: {
        projectName: projectNameHeader,
        clientName: clientNameHeader,
        location: locationHeader,
        workDate: workDateHeader,
        staffNo: staffNoHeader || undefined,
        staffName: staffNameHeader || undefined,
        supervisorName: supervisorHeader || undefined
      }
    };
  }
  
  return null;
}

function convertToUtf8(buffer: Buffer): string {
  const uint8Array = new Uint8Array(buffer);
  const detected = Encoding.detect(uint8Array);
  
  if (detected === 'UTF8' || detected === 'ASCII') {
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      return buffer.slice(3).toString('utf8');
    }
    return buffer.toString('utf8');
  }
  
  const unicodeArray = Encoding.convert(uint8Array, {
    to: 'UNICODE',
    from: detected || 'SJIS'
  });
  
  return Encoding.codeToString(unicodeArray);
}

function normalizeClientName(name: string): string {
  return name
    .replace(/[（）\(\)]/g, '')
    .replace(/[\s　]+/g, '')
    .replace(/株式会社|有限会社|合同会社/g, '')
    .toLowerCase()
    .trim();
}

function normalizeNameSpaces(name: string): string {
  // Convert full-width spaces to half-width spaces
  return name.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
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
  const detectedEncoding = Encoding.detect(new Uint8Array(buffer)) || 'unknown';
  const csvText = convertToUtf8(buffer);

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
    const missingHeaders: string[] = [];
    const requiredHeaders = ['案件名', 'クライアント名', '実施場所', '実施日', '氏名'];
    for (const required of requiredHeaders) {
      if (!findHeaderMatch(headers, required)) {
        missingHeaders.push(required);
      }
    }
    res.status(400).json({
      error: 'CSV_FORMAT_INVALID',
      message: 'ファイルが指定された形式と違います。',
      details: { 
        missing_headers: missingHeaders,
        found_headers: headers.slice(0, 20),
        required: requiredHeaders
      }
    });
    return;
  }

  const { format, mapping } = formatInfo;
  const errors: Array<{ row: number; reason: string }> = [];
  let createdProjectsCount = 0;
  let existingProjectsCount = 0;
  let skippedRowsCount = 0;
  let pendingClientRowsCount = 0;
  let staffAutoAddedCount = 0;
  let duplicateCastAssignments = 0;
  let clientAutoCreatedCount = 0;

  const projectMap = new Map<string, { projectId: string; casts: Set<string> }>();
  const processedStaffKana = new Set<string>();
  const processedWorkDates = new Map<string, Set<string>>();
  const castDateAssignments = new Map<string, string>();

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const rowNum = i + 2;

    const projectName = row[mapping.projectName]?.trim();
    const clientNameRaw = row[mapping.clientName]?.trim();
    const location = row[mapping.location]?.trim();
    const workDateStr = row[mapping.workDate]?.trim();

    const emptyFields: string[] = [];
    if (!projectName) emptyFields.push('案件名');
    if (!clientNameRaw) emptyFields.push('クライアント名');
    if (!location) emptyFields.push('実施場所');
    if (!workDateStr) emptyFields.push('実施日');
    
    if (emptyFields.length > 0) {
      errors.push({ row: rowNum, reason: `以下の項目が空です: ${emptyFields.join(', ')}` });
      skippedRowsCount++;
      continue;
    }

    // At this point, all required fields are guaranteed to be non-empty strings
    const validProjectName = projectName as string;
    const validClientNameRaw = clientNameRaw as string;
    const validLocation = location as string;
    const validWorkDateStr = workDateStr as string;

    const workDates = validWorkDateStr.includes('・') ? validWorkDateStr.split('・') : [validWorkDateStr];
    
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
        validProjectName,
        validLocation,
        validClientNameRaw
      );

      if (!processedWorkDates.has(validProjectName)) {
        processedWorkDates.set(validProjectName, new Set());
      }
      const dateKey = workDate.toISOString().split('T')[0];
      if (processedWorkDates.get(validProjectName)!.has(dateKey)) {
        continue;
      }
      processedWorkDates.get(validProjectName)!.add(dateKey);

      const workName = (mapping.workContent && row[mapping.workContent]?.trim()) || validProjectName;
      const startTime = (mapping.startTime && row[mapping.startTime]?.trim()) || null;
      const endTime = (mapping.endTime && row[mapping.endTime]?.trim()) || null;
      const breakTime = (mapping.breakTime && row[mapping.breakTime]?.trim()) || null;
      const supervisorName = (mapping.supervisorName && row[mapping.supervisorName]?.trim()) || null;
      const qualifierHint = extractQualifierHint(validProjectName);

      // Check required time fields
      const timeEmptyFields: string[] = [];
      if (!startTime) timeEmptyFields.push('開始時間');
      if (!endTime) timeEmptyFields.push('終了時間');
      
      if (timeEmptyFields.length > 0) {
        errors.push({ row: rowNum, reason: `以下の項目が空です: ${timeEmptyFields.join(', ')}` });
      }

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
            existingProjectsCount++;
          } else {
            const clientNameNormalized = normalizeClientName(validClientNameRaw);
            const clientResult = await pool.query(
              'SELECT id FROM clients WHERE name_normalized = $1 AND is_active = true',
              [clientNameNormalized]
            );

            let clientId: string | null = clientResult.rows.length > 0 ? clientResult.rows[0].id : null;
            const status = 'active';

            if (!clientId) {
              const newClient = await pool.query(
                `INSERT INTO clients (name, name_normalized, emails, is_active)
                 VALUES ($1, $2, $3, true)
                 ON CONFLICT DO NOTHING
                 RETURNING id`,
                [validClientNameRaw, clientNameNormalized, []]
              );
              if (newClient.rows.length > 0) {
                clientId = newClient.rows[0].id;
                clientAutoCreatedCount++;
              } else {
                const retryResult = await pool.query(
                  'SELECT id FROM clients WHERE name_normalized = $1',
                  [clientNameNormalized]
                );
                clientId = retryResult.rows.length > 0 ? retryResult.rows[0].id : null;
              }
              if (!clientId) {
                pendingClientRowsCount++;
              }
            }

            const uniqueUrl = generateUniqueUrl();
            const urlExpiresAt = new Date(workDate);
            urlExpiresAt.setDate(urlExpiresAt.getDate() + 3);
            urlExpiresAt.setHours(23, 59, 59, 999);

            const insertResult = await pool.query(
              `INSERT INTO projects (
                project_key, client_id, work_date, work_name, location,
                start_time, end_time, break_time, work_title_raw, qualifier_hint,
                unique_url, url_expires_at, status, supervisor_name
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              RETURNING id`,
              [
                projectKey, clientId, workDate, workName, validLocation,
                startTime, endTime, breakTime, validProjectName, qualifierHint,
                uniqueUrl, urlExpiresAt, status, supervisorName
              ]
            );

            projectMap.set(projectKey, { projectId: insertResult.rows[0].id, casts: new Set() });
            createdProjectsCount++;
          }
        }

        if (mapping.staffName) {
          const rawCastName = row[mapping.staffName]?.trim();
          const castName = rawCastName ? normalizeNameSpaces(rawCastName) : undefined;
          const staffNo = mapping.staffNo ? row[mapping.staffNo]?.trim() : null;
          const rawCastNameKana = row['フリガナ']?.trim() || row['カナ']?.trim() || row['氏名カナ']?.trim();
          const castNameKana = rawCastNameKana ? normalizeNameSpaces(rawCastNameKana) : undefined;
          
          // Check required cast fields
          const castEmptyFields: string[] = [];
          if (!castName) castEmptyFields.push('氏名');
          if (!staffNo) castEmptyFields.push('スタッフNo.');
          if (!castNameKana) castEmptyFields.push('フリガナ');
          
          if (castEmptyFields.length > 0) {
            errors.push({ row: rowNum, reason: `以下の項目が空です: ${castEmptyFields.join(', ')}` });
          }
          
          if (castName) {
            const projectInfo = projectMap.get(projectKey)!;
            const castIdentifier = staffNo || castName;

            const castDateKey = `${castName}::${dateKey}`;
            if (castDateAssignments.has(castDateKey)) {
              const existingWork = castDateAssignments.get(castDateKey)!;
              errors.push({ row: rowNum, reason: `${castName} は ${dateKey} に既に「${existingWork}」に割り当て済みです（1日1現場まで）` });
              duplicateCastAssignments++;
            } else {
              castDateAssignments.set(castDateKey, workName);
            }

            if (!castDateAssignments.has(castDateKey) || castDateAssignments.get(castDateKey) === workName) {
              if (!projectInfo.casts.has(castIdentifier)) {
                const existingAssignment = await pool.query(
                  `SELECT p.work_name FROM project_casts pc
                   JOIN projects p ON pc.project_id = p.id
                   LEFT JOIN staff_master sm ON pc.staff_id = sm.id
                   WHERE REPLACE(REPLACE(sm.display_name_kanji, ' ', ''), E'\\u3000', '') = REPLACE(REPLACE($1, ' ', ''), E'\\u3000', '')
                     AND p.work_date = $2
                     AND p.id != $3`,
                  [castName, workDate, projectInfo.projectId]
                );
                if (existingAssignment.rows.length > 0) {
                  errors.push({ row: rowNum, reason: `${castName} は ${dateKey} に既に「${existingAssignment.rows[0].work_name}」に割り当て済みです（1日1現場まで）` });
                  duplicateCastAssignments++;
                } else {
                  const staffIdRow = await pool.query(
                    `SELECT id FROM staff_master WHERE REPLACE(REPLACE(display_name_kanji, ' ', ''), E'\\u3000', '') = REPLACE(REPLACE($1, ' ', ''), E'\\u3000', '') LIMIT 1`,
                    [castName]
                  );
                  await pool.query(
                    `INSERT INTO project_casts (project_id, staff_no, staff_id, row_index)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (project_id, staff_no) DO NOTHING`,
                    [projectInfo.projectId, castIdentifier, staffIdRow.rows[0]?.id || null, i]
                  );
                  projectInfo.casts.add(castIdentifier);
                }
              }
            }
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

  // 全行がエラーの場合、または80%以上がエラーの場合は「形式が違う」エラーを返す
  const errorRate = skippedRowsCount / records.length;
  if (skippedRowsCount === records.length || errorRate >= 0.8) {
    // どの項目が空だったかを集計
    const emptyFieldCounts: Record<string, number> = {};
    for (const err of errors) {
      const match = err.reason.match(/以下の項目が空です: (.+)/);
      if (match) {
        const fields = match[1].split(', ');
        for (const field of fields) {
          emptyFieldCounts[field] = (emptyFieldCounts[field] || 0) + 1;
        }
      }
    }
    
    const emptyFieldsList = Object.entries(emptyFieldCounts)
      .filter(([, count]) => count > records.length * 0.5)
      .map(([field]) => field);
    
    res.status(400).json({
      error: 'CSV_FORMAT_INVALID',
      message: 'ファイルが指定された形式と違います。',
      details: {
        empty_fields: emptyFieldsList.length > 0 ? emptyFieldsList : ['データが不足しています'],
        total_rows: records.length,
        error_rows: skippedRowsCount,
        sample_errors: errors.slice(0, 5)
      }
    });
    return;
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

  const staffWithoutEmail: string[] = [];
  if (processedStaffKana.size > 0) {
    const kanaList = Array.from(processedStaffKana);
    const placeholders = kanaList.map((_, i) => `$${i + 1}`).join(', ');
    const noEmailResult = await pool.query(
      `SELECT sm.display_name_kanji FROM staff_master sm
       LEFT JOIN cast_users cu ON cu.staff_id = sm.id AND cu.email_verified = true
       WHERE sm.display_name_kana IN (${placeholders})
         AND cu.id IS NULL`,
      kanaList
    );
    for (const row of noEmailResult.rows) {
      staffWithoutEmail.push(row.display_name_kanji);
    }
  }

  res.status(200).json({
    ok: true,
    status: importStatus,
    created_projects_count: createdProjectsCount,
    existing_projects_count: existingProjectsCount,
    skipped_rows_count: skippedRowsCount,
    pending_client_rows_count: pendingClientRowsCount,
    staff_auto_added_count: staffAutoAddedCount,
    client_auto_created_count: clientAutoCreatedCount,
    duplicate_cast_assignments: duplicateCastAssignments,
    staff_without_email: staffWithoutEmail,
    errors: errors.slice(0, 10)
  });
});

router.get('/imports', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, imported_by_admin_email, original_file_name, detected_encoding, status,
              created_projects_count, skipped_rows_count, pending_client_rows_count, 
              errors_json, created_at
       FROM csv_imports
       ORDER BY created_at DESC
       LIMIT 50`
    );

    res.json({
      imports: result.rows
    });
  } catch (error) {
    console.error('CSV imports list error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'インポート履歴の取得に失敗しました',
      details: {}
    });
  }
});

router.get('/imports/:id/projects', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const importResult = await pool.query(
      `SELECT id, original_file_name, created_at FROM csv_imports WHERE id = $1`,
      [id]
    );

    if (importResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'インポート履歴が見つかりません',
        details: {}
      });
      return;
    }

    const importInfo = importResult.rows[0];
    const importTime = new Date(importInfo.created_at);
    const startTime = new Date(importTime.getTime() - 60000);
    const endTime = new Date(importTime.getTime() + 60000);

    const projectsResult = await pool.query(
      `SELECT p.id, p.project_key, c.name as client_name_raw, p.work_date, p.work_name, p.location, 
              p.status, p.unique_url, p.url_expires_at, p.created_at
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.created_at >= $1 AND p.created_at <= $2
       ORDER BY p.work_date DESC, p.created_at DESC`,
      [startTime, endTime]
    );

    res.json({
      import: importInfo,
      projects: projectsResult.rows
    });
  } catch (error) {
    console.error('Import projects error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'インポート案件の取得に失敗しました',
      details: {}
    });
  }
});

export default router;
