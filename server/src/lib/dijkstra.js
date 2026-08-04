const FLOOR_CHANGE_PENALTY = 20000;
const BADGE_ACCESS_PENALTY = 60000;

function isFloorChangeEdge(edge, nodeById) {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  return Boolean(from && to && from.floorId !== to.floorId);
}

function isBadgeAccessEdge(edge, nodeById) {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  return Boolean(
    edge.requiresBadgeAccess ||
      from?.transitionRequiresBadgeAccess ||
      to?.transitionRequiresBadgeAccess ||
      from?.doorRequiresBadgeAccess ||
      to?.doorRequiresBadgeAccess
  );
}

function solveShortestPath(nodes, edges, fromNodeId, toNodeId, { allowFloorChanges }) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) return null;

  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    if (!allowFloorChanges && isFloorChangeEdge(edge, nodeById)) continue;
    adjacency.get(edge.from).push({ to: edge.to, edge });
    adjacency.get(edge.to).push({ to: edge.from, edge });
  }

  const dist = new Map(nodes.map((n) => [n.id, Infinity]));
  const prevEdge = new Map();
  const prevNode = new Map();
  const visited = new Set();
  dist.set(fromNodeId, 0);

  while (visited.size < nodes.length) {
    let currentId = null;
    let currentDist = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < currentDist) {
        currentDist = d;
        currentId = id;
      }
    }
    if (currentId === null) break;
    if (currentId === toNodeId) break;
    visited.add(currentId);

    for (const { to, edge } of adjacency.get(currentId)) {
      if (visited.has(to)) continue;
      const floorChangePenalty = isFloorChangeEdge(edge, nodeById) ? FLOOR_CHANGE_PENALTY : 0;
      const badgeAccessPenalty = isBadgeAccessEdge(edge, nodeById) ? BADGE_ACCESS_PENALTY : 0;
      const candidate = currentDist + edge.weight + floorChangePenalty + badgeAccessPenalty;
      if (candidate < dist.get(to)) {
        dist.set(to, candidate);
        prevNode.set(to, currentId);
        prevEdge.set(to, edge);
      }
    }
  }

  if (dist.get(toNodeId) === Infinity) return null;

  const pathNodeIds = [toNodeId];
  const pathEdges = [];
  let cursor = toNodeId;
  while (cursor !== fromNodeId) {
    pathEdges.unshift(prevEdge.get(cursor));
    cursor = prevNode.get(cursor);
    pathNodeIds.unshift(cursor);
  }

  return {
    nodes: pathNodeIds.map((id) => nodeById.get(id)),
    edges: pathEdges,
    totalWeight: dist.get(toNodeId),
  };
}

export function findShortestPath(nodes, edges, fromNodeId, toNodeId) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const fromNode = nodeById.get(fromNodeId);
  const toNode = nodeById.get(toNodeId);

  if (fromNode && toNode && fromNode.floorId === toNode.floorId) {
    const sameFloorResult = solveShortestPath(nodes, edges, fromNodeId, toNodeId, { allowFloorChanges: false });
    if (sameFloorResult) return sameFloorResult;
  }

  return solveShortestPath(nodes, edges, fromNodeId, toNodeId, { allowFloorChanges: true });
}
