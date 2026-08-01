const DEFAULT_PIXELS_PER_FOOT = 10;
const POI_ANNOTATION_MAX_DISTANCE_PX = 60;
const DEFAULT_LANDMARK_VISIBILITY_FEET = 30;

function bearing(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
}

function normalizeAngleDiff(diff) {
  let d = diff % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function classifyTurn(diff) {
  const abs = Math.abs(diff);
  const side = diff > 0 ? 'right' : 'left';
  if (abs < 15) return { label: 'straight', side: null };
  if (abs < 45) return { label: 'slight', side };
  if (abs < 120) return { label: 'turn', side };
  if (abs < 170) return { label: 'sharp', side };
  return { label: 'u-turn', side: null };
}

function clockDirection(diff) {
  const hourOffset = Math.round(diff / 30);
  return ((hourOffset + 11) % 12) + 1;
}

function distanceText(pixels, pixelsPerFoot) {
  const feet = Math.round((pixels / pixelsPerFoot) / 5) * 5;
  if (feet <= 0) return null;
  return `approximately ${feet} feet`;
}

function floorLabel(floor) {
  return floor?.name || floor?.id || 'the destination floor';
}

function doorText(node) {
  return node.doorDescription || node.label || 'the door';
}

function nearbyLandmarksForSegment(from, to, landmarks, pixelsPerFoot) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return [];

  const annotations = [];
  const heading = bearing(from, to);
  for (const landmark of landmarks) {
    if (landmark.floorId !== from.floorId) continue;

    const px = landmark.x - from.x;
    const py = landmark.y - from.y;
    const t = (px * dx + py * dy) / lengthSq;
    if (t < 0.15 || t > 1.15) continue;

    const perpDist = Math.abs(dx * py - dy * px) / Math.sqrt(lengthSq);
    const visibilityRadiusFeet = Math.max(1, Number(landmark.visibilityRadiusFeet) || DEFAULT_LANDMARK_VISIBILITY_FEET);
    if (perpDist > visibilityRadiusFeet * pixelsPerFoot) continue;

    const relative = normalizeAngleDiff(bearing(from, landmark) - heading);
    const side = Math.abs(relative) < 20 ? 'ahead' : relative > 0 ? 'right' : 'left';
    annotations.push({
      text: `${landmark.description || landmark.name} is on your ${side} at about ${clockDirection(relative)} o'clock`,
      distance: perpDist,
    });
  }
  return annotations.sort((a, b) => a.distance - b.distance).slice(0, 2).map((a) => a.text);
}

// Finds POIs that sit near (but not on) a path segment, and which side
// of the walker's direction of travel they fall on.
function poiAnnotationsForSegment(from, to, pois, pathNodeIds) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return [];

  const annotations = [];
  for (const poi of pois) {
    if (pathNodeIds.has(poi.node.id)) continue;
    if (poi.node.floorId !== from.floorId || poi.node.floorId !== to.floorId) continue;

    const px = poi.node.x - from.x;
    const py = poi.node.y - from.y;
    const t = (px * dx + py * dy) / lengthSq;
    if (t < 0.1 || t > 0.9) continue;

    const perpDist = Math.abs(dx * py - dy * px) / Math.sqrt(lengthSq);
    if (perpDist > POI_ANNOTATION_MAX_DISTANCE_PX) continue;

    const cross = dx * py - dy * px;
    const side = cross < 0 ? 'left' : 'right';
    annotations.push(`${poi.name} is on your ${side}`);
  }
  return annotations;
}

