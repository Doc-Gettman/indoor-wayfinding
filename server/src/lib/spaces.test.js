import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssignment, resolveEdgeSpace, reconcileSpaceEdges, routeSpaceContexts } from '../../../shared/spaces.js';
import { generateDirections } from './directions.js';
import { buildPathDescription } from './llmDirections.js';

const spaces = [
  { id: 'hall', name: 'East Hallway', environment: 'indoor', layout: 'corridor' },
  { id: 'lobby', name: 'Entrance Lobby', environment: 'indoor', layout: 'open' },
  { id: 'yard', name: 'Outdoor Courtyard', environment: 'outdoor', layout: 'open' },
];
const node = (id, x, spaceId, extra = {}) => ({ id, x, y: 0, floorId: 'ground', nodeType: 'waypoint', spaceId, ...extra });
const edge = (from, to, spaceId, extra = {}) => ({ id: `${from}-${to}`, from, to, type: 'walk', weight: 200, spaceId, ...extra });
function input(pathNodes, pathEdges, extra = {}) {
  return { pathNodes, pathEdges, allNodes: pathNodes, allEdges: pathEdges, spaces,
    floorsById: new Map([['ground', { name: 'Ground', pixelsPerFoot: 10 }]]),
    pois: [{ nodeId: pathNodes.at(-1).id, name: 'Reception' }], destination: { name: 'Reception' }, landmarks: [], ...extra };
}

test('assignment validates unknown IDs, contradictory membership, and boundary pairs', () => {
  assert.equal(validateAssignment({}, spaces), null);
  assert.equal(validateAssignment({ boundarySpaceIds: ['hall', 'lobby'] }, spaces), null);
  for (const assignment of [{ spaceId: 'missing' }, { boundarySpaceIds: ['hall'] }, { boundarySpaceIds: ['hall', 'hall'] },
    { spaceId: 'hall', boundarySpaceIds: ['hall', 'lobby'] }, { boundarySpaceIds: 'hall' }, { boundarySpaceIds: ['hall', null] }]) {
    assert.ok(validateAssignment(assignment, spaces));
  }
  assert.ok(validateAssignment({ boundarySpaceIds: ['hall', 'lobby'] }, spaces, false));
});

test('connections inherit shared spaces, reject unmarked boundaries, and support either boundary side', () => {
  const a = node('a', 0, 'hall');
  const b = node('b', 100, 'lobby');
  const door = node('door', 50, null, { boundarySpaceIds: ['hall', 'lobby'] });
  assert.equal(resolveEdgeSpace({}, a, a).spaceId, 'hall');
  assert.ok(resolveEdgeSpace({}, a, b).error);
  assert.equal(resolveEdgeSpace({}, a, door).spaceId, 'hall');
  assert.equal(resolveEdgeSpace({}, door, b).spaceId, 'lobby');
  assert.ok(resolveEdgeSpace({ spaceId: 'yard' }, a, door).error);
  assert.ok(resolveEdgeSpace({}, door, door).error);
  assert.equal(resolveEdgeSpace({ spaceId: 'hall' }, door, door).spaceId, 'hall');
});

test('reassignment updates stale edges and flags ambiguity without changing route mechanics', () => {
  const nodes = [node('a', 0, 'lobby'), node('b', 100, 'lobby'), node('c', 200, 'yard')];
  const edges = [edge('a', 'b', 'hall'), edge('b', 'c', 'hall'), edge('a', 'c', null, { type: 'elevator' })];
  const updated = reconcileSpaceEdges(nodes, edges);
  assert.equal(updated[0].spaceId, 'lobby');
  assert.equal(updated[1].spaceId, null);
  assert.equal(updated[1].needsSpaceReview, true);
  assert.deepEqual(updated[2], edges[2]);
  assert.equal(updated[0].weight, edges[0].weight);
  assert.equal(reconcileSpaceEdges(nodes.map((n) => ({ ...n, spaceId: null })), edges)[0].spaceId, null);
});

test('legacy hallway edges get neutral directions in both generators', () => {
  const data = input([node('a', 0), node('b', 500)], [edge('a', 'b', null, { type: 'hallway' })]);
  assert.doesNotMatch(generateDirections(data).join(' '), /hall|corridor|indoors|outside/i);
  const description = buildPathDescription(data);
  assert.equal(description.segments[0].space, null);
  assert.equal(description.segments[0].edgeType, 'walk');
});

