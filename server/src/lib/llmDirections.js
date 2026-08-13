import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_PIXELS_PER_FOOT = 10;
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

function clockDirection(diff) {
  const hourOffset = Math.round(diff / 30);
  return ((hourOffset + 11) % 12) + 1;
}

function relativeSide(diff) {
  if (Math.abs(diff) < 20) return 'ahead';
  if (Math.abs(diff) > 160) return 'behind';
  return diff > 0 ? 'right' : 'left';
}

function relativeDirection(fromHeading, toHeading) {
  if (fromHeading === null || toHeading === null) return null;
  const diff = normalizeAngleDiff(toHeading - fromHeading);
  return {
    side: relativeSide(diff),
    clock: `${clockDirection(diff)} o'clock`,
    degrees: Math.round(diff),
  };
}

function mapExitDirection(from, to) {
  if (!from || !to) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  if (Math.abs(dx) >= Math.abs(dy) * 0.75) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

// Mirrors dijkstra.js's isBadgeAccessEdge — badge doors are typically
// one-directional, so a door's description (which usually references the
// badge requirement) should only be surfaced to the LLM as active when the
// visitor is actually arriving from the gated side.
function badgeRequiredForDoorCrossing(door, fromId) {
  if (!door?.doorRequiresBadgeAccess) return false;
  if (door.doorBadgeAccessFromNodeIds?.length) return door.doorBadgeAccessFromNodeIds.includes(fromId);
  return true;
}

// Finds landmarks that sit near a path segment, and which side of the
// walker's direction of travel they fall on. Mirrors the POI-annotation
// geometry in lib/directions.js but returns structured data (for the LLM
// prompt) instead of pre-formatted text.
function nearbyLandmarksForSegment(from, to, landmarks, heading, pixelsPerFoot) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return [];

  const found = [];
  for (const lm of landmarks) {
    if (lm.floorId !== from.floorId) continue;
    const px = lm.x - from.x;
    const py = lm.y - from.y;
    const t = (px * dx + py * dy) / lengthSq;
    if (t < 0.15 || t > 1.15) continue;

    const perpDist = Math.abs(dx * py - dy * px) / Math.sqrt(lengthSq);
    const visibilityRadiusFeet = Math.max(1, Number(lm.visibilityRadiusFeet) || DEFAULT_LANDMARK_VISIBILITY_FEET);
    const visibilityRadiusPx = visibilityRadiusFeet * pixelsPerFoot;
    if (perpDist > visibilityRadiusPx) continue;

    const cross = dx * py - dy * px;
    const landmarkHeading = bearing(from, lm);
    const relative = relativeDirection(heading, landmarkHeading);
    found.push({
      name: lm.name,
      description: lm.description || null,
      side: cross < 0 ? 'left' : 'right',
      clock: relative?.clock || null,
      approxFeetAwayFromPath: Math.round(perpDist / pixelsPerFoot),
      visibilityRadiusFeet,
    });
  }
  return found.sort((a, b) => a.approxFeetAwayFromPath - b.approxFeetAwayFromPath).slice(0, 4);
}

