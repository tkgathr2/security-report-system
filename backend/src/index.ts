import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import authRouter from './routes/auth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get('/version', (_req: Request, res: Response) => {
  res.json({ spec: 'plan_v2', app: 'security-report-system' });
});

app.use('/api/auth', authRouter);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
