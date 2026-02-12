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
import crypto from 'crypto';
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

const SETUP_TOKEN = process.env.AUTH_SECRET || '';

app.post('/api/setup/bulk-import', express.json({limit: '5mb'}), async (req: Request, res: Response) => {
  if (!SETUP_TOKEN || req.headers.authorization !== `Bearer ${SETUP_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const { staff, projects } = req.body;
    let staffAdded = 0;
    let projectsCreated = 0;
    let castsAdded = 0;

    for (const s of staff || []) {
      const existing = await pool.query('SELECT id FROM staff_master WHERE display_name_kana = $1', [s.kana]);
      if (existing.rows.length === 0) {
        await pool.query(
          'INSERT INTO staff_master (display_name_kanji, display_name_kana, created_at, updated_at, created_by) VALUES ($1, $2, NOW(), NOW(), $3)',
          [s.kanji, s.kana, 'setup-api']
        );
        staffAdded++;
      }
    }

    for (const p of projects || []) {
      const projectKey = crypto.createHash('sha256').update(`${p.work_date}|${p.work_name}|${p.location}|${p.client_name}`).digest('hex').substring(0, 16);
      const existing = await pool.query('SELECT id FROM projects WHERE project_key = $1', [projectKey]);
      let projectId: string;
      if (existing.rows.length > 0) {
        projectId = existing.rows[0].id;
      } else {
        const uniqueUrl = crypto.randomUUID();
        const urlExpires = new Date(p.work_date);
        urlExpires.setDate(urlExpires.getDate() + 3);
        urlExpires.setHours(23, 59, 59, 999);
        const clientResult = await pool.query(
          "SELECT id FROM clients WHERE name_normalized = LOWER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE($1, '（', ''), '）', ''), '(', ''), ')', ''))) AND is_active = true",
          [p.client_name]
        );
        const clientId = clientResult.rows.length > 0 ? clientResult.rows[0].id : null;
        const ins = await pool.query(
          `INSERT INTO projects (project_key, client_id, client_name_raw, work_date, work_name, location, start_time, end_time, work_title_raw, unique_url, url_expires_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
          [projectKey, clientId, p.client_name, p.work_date, p.work_name, p.location, p.start_time, p.end_time, p.work_name, uniqueUrl, urlExpires, clientId ? 'active' : 'pending_client']
        );
        projectId = ins.rows[0].id;
        projectsCreated++;
      }
      for (let ci = 0; ci < (p.casts || []).length; ci++) {
        const c = p.casts[ci];
        await pool.query(
          'INSERT INTO project_casts (project_id, staff_no, cast_name, row_index) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, staff_no) DO NOTHING',
          [projectId, c.staff_no, c.name, ci]
        );
        castsAdded++;
      }
    }
    res.json({ ok: true, staffAdded, projectsCreated, castsAdded });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

async function ensureSchema(){
  try {
    await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS guards_json JSONB');
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
      is_active: true
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

ensureSchema().finally(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});
