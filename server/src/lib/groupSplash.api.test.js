import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const BUCKET_URL = 'https://example.supabase.co/storage/v1/object/public/floor-images';
let groups = [];
const removed = [];
mock.module('../db.js', { namedExports: {
  listGroups: async () => structuredClone(groups),
  saveGroups: async (next) => { groups = structuredClone(next); },
  listBuildings: async () => [],
  getBuildingMetadata: async () => ({}),
  saveBuildingMetadata: async () => {},
  nextId: (prefix) => `${prefix}-1`,
} });
mock.module('../middleware/auth.js', { namedExports: {
  requireAdmin: (req, res, next) => req.headers['x-test-admin'] === 'yes' ? next() : res.status(401).json({ error: 'Admin login required' }),
} });
mock.module('./storage.js', { namedExports: {
  ALLOWED_IMAGE_TYPES: /^image\/(png|jpe?g|webp)$/,
  storagePathFromImageUrl: (url) => (url.startsWith(`${BUCKET_URL}/`) ? url.slice(BUCKET_URL.length + 1).split('?')[0] : null),
  removeStorageImage: async (url) => { removed.push(url); },
  createImageUploadUrl: async (path) => ({ signedUrl: `signed:${path}`, path, publicUrl: `${BUCKET_URL}/${path}` }),
} });
const { groupsRouter } = await import('../routes/groups.js');

const app = express();
app.use(express.json());
app.use('/groups', groupsRouter);
let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/groups`;
});
after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  groups = [{ id: 'g1', name: 'Mercy Health' }, { id: 'g2', name: 'Other' }];
  removed.length = 0;
});
async function call(path, method, body, admin = true) {
  const response = await fetch(`${base}${path}`, { method,
    headers: { 'content-type': 'application/json', ...(admin ? { 'x-test-admin': 'yes' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

test('splash text/color/duration save with defaults, and renaming keeps the splash', async () => {
  const saved = await call('/g1/splash', 'PUT', { text: '  Welcome!\r\nFollow the signs.  ' });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.splash, { imageUrl: null, text: 'Welcome!\nFollow the signs.', backgroundColor: '#ffffff', durationSeconds: 3 });

  await call('/g1/splash', 'PUT', { backgroundColor: '#1A2B5E', durationSeconds: 4.5 });
  await call('/g1', 'PUT', { name: 'Mercy' });
  assert.deepEqual(groups[0].splash, { imageUrl: null, text: 'Welcome!\nFollow the signs.', backgroundColor: '#1a2b5e', durationSeconds: 4.5 });
});

test('splash validation and admin requirement', async () => {
  assert.equal((await call('/g1/splash', 'PUT', { text: 'x' }, false)).status, 401);
  assert.equal((await call('/g1/splash', 'PUT', { text: 'x'.repeat(501) })).status, 400);
  assert.equal((await call('/g1/splash', 'PUT', { backgroundColor: 'red' })).status, 400);
  assert.equal((await call('/g1/splash', 'PUT', { durationSeconds: 60 })).status, 400);
  assert.equal((await call('/missing/splash', 'PUT', { text: 'x' })).status, 404);
  assert.equal((await call('/g1/splash-image-upload-url', 'POST', { contentType: 'image/gif' })).status, 400);
  assert.equal(groups[0].splash, undefined);
});

test('splash image: upload, replace removes the old file, only own-folder URLs accepted, delete cleans up', async () => {
  const { data: upload } = await call('/g1/splash-image-upload-url', 'POST', { contentType: 'image/png', extension: '.png' });
  assert.match(upload.path, /^groups\/g1\/splash-\d+\.png$/);

  assert.equal((await call('/g1/splash-image', 'POST', { imageUrl: upload.publicUrl })).data.splash.imageUrl, upload.publicUrl);
  const second = `${BUCKET_URL}/groups/g1/splash-2.png`;
  await call('/g1/splash-image', 'POST', { imageUrl: second });
  assert.deepEqual(removed, [upload.publicUrl]);

  for (const imageUrl of ['https://evil.example/logo.png', `${BUCKET_URL}/groups/g2/splash-1.png`, `${BUCKET_URL}/buildings/b/floors/f.png`]) {
    assert.equal((await call('/g1/splash-image', 'POST', { imageUrl })).status, 400, imageUrl);
  }

  assert.equal((await call('/g1/splash-image', 'DELETE')).data.splash.imageUrl, null);
  assert.deepEqual(removed, [upload.publicUrl, second]);
});

test('deleting a group removes its splash image', async () => {
  groups[0].splash = { imageUrl: `${BUCKET_URL}/groups/g1/splash-9.png`, text: '' };
  assert.equal((await call('/g1', 'DELETE')).status, 200);
  assert.deepEqual(removed, [`${BUCKET_URL}/groups/g1/splash-9.png`]);
});
