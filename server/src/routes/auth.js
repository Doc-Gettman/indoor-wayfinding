import { Router } from 'express';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD is not configured on the server' });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  req.session.isAdmin = true;
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Could not save admin session' });
    res.json({ ok: true });
  });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get('/session', (req, res) => {
  res.json({ isAdmin: Boolean(req.session?.isAdmin) });
});