function buildPathDescription({ pathNodes, pathEdges, allEdges, allNodes = pathNodes, floorsById, landmarks, destination, origin }) {
  const segments = [];
  const returnTripBadgeDoors = new Map();
  let previousHeading = null;

  for (let i = 0; i < pathEdges.length; i += 1) {
    const edge = pathEdges[i];
    const from = pathNodes[i];
    const to = pathNodes[i + 1];
    const nextEdge = pathEdges[i + 1] || null;
    const nextNode = pathNodes[i + 2] || null;

    if ((edge.type === 'elevator' || edge.type === 'stairs') && from.floorId !== to.floorId) {
      // How many ways could the visitor walk from this landing, other than
      // the ride they just took? Lets the prompt tell a forced single exit
      // ("go the only way you can") apart from a real fork that needs a
      // landmark or label to disambiguate — the app has no idea which
      // physical car they rode or which way they're facing either way.
      const exitOptionsCount = (allEdges || []).filter(
        (e) => e.id !== edge.id && (e.from === to.id || e.to === to.id)
      ).length;
      const sameFloorGroupLandings = allNodes.filter(
        (node) =>
          node.id !== to.id &&
          node.floorId === to.floorId &&
          node.nodeType === 'transition' &&
          node.transitionGroupId &&
          node.transitionGroupId === to.transitionGroupId
      );
      const exitOrientationAmbiguous = sameFloorGroupLandings.length > 0;
      const routeExitDirection = mapExitDirection(to, nextNode);
      const requiredExitInstruction =
        !exitOrientationAmbiguous && (routeExitDirection === 'left' || routeExitDirection === 'right')
          ? `Turn ${routeExitDirection}`
          : null;
      const fromFloor = floorsById.get(from.floorId);
      const toFloor = floorsById.get(to.floorId);
      segments.push({
        type: 'transition',
        vehicle: edge.type,
        fromFloor: fromFloor?.name || from.floorId,
        toFloor: toFloor?.name || to.floorId,
        groupName: to.transitionGroupName || from.transitionGroupName || null,
        exitLabel: to.label || null,
        arrivalOrientationUnknown: true,
        exitOptionsCount,
        exitOrientationAmbiguous,
        routeExitDirection,
        routeExitLabel: nextNode?.label || null,
        requiredExitInstruction,
      });
      previousHeading = null;
      continue;
    }

    const pixelsPerFoot = floorsById.get(from.floorId)?.pixelsPerFoot || DEFAULT_PIXELS_PER_FOOT;
    const distancePx = Math.hypot(to.x - from.x, to.y - from.y);
    const heading = bearing(from, to);
    const nextHeading = nextNode ? bearing(to, nextNode) : null;
    const upcomingDoorIndex = pathNodes.findIndex((node, index) => index > i + 1 && node.nodeType === 'door');
    const upcomingDoor = upcomingDoorIndex === -1 ? null : pathNodes[upcomingDoorIndex];
    const upcomingDoorHeading = upcomingDoor ? bearing(to, upcomingDoor) : null;
    const upcomingDoorBadgeRequired = upcomingDoor
      ? badgeRequiredForDoorCrossing(upcomingDoor, pathNodes[upcomingDoorIndex - 1]?.id)
      : null;
    // Floor editors sometimes leave the "door" edge tool selected while
    // tracing the hallway past a doorway, so a run of edges right after a
    // real door node can be mistyped "door" too. The node itself is the
    // reliable signal for whether a door is actually there — normalize the
    // edge type against it so a mistyped edge doesn't read to the LLM as a
    // second, nonexistent door.
    const edgeType = to.nodeType === 'door' ? 'door' : edge.type === 'door' ? 'hallway' : edge.type;
    // Badge doors are typically one-directional (see dijkstra.js's
    // isBadgeAccessEdge) — only surface the badge requirement to the LLM
    // when the visitor is actually arriving from the gated side, so it
    // doesn't tell them they need a badge on the direction that's free.
    const toDoorBadgeRequired = to.nodeType === 'door' ? badgeRequiredForDoorCrossing(to, from.id) : null;
    const fromDoorBadgeRequired = from.nodeType === 'door' ? badgeRequiredForDoorCrossing(from, pathNodes[i - 1]?.id) : null;
    const nextDoorBadgeRequired = nextNode?.nodeType === 'door' ? badgeRequiredForDoorCrossing(nextNode, to.id) : null;
    if (to.nodeType === 'door' && to.doorRequiresBadgeAccess && !toDoorBadgeRequired) {
      returnTripBadgeDoors.set(to.id, { label: to.label || 'the door', description: to.doorDescription || null });
    }
    segments.push({
      type: 'walk',
      floor: floorsById.get(from.floorId)?.name || from.floorId,
      edgeType,
      fromLabel: from.label || null,
      fromType: from.nodeType,
      fromDoorDescription: from.nodeType === 'door' ? from.doorDescription || null : null,
      fromDoorBadgeRequired,
      toLabel: to.label || null,
      toType: to.nodeType,
      toDoorDescription: to.nodeType === 'door' ? to.doorDescription || null : null,
      toDoorBadgeRequired,
      approxFeet: Math.round(distancePx / pixelsPerFoot),
      directionFromPrevious: relativeDirection(previousHeading, heading),
      directionAfterArrival: nextEdge && to.nodeType !== 'door' ? relativeDirection(heading, nextHeading) : null,
      upcomingDoorAfterArrival: upcomingDoor
        ? {
            label: upcomingDoor.label || null,
            description: upcomingDoor.doorDescription || null,
            badgeRequired: upcomingDoorBadgeRequired,
            relativeToArrivalDirection: relativeDirection(heading, upcomingDoorHeading),
          }
        : null,
      nextNodeType: nextNode?.nodeType || null,
      nextNodeLabel: nextNode?.label || null,
      nextDoorDescription: nextNode?.nodeType === 'door' ? nextNode.doorDescription || null : null,
      nextDoorBadgeRequired,
      nearbyLandmarks: nearbyLandmarksForSegment(from, to, landmarks, heading, pixelsPerFoot),
    });
    // The very first segment's heading is a straight line from wherever the
    // origin room's POI pin happens to sit to the exit door — not a real
    // facing direction, since nobody has one fixed position inside a room.
    // Don't let it seed a fabricated turn call-out for the segment right
    // after the door, the same way transitions reset previousHeading below.
    previousHeading = i === 0 && from.nodeType === 'destination' ? null : heading;
  }
  return {
    origin: origin ? { label: origin.label, nodeType: origin.nodeType, nodeLabel: origin.nodeLabel || null } : null,
    segments,
    destination: { name: destination.name, description: destination.description || null },
    returnTripBadgeDoors: [...returnTripBadgeDoors.values()],
  };
}

