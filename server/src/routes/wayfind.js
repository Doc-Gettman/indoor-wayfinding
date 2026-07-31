import { Router } from 'express';
import { getCollection } from '../db.js';
import { findShortestPath } from '../lib/dijkstra.js';
import { generateDirections } from '../lib/directions.js';
import { generateLLMDirections } from '../lib/llmDirections.js';

export const wayfindRouter = Router({ mergeParams: true });

// GET /buildings/:buildingId/wayfind?from=<nodeId>&to=<poiId>
wayfindRouter.get('/', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from (node id) and to (poi id) query params are required' });

  const buildingId = req.params.buildingId;
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
      pois,
      floorsById,
      landmarks,
    });

  res.json({
    instructions,
    generatedBy: llmInstructions ? 'llm' : 'rules',
    destination: destinationPoi,
    floorsCrossed: [...new Set(result.nodes.map((n) => n.floorId))],
  });
});
