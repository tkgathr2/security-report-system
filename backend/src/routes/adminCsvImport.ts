import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import Encoding from 'encoding-japanese';
import crypto from 'crypto';
import pool from '../db/pool';
import { logAudit } from '../utils/auditLog';
import { requireApiKey } from '../middleware/apiKeyAuth';
import { resolveStaffForImport } from '../services/staffResolver';

// APIキーまたは管理者JWTで認証する複合ミドルウェア（機械間通信対応）
function requireAdminOrApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key'];
  if (key && process.env.HOUKO_API_KEY && key === process.env.HOUKO_API_KEY) {
    // API key authentication - set a system user for audit logging
    (req as any).user = { id: 'system-api', email: 'system@api-key', is_active: true };
    next(); return;
  }
  requireAdminAuth(req, res, next);
}

const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
  '開始時間': ['開始（予定）時間', '開始(予定)時間', '開始時間', 'start_time'],
  '終了時間': ['終了（予定）時間', '終了(予定)時間', '終了時間', 'end_time'],
  '休憩時間': ['休憩時間', 'break_time'],
  '業務内容': ['業務内容(2)', '業務内容', 'work_content'],
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
    const startTimeHeader = findHeaderMatch(headers, '開始時間');
    const endTimeHeader = findHeaderMatch(headers, '終了時間');
    const breakTimeHeader = findHeaderMatch(headers, '休憩時間');
    const workContentHeader = findHeaderMatch(headers, '業務内容');
    return {
      format: 'staff_assignment',
      mapping: {
        projectName: '案件名',
        clientName: 'クライアント名',
        location: '実施場所',
        workDate: '実施日',
        workContent: workContentHeader || undefined,
        startTime: startTimeHeader || undefined,
        endTime: endTimeHeader || undefined,
        breakTime: breakTimeHeader || undefined,
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
    const startTimeHeader = findHeaderMatch(headers, '開始時間');
    const endTimeHeader = findHeaderMatch(headers, '終了時間');
    const breakTimeHeader = findHeaderMatch(headers, '休憩時間');
    const workContentHeader = findHeaderMatch(headers, '業務内容');
    return {
      format: hasStaffInfo ? 'staff_assignment' : 'job_export',
      mapping: {
        projectName: '案件名',
        clientName: 'クライアント名',
        location: '実施場所',
        workDate: '実施日',
        workContent: workContentHeader || undefined,
        startTime: startTimeHeader || undefined,
        endTime: endTimeHeader || undefined,
        breakTime: breakTimeHeader || undefined,
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
  const startTimeHeader = findHeaderMatch(headers, '開始時間');
  const endTimeHeader = findHeaderMatch(headers, '終了時間');
  const breakTimeHeader = findHeaderMatch(headers, '休憩時間');
  const workContentHeader = findHeaderMatch(headers, '業務内容');
  
  if (projectNameHeader && clientNameHeader && locationHeader && workDateHeader) {
    const hasStaffInfo = staffNameHeader !== null;
    return {
      format: hasStaffInfo ? 'staff_assignment' : 'job_export',
      mapping: {
        projectName: projectNameHeader,
        clientName: clientNameHeader,
        location: locationHeader,
        workDate: workDateHeader,
        workContent: workContentHeader || undefined,
        startTime: startTimeHeader || undefined,
        endTime: endTimeHeader || undefined,
        breakTime: breakTimeHeader || undefined,
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
  
  const sourceEncoding = detected || 'SJIS';
  const unicodeArray = Encoding.convert(uint8Array, {
    to: 'UNICODE',
    from: sourceEncoding
  });
  
  const result = Encoding.codeToString(unicodeArray);
  
  if (sourceEncoding !== 'SJIS' && !/[\u3040-\u9FFF\uFF00-\uFFEF]/.test(result.substring(0, 500))) {
    const sjisArray = Encoding.convert(uint8Array, {
      to: 'UNICODE',
      from: 'SJIS'
    });
    return Encoding.codeToString(sjisArray);
  }
  
  return result;
}

function normalizeClientName(name: string): string {
  return name
    .replace(/株式会社|有限会社|合同会社/g, '')
    .replace(/[㈱㈲]/g, '')
    .replace(/[（\(]株[）\)]/g, '')
    .replace(/[（\(]有[）\)]/g, '')
    .replace(/[（\(]合[）\)]/g, '')
    .replace(/[\s　]+/g, '')
    .toLowerCase()
    .trim();
}

function isEmptyClientName(name: string | undefined | null): boolean {
  if (!name) return true;

  const trimmed = name.replace(/[\s　]+/g, '').trim();
  if (trimmed === '') return true;
  if (/^[-ー－―]+$/.test(trimmed)) return true;

  const normalized = normalizeClientName(name);
  if (normalized === '') return true;

  return false;
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
    const year = parseInt(match[1]);
    const month = parseInt(match[2]);
    const day = parseInt(match[3]);

    // Validate month and day ranges
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;

    // TZ非依存化: ローカルTZ依存の new Date(year, month-1, day) は
    // サーバTZが UTC やそれ以外のとき「日付がずれる」事象を起こす。
    // CSVの日付はカレンダー上の日付（時刻無し）として UTC 0時で固定する。
    return new Date(Date.UTC(year, month - 1, day));
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

router.post('/import', requireAdminOrApiKey, upload.single('file'), async (req: Request, res: Response) => {
  const adminUser = req.user as AdminUser;
  const forceImport = req.body?.force_import === 'true';
  
  if (!req.file) {
    res.status(400).json({
      error: 'INVALID_PAYLOAD',
      message: 'CSVファイルが必要です',
      details: {}
    });
    return;
  }

  const buffer = req.file.buffer;
  const rawFileName = req.file.originalname;
  const fileNameBytes = Buffer.from(rawFileName, 'latin1');
  const fnDetected = Encoding.detect(new Uint8Array(fileNameBytes));
  let originalFileName = rawFileName;
  if (fnDetected && fnDetected !== 'UTF8' && fnDetected !== 'ASCII') {
    const converted = Encoding.convert(new Uint8Array(fileNameBytes), { to: 'UNICODE', from: fnDetected });
    originalFileName = Encoding.codeToString(converted);
  } else if (!/^[\x20-\x7E\u3000-\u9FFF\uFF00-\uFFEF\u30A0-\u30FF\u3040-\u309F\u4E00-\u9FAF._\-()\s]+$/.test(rawFileName)) {
    try {
      originalFileName = Buffer.from(rawFileName, 'latin1').toString('utf8');
    } catch { /* keep original */ }
  }
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

  const requiredFieldChecks: Array<{ label: string; key: string | undefined }> = [
    { label: '案件名', key: mapping.projectName },
    { label: 'クライアント名', key: mapping.clientName },
    { label: '実施場所', key: mapping.location },
    { label: '実施日', key: mapping.workDate },
    { label: '氏名', key: mapping.staffName },
  ];
  const criticalMissing: string[] = [];
  for (const { label, key } of requiredFieldChecks) {
    if (!key) {
      criticalMissing.push(label);
      continue;
    }
    const filledCount = records.filter(r => r[key]?.trim()).length;
    if (filledCount === 0) {
      criticalMissing.push(label);
    }
  }
  if (criticalMissing.length > 0) {
    res.status(400).json({
      error: 'CSV_FORMAT_INVALID',
      message: `必須項目が不足しています: ${criticalMissing.join('、')}`,
      details: {
        missing_headers: criticalMissing,
        found_headers: headers.slice(0, 20)
      }
    });
    return;
  }

  // Row-level required field validation: if any row has missing required fields,
  // block the entire import (no partial imports).
  const rowValidationErrors: Array<{ row: number; reason: string }> = [];
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const rowNum = i + 2;

    const projectNameKey = mapping.projectName;
    const clientNameKey = mapping.clientName;
    const locationKey = mapping.location;
    const workDateKey = mapping.workDate;
    const staffNameKey = mapping.staffName;

    const projectName = projectNameKey ? row[projectNameKey]?.trim() : undefined;
    const clientNameRaw = clientNameKey ? row[clientNameKey]?.trim() : undefined;
    const location = locationKey ? row[locationKey]?.trim() : undefined;
    const workDateStr = workDateKey ? row[workDateKey]?.trim() : undefined;
    const staffName = staffNameKey ? row[staffNameKey]?.trim() : undefined;

    const emptyFields: string[] = [];
    if (!projectName) emptyFields.push('案件名');
    if (isEmptyClientName(clientNameRaw)) emptyFields.push('クライアント名');
    if (!location) emptyFields.push('実施場所');
    if (!workDateStr) emptyFields.push('実施日');
    if (!staffName) emptyFields.push('氏名');

    if (emptyFields.length > 0) {
      rowValidationErrors.push({ row: rowNum, reason: `以下の項目が空です: ${emptyFields.join(', ')}` });
    }
  }

  if (rowValidationErrors.length > 0) {
    res.status(400).json({
      error: 'CSV_ROW_INVALID',
      message: '必須項目が空の行があります。CSVを修正して再アップロードしてください。',
      details: {
        error_count: rowValidationErrors.length,
        errors: rowValidationErrors
      }
    });
    return;
  }

  const errors: Array<{ row: number; reason: string }> = [];
  let createdProjectsCount = 0;
  let updatedProjectsCount = 0;
  let skippedRowsCount = 0;
  let pendingClientRowsCount = 0;
  let staffAutoAddedCount = 0;
  let duplicateCastAssignments = 0;
  let clientAutoCreatedCount = 0;
  let softDeletedProjectsCount = 0;
  let skippedDeletedCastCount = 0;

  const projectMap = new Map<string, { projectId: string; casts: Set<string> }>();
  const processedStaffKana = new Set<string>();
  const processedWorkDates = new Map<string, Set<string>>();
  const castDateAssignments = new Map<string, string>();

  // 上書きモード: CSVに含まれる全日付を事前に収集
  // トランザクション開始前にCSVの日付を把握し、既存データをソフトデリートする
  const csvDatesPreScan = new Set<string>();
  for (const row of records) {
    const workDateStr = row[mapping.workDate]?.trim();
    if (workDateStr) {
      const dates = workDateStr.includes('・') ? workDateStr.split('・') : [workDateStr];
      for (const d of dates) {
        const parsed = parseDate(d.trim());
        if (parsed) {
          csvDatesPreScan.add(parsed.toISOString().split('T')[0]);
        }
      }
    }
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // 上書きモード: CSVに含まれる日付の既存案件を全てソフトデリート（後で新データで上書き）
    // これにより、ダブルブッキングチェックで旧データと衝突しなくなる
    for (const dateStr of csvDatesPreScan) {
      const existingProjects = await dbClient.query(
        `SELECT id FROM projects WHERE work_date = $1 AND deleted_at IS NULL`,
        [dateStr]
      );
      for (const row of existingProjects.rows) {
        await dbClient.query(
          `UPDATE projects SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [row.id]
        );
        await dbClient.query(
          `UPDATE project_casts SET deleted_at = NOW() WHERE project_id = $1 AND deleted_at IS NULL`,
          [row.id]
        );
        softDeletedProjectsCount++;
      }
    }

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2;

      const projectName = row[mapping.projectName]?.trim();
      const clientNameRaw = row[mapping.clientName]?.trim();
      const location = row[mapping.location]?.trim();
      const workDateStr = row[mapping.workDate]?.trim();

      const emptyFields: string[] = [];
      if (!projectName) emptyFields.push('案件名');
      if (isEmptyClientName(clientNameRaw)) emptyFields.push('クライアント名');
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
        const dateSet = processedWorkDates.get(validProjectName);
        if (dateSet) {
          dateSet.add(dateKey);
        }

        const workName = (mapping.workContent && row[mapping.workContent]?.trim()) || validProjectName;
        const startTime = (mapping.startTime && row[mapping.startTime]?.trim()) || null;
        const endTime = (mapping.endTime && row[mapping.endTime]?.trim()) || null;
        const breakTime = (mapping.breakTime && row[mapping.breakTime]?.trim()) || null;
        const supervisorName = (mapping.supervisorName && row[mapping.supervisorName]?.trim()) || null;
        const qualifierHint = extractQualifierHint(validProjectName);

        try {
          if (!projectMap.has(projectKey)) {
            // Check for both active and soft-deleted projects with same key
            const existingProject = await dbClient.query(
              'SELECT id, deleted_at FROM projects WHERE project_key = $1',
              [projectKey]
            );

            if (existingProject.rows.length > 0) {
              const existingProjectId = existingProject.rows[0].id;
              // If soft-deleted, restore it
              if (existingProject.rows[0].deleted_at) {
                await dbClient.query(
                  'UPDATE projects SET deleted_at = NULL, updated_at = NOW() WHERE id = $1',
                  [existingProjectId]
                );
              }
              const clientNameNormalized = normalizeClientName(validClientNameRaw);
              const clientResult = await dbClient.query(
                'SELECT id FROM clients WHERE name_normalized = $1 AND is_active = true AND deleted_at IS NULL',
                [clientNameNormalized]
              );
              let clientId: string | null = clientResult.rows.length > 0 ? clientResult.rows[0].id : null;
              if (!clientId) {
                const newClient = await dbClient.query(
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
                  const retryResult = await dbClient.query(
                    'SELECT id FROM clients WHERE name_normalized = $1 AND deleted_at IS NULL',
                    [clientNameNormalized]
                  );
                  clientId = retryResult.rows.length > 0 ? retryResult.rows[0].id : null;
                }
              }

              // Check if clientId is still null before updating
              if (!clientId) {
                errors.push({ row: rowNum, reason: 'クライアントIDが取得できませんでした' });
                skippedRowsCount++;
                continue;
              }

              await dbClient.query(
                `UPDATE projects SET client_id = $1, work_name = $2, location = $3,
                 start_time = $4, end_time = $5, break_time = $6,
                 work_title_raw = $7, qualifier_hint = $8, supervisor_name = $9,
                 updated_at = NOW()
                 WHERE id = $10`,
                [clientId, workName, validLocation, startTime, endTime, breakTime,
                 validProjectName, qualifierHint, supervisorName, existingProjectId]
              );
              await dbClient.query(
                `UPDATE project_casts SET deleted_at = NOW() WHERE project_id = $1 AND deleted_at IS NULL`,
                [existingProjectId]
              );
              projectMap.set(projectKey, { projectId: existingProjectId, casts: new Set() });
              updatedProjectsCount++;
            } else {
              const clientNameNormalized = normalizeClientName(validClientNameRaw);
              const clientResult = await dbClient.query(
                'SELECT id FROM clients WHERE name_normalized = $1 AND is_active = true AND deleted_at IS NULL',
                [clientNameNormalized]
              );

              let clientId: string | null = clientResult.rows.length > 0 ? clientResult.rows[0].id : null;
              const status = 'active';

              if (!clientId) {
                const newClient = await dbClient.query(
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
                  const retryResult = await dbClient.query(
                    'SELECT id FROM clients WHERE name_normalized = $1 AND deleted_at IS NULL',
                    [clientNameNormalized]
                  );
                  clientId = retryResult.rows.length > 0 ? retryResult.rows[0].id : null;
                }
              }

              // Check if clientId is null before proceeding with INSERT
              if (!clientId) {
                errors.push({ row: rowNum, reason: 'クライアントIDが取得できませんでした' });
                skippedRowsCount++;
                pendingClientRowsCount++;
                continue;
              }

              const uniqueUrl = generateUniqueUrl();
              // workDate は parseDate により UTC 0時の Date。
              // URL有効期限も UTC 基準で「workDate + 3日 の終わり (UTC 23:59:59.999)」とする。
              const urlExpiresAt = new Date(workDate.getTime());
              urlExpiresAt.setUTCDate(urlExpiresAt.getUTCDate() + 3);
              urlExpiresAt.setUTCHours(23, 59, 59, 999);

              const insertResult = await dbClient.query(
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
              const projectInfo = projectMap.get(projectKey);
              if (!projectInfo) {
                errors.push({ row: rowNum, reason: 'プロジェクト情報が見つかりません' });
                skippedRowsCount++;
                continue;
              }
              // staff_no が空欄の場合、project_casts.staff_no を castName 単独にすると
              // 同プロジェクト内の同姓同名2行（別人かもしれない）が ON CONFLICT で一方を
              // 黙って上書きする。row_index で衝突回避し、両行を保持する。
              const castIdentifier = staffNo || `${castName}::r${i}`;

              // ダブルブッキング検出キーはスタッフNo優先（同姓同名別人を誤検知しない）。
              // No未付与のときのみ氏名でキー化する（従来挙動を縮退維持）。
              const castDateKey = `${staffNo || castName}::${dateKey}`;
              if (castDateAssignments.has(castDateKey)) {
                const existingWork = castDateAssignments.get(castDateKey)!;
                // 同一CSV内で同じ人が同じ日に複数現場へ出現（プロキャス元データ由来の重複）。
                // 手動取込(force_import=false)ではダブルブッキングとしてブロック対象なので errors に載せる。
                // 自動同期(force_import=true)ではこれは想定内の重複除外であり、元データ側にしか
                // 直せない状態が毎回同じ行として再検出される。errors に載せると procast-sync が
                // errorCount>0 を「一部失敗」とみなし、同じ警告を毎日3回鳴らし続ける（社長指摘 2026-07-21）。
                // よって force_import 時は errors には載せず、duplicate_cast_assignments の集計のみ行う。
                if (!forceImport) {
                  errors.push({ row: rowNum, reason: `${castName} は ${dateKey} に既に「${existingWork}」に割り当て済みです（1日1現場まで）` });
                }
                duplicateCastAssignments++;
              }

              if (!castDateAssignments.has(castDateKey)) {
                castDateAssignments.set(castDateKey, workName);
                  // DB側の既存割当チェックも procast_staff_no を優先照合する。
                  // No指定があればNo一致だけを既存扱い、No空欄行はNo未付与の同名のみを対象にする。
                  // これにより「同姓同名別人」の row を誤って既存とみなさない。
                  const existingAssignment = await dbClient.query(
                    `SELECT p.work_name FROM project_casts pc
                     JOIN projects p ON pc.project_id = p.id
                     LEFT JOIN staff_master sm ON pc.staff_id = sm.id AND sm.deleted_at IS NULL
                     WHERE (
                       ($4::text IS NOT NULL AND sm.procast_staff_no = $4)
                       OR (
                         $4::text IS NULL
                         AND sm.procast_staff_no IS NULL
                         AND REPLACE(REPLACE(sm.display_name_kanji, ' ', ''), E'\\u3000', '') = REPLACE(REPLACE($1, ' ', ''), E'\\u3000', '')
                       )
                     )
                       AND p.work_date = $2
                       AND p.id != $3
                       AND pc.deleted_at IS NULL
                       AND p.deleted_at IS NULL`,
                    [castName, workDate, projectInfo.projectId, staffNo || null]
                  );
                  if (existingAssignment.rows.length > 0 && !forceImport) {
                    errors.push({ row: rowNum, reason: `${castName} は ${dateKey} に既に「${existingAssignment.rows[0].work_name}」に割り当て済みです（1日1現場まで）` });
                    duplicateCastAssignments++;
                  } else {
                    if (existingAssignment.rows.length > 0) {
                      await dbClient.query(
                        `UPDATE project_casts SET deleted_at = NOW()
                         WHERE staff_id IN (
                           SELECT sm.id FROM staff_master sm
                           WHERE (
                             ($4::text IS NOT NULL AND sm.procast_staff_no = $4)
                             OR (
                               $4::text IS NULL
                               AND sm.procast_staff_no IS NULL
                               AND REPLACE(REPLACE(sm.display_name_kanji, ' ', ''), E'\\u3000', '') = REPLACE(REPLACE($1, ' ', ''), E'\\u3000', '')
                             )
                           )
                             AND sm.deleted_at IS NULL
                         )
                           AND project_id IN (SELECT p.id FROM projects p WHERE p.work_date = $2 AND p.id != $3 AND p.deleted_at IS NULL)
                           AND deleted_at IS NULL`,
                        [castName, workDate, projectInfo.projectId, staffNo || null]
                      );
                    }
                    // \u30b9\u30bf\u30c3\u30d5No\u512a\u5148\u3067\u7167\u5408\uff08\u540c\u59d3\u540c\u540d\u306e\u5225\u4eba\u3092\u540d\u524d\u3067\u5438\u53ce\u3057\u306a\u3044\uff09\u3002\u8a73\u7d30\u306f services/staffResolver.ts
                    const staffKana = castNameKana || castName;
                    const resolved = await resolveStaffForImport(dbClient, {
                      staffNo: staffNo ?? null,
                      castName,
                      castNameKana: castNameKana || null,
                      adminEmail: adminUser.email,
                    });
                    if (resolved.skippedDeleted) {
                      skippedDeletedCastCount++;
                      errors.push({ row: rowNum, reason: `${castName} は削除済みのためスキップしました` });
                      continue;
                    }
                    if (resolved.autoAdded) {
                      staffAutoAddedCount++;
                    }
                    processedStaffKana.add(staffKana);
                    // ON CONFLICT は partial unique index にマッチさせるため WHERE 句を明示。
                    // 2026-06-19 PR #480 で UNIQUE 制約を partial unique index (`WHERE deleted_at IS NULL`)
                    // に変更したため、素の `ON CONFLICT (project_id, staff_no)` だと arbiter index に
                    // マッチせず「there is no unique or exclusion constraint matching the ON CONFLICT
                    // specification」で全行エラーになる（プロキャス自動同期で再発・西村さん指摘）。
                    // 同じ (project_id, staff_no) で active な行があれば update（deleted_at=NULL で再活性化）、
                    // 無ければ新規 INSERT。soft-deleted な行は partial index 対象外＝新規 INSERT が成功する設計でよい。
                    await dbClient.query(
                      `INSERT INTO project_casts (project_id, staff_no, staff_id, row_index, cast_name)
                       VALUES ($1, $2, $3, $4, $5)
                       ON CONFLICT (project_id, staff_no) WHERE deleted_at IS NULL DO UPDATE SET staff_id = EXCLUDED.staff_id, cast_name = EXCLUDED.cast_name, deleted_at = NULL`,
                      [projectInfo.projectId, castIdentifier, resolved.staffId, i, castName]
                    );
                    projectInfo.casts.add(castIdentifier);
                  }
                }
              }
              const staffKanaKey = castNameKana || castName;
              if (staffKanaKey && !processedStaffKana.has(staffKanaKey)) {
                processedStaffKana.add(staffKanaKey);
              }
            }
          
        } catch (error) {
          console.error('Row processing error:', error);
          errors.push({ row: rowNum, reason: `処理エラー: ${String(error)}` });
          skippedRowsCount++;
        }
      }
    }

    if (duplicateCastAssignments > 0 && !forceImport) {
      await dbClient.query('ROLLBACK');
      const doubleBookingErrors = errors.filter(e => e.reason.includes('に既に「'));
      res.status(200).json({
        ok: false,
        blocked: true,
        blocked_reason: 'DOUBLE_BOOKING',
        message: `ダブルブッキングが${duplicateCastAssignments}件検出されました。インポートをブロックしました。`,
        duplicate_cast_assignments: duplicateCastAssignments,
        errors: doubleBookingErrors.slice(0, 20)
      });
      return;
    }

    await dbClient.query('COMMIT');
  } catch (txError) {
    try {
      await dbClient.query('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    console.error('CSV import transaction error:', txError);
    res.status(500).json({
      error: 'IMPORT_FAILED',
      message: 'インポート処理中にエラーが発生しました',
      details: { error: String(txError) }
    });
    return;
  } finally {
    dbClient.release();
  }

  // 全行がエラーの場合、または80%以上がエラーの場合は「形式が違う」エラーを返す
  const errorRate = skippedRowsCount / records.length;
  if (skippedRowsCount === records.length || errorRate >= 0.5) {
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
        sample_errors: errors.slice(0, 10)
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
             LEFT JOIN cast_users cu ON cu.staff_id = sm.id AND cu.email_verified = true AND cu.deleted_at IS NULL
             WHERE REPLACE(REPLACE(sm.display_name_kana, ' ', ''), E'\\u3000', '') IN (${placeholders})
         AND sm.deleted_at IS NULL
         AND cu.id IS NULL`,
      kanaList
    );
    for (const row of noEmailResult.rows) {
      staffWithoutEmail.push(row.display_name_kanji);
    }
  }

  logAudit({ req, actorEmail: adminUser.email, action: 'CSV_IMPORT', targetType: 'csv_import', payload: { file_name: originalFileName, status: importStatus, created_projects: createdProjectsCount, skipped_rows: skippedRowsCount, staff_auto_added: staffAutoAddedCount, client_auto_created: clientAutoCreatedCount } });

  res.status(200).json({
    ok: true,
    status: importStatus,
    created_projects_count: createdProjectsCount,
    updated_projects_count: updatedProjectsCount,
    soft_deleted_projects_count: softDeletedProjectsCount,
    skipped_rows_count: skippedRowsCount,
    pending_client_rows_count: pendingClientRowsCount,
    staff_auto_added_count: staffAutoAddedCount,
    client_auto_created_count: clientAutoCreatedCount,
    duplicate_cast_assignments: duplicateCastAssignments,
    skipped_deleted_cast_count: skippedDeletedCastCount,
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
       WHERE p.created_at >= $1 AND p.created_at <= $2 AND p.deleted_at IS NULL
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
