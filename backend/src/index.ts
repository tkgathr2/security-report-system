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

const SETUP_TOKEN = process.env.AUTH_SECRET || '';

app.get('/api/setup/diagnostic', async (req: Request, res: Response) => {
  if (!SETUP_TOKEN || req.headers.authorization !== `Bearer ${SETUP_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    const projects = await pool.query("SELECT id, work_name, work_date, status, client_name_raw, location FROM projects WHERE work_date >= CURRENT_DATE - INTERVAL '1 day' ORDER BY work_date");
    const casts = await pool.query(`SELECT pc.id, pc.project_id, pc.staff_no, pc.cast_name, pc.row_index, p.work_name, p.work_date
       FROM project_casts pc JOIN projects p ON p.id = pc.project_id
       WHERE p.work_date >= CURRENT_DATE - INTERVAL '1 day' ORDER BY p.work_date, pc.row_index`);
    const reports = await pool.query("SELECT id, project_id, cast_user_id, work_date, status FROM reports WHERE work_date >= CURRENT_DATE - INTERVAL '1 day' ORDER BY work_date");
    const castUsers = await pool.query("SELECT id, email, name, staff_id FROM cast_users ORDER BY id");
    res.json({ tables: tables.rows, projects: projects.rows, casts: casts.rows, reports: reports.rows, castUsers: castUsers.rows });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.post('/api/setup/add-cast', async (req: Request, res: Response) => {
  if (!SETUP_TOKEN || req.headers.authorization !== `Bearer ${SETUP_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const { project_id, staff_no, cast_name } = req.body;
    const maxRow = await pool.query('SELECT COALESCE(MAX(row_index), 0) as max_row FROM project_casts WHERE project_id = $1', [project_id]);
    const nextRow = maxRow.rows[0].max_row + 1;
    const result = await pool.query(
      `INSERT INTO project_casts (project_id, staff_no, cast_name, row_index) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, staff_no) DO NOTHING RETURNING id, staff_no, cast_name, row_index`,
      [project_id, staff_no, cast_name, nextRow]
    );
    res.json({ inserted: result.rows });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.delete('/api/setup/report/:reportId', async (req: Request, res: Response) => {
  if (!SETUP_TOKEN || req.headers.authorization !== `Bearer ${SETUP_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const result = await pool.query('DELETE FROM reports WHERE id = $1 RETURNING id', [req.params.reportId]);
    res.json({ deleted: result.rows });
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
