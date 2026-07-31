import { Router } from 'express';
import { setAdminCookie, clearAdminCookie, readAdminSession } from '../lib/adminSession.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD is not configured on the server' });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  setAdminCookie(res);
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

authRouter.get('/session', (req, res) => {
  res.json({ isAdmin: Boolean(readAdminSession(req)?.isAdmin) });
});
