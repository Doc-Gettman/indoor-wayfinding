import { Router } from 'express';
import { getCollection } from '../db.js';
import { findShortestPath } from '../lib/dijkstra.js';
import { generateDirections } from '../lib/directions.js';
import { generateLLMDirections } from '../lib/llmDirections.js';
import { getCachedRoute, setCachedRoute } from '../lib/routeCache.js';

export const wayfindRouter = Router({ mergeParams: true });

const ROUTING_VERSION = 11;
const DEFAULT_PIXELS_PER_FOOT = 10;
const WALKING_FEET_PER_SECOND = 3;
const ELEVATOR_BASE_SECONDS = 45;
const ELEVATOR_SECONDS_PER_FLOOR = 8;
const STAIRS_BASE_SECONDS = 20;
const STAIRS_SECONDS_PER_FLOOR = 18;

function floorSortValue(floor, fallbackId) {
  const raw = String(floor?.sortOrder ?? floor?.level ?? floor?.name ?? fallbackId ?? '');
  const lower = raw.toLowerCase();
  const match = lower.match(/-?\d+(\.\d+)?/);
  if (match) {
    const value = Number(match[0]);
    return lower.includes('basement') || lower.startsWith('b') ? -Math.abs(value) : value;
  }
  if (lower.includes('ground') || lower.includes('lobby')) return 0;
  return null;
}

function floorDelta(fromFloor, toFloor, fromFloorId, toFloorId) {
  const fromValue = floorSortValue(fromFloor, fromFloorId);
  const toValue = floorSortValue(toFloor, toFloorId);
  if (fromValue === null || toValue === null) return 1;
  return Math.max(1, Math.abs(toValue - fromValue));
}

function estimateTravelSeconds(pathNodes, pathEdges, floorsById) {
  let seconds = 0;

  for (let i = 0; i < pathEdges.length; i += 1) {
    const edge = pathEdges[i];
    const from = pathNodes[i];
    const to = pathNodes[i + 1];
    if (!from || !to) continue;

    if ((edge.type === 'elevator' || edge.type === 'stairs') && from.floorId !== to.floorId) {
      const delta = floorDelta(floorsById.get(from.floorId), floorsById.get(to.floorId), from.floorId, to.floorId);
      seconds += edge.type === 'elevator'
        ? ELEVATOR_BASE_SECONDS + delta * ELEVATOR_SECONDS_PER_FLOOR
        : STAIRS_BASE_SECONDS + delta * STAIRS_SECONDS_PER_FLOOR;
      continue;
    }

    const floor = floorsById.get(from.floorId);
    const pixelsPerFoot = floor?.pixelsPerFoot || DEFAULT_PIXELS_PER_FOOT;
    const feet = Math.hypot(to.x - from.x, to.y - from.y) / pixelsPerFoot;
    seconds += feet / WALKING_FEET_PER_SECOND;
  }

  return seconds;
}

function travelTimeText(seconds) {
  if (seconds < 60) {
    return 'Estimated travel time: it just takes a few seconds.';
  }
  const minutes = Math.round(seconds / 60);
  return `Estimated travel time: about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

function buildRouteMap(pathNodes, floorsById) {
  const floorSegments = [];
  let current = null;

  for (const node of pathNodes) {
    if (!current || current.floorId !== node.floorId) {
      current = { floorId: node.floorId, points: [] };
      floorSegments.push(current);
    }
    current.points.push({ id: node.id, x: node.x, y: node.y });
  }

  return floorSegments
    .map((segment, index) => {
      const floor = floorsById.get(segment.floorId);
      return {
        floorId: segment.floorId,
        floorName: floor?.name || segment.floorId,
        imagePath: floor?.imagePath || null,
        segmentIndex: index,
        points: segment.points,
      };
    })
    .filter((segment) => segment.imagePath && segment.points.length > 0);
}

// GET /buildings/:buildingId/wayfind?from=<nodeId>&to=<poiId>
wayfindRouter.get('/', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from (node id) and to (poi id) query params are required' });

  const buildingId = req.params.buildingId;

  const cached = getCachedRoute(buildingId, from, to);
  if (cached?.routeMap && cached.routingVersion === ROUTING_VERSION) return res.json(cached);

  const [nodes, edges, pois, floors, landmarks, qrcodes] = await Promise.all([
    getCollection(buildingId, 'nodes'),
    getCollection(buildingId, 'edges'),
    getCollection(buildingId, 'pois'),
    getCollection(buildingId, 'floors'),
    getCollection(buildingId, 'landmarks'),
    getCollection(buildingId, 'qrcodes'),
  ]);

  const destinationPoi = pois.find((p) => p.id === to);
  if (!destinationPoi) return res.status(404).json({ error: 'Destination POI not found' });
  const originQrCode = qrcodes.find((qr) => qr.originNodeId === from) || null;
  const originNode = nodes.find((node) => node.id === from) || null;

  const result = findShortestPath(nodes, edges, from, destinationPoi.nodeId);
  if (!result) return res.status(404).json({ error: 'No route found between the given locations' });

  const floorsById = new Map(floors.map((f) => [f.id, f]));

  const llmInstructions = await generateLLMDirections({
    pathNodes: result.nodes,
    pathEdges: result.edges,
    allEdges: edges,
    allNodes: nodes,
    floorsById,
    landmarks,
    destination: destinationPoi,
    origin: originNode
      ? {
          label: originQrCode?.label || originNode.label || '',
          nodeType: originNode.nodeType,
          nodeLabel: originNode.label || '',
        }
      : null,
  });
  const instructions =
    llmInstructions ||
    generateDirections({
      pathNodes: result.nodes,
      pathEdges: result.edges,
      allEdges: edges,
      allNodes: nodes,
      pois,
      floorsById,
      landmarks,
    });
  const estimatedTravelSeconds = estimateTravelSeconds(result.nodes, result.edges, floorsById);
  const instructionsWithTravelTime = [...instructions, travelTimeText(estimatedTravelSeconds)];

  const payload = {
    instructions: instructionsWithTravelTime,
    estimatedTravelSeconds: Math.round(estimatedTravelSeconds),
    generatedBy: llmInstructions ? 'llm' : 'rules',
    routingVersion: ROUTING_VERSION,
    destination: destinationPoi,
    floorsCrossed: [...new Set(result.nodes.map((n) => n.floorId))],
    routeMap: buildRouteMap(result.nodes, floorsById),
  };
  setCachedRoute(buildingId, from, to, payload);
  res.json(payload);
});
