import crypto from 'node:crypto';
import { parseCookie, stringifySetCookie } from 'cookie';

const COOKIE_NAME = 'admin_session';
const MAX_AGE_MS = 8 * 60 * 60 * 1000;

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token) {
  const [data, sig] = String(token || '').split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(data).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  return payload.exp > Date.now() ? payload : null;
}

export function setAdminCookie(res) {
  const token = sign({ isAdmin: true, exp: Date.now() + MAX_AGE_MS });
  res.setHeader(
    'Set-Cookie',
    stringifySetCookie({
      name: COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(MAX_AGE_MS / 1000),
      secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
    })
  );
}

export function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', stringifySetCookie({ name: COOKIE_NAME, value: '', path: '/', maxAge: 0 }));
}

export function readAdminSession(req) {
  const cookies = parseCookie(req.headers.cookie || '');
  return verify(cookies[COOKIE_NAME]);
}
