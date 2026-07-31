import { Router } from 'express';
import { listBuildings, saveBuildings, nextId } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const buildingsRouter = Router();

buildingsRouter.get('/', async (req, res) => {
  res.json(await listBuildings());
});

buildingsRouter.get('/:buildingId', async (req, res) => {
  const buildings = await listBuildings();
  const building = buildings.find((b) => b.id === req.params.buildingId);
  if (!building) return res.status(404).json({ error: 'Building not found' });
  res.json(building);
});

buildingsRouter.post('/', requireAdmin, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const buildings = await listBuildings();
  const building = { id: nextId('bldg'), name };
  buildings.push(building);
  await saveBuildings(buildings);
  res.status(201).json(building);
});

buildingsRouter.put('/:buildingId', requireAdmin, async (req, res) => {
  const buildings = await listBuildings();
  const index = buildings.findIndex((b) => b.id === req.params.buildingId);
  if (index === -1) return res.status(404).json({ error: 'Building not found' });
  buildings[index] = { ...buildings[index], ...req.body, id: buildings[index].id };
  await saveBuildings(buildings);
  res.json(buildings[index]);
});

buildingsRouter.delete('/:buildingId', requireAdmin, async (req, res) => {
  const buildings = await listBuildings();
  const filtered = buildings.filter((b) => b.id !== req.params.buildingId);
  await saveBuildings(filtered);
  res.json({ ok: true });
});
