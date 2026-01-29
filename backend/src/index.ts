import express, { Request, Response } from 'express';
import session from 'express-session';
import passport from 'passport';
import dotenv from 'dotenv';
import path from 'path';
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
import pool from './db/pool';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.AUTH_SECRET || 'dev-secret-key';

app.use(express.json());

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get('/version', (_req: Request, res: Response) => {
  res.json({ spec: 'plan_v2', app: 'houkochan' });
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

async function ensureSchema() {
  try {
    await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS guards_json JSONB');
  } catch (e) {
    console.error('[DB] ensureSchema failed:', e);
  }
}

// Serve frontend static files in production
// __dirname is backend/dist after compilation, so ../frontend-dist points to backend/frontend-dist
const frontendDistPath = path.join(__dirname, '../frontend-dist');
app.use(express.static(frontendDistPath));

// SPA fallback - serve index.html for non-API routes (Express 5.x compatible syntax)
app.get('/report/:uniqueUrl', (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// Catch-all route for SPA - serve index.html for any unmatched routes
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
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
