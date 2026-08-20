import { Router } from 'express';
import { getCollection, saveCollection, nextId } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const destinationTypesRouter = Router({ mergeParams: true });

function cleanName(value) {
  return String(value || '').trim();
}

function findDuplicate(types, name, excludeId) {
  return types.find((type) => type.id !== excludeId && type.name.toLowerCase() === name.toLowerCase());
}

destinationTypesRouter.get('/', async (req, res) => {
  const types = await getCollection(req.params.buildingId, 'destinationTypes');
  res.json(types.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
});

destinationTypesRouter.post('/', requireAdmin, async (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'name is required' });
  const types = await getCollection(req.params.buildingId, 'destinationTypes');
  if (findDuplicate(types, name)) return res.status(409).json({ error: 'A destination type with this name already exists' });
  const type = { id: nextId('destination-type'), name };
  types.push(type);
  await saveCollection(req.params.buildingId, 'destinationTypes', types);
  res.status(201).json(type);
});

destinationTypesRouter.put('/:typeId', requireAdmin, async (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'name is required' });
  const types = await getCollection(req.params.buildingId, 'destinationTypes');
  const index = types.findIndex((type) => type.id === req.params.typeId);
  if (index === -1) return res.status(404).json({ error: 'Destination type not found' });
  if (findDuplicate(types, name, req.params.typeId)) {
    return res.status(409).json({ error: 'A destination type with this name already exists' });
  }
  types[index] = { ...types[index], name };
  await saveCollection(req.params.buildingId, 'destinationTypes', types);
  res.json(types[index]);
});

destinationTypesRouter.delete('/:typeId', requireAdmin, async (req, res) => {
  const types = await getCollection(req.params.buildingId, 'destinationTypes');
  const filtered = types.filter((type) => type.id !== req.params.typeId);
  if (filtered.length === types.length) return res.status(404).json({ error: 'Destination type not found' });
  await saveCollection(req.params.buildingId, 'destinationTypes', filtered);

  const pois = await getCollection(req.params.buildingId, 'pois');
  const updatedPois = pois.map((poi) =>
    poi.destinationTypeId === req.params.typeId ? { ...poi, destinationTypeId: null } : poi,
  );
  await saveCollection(req.params.buildingId, 'pois', updatedPois);
  res.json({ ok: true });
});
