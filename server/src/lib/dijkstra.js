export function findShortestPath(nodes, edges, fromNodeId, toNodeId) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) return null;

  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
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
      const candidate = currentDist + edge.weight;
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