test('open-area boundaries break straight segments without inventing a door', () => {
  const nodes = [node('a', 0, 'hall'), node('opening', 200, null, { boundarySpaceIds: ['hall', 'lobby'] }), node('b', 500, 'lobby')];
  const edges = [edge('a', 'opening', 'hall'), edge('opening', 'b', 'lobby')];
  const data = input(nodes, edges);
  const directions = generateDirections(data);
  assert.ok(directions.includes('Continue into Entrance Lobby'));
  assert.doesNotMatch(directions.join(' '), /door/i);
  assert.equal(buildPathDescription(data).segments[1].spaceChangeAtStart, 'Continue into Entrance Lobby');
  const reversed = generateDirections(input([...nodes].reverse(), [...edges].reverse()));
  assert.ok(reversed.includes('Continue into East Hallway'));
});

test('door boundaries combine indoor/outdoor and directional badge wording in both directions', () => {
  const nodes = [node('a', 0, 'lobby'), node('door', 200, null, { nodeType: 'door', boundarySpaceIds: ['lobby', 'yard'],
    label: 'the glass doors', doorRequiresBadgeAccess: true, doorBadgeAccessFromNodeIds: ['b'], doorDescription: 'badge reader' }), node('b', 500, 'yard')];
  const edges = [edge('a', 'door', 'lobby'), edge('door', 'b', 'yard')];
  const outward = generateDirections(input(nodes, edges));
  const crossing = outward.find((line) => line.includes('Go outside through'));
  assert.match(crossing, /outside.*Outdoor Courtyard/);
  assert.doesNotMatch(crossing, /badge/i);
  assert.match(outward.at(-1), /return.*badge/i);
  assert.equal(outward.filter((line) => line.includes('Outdoor Courtyard')).length, 1);
  const inward = generateDirections(input([...nodes].reverse(), [...edges].reverse()));
  assert.match(inward.join(' '), /Use your badge.*inside.*Entrance Lobby/);
  assert.doesNotMatch(inward.join(' '), /hallway/);
  const description = buildPathDescription(input(nodes, edges));
  assert.equal(description.segments[0].toDoorBadgeRequired, false);
  assert.match(description.segments[0].spaceChangeAfterArrival, /outside/);
});

test('open and outdoor walking segments do not use hallway language and retain mapped turns', () => {
  const outdoorWalkway = { ...spaces[2], layout: 'corridor', descriptiveTerm: 'walkway' };
  const nodes = [node('a', 0, 'yard'), node('b', 200, 'yard'), node('c', 400, 'yard', { y: -100 })];
  const data = input(nodes, [edge('a', 'b', 'yard'), edge('b', 'c', 'yard')], { spaces: [outdoorWalkway] });
  const text = generateDirections(data).join(' ');
  assert.doesNotMatch(text, /hallway|down the hall/);
  assert.match(text, /Bear left/);
  assert.match(text, /Outdoor Courtyard/);
});

test('landmarks in a different assigned space do not leak through nearby walls', () => {
  const data = input([node('a', 0, 'lobby'), node('b', 200, 'lobby')], [edge('a', 'b', 'lobby')], {
    landmarks: [{ id: 'lm', name: 'Courtyard fountain', description: 'Fountain', floorId: 'ground', x: 100, y: 0, spaceId: 'yard' }],
  });
  assert.doesNotMatch(generateDirections(data).join(' '), /fountain/i);
  assert.deepEqual(buildPathDescription(data).segments[0].nearbyLandmarks, []);
});

test('starting or stopping on a boundary does not infer an untraversed other side', () => {
  const boundary = node('door', 100, null, { boundarySpaceIds: ['hall', 'lobby'] });
  const a = node('a', 0, 'hall');
  for (const nodes of [[a, boundary], [boundary, a]]) {
    const data = input(nodes, [edge('a', 'door', 'hall')]);
    assert.doesNotMatch(generateDirections(data).join(' '), /Entrance Lobby/);
  }
});

test('a flagged edge never supplies stale spatial wording', () => {
  const nodes = [node('a', 0, 'lobby'), node('b', 200, 'lobby')];
  assert.deepEqual(routeSpaceContexts(nodes, [edge('a', 'b', 'lobby', { needsSpaceReview: true })], spaces), [null]);
});
