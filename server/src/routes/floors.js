import { Router } from 'express';
import path from 'node:path';
import { getCollection, saveCollection, nextId } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { ALLOWED_IMAGE_TYPES, createImageUploadUrl, removeStorageImage, storagePathFromImageUrl } from '../lib/storage.js';

export const floorsRouter = Router({ mergeParams: true });

floorsRouter.get('/', async (req, res) => {
  res.json(await getCollection(req.params.buildingId, 'floors'));
});

floorsRouter.post('/', requireAdmin, async (req, res) => {
  const { name, pixelsPerFoot, sortOrder } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const floors = await getCollection(req.params.buildingId, 'floors');
  const floor = {
    id: nextId('floor'),
    name,
    pixelsPerFoot: pixelsPerFoot || null,
    imagePath: null,
    sortOrder: sortOrder === undefined || sortOrder === null || sortOrder === '' ? null : Number(sortOrder),
  };
  floors.push(floor);
  await saveCollection(req.params.buildingId, 'floors', floors);
  res.status(201).json(floor);
});

floorsRouter.put('/:floorId', requireAdmin, async (req, res) => {
  const floors = await getCollection(req.params.buildingId, 'floors');
  const index = floors.findIndex((f) => f.id === req.params.floorId);
  if (index === -1) return res.status(404).json({ error: 'Floor not found' });
  floors[index] = { ...floors[index], ...req.body, id: floors[index].id };
  await saveCollection(req.params.buildingId, 'floors', floors);
  res.json(floors[index]);
});

floorsRouter.delete('/:floorId', requireAdmin, async (req, res) => {
  const floors = await getCollection(req.params.buildingId, 'floors');
  const filtered = floors.filter((f) => f.id !== req.params.floorId);
  await saveCollection(req.params.buildingId, 'floors', filtered);
  res.json({ ok: true });
});

floorsRouter.post('/:floorId/image-upload-url', requireAdmin, async (req, res) => {
  const { contentType, extension } = req.body || {};
  if (!contentType || !ALLOWED_IMAGE_TYPES.test(contentType)) {
    return res.status(400).json({ error: 'Only PNG, JPEG, or WEBP images are allowed' });
  }
  const ext = extension || path.extname(contentType).replace('image/', '.') || '.png';
  const storagePath = `buildings/${req.params.buildingId}/floors/${req.params.floorId}${ext}`;
  try {
    res.json(await createImageUploadUrl(storagePath));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

floorsRouter.post('/:floorId/image', requireAdmin, async (req, res) => {
  const { imagePath } = req.body || {};
  if (!imagePath) return res.status(400).json({ error: 'imagePath is required' });
  const floors = await getCollection(req.params.buildingId, 'floors');
  const index = floors.findIndex((f) => f.id === req.params.floorId);
  if (index === -1) return res.status(404).json({ error: 'Floor not found' });
  const previousImagePath = floors[index].imagePath;
  floors[index] = { ...floors[index], imagePath };
  await saveCollection(req.params.buildingId, 'floors', floors);
  if (previousImagePath && storagePathFromImageUrl(previousImagePath) !== storagePathFromImageUrl(imagePath)) {
    await removeStorageImage(previousImagePath).catch(() => {});
  }
  res.json(floors[index]);
});

floorsRouter.delete('/:floorId/image', requireAdmin, async (req, res) => {
  const floors = await getCollection(req.params.buildingId, 'floors');
  const index = floors.findIndex((f) => f.id === req.params.floorId);
  if (index === -1) return res.status(404).json({ error: 'Floor not found' });
  const { imagePath } = floors[index];
  floors[index] = { ...floors[index], imagePath: null };
  await saveCollection(req.params.buildingId, 'floors', floors);
  if (imagePath) {
    await removeStorageImage(imagePath).catch(() => {});
  }
  res.json(floors[index]);
});
