import { Router } from 'express';
import { getCollection, saveCollection, nextId } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const landmarksRouter = Router({ mergeParams: true });

// Landmarks are visual reference points ("the glass doors with the Kimley-Horn
// logo", "the sign that says Radiology") used to make generated directions
// sound natural. They are not part of the routing graph — no edges, no
// nodeType — just a labeled point on a floor that direction generation can
// reference when it's near a path segment.

landmarksRouter.get('/', async (req, res) => {
  res.json(await getCollection(req.params.buildingId, 'landmarks'));
});

landmarksRouter.post('/', requireAdmin, async (req, res) => {
  const { floorId, x, y, name, description, visibilityRadiusFeet } = req.body || {};
  if (!floorId || x === undefined || y === undefined) {
    return res.status(400).json({ error: 'floorId, x, and y are required' });
  }
  const landmarks = await getCollection(req.params.buildingId, 'landmarks');
  const landmark = {
    id: nextId('landmark'),
    floorId,
    x,
    y,
    name: name || '',
    description: description || '',
    visibilityRadiusFeet: Math.max(1, Number(visibilityRadiusFeet) || 30),
  };
  landmarks.push(landmark);
  await saveCollection(req.params.buildingId, 'landmarks', landmarks);
  res.status(201).json(landmark);
});

landmarksRouter.put('/:landmarkId', requireAdmin, async (req, res) => {
  const landmarks = await getCollection(req.params.buildingId, 'landmarks');
  const index = landmarks.findIndex((l) => l.id === req.params.landmarkId);
  if (index === -1) return res.status(404).json({ error: 'Landmark not found' });
  landmarks[index] = { ...landmarks[index], ...req.body, id: landmarks[index].id };
  await saveCollection(req.params.buildingId, 'landmarks', landmarks);
  res.json(landmarks[index]);
});

landmarksRouter.delete('/:landmarkId', requireAdmin, async (req, res) => {
  const landmarks = await getCollection(req.params.buildingId, 'landmarks');
  const filtered = landmarks.filter((l) => l.id !== req.params.landmarkId);
  await saveCollection(req.params.buildingId, 'landmarks', filtered);
  res.json({ ok: true });
});
