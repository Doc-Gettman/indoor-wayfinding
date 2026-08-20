import { Router } from 'express';
import { getCollection, saveCollection, nextId } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const poisRouter = Router({ mergeParams: true });

poisRouter.get('/', async (req, res) => {
  res.json(await getCollection(req.params.buildingId, 'pois'));
});

poisRouter.post('/', requireAdmin, async (req, res) => {
  const { nodeId, name, description, destinationTypeId } = req.body || {};
  if (!nodeId || !name) return res.status(400).json({ error: 'nodeId and name are required' });
  const nodes = await getCollection(req.params.buildingId, 'nodes');
  if (!nodes.some((n) => n.id === nodeId)) return res.status(404).json({ error: 'Node not found' });
  const cleanDestinationTypeId = destinationTypeId || null;
  if (cleanDestinationTypeId) {
    const destinationTypes = await getCollection(req.params.buildingId, 'destinationTypes');
    if (!destinationTypes.some((type) => type.id === cleanDestinationTypeId)) {
      return res.status(400).json({ error: 'Unknown destination type' });
    }
  }

  const pois = await getCollection(req.params.buildingId, 'pois');
  const poi = { id: nextId('poi'), nodeId, name, description: description || '', destinationTypeId: cleanDestinationTypeId };
  pois.push(poi);
  await saveCollection(req.params.buildingId, 'pois', pois);
  res.status(201).json(poi);
});

poisRouter.put('/:poiId', requireAdmin, async (req, res) => {
  const pois = await getCollection(req.params.buildingId, 'pois');
  const index = pois.findIndex((p) => p.id === req.params.poiId);
  if (index === -1) return res.status(404).json({ error: 'POI not found' });
  const patch = { ...req.body };
  if ('destinationTypeId' in patch) {
    patch.destinationTypeId = patch.destinationTypeId || null;
    if (patch.destinationTypeId) {
      const destinationTypes = await getCollection(req.params.buildingId, 'destinationTypes');
      if (!destinationTypes.some((type) => type.id === patch.destinationTypeId)) {
        return res.status(400).json({ error: 'Unknown destination type' });
      }
    }
  }
  pois[index] = { ...pois[index], ...patch, id: pois[index].id };
  await saveCollection(req.params.buildingId, 'pois', pois);
  res.json(pois[index]);
});

poisRouter.delete('/:poiId', requireAdmin, async (req, res) => {
  const pois = await getCollection(req.params.buildingId, 'pois');
  const filtered = pois.filter((p) => p.id !== req.params.poiId);
  await saveCollection(req.params.buildingId, 'pois', filtered);
  res.json({ ok: true });
});
