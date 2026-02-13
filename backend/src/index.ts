import express, { Request, Response } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import authRouter from './routes/auth';
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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.AUTH_SECRET || 'dev-secret-key';

// Trust proxy for Railway (required for secure cookies behind reverse proxy)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json());

// PostgreSQL session store for persistent sessions
const PgSession = connectPgSimple(session);

app.use(session({
  store: new PgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true
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

app.get('/version', (_req: Request, res: Response) => {
  res.json({ spec: 'plan_v2', app: 'houkochan', build: '2026-02-02-v71' });
});

app.use('/api/auth', authRouter);
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

async function ensureSchema(){
  try {
    await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS guards_json JSONB');
    await pool.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS supervisor_name TEXT');
    await pool.query(`ALTER TABLE admin_allowlist ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin'`);
    await pool.query(`UPDATE admin_allowlist SET role = 'super_admin' WHERE LOWER(email) = LOWER('atsuhiro@takagi.bz') AND (role IS NULL OR role != 'super_admin')`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS access_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ
      )
    `);
    // Activate all pending_client projects
    const activated = await pool.query(`UPDATE projects SET status = 'active' WHERE status = 'pending_client' RETURNING id`);
    if (activated.rows.length > 0) {
      console.log(`[DB] Activated ${activated.rows.length} pending_client projects`);
    }

    // Ensure 大野 祢音 and 宮﨑 萌 exist in staff_master and have projects for today
    const crypto = await import('crypto');
    const staffToAdd = [
      { kanji: '大野 祢音', kana: 'オオノ ネオン' },
      { kanji: '宮﨑 萌', kana: 'ミヤザキ モエ' }
    ];
    const todayStr = new Date().toISOString().split('T')[0];
    for (const staff of staffToAdd) {
      let staffId: string;
      const existing = await pool.query(`SELECT id FROM staff_master WHERE display_name_kanji = $1`, [staff.kanji]);
      if (existing.rows.length > 0) {
        staffId = existing.rows[0].id;
      } else {
        const ins = await pool.query(`INSERT INTO staff_master (display_name_kanji, display_name_kana) VALUES ($1, $2) RETURNING id`, [staff.kanji, staff.kana]);
        staffId = ins.rows[0].id;
        console.log(`[DB] Created staff: ${staff.kanji} (${staffId})`);
      }
      const existingProject = await pool.query(
        `SELECT p.id FROM projects p JOIN project_casts pc ON p.id = pc.project_id WHERE p.work_date = $1 AND pc.cast_name = $2 LIMIT 1`,
        [todayStr, staff.kanji]
      );
      if (existingProject.rows.length === 0) {
        const uniqueUrl = crypto.randomUUID();
        const urlExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const projResult = await pool.query(
          `INSERT INTO projects (project_key, client_name_raw, work_date, work_name, location, work_title_raw, unique_url, url_expires_at, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active') RETURNING id`,
          [`SETUP-${staff.kanji.replace(/\s/g, '')}-${todayStr}`, 'テスト現場', todayStr, `${staff.kanji}テスト現場`, '東京都', `${staff.kanji}テスト`, uniqueUrl, urlExpires]
        );
        await pool.query(`INSERT INTO project_casts (project_id, staff_no, cast_name, row_index) VALUES ($1, '001', $2, 0)`, [projResult.rows[0].id, staff.kanji]);
        console.log(`[DB] Created project for ${staff.kanji}`);
      }
    }
  } catch (e) {
    console.error('[DB] ensureSchema failed:', e);
  }
}

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

app.post('/api/setup/diagnose-and-fix', async (req: Request, res: Response) => {
  const secret = req.headers['x-auth-secret'];
  if (secret !== SESSION_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  try {
    const results: Record<string, unknown> = {};

    // 1. Check staff_master for both people
    const staffCheck = await pool.query(
      `SELECT id, display_name_kanji, display_name_kana, email FROM staff_master 
       WHERE display_name_kanji IN ('大野 祢音', '大野祢音', '宮﨑 萌', '宮﨑萌', '宮崎 萌', '宮崎萌')
       ORDER BY display_name_kanji`
    );
    results.staff_master = staffCheck.rows;

    // 2. Check cast_users for both
    const castCheck = await pool.query(
      `SELECT cu.id, cu.email, cu.name, cu.staff_id, cu.email_verified, 
              sm.display_name_kanji as linked_staff_name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.name LIKE '%大野%' OR cu.name LIKE '%宮%' OR cu.email LIKE '%ohno%' OR cu.email LIKE '%miyazaki%'`
    );
    results.cast_users = castCheck.rows;

    // 3. Check project_casts for their names
    const pcCheck = await pool.query(
      `SELECT pc.id, pc.project_id, pc.cast_name, pc.staff_no, p.work_date, p.work_name
       FROM project_casts pc
       JOIN projects p ON pc.project_id = p.id
       WHERE pc.cast_name LIKE '%大野%' OR pc.cast_name LIKE '%宮%'
       ORDER BY p.work_date DESC
       LIMIT 20`
    );
    results.project_casts = pcCheck.rows;

    // 4. Check today's projects
    const todayStr = new Date().toISOString().split('T')[0];
    const todayProjects = await pool.query(
      `SELECT p.id, p.work_name, p.work_date, p.location, p.status,
              array_agg(pc.cast_name) as casts
       FROM projects p
       LEFT JOIN project_casts pc ON pc.project_id = p.id
       WHERE p.work_date = $1
       GROUP BY p.id, p.work_name, p.work_date, p.location, p.status
       ORDER BY p.work_name
       LIMIT 20`,
      [todayStr]
    );
    results.today_projects = todayProjects.rows;
    results.today_date = todayStr;

    // 5. All staff list
    const allStaff = await pool.query(`SELECT id, display_name_kanji FROM staff_master ORDER BY display_name_kanji`);
    results.all_staff = allStaff.rows;

    // 6. All cast_users
    const allCasts = await pool.query(`SELECT id, email, name, staff_id, email_verified FROM cast_users ORDER BY name`);
    results.all_cast_users = allCasts.rows;

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/setup/activate-all', async (req: Request, res: Response) => {
  const secret = req.headers['x-auth-secret'];
  if (secret !== SESSION_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  try {
    const before = await pool.query(`SELECT status, COUNT(*) as count FROM projects GROUP BY status`);
    const result = await pool.query(
      `UPDATE projects SET status = 'active' WHERE status = 'pending_client' RETURNING id`
    );
    const after = await pool.query(`SELECT status, COUNT(*) as count FROM projects GROUP BY status`);
    res.json({ ok: true, updated: result.rows.length, before: before.rows, after: after.rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/setup/add-staff-to-projects', async (req: Request, res: Response) => {
  const secret = req.headers['x-auth-secret'];
  if (secret !== SESSION_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  try {
    const crypto = await import('crypto');
    const results: Record<string, unknown> = {};
    const todayStr = new Date().toISOString().split('T')[0];

    const staffToAdd = [
      { kanji: '大野 祢音', kana: 'オオノ ネオン' },
      { kanji: '宮﨑 萌', kana: 'ミヤザキ モエ' }
    ];

    for (const staff of staffToAdd) {
      // Ensure staff exists in staff_master
      let staffId: string;
      const existing = await pool.query(
        `SELECT id FROM staff_master WHERE display_name_kanji = $1`,
        [staff.kanji]
      );
      if (existing.rows.length > 0) {
        staffId = existing.rows[0].id;
      } else {
        const ins = await pool.query(
          `INSERT INTO staff_master (display_name_kanji, display_name_kana) VALUES ($1, $2) RETURNING id`,
          [staff.kanji, staff.kana]
        );
        staffId = ins.rows[0].id;
      }

      // Create a new project for today
      const uniqueUrl = crypto.randomUUID();
      const urlExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const projectKey = `SETUP-${staff.kanji.replace(/\s/g, '')}-${todayStr}`;

      const projResult = await pool.query(
        `INSERT INTO projects (project_key, client_name_raw, work_date, work_name, location, work_title_raw, unique_url, url_expires_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
         RETURNING id`,
        [projectKey, 'テスト現場', todayStr, `${staff.kanji}テスト現場`, '東京都', `${staff.kanji}テスト`, uniqueUrl, urlExpires]
      );
      const projectId = projResult.rows[0].id;

      // Add cast to project
      await pool.query(
        `INSERT INTO project_casts (project_id, staff_no, cast_name, row_index) VALUES ($1, $2, $3, $4)`,
        [projectId, '001', staff.kanji, 0]
      );

      results[staff.kanji] = { staffId, projectId, uniqueUrl };
    }

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

ensureSchema().finally(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});
