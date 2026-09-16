import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { invalidateRouteCache } from './routeCache.js';

// Exercise real routers with isolated storage; never connect to Supabase.
const collections = new Map();
let serial = 0;
const key = (building, name) => `${building}/${name}`;
const getCollection = async (building, name) => structuredClone(collections.get(key(building, name)) || []);
const saveCollection = async (building, name, value) => {
  collections.set(key(building, name), structuredClone(value));
  invalidateRouteCache(building);
};
mock.module('../db.js', { namedExports: {
  getCollection, saveCollection, nextId: (prefix) => `${prefix}-${++serial}`,
  listBuildings: async () => [{ id: 'building', name: 'Hospital' }], listGroups: async () => [],
  saveBuildings: async () => {}, saveBuildingMetadata: async () => {},
} });
mock.module('../middleware/auth.js', { namedExports: {
  requireAdmin: (req, res, next) => req.headers['x-test-admin'] === 'yes' ? next() : res.status(401).json({ error: 'Admin login required' }),
} });
mock.module('./llmDirections.js', { namedExports: { generateLLMDirections: async () => null } });

const { spacesRouter } = await import('../routes/spaces.js');
const { nodesRouter } = await import('../routes/nodes.js');
const { edgesRouter } = await import('../routes/edges.js');
const { landmarksRouter } = await import('../routes/landmarks.js');
const { buildingsRouter } = await import('../routes/buildings.js');
const { wayfindRouter } = await import('../routes/wayfind.js');
const app = express();
app.use(express.json());
app.use('/buildings', buildingsRouter);
for (const [name, router] of Object.entries({ spaces: spacesRouter, nodes: nodesRouter, edges: edgesRouter, landmarks: landmarksRouter, wayfind: wayfindRouter })) {
  app.use(`/buildings/:buildingId/${name}`, router);
}
let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/buildings/building`;
});
after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => { collections.clear(); invalidateRouteCache('building'); });
async function request(path, method = 'GET', body, admin = true) {
  const response = await fetch(`${base}${path}`, { method,
    headers: { 'content-type': 'application/json', ...(admin ? { 'x-test-admin': 'yes' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
async function create(path, body) {
  const result = await request(path, 'POST', body);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data;
}

async function fixture() {
  const lobby = await create('/spaces', { name: 'Entrance Lobby', layout: 'open', environment: 'indoor' });
  const yard = await create('/spaces', { name: 'Outdoor Courtyard', layout: 'open', environment: 'outdoor' });
  const a = await create('/nodes', { floorId: 'ground', x: 0, y: 0, spaceId: lobby.id });
  const door = await create('/nodes', { floorId: 'ground', x: 200, y: 0, nodeType: 'door', boundarySpaceIds: [lobby.id, yard.id] });
  const b = await create('/nodes', { floorId: 'ground', x: 400, y: 0, spaceId: yard.id });
  const first = await create('/edges', { from: a.id, to: door.id, type: 'walk' });
  const second = await create('/edges', { from: door.id, to: b.id, type: 'walk' });
  return { lobby, yard, a, b, door, first, second };
}

test('space creation, boundaries, routing, cache refresh, and building copy work together', async () => {
  const { lobby, yard, a, b, door, first, second } = await fixture();
  assert.equal(first.spaceId, lobby.id);
  assert.equal(second.spaceId, yard.id);
  const landmark = await create('/landmarks', { floorId: 'ground', x: 400, y: 0, name: 'Fountain', spaceId: yard.id });
  await saveCollection('building', 'pois', [{ id: 'destination', nodeId: b.id, name: 'Garden' }]);
  await saveCollection('building', 'floors', [{ id: 'ground', name: 'Ground', pixelsPerFoot: 10, imagePath: '/map.png' }]);
  const url = `/wayfind?from=${a.id}&to=destination`;
  const route = await request(url);
  assert.equal(route.status, 200);
  assert.match(route.data.instructions.join(' '), /outside.*Outdoor Courtyard/);
  assert.equal((await request('/spaces/' + yard.id, 'PUT', { name: 'North Courtyard' })).status, 200);
  const refreshed = await request(url);
  assert.match(refreshed.data.instructions.join(' '), /North Courtyard/);
  assert.doesNotMatch(refreshed.data.instructions.join(' '), /Outdoor Courtyard/);
  assert.equal((await request('/spaces/' + lobby.id, 'DELETE')).status, 409);
  const copy = await request('/copy', 'POST', { name: 'Copied hospital' });
  assert.equal(copy.status, 201);
  const copiedSpaces = await getCollection(copy.data.id, 'spaces');
  const copiedNodes = await getCollection(copy.data.id, 'nodes');
  const copiedEdges = await getCollection(copy.data.id, 'edges');
  const copiedLandmarks = await getCollection(copy.data.id, 'landmarks');
  const ids = copiedSpaces.map((space) => space.id);
  assert.ok(!ids.includes(lobby.id));
  assert.ok(copiedNodes.find((node) => node.nodeType === 'door').boundarySpaceIds.every((id) => ids.includes(id)));
  assert.ok(copiedEdges.every((edge) => ids.includes(edge.spaceId)));
  assert.ok(ids.includes(copiedLandmarks[0].spaceId));
  assert.notEqual(copiedLandmarks[0].id, landmark.id);
  assert.ok(!copiedNodes.some((node) => node.id === door.id));
});

test('invalid assignments fail before writes; bulk assignment reconciles existing connections', async () => {
  const { lobby, yard, a, b, door } = await fixture();
  assert.equal((await request('/nodes', 'POST', { floorId: 'ground', x: 1, y: 1, spaceId: 'missing' })).status, 400);
  assert.equal((await request('/edges', 'POST', { from: a.id, to: b.id, type: 'walk' })).status, 400);
  assert.equal((await request('/nodes/' + door.id, 'PUT', { spaceId: lobby.id })).status, 400);
  assert.equal((await getCollection('building', 'nodes')).length, 3);
  assert.equal((await request('/spaces/assign', 'POST', { nodeIds: [door.id], spaceId: lobby.id })).status, 400);
  assert.equal((await request('/spaces/assign', 'POST', { nodeIds: [a.id, 'missing'], spaceId: yard.id })).status, 400);
  assert.equal((await getCollection('building', 'nodes')).find((node) => node.id === a.id).spaceId, lobby.id);
  const newSpace = await create('/spaces', { name: 'Concourse', layout: 'open' });
  assert.equal((await request('/spaces/assign', 'POST', { nodeIds: [a.id], spaceId: newSpace.id })).status, 200);
  const flagged = (await getCollection('building', 'edges')).find((edge) => edge.from === a.id);
  assert.equal(flagged.needsSpaceReview, true);
  assert.equal(flagged.spaceId, null);
  assert.equal((await request('/nodes/' + door.id, 'PUT', { boundarySpaceIds: [newSpace.id, yard.id] })).status, 200);
  const fixed = (await getCollection('building', 'edges')).find((edge) => edge.from === a.id);
  assert.equal(fixed.spaceId, newSpace.id);
  assert.equal(fixed.needsSpaceReview, false);
});

test('space writes require admin, enum validation rejects invalid values, and unused spaces can be deleted', async () => {
  assert.equal((await request('/spaces', 'POST', { name: 'Test' }, false)).status, 401);
  assert.equal((await request('/spaces', 'POST', { name: 'Test', environment: 'covered' })).status, 400);
  const space = await create('/spaces', { name: 'Test' });
  assert.equal(space.environment, 'unspecified');
  assert.equal((await request('/spaces/' + space.id, 'DELETE')).status, 200);
  assert.deepEqual((await request('/spaces')).data, []);
});
