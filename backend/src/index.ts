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
  } catch (e) {
    console.error('[DB] ensureSchema failed:', e);
  }
}

const SETUP_TOKEN = process.env.AUTH_SECRET || '';

app.post('/api/setup/bulk-create-projects', async (req: Request, res: Response) => {
  if (!SETUP_TOKEN || req.headers.authorization !== `Bearer ${SETUP_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const { people, start_date, end_date, client_name, location_prefix, work_name_prefix } = req.body;
    if (!people || !Array.isArray(people) || people.length === 0) {
      res.status(400).json({ error: 'people array required' });
      return;
    }
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    let projectsCreated = 0;
    let castsAdded = 0;
    const results: Array<{ date: string; person: string; projectId: string; uniqueUrl: string }> = [];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      for (const person of people) {
        const { name, staff_no } = person;
        const workName = `${work_name_prefix || '警備業務'} - ${name}`;
        const location = `${location_prefix || '東京都'} ${name}現場`;
        const companyName = client_name || 'テスト株式会社';
        const crypto = await import('crypto');
        const projectKey = crypto.createHash('sha256').update(`${dateStr}|${workName}|${location}|${companyName}`).digest('hex').substring(0, 16);
        const uniqueUrl = crypto.randomUUID();
        const urlExpiresAt = new Date(d);
        urlExpiresAt.setDate(urlExpiresAt.getDate() + 3);
        urlExpiresAt.setHours(23, 59, 59, 999);

        const existing = await pool.query('SELECT id FROM projects WHERE project_key = $1', [projectKey]);
        if (existing.rows.length > 0) continue;

        const insertResult = await pool.query(
          `INSERT INTO projects (
            project_key, client_name_raw, work_date, work_name, location,
            start_time, end_time, work_title_raw, unique_url, url_expires_at, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [projectKey, companyName, d, workName, location, '08:00', '17:00', workName, uniqueUrl, urlExpiresAt, 'active']
        );
        const projectId = insertResult.rows[0].id;
        projectsCreated++;

        const castId = staff_no || name;
        await pool.query(
          'INSERT INTO project_casts (project_id, staff_no, cast_name, row_index) VALUES ($1, $2, $3, 0) ON CONFLICT (project_id, staff_no) DO NOTHING',
          [projectId, castId, name]
        );
        castsAdded++;
        results.push({ date: dateStr, person: name, projectId, uniqueUrl });
      }
    }
    res.json({ ok: true, projectsCreated, castsAdded, results: results.slice(0, 20) });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/setup/list-staff', async (req: Request, res: Response) => {
  if (!SETUP_TOKEN || req.headers.authorization !== `Bearer ${SETUP_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const staff = await pool.query('SELECT id, display_name_kanji, display_name_kana FROM staff_master ORDER BY display_name_kanji');
    res.json({ staff: staff.rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

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
