import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { getCollection, saveCollection, buildingImagesDir, nextId } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const floorsRouter = Router({ mergeParams: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        cb(null, await buildingImagesDir(req.params.buildingId));
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      cb(null, `${req.params.floorId}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) {
      return cb(new Error('Only PNG, JPEG, or WEBP images are allowed'));
    }
    cb(null, true);
  },
});

floorsRouter.get('/', async (req, res) => {
  res.json(await getCollection(req.params.buildingId, 'floors'));
});

floorsRouter.post('/', requireAdmin, async (req, res) => {
  const { name, pixelsPerFoot } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const floors = await getCollection(req.params.buildingId, 'floors');
  const floor = { id: nextId('floor'), name, pixelsPerFoot: pixelsPerFoot || null, imagePath: null };
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

floorsRouter.post('/:floorId/image', requireAdmin, upload.single('image'), async (req, res) => {
  const floors = await getCollection(req.params.buildingId, 'floors');
  const index = floors.findIndex((f) => f.id === req.params.floorId);
  if (index === -1) return res.status(404).json({ error: 'Floor not found' });
  const relativePath = `/images/buildings/${req.params.buildingId}/floors/${req.file.filename}`;
  floors[index] = { ...floors[index], imagePath: relativePath };
  await saveCollection(req.params.buildingId, 'floors', floors);
  res.json(floors[index]);
});
