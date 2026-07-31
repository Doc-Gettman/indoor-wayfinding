import { Router } from 'express';
import { getCollection, saveCollection, nextId } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const edgesRouter = Router({ mergeParams: true });

const MANUAL_EDGE_TYPES = new Set(['hallway', 'door']);

function pixelDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

edgesRouter.get('/', async (req, res) => {
  res.json(await getCollection(req.params.buildingId, 'edges'));
});

edgesRouter.post('/', requireAdmin, async (req, res) => {
  const { from, to, type } = req.body || {};
  if (!from || !to || !MANUAL_EDGE_TYPES.has(type)) {
    return res.status(400).json({ error: `from, to, and type (one of: ${[...MANUAL_EDGE_TYPES].join(', ')}) are required` });
  }
  const nodes = await getCollection(req.params.buildingId, 'nodes');
  const fromNode = nodes.find((n) => n.id === from);
  const toNode = nodes.find((n) => n.id === to);
  if (!fromNode || !toNode) return res.status(404).json({ error: 'from/to node not found' });
  if (fromNode.floorId !== toNode.floorId) {
    return res.status(400).json({ error: 'Manual edges must connect nodes on the same floor' });
  }

  const edges = await getCollection(req.params.buildingId, 'edges');
  const edge = { id: nextId('edge'), from, to, type, weight: pixelDistance(fromNode, toNode) };
  edges.push(edge);
  await saveCollection(req.params.buildingId, 'edges', edges);
  res.status(201).json(edge);
});

edgesRouter.delete('/:edgeId', requireAdmin, async (req, res) => {
  const edges = await getCollection(req.params.buildingId, 'edges');
  const filtered = edges.filter((e) => e.id !== req.params.edgeId);
  await saveCollection(req.params.buildingId, 'edges', filtered);
  res.json({ ok: true });
});
