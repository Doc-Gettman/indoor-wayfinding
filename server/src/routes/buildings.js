import { Router } from 'express';
import { getCollection, listBuildings, listGroups, nextId, saveBuildingMetadata, saveBuildings, saveCollection } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const buildingsRouter = Router();

const COPY_COLLECTIONS = ['floors', 'nodes', 'edges', 'pois', 'landmarks', 'qrcodes'];
const BASE_URL = process.env.CLIENT_BASE_URL || 'http://localhost:5173';

function cleanGroupId(value) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

// groupId is chosen from a dropdown of existing groups client-side, but
// verify server-side too rather than trusting an arbitrary id was posted.
async function resolveGroupId(value) {
  const groupId = cleanGroupId(value);
  if (!groupId) return { groupId: null };
  const groups = await listGroups();
  if (!groups.some((g) => g.id === groupId)) return { error: 'Unknown group' };
  return { groupId };
}

function wayfindUrl(buildingId, originNodeId) {
  return `${BASE_URL}/wayfind/${buildingId}?from=${originNodeId}`;
}

function remapRef(id, map) {
  return id ? map.get(id) || id : id;
}

function copyCollections(targetBuildingId, collections) {
  const floorIdMap = new Map();
  const nodeIdMap = new Map();
  const transitionGroupIdMap = new Map();

  const floors = collections.floors.map((floor) => {
    const id = nextId('floor');
    floorIdMap.set(floor.id, id);
    return { ...floor, id };
  });

  const nodes = collections.nodes.map((node) => {
    const id = nextId('node');
    nodeIdMap.set(node.id, id);
    if (node.transitionGroupId && !transitionGroupIdMap.has(node.transitionGroupId)) {
      transitionGroupIdMap.set(node.transitionGroupId, nextId('transition-group'));
    }
    return {
      ...node,
      id,
      floorId: remapRef(node.floorId, floorIdMap),
      transitionGroupId: remapRef(node.transitionGroupId, transitionGroupIdMap),
    };
  });

  const edges = collections.edges.map((edge) => ({
    ...edge,
    id: nextId('edge'),
    from: remapRef(edge.from, nodeIdMap),
    to: remapRef(edge.to, nodeIdMap),
  }));

  const pois = collections.pois.map((poi) => ({
    ...poi,
    id: nextId('poi'),
    nodeId: remapRef(poi.nodeId, nodeIdMap),
  }));

  const landmarks = collections.landmarks.map((landmark) => ({
    ...landmark,
    id: nextId('landmark'),
    floorId: remapRef(landmark.floorId, floorIdMap),
  }));

  const qrcodes = collections.qrcodes.map((qr) => {
    const originNodeId = remapRef(qr.originNodeId, nodeIdMap);
    return {
      ...qr,
      id: nextId('qr'),
      originNodeId,
      url: wayfindUrl(targetBuildingId, originNodeId),
    };
  });

  return { floors, nodes, edges, pois, landmarks, qrcodes };
}

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
  const { name, groupId } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const resolved = await resolveGroupId(groupId);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  const buildings = await listBuildings();
  const building = { id: nextId('bldg'), name: String(name).trim() };
  if (!building.name) return res.status(400).json({ error: 'name is required' });
  buildings.push(building);
  await saveBuildings(buildings);
  const metadata = { groupId: resolved.groupId };
  await saveBuildingMetadata(building.id, metadata);
  const groups = await listGroups();
  const groupName = resolved.groupId ? groups.find((g) => g.id === resolved.groupId)?.name || null : null;
  res.status(201).json({ ...building, ...metadata, groupName });
});

buildingsRouter.put('/:buildingId', requireAdmin, async (req, res) => {
  const { name, groupId } = req.body || {};
  const buildings = await listBuildings();
  const index = buildings.findIndex((b) => b.id === req.params.buildingId);
  if (index === -1) return res.status(404).json({ error: 'Building not found' });
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'name cannot be blank' });
    buildings[index] = { ...buildings[index], name: String(name).trim(), id: buildings[index].id };
  }
  if (groupId !== undefined) {
    const resolved = await resolveGroupId(groupId);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    await saveBuildingMetadata(req.params.buildingId, { groupId: resolved.groupId });
    buildings[index].groupId = resolved.groupId;
    const groups = await listGroups();
    buildings[index].groupName = resolved.groupId ? groups.find((g) => g.id === resolved.groupId)?.name || null : null;
  }
  res.json(buildings[index]);
});

buildingsRouter.post('/:buildingId/copy', requireAdmin, async (req, res) => {
  const buildings = await listBuildings();
  const source = buildings.find((b) => b.id === req.params.buildingId);
  if (!source) return res.status(404).json({ error: 'Building not found' });

  const { name, groupId } = req.body || {};
  const copiedBuilding = {
    id: nextId('bldg'),
    name: String(name || `${source.name} Copy`).trim(),
  };
  if (!copiedBuilding.name) return res.status(400).json({ error: 'name is required' });

  let resolvedGroupId = source.groupId || null;
  if (groupId !== undefined) {
    const resolved = await resolveGroupId(groupId);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    resolvedGroupId = resolved.groupId;
  }

  buildings.push(copiedBuilding);
  await saveBuildings(buildings);
  const metadata = { groupId: resolvedGroupId };
  await saveBuildingMetadata(copiedBuilding.id, metadata);

  const collectionEntries = await Promise.all(
    COPY_COLLECTIONS.map(async (collectionName) => [collectionName, await getCollection(source.id, collectionName)]),
  );
  const copiedCollections = copyCollections(copiedBuilding.id, Object.fromEntries(collectionEntries));
  await Promise.all(COPY_COLLECTIONS.map((collectionName) => saveCollection(copiedBuilding.id, collectionName, copiedCollections[collectionName])));

  const groups = await listGroups();
  const groupName = resolvedGroupId ? groups.find((g) => g.id === resolvedGroupId)?.name || null : null;
  res.status(201).json({ ...copiedBuilding, ...metadata, groupName });
});

buildingsRouter.delete('/:buildingId', requireAdmin, async (req, res) => {
  const buildings = await listBuildings();
  const filtered = buildings.filter((b) => b.id !== req.params.buildingId);
  await saveBuildings(filtered);
  res.json({ ok: true });
});