const SYSTEM_PROMPT = `You write short, natural, conversational indoor walking directions for visitors to a building (hospital, office, etc.) — the way a helpful staff member would describe them out loud, not mechanical GPS turn-by-turn output.

Guidelines:
- When a segment has a nearby landmark, describe the turn or hallway relative to that landmark instead of raw distance or compass direction — e.g. "go through the glass doors with the Kimley-Horn logo" or "facing away from the reception desk, head left past the sign that says Radiology".
- Use directionFromPrevious and directionAfterArrival to articulate relative orientation when helpful, including clock directions like "to your right, about 2 o'clock". Prefer these over vague "continue straight" language after exiting a room or door.
- Avoid stating precise distances in feet (e.g. "15 feet", "34 feet down") — describe distance qualitatively instead, based on approxFeet: short segments as "just down the hall" / "right past" / "a few steps", medium segments as "a little way down the corridor" / "partway down the hall", long segments as "quite a way down" / "toward the far end of the hallway". Only give a rounded, approximate number of feet ("about 50 feet or so") for unusually long stretches with no landmark and no natural qualitative phrase that fits — and even then, treat it as a last resort, not the default.
- Combine consecutive similar segments into a single natural sentence rather than one step per graph edge — aim for 3-8 total steps for a typical route.
- Describe elevator/stairs segments as "Take the elevator/stairs to the Nth floor" — do not say "up" or "down"; toFloor's own name/number already says where it goes. If groupName is present, use it instead of "the elevator" — e.g. "Take one of the elevators for floors 1-15 to the 7th floor" — since a landing can have more than one interchangeable car and the visitor shouldn't be pointed at one specific door.
- A transition segment's arrivalOrientationUnknown only makes left/right ambiguous when exitOrientationAmbiguous is true, which means the same elevator/stair group has landings on both sides of that floor's hall. If requiredExitInstruction is present, include that exact phrase as the first movement after exiting; do not replace it with vague route-shape language. If exitOrientationAmbiguous is false and routeExitDirection is "left" or "right", say "turn left" or "turn right" instead of wording like "head toward the hallway leading to [destination]" or "take the route down and around". If exitOrientationAmbiguous is true, avoid left/right for the first movement after arrival and disambiguate using exitLabel, routeExitLabel, or nearby landmarks. If exitOptionsCount is 0 or 1, say there is only one way to go.
- For the same reason, directionFromPrevious is also null for the segment right after the origin room's exit door — the visitor's exact seat/position inside that room isn't known, so there's no real facing to turn from. Don't invent a turn there either; describe it plainly ("head down the hallway") or lean on a landmark/upcomingDoorAfterArrival cue if one is present. A normal directionAfterArrival or directionFromPrevious at the *next* junction is fine.
- Treat origin.label as a posted QR location label, not proof of what action the visitor just took. If origin.nodeType is "waypoint", do not say "coming off the elevator" or "when you step off" at the start; say "From the QR code/current location..." and direct them to walk the first segment to the elevator/stairs/door.
- Only say "get back on the same elevator" when origin.nodeType is "transition" or the first path node is the elevator landing itself. If the origin is a nearby waypoint, say "walk to the elevator bank" and describe the first segment's distance qualitatively, per the distance guideline above.
- Mention doors as doors ("open the door", "go through the glass double doors") when the path passes through a door-type waypoint. Use door descriptions when provided, EXCEPT: doors are frequently one-directional badge readers (free to exit, badge required to enter), and each door-related field (toDoorBadgeRequired, fromDoorBadgeRequired, nextDoorBadgeRequired, upcomingDoorAfterArrival.badgeRequired) tells you whether a badge is actually needed for THAT specific crossing. If that field is explicitly false, do not mention a badge even if the door's description references one — badge language only belongs on a crossing where the field is true. Do not add your own note about the return trip needing a badge; that is appended separately.
- Only describe passing through a door where a segment's fromType or toType is literally "door" in the data. Never invent an extra "next door" or "another door" to narrate a reception desk, glass wall, or open area you're walking past — if there's no door-type node there, describe it as continuing down the hall/space, not as a separate door.
- When the route exits a named room through a door and upcomingDoorAfterArrival is present, use upcomingDoorAfterArrival.relativeToArrivalDirection as the visible-door cue: "After exiting..., you should see [door] to your [side] (about [clock]). Go through that door." Prefer this over directionAfterArrival for that exit.
- Treat the first door immediately after the origin as the exit from that room; say "exit through..." or "leave through..." rather than describing it as a separate object off to the side.
- If you mention an upcoming door in one step, do not repeat the same door in the next step. Fold the intervening movement into the same instruction.
- For the final approach, if the last movement turns into a named destination, describe it as turning through the doorway/opening to reach that destination when that sounds natural.
- Do not invent landmarks, room names, or details that are not present in the input data.
- End with arrival at the named destination.
- Respond with nothing but the JSON object described by the schema.`;

