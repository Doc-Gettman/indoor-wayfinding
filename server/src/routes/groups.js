import { Router } from 'express';
import { getBuildingMetadata, listBuildings, listGroups, nextId, saveBuildingMetadata, saveGroups } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const groupsRouter = Router();

function cleanName(value) {
  return String(value || '').trim();
}

function findDuplicate(groups, name, excludeId) {
  return groups.find((g) => g.id !== excludeId && g.name.toLowerCase() === name.toLowerCase());
}

groupsRouter.get('/', async (req, res) => {
  res.json(await listGroups());
});

groupsRouter.post('/', requireAdmin, async (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'name is required' });
  const groups = await listGroups();
  if (findDuplicate(groups, name)) return res.status(409).json({ error: 'A group with this name already exists' });
  const group = { id: nextId('group'), name };
  groups.push(group);
  await saveGroups(groups);
  res.status(201).json(group);
});

groupsRouter.put('/:groupId', requireAdmin, async (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'name is required' });
  const groups = await listGroups();
  const index = groups.findIndex((g) => g.id === req.params.groupId);
  if (index === -1) return res.status(404).json({ error: 'Group not found' });
  if (findDuplicate(groups, name, req.params.groupId)) {
    return res.status(409).json({ error: 'A group with this name already exists' });
  }
  groups[index] = { ...groups[index], name };
  await saveGroups(groups);
  res.json(groups[index]);
});

groupsRouter.delete('/:groupId', requireAdmin, async (req, res) => {
  const groups = await listGroups();
  const filtered = groups.filter((g) => g.id !== req.params.groupId);
  await saveGroups(filtered);

  const buildings = await listBuildings();
  await Promise.all(
    buildings
      .filter((b) => b.groupId === req.params.groupId)
      .map(async (b) => {
        const metadata = await getBuildingMetadata(b.id);
        await saveBuildingMetadata(b.id, { ...metadata, groupId: null });
      }),
  );

  res.json({ ok: true });
});
