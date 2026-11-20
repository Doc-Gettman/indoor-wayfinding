// Aggregations over direction_requests rows (see server/sql/direction_requests.sql).
// Pure functions so the report shapes are testable without Supabase.

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveTimeZone(value) {
  if (!value) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

// "YYYY-MM-DD" of the instant as seen on a wall calendar in timeZone.
export function localDate(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(instant),
  );
}

// Weeks run Monday–Sunday; a week is identified by its Monday's local date.
export function weekStart(instant, timeZone) {
  const [y, m, d] = localDate(instant, timeZone).split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  const daysSinceMonday = (new Date(utcMidnight).getUTCDay() + 6) % 7;
  return new Date(utcMidnight - daysSinceMonday * DAY_MS).toISOString().slice(0, 10);
}

function weekStartsBetween(firstWeek, lastWeek) {
  const weeks = [];
  for (let t = Date.parse(`${firstWeek}T00:00:00Z`); t <= Date.parse(`${lastWeek}T00:00:00Z`); t += 7 * DAY_MS) {
    weeks.push(new Date(t).toISOString().slice(0, 10));
  }
  return weeks;
}

function originKey(row) {
  return row.qr_code_id || `node:${row.origin_node_id}`;
}

// Per-building detail: every origin (QR code) that was scanned, where those
// visitors asked to go, plus the raw chronological log.
export function buildBuildingReport({ rows, qrcodes, pois, nodes }) {
  const qrById = new Map(qrcodes.map((qr) => [qr.id, qr]));
  const qrByNode = new Map(qrcodes.map((qr) => [qr.originNodeId, qr]));
  const poiById = new Map(pois.map((poi) => [poi.id, poi]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  // Prefer current names (renames should show up in reports), falling back to
  // the snapshot taken at request time when the QR code/POI was since deleted.
  function originLabel(row) {
    const qr = (row.qr_code_id && qrById.get(row.qr_code_id)) || null;
    if (qr) return qr.label;
    if (row.qr_label) return `${row.qr_label} (deleted QR code)`;
    const fallbackQr = qrByNode.get(row.origin_node_id);
    if (fallbackQr) return fallbackQr.label;
    const nodeLabel = nodeById.get(row.origin_node_id)?.label;
    return nodeLabel ? `${nodeLabel} (no QR code)` : 'Unknown origin';
  }
  function destinationName(row) {
    return poiById.get(row.destination_poi_id)?.name || row.destination_name || 'Unknown destination';
  }

  const origins = new Map();
  const requests = [];
  for (const row of rows) {
    const key = originKey(row);
    const label = originLabel(row);
    const destination = destinationName(row);
    let origin = origins.get(key);
    if (!origin) {
      origin = { key, qrCodeId: row.qr_code_id || null, label, total: 0, destinations: new Map() };
      origins.set(key, origin);
    }
    origin.total += 1;
    const dest = origin.destinations.get(row.destination_poi_id) || { poiId: row.destination_poi_id, name: destination, count: 0 };
    dest.count += 1;
    origin.destinations.set(row.destination_poi_id, dest);
    requests.push({
      id: row.id,
      createdAt: row.created_at,
      qrCodeId: row.qr_code_id || null,
      originLabel: label,
      destinationPoiId: row.destination_poi_id,
      destinationName: destination,
      avoidStairs: row.avoid_stairs,
    });
  }

  const byCountThenName = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
  return {
    total: rows.length,
    origins: [...origins.values()]
      .map((origin) => ({ ...origin, destinations: [...origin.destinations.values()].sort(byCountThenName) }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)),
    requests: requests.reverse(),
  };
}

// Per-group summary: request counts by week (rows) × building (columns).
// Every week in [since, until) is present, including zero-request weeks, so
// gaps in usage are visible rather than silently skipped.
export function buildGroupSummary({ rows, buildings, since, until, timeZone }) {
  const buildingTotals = new Map(buildings.map((b) => [b.id, 0]));
  const weekCounts = new Map();
  for (const row of rows) {
    if (!buildingTotals.has(row.building_id)) continue;
    const week = weekStart(row.created_at, timeZone);
    let counts = weekCounts.get(week);
    if (!counts) {
      counts = new Map();
      weekCounts.set(week, counts);
    }
    counts.set(row.building_id, (counts.get(row.building_id) || 0) + 1);
    buildingTotals.set(row.building_id, buildingTotals.get(row.building_id) + 1);
  }

  const firstWeek = weekStart(since, timeZone);
  const lastWeek = weekStart(Date.parse(until) - 1, timeZone);
  const weeks = weekStartsBetween(firstWeek, lastWeek).map((week) => {
    const counts = weekCounts.get(week) || new Map();
    const byBuilding = Object.fromEntries(buildings.map((b) => [b.id, counts.get(b.id) || 0]));
    return { weekStart: week, byBuilding, total: Object.values(byBuilding).reduce((sum, n) => sum + n, 0) };
  });

  return {
    total: [...buildingTotals.values()].reduce((sum, n) => sum + n, 0),
    buildings: buildings
      .map((b) => ({ id: b.id, name: b.name, total: buildingTotals.get(b.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    weeks,
  };
}
