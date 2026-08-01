# Design: elevator banks flanking both sides of a landing

Status: **implemented**
Reviewed by: Codex (comments incorporated below)

## Problem

Real buildings often have a lobby/landing with elevator doors on both sides
— e.g. two cars on the left wall, two on the right, all serving the same
set of floors. The current transition model (`server/src/lib/transitions.js`)
represents an elevator or stairwell as a `transitionGroupId` shared across
one landing node per floor; `syncTransitionEdges()` fully connects every
node in the group with a flat ride weight (elevator = 250, stairs = 150,
see `TRANSITION_WEIGHTS`).

Nothing in the schema or the admin UI (`TransitionLinkPicker` in
`client/src/pages/FloorEditor.jsx`) actually prevents an admin from placing
a second landing node on the *same* floor and linking it to the same
group — "link to existing landing" lets you pick any existing node in a
group regardless of floor. But doing that today silently breaks two things:

1. **Routing weight bug** — `syncTransitionEdges` applies the full flat
   elevator/stairs weight between *every* pair of group members, including
   two nodes on the same floor. Crossing from the left cluster to the right
   cluster of the same lobby would be priced as a full ride (250 units,
   i.e. 25 ft-equivalent at the default 10px/ft), which both under-prices a
   genuinely long lobby walk and over-prices a short one — either way,
   Dijkstra reasons about it incorrectly.
2. **Direction-generation bug** — both `generateLLMDirections`
   (`server/src/lib/llmDirections.js`) and the rule-based fallback
   `generateDirections` (`server/src/lib/directions.js`) classify *any*
   edge with `type === 'elevator' | 'stairs'` as a floor-change segment,
   unconditionally emitting "Take the elevator to the Nth floor." For a
   same-floor pair (`from.floorId === to.floorId`), this produces a
   nonsensical instruction to take the elevator to a floor the visitor is
   already on.

There's a third, deeper problem, raised in review and worth treating as a
first-class part of this design rather than a footnote: **the app never
knows which way the visitor is facing after they step off an
elevator/stairs**, regardless of whether the landing is a simple
single-car stop or a multi-sided bank. Dijkstra picks the correct specific
landing node, but "correct node" isn't the same as "known facing
direction" — so any generated instruction that says "turn left" or "turn
right" right after a transition is unearned. This matters more, not less,
once a landing has doors on multiple sides, because now there may
genuinely be more than one plausible way to walk from the same landing
node.

## Goals

- Model each interchangeable elevator/stair service zone as one landing node
  per side/floor, not one node per physical car. If four elevators in the same
  landing area all serve the same floors, they should be represented as one
  transition group/landing target for that service range. Only split the bank
  into separate groups when the cars provide different floor service, such as
  floors 1-15, 16-24, and 25-40. Use visitor-facing group names such as
  "Elevators for floors 1-15" or "High-rise elevators, floors 25-40" so
  directions can tell people which bank to use.

- Model a bank flanking both sides of a landing using the **existing**
  `transitionGroupId` clique concept — no new node type. The model already
  supports N members per group; it just prices and narrates a same-floor
  pair incorrectly.
- Same-floor hops between bank members should cost real walking distance
  (like any manually-drawn hallway edge) and read as ordinary walking
  directions — never "take the elevator."
- Cross-floor hops keep today's behavior (flat ride weight, "take the
  elevator/stairs to floor X"). Dijkstra will naturally pick whichever
  specific landing node (left or right) is cheapest to reach from the
  incoming path.
- **The first instruction after any elevator/stairs transition must never
  assert a body-relative turn ("turn left/right") that isn't earned by
  known geometry.** Two concrete cases, matching the two real scenarios
  worth designing for:
  - **Single viable exit from the landing** (e.g. a hotel elevator lobby
    where one side is just a window): say so plainly — "step out and go
    the only way you can, then turn right at the end" — rather than
    inventing a facing-dependent direction for the first step.
  - **Multiple viable exits** (a true multi-sided bank, or any landing
    with more than one onward hallway): disambiguate using whichever
    *chosen* landing's label, a nearby landmark, or both — e.g. "the
    elevators behind you serve floors 1–5; walk toward the reception
    desk" — never a bare "turn left."
- Zoned service (e.g. a "low-rise bank" and "high-rise bank" that don't
  fully overlap in floors served) needs no new modeling — an admin already
  expresses that today by giving each zone its own `transitionGroupId`.

## Proposed changes

### 0. Modeling convention: service range, not physical car count

