import { Router } from 'express';
import { getCollection, listBuildings, listDirectionRequests, listGroups } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { buildBuildingReport, buildGroupSummary, resolveTimeZone } from '../lib/requestReports.js';

const DEFAULT_RANGE_DAYS = 30;

// since/until are ISO instants computed by the client from local calendar
// dates; tz is the viewer's IANA zone, used to bucket requests into weeks.
function parseRange(query) {
  const until = query.until ? new Date(query.until) : new Date();
  const since = query.since ? new Date(query.since) : new Date(until.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) return { error: 'since and until must be valid dates' };
  if (since >= until) return { error: 'since must be before until' };
  return { since: since.toISOString(), until: until.toISOString(), timeZone: resolveTimeZone(query.tz) };
}

// Express 4 doesn't forward rejected promises from async handlers.
const handle = (fn) => (req, res, next) => fn(req, res).catch(next);

// GET /buildings/:buildingId/reports/direction-requests?since&until&tz
export const buildingReportsRouter = Router({ mergeParams: true });

buildingReportsRouter.get(
  '/direction-requests',
  requireAdmin,
  handle(async (req, res) => {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const { buildingId } = req.params;
    const buildings = await listBuildings();
    const building = buildings.find((b) => b.id === buildingId);
    if (!building) return res.status(404).json({ error: 'Building not found' });

    const [rows, qrcodes, pois, nodes] = await Promise.all([
      listDirectionRequests({ buildingIds: [buildingId], since: range.since, until: range.until }),
      getCollection(buildingId, 'qrcodes'),
      getCollection(buildingId, 'pois'),
      getCollection(buildingId, 'nodes'),
    ]);
    res.json({ building, ...range, ...buildBuildingReport({ rows, qrcodes, pois, nodes }) });
  }),
);

// GET /groups/:groupId/reports/direction-requests?since&until&tz
export const groupReportsRouter = Router({ mergeParams: true });

groupReportsRouter.get(
  '/direction-requests',
  requireAdmin,
  handle(async (req, res) => {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const groups = await listGroups();
    const group = groups.find((g) => g.id === req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Uses current group membership, so moving a building into a group brings
    // its full request history with it.
    const buildings = (await listBuildings()).filter((b) => b.groupId === group.id);
    const rows = await listDirectionRequests({ buildingIds: buildings.map((b) => b.id), since: range.since, until: range.until });
    res.json({ group, ...range, ...buildGroupSummary({ rows, buildings, ...range }) });
  }),
);
