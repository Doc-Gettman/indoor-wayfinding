# Indoor, outdoor, and open spaces — shared design proposal

Status: Initial implementation completed in the workspace; pending deployment and map classification.
Date: 2026-09-15

This document records the proposal, reviewer feedback, and the implementation authorized by the user after reviewing the editor workflow. Add feedback in the reviewer comments section below; record agreed changes in the decision log.

## Implemented workflow

- The floor editor has a Spaces panel with an active space, creation/editing, and bulk assignment of existing waypoints and landmarks. Bulk-selected waypoints are highlighted on the map.
- Spaces have a name, environment (`indoor`, `outdoor`, `unspecified`), layout (`open`, `corridor`, `room`, `unspecified`), and an optional descriptive term. They belong administratively to the building and can be reused across its floor maps.
- New points and connections inherit the active space. Destinations inherit their waypoint's assignment; landmarks have their own assignment.
- A waypoint or door can be marked “Connects to another space.” Its two adjacent spaces are stored in `boundarySpaceIds`; its single `spaceId` is null. Completing a new boundary switches the active drawing space to the other side. Continuing from an existing boundary asks which side to use.
- Connections store `spaceId`, with shared endpoint context prefilled by the server. New contradictory connections are rejected. Changing existing point assignments recomputes attached connections and marks ambiguous ones `needsSpaceReview`; they receive neutral route wording until resolved.
- Use the existing edge-splitting tool to place a missing boundary, then edit that waypoint's two sides. Ordinary doors do not force a space change.
- Existing `hallway` edge types remain compatible and are interpreted as walking connections, not proof of a corridor. New walking connections use `walk`. No mass rewrite or automatic classification of live maps is required.
- Both direction generators consume shared space resolution. Space changes break narration, real door crossings incorporate destination-space wording, and known landmarks from other spaces are excluded. Outdoor walkways and open spaces use neutral movement language rather than hallway language.
- Space writes invalidate route caches. Building copies include spaces and remap assignments. In-use spaces cannot be deleted until their references are reassigned.
- Avoid stairs remains enabled by default and is independent of spatial classification. This change does not add routing shortcuts or imply accessibility.

To classify Advent Hospital, create its named spaces, bulk-assign the existing points, then designate boundary doors/openings and resolve flagged connections. The implementation does not guess these classifications from the basemap.

Validation: run `npm.cmd test --prefix server` on Windows (or `npm test --prefix server` elsewhere), `npm.cmd run build --prefix client`, and `npm.cmd run lint --prefix client`. The API tests use isolated in-memory storage, not Supabase. API tests require a Node version supporting `--experimental-test-module-mocks`.

## Problem

The system currently treats waypoints and destinations as if they are inside a building and walking connections as hallways. This produces awkward directions in places such as airport terminals, courtyards, and outdoor walkways.

The assumptions appear in both data and instruction generation:

- `server/src/routes/edges.js` accepts hallway and door connections for manually authored edges.
- `client/src/pages/FloorEditor.jsx` creates walking connections as hallways.
- `server/src/lib/directions.js` uses hallway language in distance descriptions.
- `server/src/lib/llmDirections.js` frames directions as indoor walking and encourages hallway wording.
- Waypoints carry a floor reference, and destinations reference waypoints; neither currently identifies a space.

Changing only the AI prompt would leave the data ambiguous and the fallback directions unchanged.

## Recommended model

Introduce named **spaces**, keeping environment separate from layout. An airport concourse can be indoor and open; a covered outdoor walkway can be outdoor and corridor-like.

| Property | Suggested values or examples | Purpose |
| --- | --- | --- |
| Name | Main Concourse, North Courtyard | Recognizable location for directions |
| Environment | Indoor, outdoor, unspecified | Whether a visitor is inside or outside |
| Layout | Corridor, open area, room, unspecified | How movement through the area is described |
| Optional descriptive term | Concourse, lobby, plaza, walkway | Vocabulary matching the actual place |

These are conceptual properties, not a finalized API schema. Coverage could become a separate attribute later: a roof alone should not classify an outdoor walkway as indoor.

A building remains the administrative owner of its spaces, including associated outdoor areas. Administrative ownership does not imply physical enclosure. Map/floor placement also remains separate from environment; a ground-level map can contain both indoor and outdoor spaces.

### Assignments and boundaries

- Waypoints belong to a space. Destinations inherit spatial context from their waypoint to avoid contradictory settings.
- Walking connections identify the space they traverse, because directions describe movement along connections, not just endpoints.
- When both endpoints share a space, the editor can assign that context automatically for ordinary connections.
- Space boundaries must be represented explicitly when context changes. Doors can mark boundaries, but an opening from a hallway into a concourse can also be a boundary without a door.
- Doorway nodes should support a boundary role rather than being forced arbitrarily into one side. The precise boundary representation remains an open decision.
- Connections spanning multiple spaces should be split at their boundaries or given another explicit boundary representation; do not silently guess from endpoint labels.

Separate connection mechanics (walking, door crossing, stairs, elevator) from spatial context. The current hallway edge type mixes these concepts. Compatibility with existing edge types needs a deliberate migration strategy.

## Direction behavior

Both AI and fallback directions should consume the same resolved spatial context.

| Context | Example |
| --- | --- |
| Indoor corridor | Continue down the hallway. |
| Indoor open area | Continue through the main concourse toward Gate B12. |
| Outdoor open area | Follow the route through the courtyard toward the fountain. |
| Outdoor walkway | Follow the walkway toward the north entrance. |
| Indoor to outdoor | Go through the glass doors into the courtyard. |
| Outdoor to indoor | Enter the terminal through the north entrance. |
| Unspecified | Continue ahead toward reception. |

