import './instrument';
import * as Sentry from '@sentry/node';
import express, { Request, Response } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import adminAuthRouter from './routes/adminAuth';
import adminRouter from './routes/admin';
import adminReportsRouter from './routes/adminReports';
import adminRecipientsRouter from './routes/adminRecipients';
import projectsRouter from './routes/projects';
import draftsRouter from './routes/drafts';
import reportsRouter from './routes/reports';
import adminCsvImportRouter from './routes/adminCsvImport';
import staffRouter from './routes/staff';
import castAuthRouter from './routes/castAuth';
import pool from './db/pool';
import { requestTimeout } from './middleware/requestTimeout';
import { sanitizeInput } from './utils/validation';
import { startDataUploadMonitor, stopDataUploadMonitor } from './services/dataUploadMonitor';

dotenv.config();

if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
  console.error('[FATAL] AUTH_SECRET is not set in production. Server cannot start safely.');
  console.error('[FATAL] Set AUTH_SECRET environment variable in Railway and redeploy.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.AUTH_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret-key');

// Trust proxy for Railway (required for secure cookies behind reverse proxy)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '10mb' }));
app.use((req: Request, _res: Response, next: () => void) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeInput(req.body);
  }
  next();
});
app.use(requestTimeout);

// PostgreSQL session store for persistent sessions
const PgSession = connectPgSimple(session);

