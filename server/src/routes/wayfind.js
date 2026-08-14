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

const ORDINAL_ONES = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 };
const ORDINAL_TEENS = {
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14,
  fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
};
const ORDINAL_TENS = { twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90 };
const CARDINAL_TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Handles floor names that spell the ordinal out ("Twelfth Floor",
// "Twenty-Third Floor") instead of using a digit ("12th Floor") — common
// enough in real building signage that the digit regex below alone misses a
// building's entire floor set.
function parseOrdinalWords(text) {
  const words = text.replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word in ORDINAL_ONES) return ORDINAL_ONES[word];
    if (word in ORDINAL_TEENS) return ORDINAL_TEENS[word];
    if (word in ORDINAL_TENS) return ORDINAL_TENS[word];
    if (word in CARDINAL_TENS && words[i + 1] in ORDINAL_ONES) return CARDINAL_TENS[word] + ORDINAL_ONES[words[i + 1]];
  }
  return null;
}

function floorSortValue(floor, fallbackId) {
  const raw = String(floor?.sortOrder ?? floor?.level ?? floor?.name ?? fallbackId ?? '');
  const lower = raw.toLowerCase();
  if (lower.includes('ground') || lower.includes('lobby')) return 0;
  const match = lower.match(/-?\d+(\.\d+)?/);
  if (match) {
    const value = Number(match[0]);
    return lower.includes('basement') || lower.startsWith('b') ? -Math.abs(value) : value;
  }
  const ordinal = parseOrdinalWords(lower);
  if (ordinal !== null) return lower.includes('basement') ? -ordinal : ordinal;
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
  if (seconds < 15) {
    return 'Estimated travel time: just a few seconds.';
  }
  if (seconds <= 60) {
    const roundedSeconds = Math.round(seconds / 10) * 10;
    if (roundedSeconds < 60) {
      return `Estimated travel time: about ${roundedSeconds} seconds.`;
    }
    // Falls through to "about a minute" below rather than saying "60 seconds".
  }
  // Round to the nearest half-minute so longer trips still read as a round,
  // spoken-out-loud number ("a minute and a half") instead of exact seconds.
  const halfMinutes = Math.max(2, Math.round(seconds / 30));
  const minutes = Math.floor(halfMinutes / 2);
  const hasHalf = halfMinutes % 2 === 1;
  let phrase;
  if (minutes === 1) {
    phrase = hasHalf ? 'a minute and a half' : 'a minute';
  } else {
    phrase = hasHalf ? `${minutes} and a half minutes` : `${minutes} minutes`;
  }
  return `Estimated travel time: about ${phrase}.`;
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

  const floorsById = new Map(floors.map((f) => [f.id, f]));

  const result = findShortestPath(nodes, edges, from, destinationPoi.nodeId, floorsById);
  if (!result) return res.status(404).json({ error: 'No route found between the given locations' });

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
