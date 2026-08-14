const FLOOR_CHANGE_PENALTY = 20000;
const BADGE_ACCESS_PENALTY = 60000;
// A stairs edge's stored weight (set in transitions.js) is the downhill
// rate; going up the same stairs costs this many times as much, since most
// visitors would rather take an elevator up several flights than climb them,
// even though a short descent on foot is no big deal.
const STAIRS_UP_MULTIPLIER = 3;

function isFloorChangeEdge(edge, nodeById) {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  return Boolean(from && to && from.floorId !== to.floorId);
}

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

// The same stairs edge is walked in both directions, so the up-vs-down
// asymmetry can't live in the edge's stored weight — it has to be computed
// per traversal, same as the badge-direction check above. Returns the EXTRA
// cost on top of the edge's already-stored (downhill) weight; 0 when going
// down, flat, or when floor order can't be determined.
function stairsUpSurcharge(edge, nodeById, floorsById, fromId, toId) {
  if (edge.type !== 'stairs') return 0;
  const from = nodeById.get(fromId);
  const to = nodeById.get(toId);
  if (!from || !to || from.floorId === to.floorId) return 0;
  const fromValue = floorSortValue(floorsById.get(from.floorId), from.floorId);
  const toValue = floorSortValue(floorsById.get(to.floorId), to.floorId);
  if (fromValue === null || toValue === null || toValue <= fromValue) return 0;
  return edge.weight * (STAIRS_UP_MULTIPLIER - 1);
}

// Badge doors are typically one-directional in real buildings (a reader on
// the public side, free egress on the secure side). A door with
// doorBadgeAccessFromNodeIds set only penalizes travel departing from one of
// those specific neighbors — a door's "public side" can be more than one
// graph node (e.g. a transition landing and a separate hallway pass-by point
// that both sit in the same physical lobby). Doors without any configured
// direction fall back to the old symmetric behavior so existing map data
// keeps working unchanged.
//
// Only the door being ENTERED (the arrival node of this hop) can charge —
// never the one just departed. A door node sits between two edges (the walk
// up to it and the walk away from it); checking both endpoints would charge
// a single crossing twice, which in practice made an unconfigured
// (symmetric) door cost double what a directionally-configured one does,
// enough to make the router take absurd detours just to dodge it.
function isBadgeAccessEdge(edge, nodeById, fromId, toId) {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  if (edge.requiresBadgeAccess || from?.transitionRequiresBadgeAccess || to?.transitionRequiresBadgeAccess) {
    return true;
  }

  const arrivalNode = nodeById.get(toId);
  if (arrivalNode?.nodeType !== 'door' || !arrivalNode.doorRequiresBadgeAccess) return false;
  if (arrivalNode.doorBadgeAccessFromNodeIds?.length) return arrivalNode.doorBadgeAccessFromNodeIds.includes(fromId);
  return true;
}

function solveShortestPath(nodes, edges, fromNodeId, toNodeId, floorsById, { allowFloorChanges }) {
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
      const badgeAccessPenalty = isBadgeAccessEdge(edge, nodeById, currentId, to) ? BADGE_ACCESS_PENALTY : 0;
      const stairsSurcharge = stairsUpSurcharge(edge, nodeById, floorsById, currentId, to);
      const candidate = currentDist + edge.weight + floorChangePenalty + badgeAccessPenalty + stairsSurcharge;
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

export function findShortestPath(nodes, edges, fromNodeId, toNodeId, floorsById = new Map()) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const fromNode = nodeById.get(fromNodeId);
  const toNode = nodeById.get(toNodeId);

  if (fromNode && toNode && fromNode.floorId === toNode.floorId) {
    const sameFloorResult = solveShortestPath(nodes, edges, fromNodeId, toNodeId, floorsById, { allowFloorChanges: false });
    if (sameFloorResult) return sameFloorResult;
  }

  return solveShortestPath(nodes, edges, fromNodeId, toNodeId, floorsById, { allowFloorChanges: true });
}
