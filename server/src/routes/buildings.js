import { Router } from 'express';
import { getCollection, listBuildings, nextId, saveBuildingMetadata, saveBuildings, saveCollection } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const buildingsRouter = Router();

const COPY_COLLECTIONS = ['floors', 'nodes', 'edges', 'pois', 'landmarks', 'qrcodes'];
const BASE_URL = process.env.CLIENT_BASE_URL || 'http://localhost:5173';

function cleanClientName(value) {
  return String(value || '').trim();
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
  const { name, clientName } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const buildings = await listBuildings();
  const building = { id: nextId('bldg'), name: String(name).trim() };
  if (!building.name) return res.status(400).json({ error: 'name is required' });
  buildings.push(building);
  await saveBuildings(buildings);
  const metadata = { clientName: cleanClientName(clientName) };
  await saveBuildingMetadata(building.id, metadata);
  res.status(201).json({ ...building, ...metadata });
});

buildingsRouter.put('/:buildingId', requireAdmin, async (req, res) => {
  const { name, clientName } = req.body || {};
  const buildings = await listBuildings();
  const index = buildings.findIndex((b) => b.id === req.params.buildingId);
  if (index === -1) return res.status(404).json({ error: 'Building not found' });
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'name cannot be blank' });
    buildings[index] = { ...buildings[index], name: String(name).trim(), id: buildings[index].id };
  }
  await saveBuildings(buildings);
  if (clientName !== undefined) {
    await saveBuildingMetadata(req.params.buildingId, { clientName: cleanClientName(clientName) });
    buildings[index].clientName = cleanClientName(clientName);
  }
  res.json(buildings[index]);
});

buildingsRouter.post('/:buildingId/copy', requireAdmin, async (req, res) => {
  const buildings = await listBuildings();
  const source = buildings.find((b) => b.id === req.params.buildingId);
  if (!source) return res.status(404).json({ error: 'Building not found' });

  const { name, clientName } = req.body || {};
  const copiedBuilding = {
    id: nextId('bldg'),
    name: String(name || `${source.name} Copy`).trim(),
  };
  if (!copiedBuilding.name) return res.status(400).json({ error: 'name is required' });

  buildings.push(copiedBuilding);
  await saveBuildings(buildings);
  const metadata = { clientName: clientName === undefined ? source.clientName || '' : cleanClientName(clientName) };
  await saveBuildingMetadata(copiedBuilding.id, metadata);

  const collectionEntries = await Promise.all(
    COPY_COLLECTIONS.map(async (collectionName) => [collectionName, await getCollection(source.id, collectionName)]),
  );
  const copiedCollections = copyCollections(copiedBuilding.id, Object.fromEntries(collectionEntries));
  await Promise.all(COPY_COLLECTIONS.map((collectionName) => saveCollection(copiedBuilding.id, collectionName, copiedCollections[collectionName])));

  res.status(201).json({ ...copiedBuilding, ...metadata });
});

buildingsRouter.delete('/:buildingId', requireAdmin, async (req, res) => {
  const buildings = await listBuildings();
  const filtered = buildings.filter((b) => b.id !== req.params.buildingId);
  await saveBuildings(filtered);
  res.json({ ok: true });
});
