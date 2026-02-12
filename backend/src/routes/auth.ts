import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';

const router = Router();

const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret-key';
const JWT_EXPIRES_IN = '7d';

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, pin } = req.body;

    if (!email || !pin) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'メールアドレスとPINは必須です',
        details: {}
      });
      return;
    }

    if (!/^\d{4,6}$/.test(pin)) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'PINは4〜6桁の数字である必要があります',
        details: {}
      });
      return;
    }

    const existingUser = await pool.query(
      'SELECT id, pin_hash, created_at FROM cast_users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      const existing = existingUser.rows[0];
      if (!existing.pin_hash) {
        const pinHash = await bcrypt.hash(pin, 10);
        await pool.query(
          'UPDATE cast_users SET pin_hash = $1, updated_at = NOW() WHERE id = $2',
          [pinHash, existing.id]
        );

        const token = jwt.sign(
          { userId: existing.id, email },
          AUTH_SECRET,
          { expiresIn: JWT_EXPIRES_IN }
        );

        res.status(200).json({
          user: {
            id: existing.id,
            email,
            created_at: existing.created_at
          },
          token
        });
        return;
      }

      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'このメールアドレスは既に登録されています',
        details: {}
      });
      return;
    }

    const pinHash = await bcrypt.hash(pin, 10);

    const result = await pool.query(
      'INSERT INTO cast_users (email, pin_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [email, pinHash]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      AUTH_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at
      },
      token
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: '登録処理中にエラーが発生しました',
      details: {}
    });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, pin } = req.body;

    if (!email || !pin) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'メールアドレスとPINは必須です',
        details: {}
      });
      return;
    }

    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.pin_hash, cu.created_at, cu.staff_id,
              sm.display_name_kanji as staff_name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'メールアドレスまたはPINが正しくありません',
        details: {}
      });
      return;
    }

    const user = result.rows[0];

    if (!user.pin_hash) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'メールアドレスまたはPINが正しくありません',
        details: {}
      });
      return;
    }

    const isValidPin = await bcrypt.compare(pin, user.pin_hash);

    if (!isValidPin) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'メールアドレスまたはPINが正しくありません',
        details: {}
      });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      AUTH_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        staff_id: user.staff_id || null,
        staff_name: user.staff_name || null
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'ログイン処理中にエラーが発生しました',
      details: {}
    });
  }
});

router.post('/exchange-cast-token', async (req: Request, res: Response) => {
  try {
    const { cast_token } = req.body;
    if (!cast_token) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'cast_tokenは必須です', details: {} });
      return;
    }

    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.created_at, cu.staff_id,
              sm.display_name_kanji as staff_name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.magic_link_token = $1 AND cu.magic_link_expires > NOW()`,
      [cast_token]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'キャストトークンが無効です', details: {} });
      return;
    }

    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      AUTH_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        staff_id: user.staff_id || null,
        staff_name: user.staff_name || null
      },
      token
    });
  } catch (error) {
    console.error('Exchange cast token error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'トークン交換に失敗しました', details: {} });
  }
});

export default router;