// Generates natural-language directions via Claude, referencing configured
// landmarks. Returns null (never throws) if no API key is configured or the
// call fails for any reason, so callers can fall back to the deterministic
// rule-based generator in lib/directions.js.
export async function generateLLMDirections(input) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const description = buildPathDescription(input);
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2000,
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              steps: { type: 'array', items: { type: 'string' } },
            },
            required: ['steps'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: `Generate directions from this route data:\n\n${JSON.stringify(description, null, 2)}`,
        },
      ],
    }, { timeout: 20000 });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) return null;
    const parsed = JSON.parse(textBlock.text);
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) return null;

    // Appended deterministically rather than left to the model, since this
    // is a security-relevant statement the prompt shouldn't be trusted to
    // get right every time.
    if (description.returnTripBadgeDoors.length) {
      const originName = input.origin?.nodeLabel || input.origin?.label || 'your starting point';
      const doorPhrase = description.returnTripBadgeDoors
        .map((door) => (door.description ? `${door.label} (${door.description})` : door.label))
        .join(' and ');
      parsed.steps.push(
        `Note: if you return to ${originName} using this same route, you'll need a badge to get back through ${doorPhrase}.`
      );
    }

    return parsed.steps;
  } catch (err) {
    console.error('LLM direction generation failed, falling back to rule-based directions:', err.message);
    return null;
  }
}
