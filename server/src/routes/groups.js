import { Router } from 'express';
import { getBuildingMetadata, listBuildings, listGroups, nextId, saveBuildingMetadata, saveGroups } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { ALLOWED_IMAGE_TYPES, createImageUploadUrl, removeStorageImage, storagePathFromImageUrl } from '../lib/storage.js';
import { DEFAULT_GROUP_SPLASH, SPLASH_DURATION_MAX, SPLASH_DURATION_MIN, SPLASH_TEXT_MAX_LENGTH } from '../lib/splash.js';

export const groupsRouter = Router();

// Custom splash screen shown to visitors right after scanning a QR code in
// any building of the group (in place of the default GoldenKey splash).
// Buildings can override the text — see lib/splash.js.
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const DEFAULT_SPLASH = DEFAULT_GROUP_SPLASH;

// Express 4 doesn't forward rejected promises from async handlers.
const handle = (fn) => (req, res, next) => fn(req, res).catch(next);

async function loadGroup(groupId) {
  const groups = await listGroups();
  const index = groups.findIndex((g) => g.id === groupId);
  return { groups, index, group: groups[index] };
}

async function saveSplash(groups, index, splash) {
  groups[index] = { ...groups[index], splash: { ...DEFAULT_SPLASH, ...groups[index].splash, ...splash } };
  await saveGroups(groups);
  return groups[index];
}

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

// PUT /groups/:groupId/splash  { text, backgroundColor, durationSeconds }
groupsRouter.put(
  '/:groupId/splash',
  requireAdmin,
  handle(async (req, res) => {
    const { groups, index } = await loadGroup(req.params.groupId);
    if (index === -1) return res.status(404).json({ error: 'Group not found' });
    const { text, backgroundColor, durationSeconds } = req.body || {};
    const update = {};
    if (text !== undefined) {
      const cleaned = String(text ?? '').replace(/\r\n/g, '\n').trim();
      if (cleaned.length > SPLASH_TEXT_MAX_LENGTH) {
        return res.status(400).json({ error: `Splash text must be ${SPLASH_TEXT_MAX_LENGTH} characters or fewer` });
      }
      update.text = cleaned;
    }
    if (backgroundColor !== undefined) {
      if (!HEX_COLOR.test(String(backgroundColor))) return res.status(400).json({ error: 'backgroundColor must be a #rrggbb color' });
      update.backgroundColor = String(backgroundColor).toLowerCase();
    }
    if (durationSeconds !== undefined) {
      const seconds = Number(durationSeconds);
      if (!Number.isFinite(seconds) || seconds < SPLASH_DURATION_MIN || seconds > SPLASH_DURATION_MAX) {
        return res.status(400).json({ error: `durationSeconds must be between ${SPLASH_DURATION_MIN} and ${SPLASH_DURATION_MAX}` });
      }
      update.durationSeconds = Math.round(seconds * 2) / 2;
    }
    res.json(await saveSplash(groups, index, update));
  }),
);

// POST /groups/:groupId/splash-image-upload-url  { contentType, extension }
// Each upload gets a unique path so phones never show a cached old image.
groupsRouter.post(
  '/:groupId/splash-image-upload-url',
  requireAdmin,
  handle(async (req, res) => {
    const { group } = await loadGroup(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const { contentType, extension } = req.body || {};
    if (!contentType || !ALLOWED_IMAGE_TYPES.test(contentType)) {
      return res.status(400).json({ error: 'Only PNG, JPEG, or WEBP images are allowed' });
    }
    const ext = /^\.(png|jpe?g|webp)$/i.test(String(extension || '')) ? extension.toLowerCase() : `.${contentType.split('/')[1]}`;
    res.json(await createImageUploadUrl(`groups/${group.id}/splash-${Date.now()}${ext}`));
  }),
);

// POST /groups/:groupId/splash-image  { imageUrl } — called after the browser
// finishes uploading to the signed URL.
groupsRouter.post(
  '/:groupId/splash-image',
  requireAdmin,
  handle(async (req, res) => {
    const { groups, index, group } = await loadGroup(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const imageUrl = String(req.body?.imageUrl || '');
    // Only accept images uploaded to this group's own storage folder, never an
    // arbitrary URL that would then be shown to every visitor.
    if (!storagePathFromImageUrl(imageUrl)?.startsWith(`groups/${group.id}/`)) {
      return res.status(400).json({ error: 'imageUrl must be an uploaded splash image for this group' });
    }
    const previous = group.splash?.imageUrl;
    const updated = await saveSplash(groups, index, { imageUrl });
    if (previous && previous !== imageUrl) await removeStorageImage(previous).catch(() => {});
    res.json(updated);
  }),
);

groupsRouter.delete(
  '/:groupId/splash-image',
  requireAdmin,
  handle(async (req, res) => {
    const { groups, index, group } = await loadGroup(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const previous = group.splash?.imageUrl;
    const updated = await saveSplash(groups, index, { imageUrl: null });
    if (previous) await removeStorageImage(previous).catch(() => {});
    res.json(updated);
  }),
);

groupsRouter.delete('/:groupId', requireAdmin, async (req, res) => {
  const groups = await listGroups();
  const filtered = groups.filter((g) => g.id !== req.params.groupId);
  await saveGroups(filtered);
  const deletedSplashImage = groups.find((g) => g.id === req.params.groupId)?.splash?.imageUrl;
  if (deletedSplashImage) await removeStorageImage(deletedSplashImage).catch(() => {});

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