Do not ask admins to place one transition node for every elevator car when
those cars are interchangeable. A hotel bank with four elevators that all
serve floors 1-15 should be modeled as one service-range group, with one
landing node per relevant side/floor. If the same landing area contains
separate service ranges, model those as separate transition groups:
"Elevators for floors 1-15", "Elevators for floors 16-24", "Elevators for
floors 25-40".

Direction wording should use the group/service name when choosing among
zones, e.g. "Use one of the elevators for floors 1-15 and take it to Floor
7." This avoids implying a specific car while still giving enough
instruction for a bank with low/mid/high-rise service.

### 1. Fix same-floor clique weighting (`server/src/lib/transitions.js`)

In `syncTransitionEdges`, when building the clique edge between two group
members, branch on `from.floorId === to.floorId`:
- **Same floor**: weight = pixel distance between the two nodes (same
  convention as a manually-drawn hallway edge in `edges.js`), and
  `type: 'hallway'` instead of the transition type. Keep
  `transitionGroupId` set on the edge regardless, so the existing
  teardown/rebuild filter (which already keys off `transitionGroupId` in
  addition to `type === 'elevator'/'stairs'`) continues to correctly
  manage it when the group changes. Also set a new boolean,
  `generatedByTransitionGroup: true`, on these edges specifically — needed
  for the editor-UX fix in change 4 below.
- **Different floors**: unchanged — flat weight, transition type.

### 2. Fix segment classification (`directions.js` / `llmDirections.js`)

As a defensive check (in case any same-floor edge predating this fix still
carries a transition type), only treat an edge as a floor-change
transition when `edge.type` is elevator/stairs **and**
`from.floorId !== to.floorId`. Once change 1 ships, same-floor pairs are
typed `hallway` and already flow through the normal walking-segment code
path — this check is a safety net, not the primary mechanism.

### 3. Structured "orientation unknown" + fork data for the LLM path

This is the concrete mechanism for the goal above, and the main thing to
get right.

`wayfind.js` already fetches the *full* building `edges` list (not just
the path edges) to run Dijkstra — currently only `result.edges` (the path
subset) is passed on to `generateLLMDirections`/`generateDirections`. Pass
the full `edges` list through as well, so `buildPathDescription()` can
answer "how many ways could the visitor walk from this landing node?"
independent of which one Dijkstra happened to pick.

In `buildPathDescription()`, for each `type: 'transition'` segment (i.e.
`edge.type` is elevator/stairs with a real floor change), compute against
the full edge list:

```js
const exitOptionsCount = allEdges.filter(
  (e) => (e.from === to.id || e.to === to.id) && e !== edge
).length;
```

