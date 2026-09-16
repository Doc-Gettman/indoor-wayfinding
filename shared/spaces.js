export const ENVIRONMENTS = ['indoor', 'outdoor', 'unspecified'];
export const LAYOUTS = ['open', 'corridor', 'room', 'unspecified'];

export function nodeSpaceIds(node) {
  return node?.boundarySpaceIds?.length ? node.boundarySpaceIds : node?.spaceId ? [node.spaceId] : [];
}

export function validateAssignment(item, spaces, allowBoundary = true) {
  const ids = new Set(spaces.map((space) => space.id));
  if (item.spaceId != null && (typeof item.spaceId !== 'string' || !ids.has(item.spaceId))) return 'Unknown space';
  const boundary = item.boundarySpaceIds ?? [];
  if (!Array.isArray(boundary)) return 'Boundary spaces must be an array';
  if (boundary.length) {
    if (!allowBoundary || boundary.length !== 2 || new Set(boundary).size !== 2 || boundary.some((id) => !ids.has(id))) {
      return 'A boundary must connect two different known spaces';
    }
    if (item.spaceId) return 'A boundary belongs to its two adjacent spaces, not a single space';
  }
  return null;
}

// Explicit edge context wins only when consistent with both endpoints.
// Unclassified endpoints are allowed for incremental map authoring.
export function resolveEdgeSpace(edge, from, to) {
  const a = nodeSpaceIds(from);
  const b = nodeSpaceIds(to);
  const common = a.filter((id) => b.includes(id));
  if (a.length && b.length && !common.length) return { spaceId: null, error: 'Different spaces: add a boundary waypoint or door where the space changes.' };
  if (edge.spaceId) {
    if ((a.length && !a.includes(edge.spaceId)) || (b.length && !b.includes(edge.spaceId))) {
      return { spaceId: null, error: 'Connection space conflicts with its endpoints. Review the boundary and space assignment.' };
    }
    return { spaceId: edge.spaceId, error: null };
  }
  if (common.length === 1) return { spaceId: common[0], error: null };
  if (common.length > 1) return { spaceId: null, error: 'Choose which space this connection passes through.' };
  return { spaceId: null, error: null };
}

export function reconcileSpaceEdges(nodes, edges, changedIds) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    if (changedIds && !changedIds.has(edge.from) && !changedIds.has(edge.to)) return edge;
    if (edge.type === 'elevator' || edge.type === 'stairs') return edge;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    let context = resolveEdgeSpace({ ...edge, spaceId: null }, from, to);
    // Two boundary endpoints may share both spaces. Keep a valid explicit
    // choice there; otherwise rederive so reassignment cannot leave stale data.
    if (context.error && nodeSpaceIds(from).length === 2 && nodeSpaceIds(to).length === 2) {
      context = resolveEdgeSpace(edge, from, to);
    }
    return { ...edge, spaceId: context.spaceId, needsSpaceReview: Boolean(context.error) };
  });
}

export function routeSpaceContexts(pathNodes, pathEdges, spaces = []) {
  const byId = new Map(spaces.map((space) => [space.id, space]));
  return pathEdges.map((edge, i) => {
    if (edge.type === 'elevator' || edge.type === 'stairs' || edge.needsSpaceReview) return null;
    const context = resolveEdgeSpace(edge, pathNodes[i], pathNodes[i + 1]);
    return context.error ? null : byId.get(context.spaceId) || null;
  });
}

export function spaceName(space) {
  return space?.name || space?.descriptiveTerm || (space?.layout === 'corridor' ? 'the corridor' : space?.layout === 'room' ? 'the room' : 'the area');
}

export function boundaryInstruction(fromSpace, toSpace) {
  if (!fromSpace || !toSpace || fromSpace.id === toSpace.id) return null;
  if (fromSpace.environment === 'indoor' && toSpace.environment === 'outdoor') return `Go outside into ${spaceName(toSpace)}`;
  if (fromSpace.environment === 'outdoor' && toSpace.environment === 'indoor') return `Go inside into ${spaceName(toSpace)}`;
  return `Continue into ${spaceName(toSpace)}`;
}
