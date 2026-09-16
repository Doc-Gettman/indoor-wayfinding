import { Router } from 'express';
import { getCollection, saveCollection, nextId } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { ENVIRONMENTS, LAYOUTS, validateAssignment, reconcileSpaceEdges } from '../../../shared/spaces.js';

export const spacesRouter = Router({ mergeParams: true });

function cleanSpace(input) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const environment = input.environment ?? 'unspecified';
  const layout = input.layout ?? 'unspecified';
  const descriptiveTerm = typeof input.descriptiveTerm === 'string' ? input.descriptiveTerm.trim() : '';
  if (!name || name.length > 120 || descriptiveTerm.length > 80 || !ENVIRONMENTS.includes(environment) || !LAYOUTS.includes(layout)) return null;
  return { name, environment, layout, descriptiveTerm };
}

spacesRouter.get('/', async (req, res) => res.json(await getCollection(req.params.buildingId, 'spaces')));

spacesRouter.post('/', requireAdmin, async (req, res) => {
  const value = cleanSpace(req.body || {});
  if (!value) return res.status(400).json({ error: 'Provide a space name (up to 120 characters), valid environment/layout, and descriptive term up to 80 characters.' });
  const spaces = await getCollection(req.params.buildingId, 'spaces');
  const space = { id: nextId('space'), ...value };
  await saveCollection(req.params.buildingId, 'spaces', [...spaces, space]);
  res.status(201).json(space);
});

// Bulk assignment validates every selection before making any writes.
spacesRouter.post('/assign', requireAdmin, async (req, res) => {
  const { nodeIds = [], landmarkIds = [], spaceId = null } = req.body || {};
  if (![nodeIds, landmarkIds].every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'))) {
    return res.status(400).json({ error: 'Select waypoints or landmarks to assign.' });
  }
  const buildingId = req.params.buildingId;
  const [spaces, nodes, landmarks, edges] = await Promise.all(['spaces', 'nodes', 'landmarks', 'edges'].map((name) => getCollection(buildingId, name)));
  const error = validateAssignment({ spaceId }, spaces);
  if (error) return res.status(400).json({ error });
  if (nodeIds.some((id) => !nodes.some((n) => n.id === id)) || landmarkIds.some((id) => !landmarks.some((l) => l.id === id))) return res.status(400).json({ error: 'Unknown selected item' });
  if (nodes.some((node) => nodeIds.includes(node.id) && node.boundarySpaceIds?.length)) return res.status(400).json({ error: 'Edit boundary waypoints individually to preserve their two sides.' });
  const changed = new Set(nodeIds);
  const updatedNodes = nodes.map((node) => changed.has(node.id) ? { ...node, spaceId } : node);
  if (nodeIds.length) {
    await saveCollection(buildingId, 'nodes', updatedNodes);
    await saveCollection(buildingId, 'edges', reconcileSpaceEdges(updatedNodes, edges, changed));
  }
  if (landmarkIds.length) await saveCollection(buildingId, 'landmarks', landmarks.map((landmark) => landmarkIds.includes(landmark.id) ? { ...landmark, spaceId } : landmark));
  res.json({ ok: true });
});

spacesRouter.put('/:spaceId', requireAdmin, async (req, res) => {
  const spaces = await getCollection(req.params.buildingId, 'spaces');
  const index = spaces.findIndex((space) => space.id === req.params.spaceId);
  if (index < 0) return res.status(404).json({ error: 'Space not found' });
  const value = cleanSpace({ ...spaces[index], ...req.body });
  if (!value) return res.status(400).json({ error: 'Invalid space name, environment, layout, or descriptive term' });
  spaces[index] = { id: spaces[index].id, ...value };
  await saveCollection(req.params.buildingId, 'spaces', spaces);
  res.json(spaces[index]);
});

spacesRouter.delete('/:spaceId', requireAdmin, async (req, res) => {
  const id = req.params.spaceId;
  const [spaces, nodes, edges, landmarks] = await Promise.all(['spaces', 'nodes', 'edges', 'landmarks'].map((name) => getCollection(req.params.buildingId, name)));
  if ([...nodes, ...edges, ...landmarks].some((item) => item.spaceId === id || item.boundarySpaceIds?.includes(id))) {
    return res.status(409).json({ error: 'Reassign items and boundaries using this space before deleting it.' });
  }
  await saveCollection(req.params.buildingId, 'spaces', spaces.filter((space) => space.id !== id));
  res.json({ ok: true });
});
