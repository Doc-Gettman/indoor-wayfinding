import { readAdminSession } from '../lib/adminSession.js';

export function requireAdmin(req, res, next) {
  if (readAdminSession(req)?.isAdmin) return next();
  return res.status(401).json({ error: 'Admin login required' });
}
