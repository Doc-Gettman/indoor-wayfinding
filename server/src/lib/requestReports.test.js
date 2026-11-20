import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { invalidateRouteCache } from './routeCache.js';
import { buildBuildingReport, buildGroupSummary, weekStart } from './requestReports.js';

// ---- Pure aggregation ------------------------------------------------------

test('weekStart buckets by Monday in the viewer time zone', () => {
  // Monday 2026-11-16 03:00 UTC is still Sunday evening in Chicago.
  assert.equal(weekStart('2026-11-16T03:00:00Z', 'UTC'), '2026-11-16');
  assert.equal(weekStart('2026-11-16T03:00:00Z', 'America/Chicago'), '2026-11-09');
  assert.equal(weekStart('2026-11-22T23:59:59Z', 'UTC'), '2026-11-16');
});

test('building report groups by QR code with destination counts, using current names', () => {
  const rows = [
    { id: '1', created_at: '2026-11-17T10:00:00Z', origin_node_id: 'n1', qr_code_id: 'qr1', qr_label: 'Old lobby', destination_poi_id: 'p1', destination_name: 'Pharmacy' },
    { id: '2', created_at: '2026-11-17T11:00:00Z', origin_node_id: 'n1', qr_code_id: 'qr1', qr_label: 'Old lobby', destination_poi_id: 'p2', destination_name: 'X-Ray' },
    { id: '3', created_at: '2026-11-17T12:00:00Z', origin_node_id: 'n1', qr_code_id: 'qr1', qr_label: 'Old lobby', destination_poi_id: 'p2', destination_name: 'X-Ray' },
    { id: '4', created_at: '2026-11-18T09:00:00Z', origin_node_id: 'n2', qr_code_id: 'qr-gone', qr_label: 'East door', destination_poi_id: 'p-gone', destination_name: 'Gift shop' },
  ];
  const report = buildBuildingReport({
    rows,
    qrcodes: [{ id: 'qr1', originNodeId: 'n1', label: 'Main lobby' }],
    pois: [{ id: 'p1', name: 'Pharmacy' }, { id: 'p2', name: 'Radiology' }],
    nodes: [],
  });
  assert.equal(report.total, 4);
  assert.deepEqual(report.origins.map((o) => [o.label, o.total]), [['Main lobby', 3], ['East door (deleted QR code)', 1]]);
  assert.deepEqual(report.origins[0].destinations.map((d) => [d.name, d.count]), [['Radiology', 2], ['Pharmacy', 1]]);
  assert.equal(report.origins[1].destinations[0].name, 'Gift shop');
  assert.equal(report.requests[0].id, '4', 'log is newest first');
});

test('group summary has every week in range, zero-filled, by building', () => {
  const summary = buildGroupSummary({
    rows: [
      { building_id: 'a', created_at: '2026-11-02T12:00:00Z' },
      { building_id: 'a', created_at: '2026-11-17T12:00:00Z' },
      { building_id: 'b', created_at: '2026-11-18T12:00:00Z' },
      { building_id: 'not-in-group', created_at: '2026-11-18T12:00:00Z' },
    ],
    buildings: [{ id: 'b', name: 'Bravo' }, { id: 'a', name: 'Alpha' }],
    since: '2026-11-01T00:00:00Z',
    until: '2026-11-21T00:00:00Z',
    timeZone: 'UTC',
  });
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.buildings.map((b) => [b.name, b.total]), [['Alpha', 2], ['Bravo', 1]]);
  assert.deepEqual(
    summary.weeks.map((w) => [w.weekStart, w.byBuilding.a, w.byBuilding.b, w.total]),
    [['2026-10-26', 0, 0, 0], ['2026-11-02', 1, 0, 1], ['2026-11-09', 0, 0, 0], ['2026-11-16', 1, 1, 2]],
  );
});

// ---- Tracking through the real wayfind router -----------------------------

const collections = new Map();
const recorded = [];
let failInserts = false;
mock.module('../db.js', { namedExports: {
  getCollection: async (building, name) => structuredClone(collections.get(`${building}/${name}`) || []),
  recordDirectionRequest: async (row) => {
    if (failInserts) throw new Error('supabase down');
    recorded.push(row);
  },
} });
mock.module('./llmDirections.js', { namedExports: { generateLLMDirections: async () => null } });
const { wayfindRouter } = await import('../routes/wayfind.js');

const app = express();
app.use('/buildings/:buildingId/wayfind', wayfindRouter);
let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/buildings/b1/wayfind`;
});
after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  recorded.length = 0;
  failInserts = false;
  invalidateRouteCache('b1');
  collections.clear();
  collections.set('b1/floors', [{ id: 'f1', name: '1st Floor', pixelsPerFoot: 10, imagePath: '/f1.png' }]);
  collections.set('b1/nodes', [
    { id: 'start', floorId: 'f1', x: 0, y: 0, nodeType: 'waypoint' },
    { id: 'end', floorId: 'f1', x: 100, y: 0, nodeType: 'destination' },
  ]);
  collections.set('b1/edges', [{ id: 'e1', from: 'start', to: 'end', type: 'hallway', weight: 100 }]);
  collections.set('b1/pois', [{ id: 'poi1', nodeId: 'end', name: 'Cafeteria' }]);
  collections.set('b1/qrcodes', [{ id: 'qr1', originNodeId: 'start', label: 'Front entrance' }]);
});

test('each completed request is recorded, including cache hits', async () => {
  for (let i = 0; i < 2; i += 1) {
    const response = await fetch(`${base}?from=start&to=poi1`);
    assert.equal(response.status, 200);
  }
  assert.equal(recorded.length, 2);
  assert.deepEqual(recorded[1], {
    building_id: 'b1', origin_node_id: 'start', qr_code_id: 'qr1', qr_label: 'Front entrance',
    destination_poi_id: 'poi1', destination_name: 'Cafeteria', avoid_stairs: true, generated_by: 'rules',
  });
});

test('failed requests are not recorded, and a failing insert does not break directions', async () => {
  assert.equal((await fetch(`${base}?from=start&to=missing`)).status, 404);
  assert.equal(recorded.length, 0);

  failInserts = true;
  const errorLog = mock.method(console, 'error', () => {});
  const response = await fetch(`${base}?from=start&to=poi1`);
  errorLog.mock.restore();
  assert.equal(response.status, 200);
  assert.ok((await response.json()).instructions.length > 0);
});
