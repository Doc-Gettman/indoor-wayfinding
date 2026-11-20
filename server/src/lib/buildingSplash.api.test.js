import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { effectiveSplash } from './splash.js';

// ---- Which splash a visitor sees -------------------------------------------

const kimleyHorn = { id: 'g1', name: 'Kimley-Horn', splash: { imageUrl: 'https://x/logo.png', text: 'Welcome', backgroundColor: '#000000', durationSeconds: 4 } };

test('group text and building text both show; group image/colors/duration are shared', () => {
  assert.deepEqual(effectiveSplash(kimleyHorn, 'Dallas Office'), {
    imageUrl: 'https://x/logo.png', groupText: 'Welcome', buildingText: 'Dallas Office', backgroundColor: '#000000', durationSeconds: 4,
  });
  const noBuildingText = effectiveSplash(kimleyHorn, '');
  assert.equal(noBuildingText.groupText, 'Welcome');
  assert.equal(noBuildingText.buildingText, '');
});

test('no group, or nothing to show, means the default GoldenKey splash', () => {
  assert.equal(effectiveSplash(null, 'Dallas Office'), null);
  assert.equal(effectiveSplash({ id: 'g2', name: 'Empty' }, ''), null);
  assert.deepEqual(effectiveSplash({ id: 'g2', name: 'Text only' }, 'Austin Office'), {
    imageUrl: null, groupText: '', buildingText: 'Austin Office', backgroundColor: '#ffffff', durationSeconds: 3,
  });
});

// ---- Building splash text route --------------------------------------------

const metadata = new Map();
mock.module('../db.js', { namedExports: {
  listBuildings: async () => [{ id: 'b1', name: 'Dallas', groupId: metadata.get('b1')?.groupId ?? null, splashText: metadata.get('b1')?.splashText || '' }],
  listGroups: async () => [{ id: 'g1', name: 'Kimley-Horn' }, { id: 'g2', name: 'Other' }],
  getBuildingMetadata: async (id) => structuredClone(metadata.get(id) || {}),
  saveBuildingMetadata: async (id, value) => { metadata.set(id, structuredClone(value)); },
  getCollection: async () => [], saveCollection: async () => {}, saveBuildings: async () => {}, nextId: (p) => `${p}-1`,
} });
mock.module('../middleware/auth.js', { namedExports: {
  requireAdmin: (req, res, next) => req.headers['x-test-admin'] === 'yes' ? next() : res.status(401).json({ error: 'Admin login required' }),
} });
const { buildingsRouter } = await import('../routes/buildings.js');

const app = express();
app.use(express.json());
app.use('/buildings', buildingsRouter);
let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/buildings`;
});
after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  metadata.clear();
  metadata.set('b1', { groupId: 'g1' });
});
async function call(path, method, body, admin = true) {
  const response = await fetch(`${base}${path}`, { method,
    headers: { 'content-type': 'application/json', ...(admin ? { 'x-test-admin': 'yes' } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

test('building splash text saves (trimmed), validates, and requires admin', async () => {
  const saved = await call('/b1/splash-text', 'PUT', { text: '  Dallas Office  ' });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.splashText, 'Dallas Office');
  assert.deepEqual(metadata.get('b1'), { groupId: 'g1', splashText: 'Dallas Office' });

  assert.equal((await call('/b1/splash-text', 'PUT', { text: 'x' }, false)).status, 401);
  assert.equal((await call('/b1/splash-text', 'PUT', { text: 'x'.repeat(501) })).status, 400);
  assert.equal((await call('/missing/splash-text', 'PUT', { text: 'x' })).status, 404);
});

test('moving a building to another group keeps its splash text', async () => {
  metadata.set('b1', { groupId: 'g1', splashText: 'Dallas Office' });
  assert.equal((await call('/b1', 'PUT', { groupId: 'g2' })).status, 200);
  assert.deepEqual(metadata.get('b1'), { groupId: 'g2', splashText: 'Dallas Office' });
});