app.use(session({
  store: new PgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax', // Required for OAuth redirects
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

app.use(passport.initialize());
app.use(passport.session());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

let seedStatus = 'pending';
let seedError = '';
let seedDetail = '';

app.get('/version', (_req: Request, res: Response) => {
  res.json({ spec: 'plan_v2', app: 'houkochan', build: '2026-02-17-v89', seedStatus, seedError, seedDetail, castFixDetail, cleanupDetail });
});

app.use('/api/admin/auth', adminAuthRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/reports', adminReportsRouter);
app.use('/api/admin/recipients', adminRecipientsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/drafts', draftsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/admin/csv', adminCsvImportRouter);
app.use('/api/staff', staffRouter);
app.use('/api/cast', castAuthRouter);

// Serve frontend static files in production
// __dirname is backend/dist after compilation, so ../frontend-dist points to backend/frontend-dist
const frontendDistPath = path.join(__dirname, '../frontend-dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');

// Check if frontend files exist
const frontendExists = fs.existsSync(frontendIndexPath);
console.log(`[Frontend] Path: ${frontendDistPath}`);
console.log(`[Frontend] Index exists: ${frontendExists}`);

if (frontendExists) {
  app.use(express.static(frontendDistPath));
}

Sentry.setupExpressErrorHandler(app);

// SPA fallback - serve index.html for non-API routes (Express 5.x compatible syntax)
app.get('/report/:uniqueUrl', (_req: Request, res: Response) => {
  if (frontendExists) {
    res.sendFile(frontendIndexPath);
  } else {
    res.status(500).send('Frontend not found. Build may have failed.');
  }
});

// Catch-all route for SPA - serve index.html for any unmatched routes
// Express 5.x requires '{*path}' syntax instead of '*' for wildcard routes
app.get('{*path}', (_req: Request, res: Response) => {
  if (frontendExists) {
    res.sendFile(frontendIndexPath);
  } else {
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="ja">
      <head>
        <meta charset="UTF-8">
        <title>Frontend Build Error</title>
        <style>body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }</style>
      </head>
      <body>
        <h1>Frontend Build Error</h1>
        <p>Frontend files not found at: ${frontendDistPath}</p>
        <p>Please check the Railway build logs.</p>
        <p><a href="/health">/health</a> - API Health Check</p>
        <p><a href="/version">/version</a> - Version Info</p>
      </body>
      </html>
    `);
  }
});

// Test-only endpointfor simulating admin login (development only)
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/test/admin-login', async (req: Request, res: Response) => {
    const testAdmin = {
      id: 'test-admin-id',
      email: 'atsuhiro@takagi.bz',
      is_active: true,
      role: 'super_admin'
    };
    req.login(testAdmin, (err) => {
      if (err) {
        res.status(500).json({ error: 'Login failed' });
        return;
      }
      res.json({ message: 'Test admin logged in', admin: testAdmin });
    });
  });
}

const SEEDED_STAFF_DATA: ReadonlyArray<readonly [string, string, string]> = [
  ['e2a3ee29-fa62-4394-b5c5-4826f30cde30', '有澤 知子', 'アリサワ トモコ'],
  ['49972e7a-f311-4358-86cb-2b5c34081b69', '井上 誠司', 'イノウエ セイジ'],
  ['433360cd-5de2-4402-83a4-1c0abb2f1626', '井村 義則', 'イムラ ヨシノリ'],
  ['2018528a-1287-4df3-9401-14b88fceaf6d', 'イ モン チョー', 'イ モン チョー'],
  ['5cdb75da-9c58-4dbf-9deb-195afdc96fd1', '梅原 幸雄', 'ウメハラ ユキオ'],
  ['0f1514c9-0524-4be6-b725-5161ed6a371f', '大野 祢音', 'オオノ ナイト'],
  ['578c67f0-88e9-4f2d-93b1-079d977b71ca', '梶原 創', 'カジハラ ソウ'],
  ['712606ff-a3bd-49ae-a351-9cd10dab8bb5', 'カッサ ヨハネス アスゲドム', 'カッサ ヨハネス アスゲドム'],
  ['83b466ae-a722-4238-b698-8bc93f99a5f7', '川面 直人', 'カワオモ ナオト'],
  ['b55cd8f2-2e28-4f84-bb79-084107001b13', '神崎 誠', 'カンザキ マコト'],
  ['e9bc1be3-8661-4456-ad1e-9618ccf01abf', '岸本 直美', 'キシモト ナオミ'],
  ['ed998da1-091c-4d1a-94f7-22ed6376beb7', '北口 恵一', 'キタグチ ケイイチ'],
  ['897b046a-15fc-4865-af3f-f5d2f1d4671d', '京谷 雅弥', 'キョウタニ マサヤ'],
  ['105b5ece-354d-4376-b56b-d0dbbafcd1e3', '久保 勇太', 'クボ ユウタ'],
  ['85580fdd-feb4-495b-a2ae-5b7f3928cc96', '近藤 拓翔', 'コンドウ タクト'],
  ['15dd404b-8f6e-40ca-8f81-cd19549cc78b', '高梨 航希', 'タカナシ コウキ'],
  ['b06832e9-e141-438d-83d8-0d1b112d6243', '土田 直矢', 'ツチダ ナオヤ'],
  ['d62cfa48-664f-4ff2-a276-96842e88c91b', 'テストスタッフ', 'テストスタッフ'],
  ['c4882bde-8fa0-425a-b29e-45a63af1cfc5', '中嶋 正一', 'ナカジマ ショウイチ'],
  ['03f26cec-e969-47d3-bf89-2e064a2abdce', '中田 琉月', 'ナカタ ルツキ'],
  ['bca398ac-c11e-424c-b098-cb498b09abb0', '中村 文彦', 'ナカムラ フミヒコ'],
  ['461239ac-ba19-4896-82bd-44587a46c443', '西村 克人', 'ニシムラ カツト'],
  ['f5321299-9b72-4b51-890d-4a311d57efeb', '波多野 匠', 'ハタノ タクミ'],
  ['1527734d-a112-4176-8bc7-63169bd14e1c', '廣中 良信', 'ヒロナカ ヨシノブ'],
  ['34e86a31-9c7b-48fa-b36b-24128dd76327', '藤井 勝', 'フジイ マサル'],
  ['bfaef3bc-2eb8-4a8b-9437-b200ff643b75', '藤田 風雅', 'フジタ フウガ'],
  ['2969c9f2-b58b-4c37-bde2-f13e7c3642a7', '松本 祐太郎', 'マツモト ユウタロウ'],
  ['a7f96a6a-907e-45b5-a1eb-462f95ccf57c', '峯 栄治', 'ミネ エイジ'],
  ['439a9918-4006-4fe7-b21f-94192a0144e1', '宮﨑 萌', 'ミヤザキ モエ'],
  ['006fdb66-2129-4491-b701-b5ea27176fb9', '高木 豊大', 'タカギ アツヒロ'],
];

async function seedStaffData() {
  try {
    const colResult = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'staff_master' ORDER BY ordinal_position`);
    const cols = colResult.rows.map((r: {column_name: string}) => r.column_name);
    seedDetail = 'cols:' + cols.join(',');
    const hasCreatedBy = cols.includes('created_by');
    const hasEmail = cols.includes('email');
    const hasDeletedAt = cols.includes('deleted_at');
    const whereClause = hasDeletedAt ? 'WHERE deleted_at IS NULL' : '';
    const countResult = await pool.query(`SELECT COUNT(*) as cnt FROM staff_master ${whereClause}`);
    const count = parseInt(countResult.rows[0].cnt, 10);
    seedDetail += ` count:${count}`;

    const staffData = SEEDED_STAFF_DATA;

    const seedIds = staffData.map(s => s[0]);
    const existingSeedQuery = hasDeletedAt
      ? 'SELECT id FROM staff_master WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL'
      : 'SELECT id FROM staff_master WHERE id = ANY($1::uuid[])';
    const existingSeed = await pool.query(existingSeedQuery, [seedIds]);
    const existingSeedIds = new Set(existingSeed.rows.map((r: { id: string }) => r.id));
    let missingSeedIds = seedIds.filter(id => !existingSeedIds.has(id));
    seedDetail += ` missingSeed:${missingSeedIds.length}`;

    if (missingSeedIds.length === 0) {
      seedStatus = 'skipped-seed-present';
      return;
    }

    if (hasDeletedAt) {
      const placeholders = seedIds.map((_, i) => `$${i + 1}`).join(', ');
      const restored = await pool.query(
        `UPDATE staff_master SET deleted_at = NULL WHERE id IN (${placeholders}) AND deleted_at IS NOT NULL`,
        seedIds
      );
      seedDetail += ` restored:${restored.rowCount}`;

      const afterRestoreSeed = await pool.query(
        'SELECT id FROM staff_master WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
        [seedIds]
      );
      const afterRestoreIds = new Set(afterRestoreSeed.rows.map((r: { id: string }) => r.id));
      missingSeedIds = seedIds.filter(id => !afterRestoreIds.has(id));
      seedDetail += ` missingAfterRestore:${missingSeedIds.length}`;

      if (missingSeedIds.length === 0) {
        seedStatus = 'restored-seed';
        return;
      }
    }

    let inserted = 0;
    for (const [id, kanji, kana] of staffData) {
      try {
        await pool.query(
          `INSERT INTO staff_master (id, display_name_kanji, display_name_kana)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [id, kanji, kana]
        );
        inserted++;
      } catch (innerErr: unknown) {
        const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        console.log(`[Seed] Skip ${kana}: ${msg}`);
      }
    }

    const newCount = await pool.query(`SELECT COUNT(*) as cnt FROM staff_master ${whereClause}`);
    seedStatus = 'done-' + newCount.rows[0].cnt;
    seedDetail += ` inserted:${inserted} after:${newCount.rows[0].cnt}`;

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Seed] Error seeding staff data:', err);
    seedStatus = 'error';
    seedError = errMsg;
  }
}

let castFixDetail = '';
let cleanupDetail = '';

async function fixProjectCasts() {
  try {
    await pool.query(`ALTER TABLE project_casts ADD COLUMN IF NOT EXISTS cast_name TEXT`);

    const pcCols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'project_casts' ORDER BY ordinal_position`);
    const pcColNames = pcCols.rows.map((r: {column_name: string}) => r.column_name);
    castFixDetail = 'pc_cols:' + pcColNames.join(',');

    const hasStaffId = pcColNames.includes('staff_id');
    castFixDetail += ` hasStaffId:${hasStaffId}`;

    if (!hasStaffId) { castFixDetail += ' no_staff_id_col'; return; }

    const nullCount = await pool.query(`SELECT COUNT(*) as cnt FROM project_casts WHERE staff_id IS NULL AND deleted_at IS NULL`);
    const totalCount = await pool.query(`SELECT COUNT(*) as cnt FROM project_casts WHERE deleted_at IS NULL`);
    castFixDetail += ` null:${nullCount.rows[0].cnt}/${totalCount.rows[0].cnt}`;

    if (parseInt(nullCount.rows[0].cnt, 10) === 0) return;

    const fixedByName = await pool.query(`
      UPDATE project_casts pc SET staff_id = sm.id
      FROM staff_master sm
      WHERE pc.staff_id IS NULL
        AND pc.deleted_at IS NULL
        AND sm.deleted_at IS NULL
        AND pc.cast_name IS NOT NULL
        AND REPLACE(REPLACE(pc.cast_name, ' ', ''), E'\\u3000', '') = REPLACE(REPLACE(sm.display_name_kanji, ' ', ''), E'\\u3000', '')
    `);
    castFixDetail += ` fixedByCastName:${fixedByName.rowCount}`;

    const stillNull = await pool.query(`SELECT COUNT(*) as cnt FROM project_casts WHERE staff_id IS NULL AND deleted_at IS NULL`);
    castFixDetail += ` stillNull:${stillNull.rows[0].cnt}`;
  } catch (err: unknown) {
    castFixDetail += ' err:' + (err instanceof Error ? err.message : String(err));
  }
}

async function cleanupData() {
  try {
    const alreadyRan = await pool.query(`SELECT 1 FROM admin_audit_logs WHERE action = 'STARTUP_CLEANUP' AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`);
    if (alreadyRan.rows.length > 0) { cleanupDetail = 'skipped-recent'; return; }
    await pool.query(`INSERT INTO admin_audit_logs (admin_email, action, target_type, payload_json) VALUES ('system', 'STARTUP_CLEANUP', 'system', '{}'::jsonb)`);

    const testNames = ['佐藤 花子', '田中 太郎', '鈴木 一郎'];
    let deletedTest = 0;
    for (const name of testNames) {
      const r = await pool.query(
        `UPDATE staff_master SET deleted_at = NOW() WHERE display_name_kanji = $1 AND display_name_kana = $1 AND deleted_at IS NULL`,
        [name]
      );
      deletedTest += r.rowCount ?? 0;
    }
    cleanupDetail = `testDeleted:${deletedTest}`;

    const seedIds = new Set(SEEDED_STAFF_DATA.map(s => s[0]));

    const dupeResult = await pool.query(`
      SELECT REPLACE(REPLACE(display_name_kana, ' ', ''), '\u3000', '') as norm_kana,
             array_agg(id ORDER BY created_at ASC) as ids,
             array_agg(display_name_kana ORDER BY created_at ASC) as kanas
      FROM staff_master
      WHERE deleted_at IS NULL
      GROUP BY REPLACE(REPLACE(display_name_kana, ' ', ''), '\u3000', '')
      HAVING COUNT(*) > 1
    `);
    let mergedCount = 0;
    for (const row of dupeResult.rows) {
      const allIds: string[] = row.ids;
      const seedInGroup = allIds.find(id => seedIds.has(id));
      const keepId = seedInGroup || allIds[0];
      const removeIds = allIds.filter(id => id !== keepId);
      for (const removeId of removeIds) {
        await pool.query(
          `UPDATE project_casts SET staff_id = $1 WHERE staff_id = $2`,
          [keepId, removeId]
        );
        await pool.query(
          `UPDATE cast_users SET staff_id = $1 WHERE staff_id = $2`,
          [keepId, removeId]
        );
        await pool.query(`UPDATE staff_master SET deleted_at = NOW() WHERE id = $1`, [removeId]);
        mergedCount++;
      }
    }
    cleanupDetail += ` dupesMerged:${mergedCount}`;

    const garbled = await pool.query(
      `DELETE FROM csv_imports WHERE original_file_name ~ '[\u00C0-\u00FF][\u0080-\u00BF]'`
    );
    cleanupDetail += ` garbledImportsDeleted:${garbled.rowCount}`;

    const highKanji = await pool.query(
      `UPDATE staff_master SET deleted_at = NOW()
       WHERE display_name_kanji = display_name_kana
         AND display_name_kana !~ '[\u30A0-\u30FF]'
         AND display_name_kana ~ '[\u4E00-\u9FFF]'
         AND deleted_at IS NULL
         AND id NOT IN (SELECT DISTINCT staff_id FROM project_casts WHERE staff_id IS NOT NULL)
         AND id NOT IN (SELECT DISTINCT staff_id FROM cast_users WHERE staff_id IS NOT NULL)`
    );
    cleanupDetail += ` kanjiOnlyKanaDeleted:${highKanji.rowCount}`;

    const dupeEmails = await pool.query(`
      SELECT email, array_agg(id ORDER BY staff_id IS NULL, created_at ASC) as ids,
             array_agg(staff_id ORDER BY staff_id IS NULL, created_at ASC) as staff_ids,
             array_agg(pin_hash IS NOT NULL ORDER BY staff_id IS NULL, created_at ASC) as has_pins
      FROM cast_users WHERE deleted_at IS NULL
      GROUP BY email HAVING COUNT(*) > 1
    `);
    let mergedCastUsers = 0;
    for (const row of dupeEmails.rows) {
      const keepId = row.ids[0];
      const removeIds: string[] = row.ids.slice(1);
      for (const removeId of removeIds) {
        await pool.query(
          `UPDATE cast_users SET
             pin_hash = COALESCE(pin_hash, (SELECT pin_hash FROM cast_users WHERE id = $2)),
             magic_link_token = COALESCE(magic_link_token, (SELECT magic_link_token FROM cast_users WHERE id = $2)),
             magic_link_expires = COALESCE(magic_link_expires, (SELECT magic_link_expires FROM cast_users WHERE id = $2)),
             staff_id = COALESCE(staff_id, (SELECT staff_id FROM cast_users WHERE id = $2)),
             updated_at = NOW()
           WHERE id = $1`,
          [keepId, removeId]
        );
        await pool.query(`UPDATE cast_users SET deleted_at = NOW() WHERE id = $1`, [removeId]);
        mergedCastUsers++;
      }
    }
    cleanupDetail += ` mergedCastUsers:${mergedCastUsers}`;

    const verifyFix = await pool.query(
      `UPDATE cast_users SET email_verified = true, updated_at = NOW()
       WHERE deleted_at IS NULL AND email_verified IS NOT TRUE
         AND staff_id IS NOT NULL AND pin_hash IS NOT NULL`
    );
    cleanupDetail += ` emailVerifiedBackfill:${verifyFix.rowCount}`;

    const orphanNoLink= await pool.query(
      `UPDATE cast_users SET deleted_at = NOW()
       WHERE deleted_at IS NULL
         AND (staff_id IS NULL
              OR staff_id NOT IN (SELECT id FROM staff_master WHERE deleted_at IS NULL))
         AND NOT (email_verified = true AND pin_hash IS NOT NULL)`
    );
    cleanupDetail += ` orphanCastUsersDeleted:${orphanNoLink.rowCount}`;
  } catch (err: unknown) {
    cleanupDetail += ' err:' + (err instanceof Error ? err.message : String(err));
  }
}

let takagiSeedDetail = '';

async function seedTakagiProjectData() {
  try {
    const TAKAGI_ID = '006fdb66-2129-4491-b701-b5ea27176fb9';
    const TAKAGI_EMAIL = 'atsuhiro@takagi.bz';

    const alreadyRan = await pool.query(
      `SELECT 1 FROM admin_audit_logs WHERE action = 'SEED_TAKAGI_PROJECTS' LIMIT 1`
    );

    await pool.query(
      `UPDATE staff_master SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`,
      [TAKAGI_ID]
    );

    await pool.query(
      `UPDATE staff_master SET email = $1 WHERE id = $2 AND (email IS NULL OR email = '')`,
      [TAKAGI_EMAIL, TAKAGI_ID]
    );

    const existingCast = await pool.query(
      `SELECT id FROM cast_users WHERE email = $1 AND deleted_at IS NULL`,
      [TAKAGI_EMAIL]
    );
    if (existingCast.rows.length === 0) {
      await pool.query(
        `INSERT INTO cast_users (email, staff_id, email_verified)
         VALUES ($1, $2, true)
         ON CONFLICT DO NOTHING`,
        [TAKAGI_EMAIL, TAKAGI_ID]
      );
      console.log('[Seed] Created cast_users record for atsuhiro@takagi.bz');
    }

    if (alreadyRan.rows.length > 0) { takagiSeedDetail = 'ensured-user-only'; return; }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let addedCount = 0;

    for (let dayOffset = 0; dayOffset < 10; dayOffset++) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + dayOffset);
      const dateStr = targetDate.toISOString().split('T')[0];

      const existingProjects = await pool.query(
        `SELECT id FROM projects WHERE work_date = $1 AND deleted_at IS NULL`,
        [dateStr]
      );

      if (existingProjects.rows.length > 0) {
        for (const proj of existingProjects.rows) {
          const alreadyAssigned = await pool.query(
            `SELECT 1 FROM project_casts WHERE project_id = $1 AND staff_id = $2 AND deleted_at IS NULL`,
            [proj.id, TAKAGI_ID]
          );
          if (alreadyAssigned.rows.length === 0) {
            const maxIdx = await pool.query(
              `SELECT COALESCE(MAX(row_index), -1) + 1 as next_idx FROM project_casts WHERE project_id = $1`,
              [proj.id]
            );
            await pool.query(
              `INSERT INTO project_casts (project_id, staff_no, staff_id, row_index, cast_name)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT DO NOTHING`,
              [proj.id, 'TAKAGI-001', TAKAGI_ID, maxIdx.rows[0].next_idx, '高木 豊大']
            );
            addedCount++;
          }
        }
      } else {
        const uniqueUrl = Math.random().toString(36).substring(2, 10);
        const urlExpires = new Date(targetDate);
        urlExpires.setDate(urlExpires.getDate() + 3);
        urlExpires.setHours(23, 59, 59, 999);
        const projectKey = `SEED-${dateStr}`;

        const newProj = await pool.query(
          `INSERT INTO projects (project_key, work_date, work_name, location, start_time, end_time, unique_url, url_expires_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [projectKey, dateStr, '警備業務', '現場A', '09:00', '18:00', uniqueUrl, urlExpires, 'active']
        );

        if (newProj.rows.length > 0) {
          await pool.query(
            `INSERT INTO project_casts (project_id, staff_no, staff_id, row_index, cast_name)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [newProj.rows[0].id, 'TAKAGI-001', TAKAGI_ID, 0, '高木 豊大']
          );
          addedCount++;
        }
      }
    }

    takagiSeedDetail = `added:${addedCount}`;
    await pool.query(
      `INSERT INTO admin_audit_logs (admin_email, action, target_type, payload_json)
       VALUES ('system', 'SEED_TAKAGI_PROJECTS', 'project_casts', $1)`,
      [JSON.stringify({ added: addedCount })]
    );
  } catch (err: unknown) {
    takagiSeedDetail = 'err:' + (err instanceof Error ? err.message : String(err));
  }
}

let server: ReturnType<typeof app.listen> | null = null;
let isShuttingDown = false;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

process.on('uncaughtException', (err: Error) => {
  const ts = new Date().toISOString();
  console.error(`[${ts}] UNCAUGHT EXCEPTION:`, err.message);
  console.error(err.stack);
  gracefulShutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const ts = new Date().toISOString();
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  console.error(`[${ts}] UNHANDLED REJECTION:`, msg);
  if (stack) console.error(stack);
  gracefulShutdown('unhandledRejection', 1);
});

process.on('SIGTERM', () => {
  console.log('[SIGTERM] received. Shutting down gracefully...');
  gracefulShutdown('SIGTERM', 0);
});

process.on('SIGINT', () => {
  console.log('[SIGINT] received. Shutting down gracefully...');
  gracefulShutdown('SIGINT', 0);
});

function gracefulShutdown(source: string, exitCode: number) {
  if (isShuttingDown) {
    console.error(`[gracefulShutdown] already in progress, ignoring duplicate from ${source}`);
    return;
  }
  isShuttingDown = true;

  console.error(`[gracefulShutdown] triggered by ${source}. Closing server and DB pool...`);
  if (cleanupTimer) clearInterval(cleanupTimer);
  stopDataUploadMonitor();
  const forceExit = setTimeout(() => {
    console.error('[gracefulShutdown] Forced exit after timeout');
    process.exit(exitCode);
  }, 10_000);
  forceExit.unref();

  const closeServer = server
    ? new Promise<void>((resolve) => server!.close(() => resolve()))
    : Promise.resolve();

  closeServer
    .then(() => pool.end())
    .then(() => {
      console.error(`[gracefulShutdown] Clean exit (code=${exitCode})`);
      process.exit(exitCode);
    })
    .catch((err: unknown) => {
      console.error('[gracefulShutdown] Error during shutdown:', err);
      process.exit(exitCode);
    });
}

server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_project_id_active ON reports (project_id) WHERE deleted_at IS NULL`)
  .then(() => console.log('[Startup] Unique index on reports ensured'))
  .catch((err: unknown) => console.error('[Startup] Index creation error:', err));

pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS notes TEXT`)
  .then(() => console.log('[Startup] reports.notes column ensured'))
  .catch((err: unknown) => console.error('[Startup] reports.notes column error:', err));

pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS partner_company_name TEXT`)
  .then(() => console.log('[Startup] reports.partner_company_name column ensured'))
  .catch((err: unknown) => console.error('[Startup] reports.partner_company_name column error:', err));

pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cast_users_email_active ON cast_users (email) WHERE deleted_at IS NULL`)
  .then(() => console.log('[Startup] Unique index on cast_users.email ensured'))
  .catch((err: unknown) => console.error('[Startup] cast_users index creation error:', err));

pool.query(`CREATE TABLE IF NOT EXISTS inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cast_user_id UUID NOT NULL,
  cast_email TEXT NOT NULL,
  cast_name TEXT,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  screenshot_bytes BYTEA,
  screenshot_mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`)
  .then(() => console.log('[Startup] Inquiries table ensured'))
  .catch((err: unknown) => console.error('[Startup] Inquiries table creation error:', err));

seedStaffData()
  .then(() => fixProjectCasts())
  .then(() => cleanupData())
  .then(() => seedTakagiProjectData())
  .then(() => {
    console.log('[Startup] Background tasks completed:', { seedStatus, castFixDetail, cleanupDetail, takagiSeedDetail });
  })
  .catch((err: unknown) => {
    console.error('[Startup] Background task error:', err);
  });

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
cleanupTimer = setInterval(() => {
  console.log('[Scheduler] Running periodic cleanup...');
  cleanupData()
    .then(() => console.log('[Scheduler] Periodic cleanup completed:', cleanupDetail))
    .catch((err: unknown) => console.error('[Scheduler] Periodic cleanup error:', err));
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

startDataUploadMonitor();
