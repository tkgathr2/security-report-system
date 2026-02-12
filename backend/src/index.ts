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

app.get('/api/setup/diag-staff', async (req: Request, res: Response) => {
  if (!SETUP_TOKEN || req.headers.authorization !== `Bearer ${SETUP_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const staff = await pool.query('SELECT id, display_name_kanji, display_name_kana FROM staff_master ORDER BY display_name_kanji');
    const today = new Date().toISOString().split('T')[0];
    const projects = await pool.query(
      `SELECT p.id, p.work_name, p.work_date, p.location, p.client_name_raw,
              json_agg(json_build_object('staff_no', pc.staff_no, 'cast_name', pc.cast_name, 'row_index', pc.row_index)) as casts
       FROM projects p
       LEFT JOIN project_casts pc ON p.id = pc.project_id
       WHERE p.work_date >= $1::date - interval '1 day'
       GROUP BY p.id ORDER BY p.work_date`,
      [today]
    );
    res.json({ staff: staff.rows, projects: projects.rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/setup/add-cast-to-projects', async (req: Request, res: Response) => {
  if (!SETUP_TOKEN || req.headers.authorization !== `Bearer ${SETUP_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const { kanji, kana, staff_no, project_ids } = req.body;
    const existing = await pool.query('SELECT id FROM staff_master WHERE display_name_kanji = $1', [kanji]);
    let staffId: string;
    if (existing.rows.length > 0) {
      staffId = existing.rows[0].id;
    } else {
      const ins = await pool.query(
        'INSERT INTO staff_master (display_name_kanji, display_name_kana, created_at, updated_at, created_by) VALUES ($1, $2, NOW(), NOW(), $3) RETURNING id',
        [kanji, kana, 'setup-api']
      );
      staffId = ins.rows[0].id;
    }
    let castsAdded = 0;
    for (const pid of project_ids || []) {
      const maxIdx = await pool.query('SELECT COALESCE(MAX(row_index), -1) as max_idx FROM project_casts WHERE project_id = $1', [pid]);
      const nextIdx = (maxIdx.rows[0].max_idx as number) + 1;
      await pool.query(
        'INSERT INTO project_casts (project_id, staff_no, cast_name, row_index) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, staff_no) DO NOTHING',
        [pid, staff_no || staffId, kanji, nextIdx]
      );
      castsAdded++;
    }
    res.json({ ok: true, staffId, castsAdded });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
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
