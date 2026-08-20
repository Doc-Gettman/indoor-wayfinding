import { Router } from 'express';
import { getCollection, saveCollection, nextId } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { syncTransitionEdges, removeTransitionEdges } from '../lib/transitions.js';

export const nodesRouter = Router({ mergeParams: true });

function pixelDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function refreshAttachedManualEdgeWeights(nodes, edges, nodeId) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const isAttached = edge.from === nodeId || edge.to === nodeId;
    const isGeneratedTransitionEdge = Boolean(edge.transitionGroupId) || edge.generatedByTransitionGroup || edge.type === 'elevator' || edge.type === 'stairs';
    if (!isAttached || isGeneratedTransitionEdge) return edge;

    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to || from.floorId !== to.floorId) return edge;
    return { ...edge, weight: pixelDistance(from, to) };
  });
}

nodesRouter.get('/', async (req, res) => {
  res.json(await getCollection(req.params.buildingId, 'nodes'));
});

nodesRouter.post('/', requireAdmin, async (req, res) => {
  const {
    floorId,
    x,
    y,
    label,
    nodeType,
    transitionSubtype,
    transitionGroupId,
    transitionGroupName,
    transitionRequiresBadgeAccess,
    doorDescription,
    doorRequiresBadgeAccess,
    doorBadgeAccessFromNodeIds,
  } = req.body || {};
  if (!floorId || x === undefined || y === undefined) {
    return res.status(400).json({ error: 'floorId, x, and y are required' });
  }
  const nodes = await getCollection(req.params.buildingId, 'nodes');
  const node = {
    id: nextId('node'),
    floorId,
    x,
    y,
    label: label || '',
    nodeType: nodeType || 'waypoint',
    transitionSubtype: transitionSubtype || null,
    transitionGroupId: transitionGroupId || null,
    transitionGroupName: nodeType === 'transition' ? transitionGroupName || '' : null,
    transitionRequiresBadgeAccess: nodeType === 'transition' ? Boolean(transitionRequiresBadgeAccess) : false,
    doorDescription: nodeType === 'door' ? doorDescription || '' : null,
    doorRequiresBadgeAccess: nodeType === 'door' ? Boolean(doorRequiresBadgeAccess) : false,
    doorBadgeAccessFromNodeIds: nodeType === 'door' && Array.isArray(doorBadgeAccessFromNodeIds) ? doorBadgeAccessFromNodeIds : [],
  };
  nodes.push(node);
  await saveCollection(req.params.buildingId, 'nodes', nodes);

  if (node.nodeType === 'transition' && node.transitionGroupId) {
    const [edges, floors] = await Promise.all([
      getCollection(req.params.buildingId, 'edges'),
      getCollection(req.params.buildingId, 'floors'),
    ]);
    const updated = syncTransitionEdges(nodes, edges, node, new Map(floors.map((f) => [f.id, f])));
    await saveCollection(req.params.buildingId, 'edges', updated);
  }

  res.status(201).json(node);
});

nodesRouter.put('/:nodeId', requireAdmin, async (req, res) => {
  const nodes = await getCollection(req.params.buildingId, 'nodes');
  const index = nodes.findIndex((n) => n.id === req.params.nodeId);
  if (index === -1) return res.status(404).json({ error: 'Node not found' });
  const positionChanged = req.body?.x !== undefined || req.body?.y !== undefined;
  nodes[index] = { ...nodes[index], ...req.body, id: nodes[index].id };
  if (nodes[index].nodeType === 'transition' && nodes[index].transitionGroupId && req.body?.transitionGroupName !== undefined) {
    for (const node of nodes) {
      if (node.id !== nodes[index].id && node.transitionGroupId === nodes[index].transitionGroupId) {
        node.transitionGroupName = nodes[index].transitionGroupName || '';
      }
    }
  }
  await saveCollection(req.params.buildingId, 'nodes', nodes);

  if (positionChanged || (nodes[index].nodeType === 'transition' && nodes[index].transitionGroupId)) {
    const [edges, floors] = await Promise.all([
      getCollection(req.params.buildingId, 'edges'),
      getCollection(req.params.buildingId, 'floors'),
    ]);
    const weightedEdges = positionChanged ? refreshAttachedManualEdgeWeights(nodes, edges, nodes[index].id) : edges;
    const updated =
      nodes[index].nodeType === 'transition' && nodes[index].transitionGroupId
        ? syncTransitionEdges(nodes, weightedEdges, nodes[index], new Map(floors.map((f) => [f.id, f])))
        : weightedEdges;
    await saveCollection(req.params.buildingId, 'edges', updated);
  }

  res.json(nodes[index]);
});

nodesRouter.delete('/:nodeId', requireAdmin, async (req, res) => {
  const nodes = await getCollection(req.params.buildingId, 'nodes');
  const filtered = nodes.filter((n) => n.id !== req.params.nodeId);
  await saveCollection(req.params.buildingId, 'nodes', filtered);

  const edges = await getCollection(req.params.buildingId, 'edges');
  const updatedEdges = removeTransitionEdges(edges, req.params.nodeId);
  await saveCollection(req.params.buildingId, 'edges', updatedEdges);

  res.json({ ok: true });
});
