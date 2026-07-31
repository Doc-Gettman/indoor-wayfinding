import { Router } from 'express';
import { getCollection, saveCollection, nextId } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const poisRouter = Router({ mergeParams: true });

poisRouter.get('/', async (req, res) => {
  res.json(await getCollection(req.params.buildingId, 'pois'));
});

poisRouter.post('/', requireAdmin, async (req, res) => {
  const { nodeId, name, description } = req.body || {};
  if (!nodeId || !name) return res.status(400).json({ error: 'nodeId and name are required' });
  const nodes = await getCollection(req.params.buildingId, 'nodes');
  if (!nodes.some((n) => n.id === nodeId)) return res.status(404).json({ error: 'Node not found' });

  const pois = await getCollection(req.params.buildingId, 'pois');
  const poi = { id: nextId('poi'), nodeId, name, description: description || '' };
  pois.push(poi);
  await saveCollection(req.params.buildingId, 'pois', pois);
  res.status(201).json(poi);
});

poisRouter.put('/:poiId', requireAdmin, async (req, res) => {
  const pois = await getCollection(req.params.buildingId, 'pois');
  const index = pois.findIndex((p) => p.id === req.params.poiId);
  if (index === -1) return res.status(404).json({ error: 'POI not found' });
  pois[index] = { ...pois[index], ...req.body, id: pois[index].id };
  await saveCollection(req.params.buildingId, 'pois', pois);
  res.json(pois[index]);
});

poisRouter.delete('/:poiId', requireAdmin, async (req, res) => {
  const pois = await getCollection(req.params.buildingId, 'pois');
  const filtered = pois.filter((p) => p.id !== req.params.poiId);
  await saveCollection(req.params.buildingId, 'pois', filtered);
  res.json({ ok: true });
});