export function generateDirections({ pathNodes, pathEdges, allEdges, pois, floorsById, landmarks = [] }) {
  const pathNodeIds = new Set(pathNodes.map((n) => n.id));
  const poiByNodeId = new Map(pois.map((p) => [p.nodeId, p]));
  const poisWithNodes = pois
    .map((p) => ({ ...p, node: pathNodes.find((n) => n.id === p.nodeId) }))
    .filter((p) => p.node);

  const instructions = [];
  let segment = null; // { label, side, pixels, floorId, exitContext }
  let prevHeading = null;
  let pendingExitContext = null;

  function flushSegment() {
    if (!segment) return;
    const floor = floorsById.get(segment.floorId);
    const dist = distanceText(segment.pixels, floor?.pixelsPerFoot || DEFAULT_PIXELS_PER_FOOT);
    let text;
    if (segment.exitContext) {
      // Right after an elevator/stairs arrival: never claim a left/right
      // turn we can't back up, since the app doesn't know which car the
      // visitor rode or which way they're facing.
      if (segment.exitContext.exitOptionsCount <= 1) {
        text = dist ? `Head the only way you can, ${dist}` : 'Head the only way you can from here';
      } else {
        text = dist ? `Continue from the landing for ${dist}` : 'Continue from the landing';
      }
    } else if (segment.label === 'straight') {
      text = dist ? `Walk straight ahead for ${dist}` : 'Walk straight ahead';
    } else if (segment.label === 'u-turn') {
      text = 'Make a U-turn';
    } else {
      text = `Make a ${segment.label} ${segment.side}${dist ? `, then continue for ${dist}` : ''}`;
    }
    if (segment.annotations.length) {
      text += `. ${segment.annotations.join('. ')}`;
    }
    instructions.push(text);
    segment = null;
  }

  for (let i = 0; i < pathEdges.length; i += 1) {
    const edge = pathEdges[i];
    const from = pathNodes[i];
    const to = pathNodes[i + 1];

    if ((edge.type === 'elevator' || edge.type === 'stairs') && from.floorId !== to.floorId) {
      flushSegment();
      prevHeading = null;
      const destFloor = floorsById.get(to.floorId);
      const vehicle = edge.type === 'elevator' ? 'elevator' : 'stairs';
      const groupName = to.transitionGroupName || from.transitionGroupName || null;
      instructions.push(`Take ${groupName ? `one of the ${groupName}` : `the ${vehicle}`} to ${floorLabel(destFloor)}`);
      const exitPoi = poiByNodeId.get(to.id);
      instructions.push(`Exit the ${vehicle}${exitPoi ? ` near ${exitPoi.name}` : ''}`);
      const exitOptionsCount = (allEdges || []).filter(
        (e) => e.id !== edge.id && (e.from === to.id || e.to === to.id)
      ).length;
      pendingExitContext = { exitOptionsCount };
      continue;
    }

    const heading = bearing(from, to);
    const floor = floorsById.get(from.floorId);
    const pixelsPerFoot = floor?.pixelsPerFoot || DEFAULT_PIXELS_PER_FOOT;
    const annotations = [
      ...poiAnnotationsForSegment(from, to, poisWithNodes, pathNodeIds),
      ...nearbyLandmarksForSegment(from, to, landmarks, pixelsPerFoot),
    ];

    if (prevHeading === null) {
      segment = { label: 'straight', side: null, pixels: 0, floorId: from.floorId, annotations: [], exitContext: pendingExitContext };
      pendingExitContext = null;
    } else {
      const diff = normalizeAngleDiff(heading - prevHeading);
      const turn = classifyTurn(diff);
      if (!segment || turn.label !== segment.label || turn.side !== segment.side) {
        flushSegment();
        segment = { label: turn.label, side: turn.side, pixels: 0, floorId: from.floorId, annotations: [] };
      }
    }

    const pixels = Math.hypot(to.x - from.x, to.y - from.y);
    segment.pixels += pixels;
    segment.annotations.push(...annotations);
    prevHeading = heading;

    if (to.nodeType === 'door') {
      flushSegment();
      const next = pathNodes[i + 2];
      if (next) {
        const nextDiff = normalizeAngleDiff(bearing(to, next) - heading);
        instructions.push(`Open ${doorText(to)}, then head toward ${clockDirection(nextDiff)} o'clock`);
      } else {
        instructions.push(`Open ${doorText(to)}`);
      }
      prevHeading = null;
    }
  }

  flushSegment();

  const destination = poiByNodeId.get(pathNodes[pathNodes.length - 1].id);
  if (destination) {
    instructions.push(`You have arrived at ${destination.name}`);
  } else {
    instructions.push('You have arrived at your destination');
  }

  return instructions;
}
