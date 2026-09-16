import test from 'node:test';
import assert from 'node:assert/strict';
import { findShortestPath } from './dijkstra.js';
import { getCachedRoute, setCachedRoute, invalidateRouteCache } from './routeCache.js';

const nodes = [
  { id: 'start', floorId: '1' },
  { id: 'end', floorId: '2' },
  { id: 'lift', floorId: '1' },
];
const edges = [
  { from: 'start', to: 'end', type: 'stairs', weight: 1 },
  { from: 'start', to: 'lift', type: 'hallway', weight: 10 },
  { from: 'lift', to: 'end', type: 'elevator', weight: 100 },
];

test('default avoids cheaper stairs in either direction; disabling permits them', () => {
  for (const [from, to] of [['start', 'end'], ['end', 'start']]) {
    const route = findShortestPath(nodes, edges, from, to);
    assert.ok(route.edges.some((edge) => edge.type === 'elevator'));
    assert.ok(route.edges.every((edge) => edge.type !== 'stairs'));
    const unrestricted = findShortestPath(nodes, edges, from, to, new Map(), { avoidStairs: false });
    assert.equal(unrestricted.edges[0].type, 'stairs');
  }
});

test('stairs-only routes have no fallback, including same-floor stairs', () => {
  for (const routeNodes of [nodes, nodes.map((node) => ({ ...node, floorId: '1' }))]) {
    assert.equal(findShortestPath(routeNodes, [edges[0]], 'start', 'end'), null);
    assert.ok(findShortestPath(routeNodes, [edges[0]], 'start', 'end', new Map(), { avoidStairs: false }));
  }
});

test('ordinary walking and an origin already at the destination still work', () => {
  assert.equal(findShortestPath(nodes, edges, 'start', 'lift').edges[0].type, 'hallway');
  assert.deepEqual(findShortestPath(nodes, edges, 'start', 'start').edges, []);
});

test('route cache separates preferences and invalidates both', () => {
  setCachedRoute('test-building', 'start', 'end', { route: 'elevator' });
  assert.equal(getCachedRoute('test-building', 'start', 'end', false), null);
  setCachedRoute('test-building', 'start', 'end', { route: 'stairs' }, false);
  assert.equal(getCachedRoute('test-building', 'start', 'end').route, 'elevator');
  assert.equal(getCachedRoute('test-building', 'start', 'end', false).route, 'stairs');
  invalidateRouteCache('test-building');
  assert.equal(getCachedRoute('test-building', 'start', 'end'), null);
  assert.equal(getCachedRoute('test-building', 'start', 'end', false), null);
});