Names, doors, and landmarks in these examples must come from authored route context; generators should not invent them.

Break instructions at meaningful space changes even when travel continues straight. Mention a space when entering it or when useful for orientation, rather than repeating its name at every waypoint. Boundary wording must work in both travel directions and must not imply a door where none exists.

Open-area instructions should favor landmarks and visible destinations. An open-area classification does not mean every straight-line shortcut is walkable. Continue routing along authored connections around seating, barriers, and other obstacles. Environment and layout alone do not establish accessibility or access permissions.

## Proposed rollout

1. Add space records and editor controls for creating spaces and assigning selected waypoints and connections in bulk. Start with explicit assignment; polygon drawing can follow later.
2. Resolve inheritance and boundary rules. Flag ambiguous connections for authors to review.
3. Update both direction generators to use shared context, preserve boundary instructions, and use neutral wording for missing context.
4. Review existing maps. Preserve routes and IDs, but treat unreviewed spatial classifications as unspecified rather than assuming every legacy hallway connection is actually a hallway.
5. Validate representative routes and refresh cached directions when the change ships. Collection writes already invalidate building route caches; the routing version should also account for changed generation behavior.

Initial scope: outdoor areas associated with the current building and represented on its maps. Separate outdoor maps and routes between buildings require additional design for map connections, coordinate systems, and distance calculations.

## Validation scenarios

- A hallway opens into a large indoor terminal without a door.
- A route exits to a courtyard and later re-enters the building, in both directions.
- A destination is outdoors.
- A covered walkway remains classified as outdoors.
- A route starts or ends at a doorway or space boundary.
- An open area contains obstacles and the route follows authored connections.
- A legacy map has no space assignments and receives neutral directions.
- AI generation is unavailable and fallback directions still respect spatial context.
- Existing stairs, elevators, badge restrictions, distances, and route geometry remain correct.
- Editing a space updates subsequent route instructions rather than serving stale cached wording.

## Open decisions

1. Are the proposed environment and layout values sufficient for the first version?
2. Should descriptive terms use a controlled vocabulary, free text, or both?
3. How should doorway and non-door boundary nodes represent adjacent spaces?
4. Should connection context be stored explicitly, derived when unambiguous, or use inheritance with explicit overrides?
5. Is explicit bulk assignment sufficient initially, or is polygon-based assignment required?
6. Does the first version need outdoor maps separate from existing floor maps?
7. What review process should classify existing maps before enabling space-specific wording?

## Reviewer comments

Append comments here so feedback remains visible to other reviewers. Include the relevant section and a concrete suggestion when possible.

| Reviewer / date | Section or decision | Comment / proposed change | Resolution |
| --- | --- | --- | --- |
| Claude / 2026-09-15 | Open decision 3 (boundary representation) | Store the two adjacent space IDs directly on the door node (e.g. `boundarySpaceIds: [fromId, toId]`), mirroring how transition nodes already carry `transitionGroupId` to pair cross-floor elevator/stair landings. Avoids inventing edge-splitting mechanics for something a single node can already represent. | |
| Claude / 2026-09-15 | Open decision 4 (stored vs. derived context) | Store explicitly, with the editor pre-filling it when both endpoints already share a space. Both `directions.js` and `llmDirections.js` already do dense per-edge geometry work (landmark projection, bearing math, badge-direction checks) on every wayfind request; deriving space context live would add another lookup pass to an already busy hot path. | |
| Claude / 2026-09-15 | Open decision 2 (vocabulary) | Environment and layout should be a closed enum, since direction wording branches on them (see the Direction behavior table). Descriptive term can stay free text since it's vocabulary substitution, not branching logic. | |
| Claude / 2026-09-15 | Assignments and boundaries | "Flagged for authors to review" should mean a hard server-side rejection, not a soft warning — `server/src/routes/edges.js` already rejects cross-floor edges outright (`fromNode.floorId !== toNode.floorId`); apply the same precedent so an unreviewed space boundary can't silently ship. | |
| Claude / 2026-09-15 | Proposed rollout, step 4 | Migration cost is concrete, not just conceptual: the literal `'hallway'` edge type is baked into `MANUAL_EDGE_TYPES` in `edges.js` and into the LLM prompt's `edgeType` normalization in `llmDirections.js`. Separating connection mechanic from spatial context touches every building's `edges` collection (~18 buildings currently in Supabase). Recommend sizing this migration explicitly rather than folding it into "review existing maps." | |
| Claude / 2026-09-15 | Validation scenarios | Add: a badge-gated door that is also a space boundary, to confirm the badge note and the boundary wording combine into one coherent instruction rather than stacking two disjoint sentences. | |

## Decision log

The user authorized implementation after confirming the active-space drawing workflow and the intended lobby/door direction wording. The original proposal and comments remain below for review history; the implemented choices are summarized above.

| Date | Decision | Rationale / approving reviewer |
| --- | --- | --- |
| 2026-09-15 | Implement active-space authoring, two-sided boundary nodes, explicit connection context, structured environment/layout, and free-text descriptive terms. | User approved the discussed workflow and requested implementation. |
| 2026-09-15 | Keep legacy edges compatible; allow unspecified context and flag ambiguous edits while rejecting new contradictory assignments. | Supports incremental map classification without fabricating hallway or indoor context. |