(`edge` here is the transition edge itself — the one the visitor just
rode in on — so it's excluded; everything else incident to the landing
node is a real candidate next step, including a same-floor crossover edge
to a sibling landing, which is itself a legitimate visual reference:
"if you don't see the doors marked Radiology, the other elevators are a
short walk to your right.")

Add to the segment: `arrivalOrientationUnknown: true` and
`exitOptionsCount`. No other new fields are needed — the first walking
segment after a transition *already* carries `exitLabel`/`toLabel` and
`nearbyLandmarks` (computed today), which is exactly the data needed to
disambiguate a real fork. The only genuinely missing signal was "is this
even a fork," which `exitOptionsCount` now supplies.

Add prompt guidelines (`SYSTEM_PROMPT` in `llmDirections.js`):
- Immediately after an elevator/stairs transition, the visitor's facing
  direction is unknown. Never say "turn left" or "turn right" as the
  *first* instruction after exiting — `directionFromPrevious` is null for
  that segment precisely because it isn't knowable, and no other data
  should be used to guess it.
- If `exitOptionsCount` is 0 or 1, say there's only one way to go, and
  describe it plainly (e.g. "step out and walk to the end of the hallway")
  — you may still describe a turn at the *next* junction using
  `directionAfterArrival` normally, since that's a relative angle between
  two known path segments and doesn't depend on facing at the elevator.
- If `exitOptionsCount` is more than 1, disambiguate using the chosen
  landing's label and/or `nearbyLandmarks` for that first segment instead
  of left/right wording.

### 4. Same fix for the deterministic fallback (`directions.js`)

`generateDirections()` already resets `prevHeading` to `null` after a
transition, so it already avoids inventing a false turn — the first
segment falls back to "Walk straight ahead for X feet," which is safe but
generic. Improve it using the same `exitOptionsCount` signal (passed in
alongside the full edge list): when a landing label or nearby landmark
exists for that first segment, prefer "Exit near [landing label], then
head toward [next label/landmark]" over the generic "walk straight ahead"
phrasing. This is a quality improvement, not a correctness fix — the
current fallback wording, unlike the LLM path, was never actually wrong,
just less rich.

### 5. Editor UX for generated same-floor edges

Once change 1 ships, same-floor crossover edges are `type: 'hallway'` but
also carry `generatedByTransitionGroup: true` and a `transitionGroupId`,
making them system-managed rather than manually drawn. Today's
`FloorEditor` edge list would otherwise show these as ordinary deletable
edges — but deleting one wouldn't reliably stick, since
`syncTransitionEdges` can recreate the whole clique the next time any
member of that group is edited. Use the new flag to render these
distinctly in the editor (e.g. a note "managed by the elevator/stairs
group — edit via the linked landing nodes instead") and hide or disable
their delete button, rather than letting an admin "delete" something that
silently reappears later.

### 6. Admin guidance for labels

Recommend (soft UX copy, not enforced): admins should label same-bank
landing nodes distinctly, e.g. "East elevator landing" or "Elevators by
reception." Add a short inline hint in `TransitionLinkPicker` when the
chosen floor already has a member of the target group, clarifying (a)
that this adds a second, alternate landing connected by a normal walk, not
a second ride, and (b) that a distinct label materially improves the
generated directions once there's more than one landing per floor in a
group.

### 7. Backfill: repair, not just report

Before/while implementing, query existing Supabase `building_collections`
data for any elevator/stairs-typed edge whose two endpoints share a
`floorId`. If any are found (unlikely today, since no admin has modeled
this scenario yet, but worth confirming rather than assuming), don't just
flag them — rerun `syncTransitionEdges` for the affected groups (or a
one-off repair script) so no stale flat-weight transition edge is left
biasing Dijkstra even after the direction generators become defensive
about it.

## Constraint worth stating explicitly, not solving

Weighting a same-floor crossover edge by Euclidean pixel distance assumes
the straight line between the two landing nodes is actually walkable —
exactly the same assumption already required of every manually-drawn
hallway edge in the app today (an admin placing a chain of waypoints is
implicitly asserting each straight segment is walkable). This isn't a new
category of risk introduced by this feature, but it *is* easier to trigger
by accident here, because linking a node to an existing transition group
doesn't feel like "drawing a hallway edge" the way the chain tool does —
an admin could link two landings that are, say, on opposite sides of an
elevator core with no direct line of sight, without realizing they just
created a walk-through-the-wall edge. Mitigate via the admin-guidance hint
in change 6 (state the assumption plainly at the point of linking) rather
than adding graph-topology validation — consistent with how every other
edge type already relies on admin judgment, not automated walkability
checks.

## Non-goals

- No new node type or schema field for "bank" as a concept — only the two
  small edge-level additions in changes 1 and 5
  (`generatedByTransitionGroup`), both scoped to same-floor crossover
  edges specifically.
- No automatic "left/right" wording derived from raw geometry beyond what
  the existing bearing/landmark/label machinery already produces once
  Dijkstra picks a specific node, and beyond the `exitOptionsCount` fork
  signal in change 3.
- No changes to how zoned service (partial-floor-coverage banks) is
  expressed — already covered by using separate `transitionGroupId`s.
- No automated walkability/line-of-sight validation for same-floor
  crossover edges (see constraint above) — admin judgment only, same as
  every other edge type.

## Testing plan (once implemented)

In a test building, create two transition nodes on the same floor sharing
one `transitionGroupId`, plus their cross-floor sibling(s) on another
floor, and confirm:
- The edge between the two same-floor siblings carries a hallway-scale
  weight, not the flat 250/150 ride weight, and is marked
  `generatedByTransitionGroup: true`.
- Dijkstra picks whichever entry point is geometrically cheaper from the
  incoming waypoint.
- Both `generateLLMDirections` and `generateDirections` describe the
  same-floor hop as ordinary walking (with normal turn/landmark
  annotations) and the cross-floor hop as "take the elevator/stairs,"
  landing on whichever side was actually chosen.
- Build one test case where the landing has exactly one onward edge
  (`exitOptionsCount <= 1`) and confirm the generated first instruction
  says there's only one way to go, without a left/right claim.
- Build a second test case where the landing has two-or-more onward edges
  and confirm the generated first instruction disambiguates via label or
  landmark, not a bare "turn left/right."
- Confirm the `FloorEditor` edge list renders generated same-floor
  crossover edges distinctly and doesn't offer a delete button that
  silently fails to stick.
- Add automated unit coverage for `syncTransitionEdges()`, the same-floor
  transition guard in both direction generators, the `exitOptionsCount`
  computation, and the prompt-driven orientation behavior (can be checked
  against the rule-based generator deterministically; the LLM path is
  harder to assert on exactly but should at least be checked for the
  absence of "turn left/right" in the first post-transition instruction
  across a few sample routes).
