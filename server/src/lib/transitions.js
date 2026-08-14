import { nextId } from '../db.js';

// Elevator wait+ride cost is roughly flat regardless of how many floors it
// serves — riders just stand there. Stairs cost scales with floor count and
// is weighted well above the elevator's flat cost so the router only takes
// them when there's genuinely no better way, matching a visitor's real
// preference. This is the DOWNHILL rate; dijkstra.js applies an extra
// surcharge on top of it at routing time when a stairs edge is actually
// climbed upward, since the same stored edge is walked both directions.
const ELEVATOR_WEIGHT = 250;
const STAIRS_WEIGHT_PER_FLOOR_DOWNHILL = 300;

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

function floorDelta(floorsById, fromFloorId, toFloorId) {
  const fromValue = floorSortValue(floorsById.get(fromFloorId), fromFloorId);
  const toValue = floorSortValue(floorsById.get(toFloorId), toFloorId);
  if (fromValue === null || toValue === null) return 1;
  return Math.max(1, Math.abs(toValue - fromValue));
}

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
export function syncTransitionEdges(nodes, edges, changedNode, floorsById = new Map()) {
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
      let weight;
      if (sameFloor) {
        weight = Math.hypot(to.x - from.x, to.y - from.y);
      } else if (type === 'stairs') {
        weight = STAIRS_WEIGHT_PER_FLOOR_DOWNHILL * floorDelta(floorsById, from.floorId, to.floorId);
      } else {
        weight = ELEVATOR_WEIGHT;
      }
      const requiresBadgeAccess = !sameFloor && Boolean(from.transitionRequiresBadgeAccess || to.transitionRequiresBadgeAccess);
      newEdges.push({
        id: nextId('edge'),
        from: from.id,
        to: to.id,
        type,
        transitionGroupId: changedNode.transitionGroupId,
        weight,
        ...(requiresBadgeAccess ? { requiresBadgeAccess: true } : {}),
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
