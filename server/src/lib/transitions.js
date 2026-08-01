import { nextId } from '../db.js';

// Flat weight per transition ride, in the same unit as pixel-distance edge
// weights. Represents wait+ride cost rather than physical distance, since
// floors don't share a coordinate scale.
const TRANSITION_WEIGHTS = {
  elevator: 250,
  stairs: 150,
};

// Rebuilds the fully-connected clique of edges for a transition group:
// every node sharing a transitionGroupId connects directly to every other,
// so riding between any two floors served by the same elevator/stairwell
// is one hop instead of a chain through intermediate floors.
//
// A group can have more than one landing on the same floor (e.g. a bank of
// elevators with doors flanking both sides of a lobby) — moving between two
// same-floor landings is a real walk, not a ride, so those pairs get a
// normal hallway-style distance weight instead of the flat ride weight, and
// are marked generatedByTransitionGroup so the editor can treat them as
// system-managed rather than manually drawn.
export function syncTransitionEdges(nodes, edges, changedNode) {
  const survivingEdges = edges.filter((e) => {
    const isTransitionEdge = Boolean(e.transitionGroupId) || e.type === 'elevator' || e.type === 'stairs';
    if (!isTransitionEdge) return true;
    if (e.from === changedNode.id || e.to === changedNode.id) return false;
    return e.transitionGroupId !== changedNode.transitionGroupId;
  });

  if (changedNode.nodeType !== 'transition' || !changedNode.transitionGroupId) {
    return survivingEdges;
  }

  const groupMembers = nodes.filter((n) => n.nodeType === 'transition' && n.transitionGroupId === changedNode.transitionGroupId);

  const newEdges = [];
  for (let i = 0; i < groupMembers.length; i += 1) {
    for (let j = i + 1; j < groupMembers.length; j += 1) {
      const from = groupMembers[i];
      const to = groupMembers[j];
      const sameFloor = from.floorId === to.floorId;
      const type = sameFloor ? 'hallway' : from.transitionSubtype || to.transitionSubtype || changedNode.transitionSubtype;
      const weight = sameFloor ? Math.hypot(to.x - from.x, to.y - from.y) : TRANSITION_WEIGHTS[type] ?? 200;
      newEdges.push({
        id: nextId('edge'),
        from: from.id,
        to: to.id,
        type,
        transitionGroupId: changedNode.transitionGroupId,
        weight,
        ...(sameFloor ? { generatedByTransitionGroup: true } : {}),
      });
    }
  }

  return [...survivingEdges, ...newEdges];
}

// Removes a transition node's edges from its group clique (used before delete).
export function removeTransitionEdges(edges, nodeId) {
  return edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
}
