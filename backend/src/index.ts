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

app.post('/api/setup/add-casts-to-inoue', async (req: Request, res: Response) => {
  if (!SETUP_TOKEN || req.headers.authorization !== `Bearer ${SETUP_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const { casts } = req.body;
    const inoueProjects = await pool.query(
      `SELECT p.id, pc.cast_name FROM projects p
       JOIN project_casts pc ON pc.project_id = p.id
       WHERE pc.cast_name LIKE '%井上%'`
    );
    const projectIds = [...new Set(inoueProjects.rows.map((r: { id: string }) => r.id))];
    let added = 0;
    for (const pid of projectIds) {
      const maxRow = await pool.query('SELECT COALESCE(MAX(row_index),0) as m FROM project_casts WHERE project_id=$1', [pid]);
      let row = maxRow.rows[0].m;
      for (const c of casts) {
        row++;
        await pool.query(
          'INSERT INTO project_casts (project_id, staff_no, cast_name, row_index) VALUES ($1,$2,$3,$4) ON CONFLICT (project_id, staff_no) DO NOTHING',
          [pid, c.staff_no, c.name, row]
        );
        added++;
      }
    }
    res.json({ ok: true, projectCount: projectIds.length, castsAdded: added });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/setup/cleanup-duplicates', async (req: Request, res: Response) => {
  if (!SETUP_TOKEN || req.headers.authorization !== `Bearer ${SETUP_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const names = ['髙木', '高木', '京谷', '近藤'];
    const dupsQuery = await pool.query(
      `SELECT p.id, p.work_date, p.work_name,
              (SELECT COUNT(*) FROM project_casts pc2 WHERE pc2.project_id = p.id) as cast_count
       FROM projects p
       JOIN project_casts pc ON pc.project_id = p.id
       WHERE pc.cast_name LIKE ANY($1)
       GROUP BY p.id, p.work_date, p.work_name`,
      [names.map(n => `%${n}%`)]
    );
    const byDate: Record<string, Array<{ id: string; work_name: string; cast_count: number }>> = {};
    for (const row of dupsQuery.rows) {
      const dateStr = row.work_date instanceof Date ? row.work_date.toISOString().split('T')[0] : String(row.work_date).split('T')[0];
      if (!byDate[dateStr]) byDate[dateStr] = [];
      byDate[dateStr].push({ id: row.id, work_name: row.work_name, cast_count: parseInt(row.cast_count) });
    }
    let deleted = 0;
    const deletedProjects: string[] = [];
    for (const dateStr of Object.keys(byDate)) {
      const projects = byDate[dateStr];
      for (const name of names) {
        const matching = projects.filter(p => p.work_name.includes(name) || p.work_name.includes('髙木') || p.work_name.includes('高木'));
        const nameMatching = name === '髙木' || name === '高木'
          ? projects.filter(p => p.work_name.includes('髙木') || p.work_name.includes('高木'))
          : projects.filter(p => p.work_name.includes(name));
        if (nameMatching.length > 1) {
          const sorted = nameMatching.sort((a, b) => b.cast_count - a.cast_count);
          for (let i = 1; i < sorted.length; i++) {
            await pool.query('DELETE FROM project_casts WHERE project_id=$1', [sorted[i].id]);
            await pool.query('DELETE FROM projects WHERE id=$1', [sorted[i].id]);
            deleted++;
            deletedProjects.push(`${dateStr}: ${sorted[i].work_name} (cast_count=${sorted[i].cast_count})`);
          }
        }
      }
    }
    res.json({ ok: true, deleted, deletedProjects: deletedProjects.slice(0, 30) });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/setup/diag-duplicates', async (req: Request, res: Response) => {
  if (!SETUP_TOKEN || req.headers.authorization !== `Bearer ${SETUP_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT pc.cast_name, p.work_date, COUNT(*) as project_count
       FROM project_casts pc
       JOIN projects p ON p.id = pc.project_id
       GROUP BY pc.cast_name, p.work_date
       HAVING COUNT(*) > 1
       ORDER BY p.work_date, pc.cast_name`
    );
    res.json({ duplicates: result.rows });
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
