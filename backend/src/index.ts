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

let seedStatus = 'pending';
let seedError = '';
let seedDetail = '';

app.get('/version', (_req: Request, res: Response) => {
  res.json({ spec: 'plan_v2', app: 'houkochan', build: '2026-02-17-v81', seedStatus, seedError, seedDetail });
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

async function seedStaffData() {
  try {
    const colResult = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'staff_master' ORDER BY ordinal_position`);
    seedDetail = 'cols:' + colResult.rows.map((r: {column_name: string}) => r.column_name).join(',');
    const countResult = await pool.query('SELECT COUNT(*) as cnt FROM staff_master WHERE deleted_at IS NULL');
    const count = parseInt(countResult.rows[0].cnt, 10);
    console.log(`[Seed] Current staff count: ${count}`);
    seedDetail += ` count:${count}`;
    if (count >= 10) { seedStatus = 'skipped-enough'; return; }
    console.log('[Seed] Staff count < 10, inserting missing staff data...');
    await pool.query(`
      INSERT INTO staff_master (id, display_name_kanji, display_name_kana, email, created_by, created_at, updated_at)
      VALUES
        ('e2a3ee29-fa62-4394-b5c5-4826f30cde30', '有澤　知子', 'アリサワ　トモコ', NULL, 'admin-manual-import', '2026-02-16 10:18:56.952141', '2026-02-16 10:18:56.952141'),
        ('49972e7a-f311-4358-86cb-2b5c34081b69', '井上　誠司', 'イノウエ　セイジ', NULL, 'admin-manual-import', '2026-02-16 10:18:59.795961', '2026-02-16 10:18:59.795961'),
        ('433360cd-5de2-4402-83a4-1c0abb2f1626', '井村　義則', 'イムラ　ヨシノリ', NULL, 'admin-manual-import', '2026-02-16 10:18:58.378965', '2026-02-16 10:18:58.378965'),
        ('2018528a-1287-4df3-9401-14b88fceaf6d', 'イ　モン　チョー', 'イ　モン　チョー', NULL, 'admin-manual-import', '2026-02-16 10:18:56.493361', '2026-02-16 10:18:56.493361'),
        ('5cdb75da-9c58-4dbf-9deb-195afdc96fd1', '梅原　幸雄', 'ウメハラ　ユキオ', NULL, 'admin-manual-import', '2026-02-16 10:18:54.623989', '2026-02-16 10:18:54.623989'),
        ('0f1514c9-0524-4be6-b725-5161ed6a371f', '大野　祢音', 'オオノ　ナイト', NULL, 'admin-manual-import', '2026-02-16 10:18:56.037351', '2026-02-16 10:18:56.037351'),
        ('578c67f0-88e9-4f2d-93b1-079d977b71ca', '梶原　創', 'カジハラ　ソウ', NULL, 'admin-manual-import', '2026-02-16 10:18:50.921408', '2026-02-16 10:18:50.921408'),
        ('712606ff-a3bd-49ae-a351-9cd10dab8bb5', 'カッサ　ヨハネス　アスゲドム', 'カッサ　ヨハネス　アスゲドム', NULL, 'admin-manual-import', '2026-02-16 10:18:57.429327', '2026-02-16 10:18:57.429327'),
        ('83b466ae-a722-4238-b698-8bc93f99a5f7', '川面　直人', 'カワオモ　ナオト', NULL, 'admin-manual-import', '2026-02-16 10:18:53.216126', '2026-02-16 10:18:53.216126'),
        ('b55cd8f2-2e28-4f84-bb79-084107001b13', '神崎　誠', 'カンザキ　マコト', NULL, 'admin-manual-import', '2026-02-16 10:18:55.568815', '2026-02-16 10:18:55.568815'),
        ('e9bc1be3-8661-4456-ad1e-9618ccf01abf', '岸本　直美', 'キシモト　ナオミ', NULL, 'admin-manual-import', '2026-02-16 10:18:54.157201', '2026-02-16 10:18:54.157201'),
        ('ed998da1-091c-4d1a-94f7-22ed6376beb7', '北口　恵一', 'キタグチ　ケイイチ', NULL, 'admin-manual-import', '2026-02-16 10:18:57.910662', '2026-02-16 10:18:57.910662'),
        ('897b046a-15fc-4865-af3f-f5d2f1d4671d', '京谷　雅弥', 'キョウタニ　マサヤ', NULL, 'admin-manual-import', '2026-02-16 10:18:49.513425', '2026-02-16 10:18:49.513425'),
        ('105b5ece-354d-4376-b56b-d0dbbafcd1e3', '久保　勇太', 'クボユウタ', NULL, 'admin-manual-import', '2026-02-16 10:18:51.838919', '2026-02-16 10:18:51.838919'),
        ('85580fdd-feb4-495b-a2ae-5b7f3928cc96', '近藤　拓翔', 'コンドウ　タクト', NULL, 'admin-manual-import', '2026-02-16 10:18:59.313973', '2026-02-16 10:18:59.313973'),
        ('15dd404b-8f6e-40ca-8f81-cd19549cc78b', '高梨　航希', 'タカナシ　コウキ', NULL, 'admin-manual-import', '2026-02-16 10:18:48.595991', '2026-02-16 10:18:48.595991'),
        ('b06832e9-e141-438d-83d8-0d1b112d6243', '土田　直矢', 'ツチダ　ナオヤ', NULL, 'admin-manual-import', '2026-02-16 10:18:47.119045', '2026-02-16 10:18:47.119045'),
        ('d62cfa48-664f-4ff2-a276-96842e88c91b', 'テストスタッフ', 'テストスタッフ', NULL, 'admin-manual-import', '2026-02-16 10:19:00.258494', '2026-02-16 10:19:00.258494'),
        ('c4882bde-8fa0-425a-b29e-45a63af1cfc5', '中嶋　正一', 'ナカジマ　ショウイチ', NULL, 'admin-manual-import', '2026-02-16 10:18:58.851201', '2026-02-16 10:18:58.851201'),
        ('03f26cec-e969-47d3-bf89-2e064a2abdce', '中田　琉月', 'ナカタ　ルツキ', NULL, 'admin-manual-import', '2026-02-16 10:18:49.055846', '2026-02-16 10:18:49.055846'),
        ('bca398ac-c11e-424c-b098-cb498b09abb0', '中村　文彦', 'ナカムラ　フミヒコ', NULL, 'admin-manual-import', '2026-02-16 10:18:49.989084', '2026-02-16 10:18:49.989084'),
        ('461239ac-ba19-4896-82bd-44587a46c443', '西村　克人', 'ニシムラ カツト', NULL, 'admin-manual-import', '2026-02-16 10:18:52.749628', '2026-02-16 10:18:52.749628'),
        ('f5321299-9b72-4b51-890d-4a311d57efeb', '波多野　匠', 'ハタノタクミ', NULL, 'admin-manual-import', '2026-02-16 10:18:50.457041', '2026-02-16 10:18:50.457041'),
        ('1527734d-a112-4176-8bc7-63169bd14e1c', '廣中　良信', 'ヒロナカ　ヨシノブ', NULL, 'admin-manual-import', '2026-02-16 10:18:47.627824', '2026-02-16 10:18:47.627824'),
        ('34e86a31-9c7b-48fa-b36b-24128dd76327', '藤井　勝', 'フジイ　マサル', NULL, 'admin-manual-import', '2026-02-16 10:18:55.098616', '2026-02-16 10:18:55.098616'),
        ('bfaef3bc-2eb8-4a8b-9437-b200ff643b75', '藤田　風雅', 'フジタ　フウガ', NULL, 'admin-manual-import', '2026-02-16 10:18:48.110747', '2026-02-16 10:18:48.110747'),
        ('2969c9f2-b58b-4c37-bde2-f13e7c3642a7', '松本　祐太郎', 'マツモト ユウタロウ', NULL, 'admin-manual-import', '2026-02-16 10:18:52.298822', '2026-02-16 10:18:52.298822'),
        ('a7f96a6a-907e-45b5-a1eb-462f95ccf57c', '峯　栄治', 'ミネ　エイジ', NULL, 'admin-manual-import', '2026-02-16 10:18:53.686006', '2026-02-16 10:18:53.686006'),
        ('439a9918-4006-4fe7-b21f-94192a0144e1', '宮﨑　萌', 'ミヤザキ　モエ', NULL, 'admin-manual-import', '2026-02-16 10:18:51.376873', '2026-02-16 10:18:51.376873')
      ON CONFLICT (id) DO NOTHING
    `);
    const newCount = await pool.query('SELECT COUNT(*) as cnt FROM staff_master WHERE deleted_at IS NULL');
    console.log(`[Seed] Staff count after seed: ${newCount.rows[0].cnt}`);
    seedStatus = 'done-' + newCount.rows[0].cnt;
    seedDetail += ` after:${newCount.rows[0].cnt}`;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Seed] Error seeding staff data:', err);
    seedStatus = 'error';
    seedError = errMsg;
  }
}

seedStaffData().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});
