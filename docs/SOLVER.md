# Seating solver

> Load this doc when touching `renderer/solver/*` or anything mentioning
> chevron / aisles / row pitch / classroom-depth / goal-vs-cap / mixed
> seating.

## TL;DR

Four style solvers (theater / classroom / rounds / mixed) sit behind a
dispatcher (`solver/index.js`) that picks one by `zone.style` and returns
a uniform result shape. The row-based solvers (theater, classroom, mixed)
share a single scan-line approach in a **rotation-aligned local frame**
centered on the zone's centroid. Most of the load-bearing weirdness lives
in three places: the local frame, the chevron path, and the obstruction
tag system.

## The decisions / invariants (locked in)

- **All solvers run in the zone's local frame.** `intoLocalFrame(zone)`
  rotates polygon vertices by `-zone.rotation` around the centroid so the
  zone faces "up." User-drawn aisles, walls, obstructions all get
  projected into that same frame before any math runs. NEVER do spatial
  math in world coords inside a solver.
- **Solver result shape is uniform.** Every solver returns
  `{ rows, seats, tables, totalSeats, warnings }`. `tables` is empty for
  pure theater; `optimizedDepth` is added only by mixed when the optimizer
  runs.
- **`preference: 'exact'` with a `target` is a goal, not a cap.** Fill
  complete rows and stop once `totalSeats >= target`. One row of spill is
  acceptable. The Object Info UI says "Goal," never "Cap."
- **Chevron lives inside the row-placement loop**, per-row, anchored at
  the aisle edge. NOT a section-rotation post-process. Default angle
  slants the row's outer end TOWARD the stage; negative reverses.
- **Chevron is theater / classroom / mixed only.** Rounds uses
  `offsetRows` (hex packing) instead.
- **chevronAngle clamps to [-45, 45], NOT [0, 45].** The `[0, ...]` clamp
  was a real bug — reflected zones flip the sign and need negative to
  survive. See the inline gotcha in `theaterSolver.js` and
  `classroomSolver.js`.
- **0-aisle chevron = single-direction slope** (not a V). The user builds
  a symmetric V by drawing one zone, reflecting it across the room's
  centerline (Object Info → Reflect). The `isOuter` gate has an
  `aisleCount === 0 ? true : ...` branch that turns on chevron for every
  span in that case.
- **Same style per row.** Aisle-split mixed rows are out of scope. Mixed
  = front classroom region + transition gap + back theater region,
  vertically split. Horizontal split only.
- **Obstruction filter is a post-process corner test.** After placement,
  each seat's four rotated corners are tested against each obstruction
  polygon. Classroom drops the table+chairs as one atomic unit (any chair
  in the table's row touching an obstruction kills the entire table).
- **Obstruction polygons are tagged with mode.** `tagObstructions()`
  returns `{ poly, mode: 'fill' | 'edge' }`. Walls are `'edge'` (chair
  blocked only if a chair edge crosses a wall edge — wall polygon
  interior is decorative). Everything else (`obstruction`, `stage`,
  `tech`) is `'fill'` (chair blocked if any corner is inside the
  polygon).
- **Hidden aisles still count.** The `userAisles` filter in
  `ui/objectInfo.js` does NOT check `!a.hidden` — visibility is a display
  concern, not a structural one.
- **Mixed solver's optimizer iterates classroom row counts.** When the
  user sets a goal, it tries N=0..maxRows classroom rows, picks the depth
  whose total seats lands closest to the goal, writes the chosen depth
  back as `optimizedDepth` so the UI can display it. Adjacent-N totals
  are reported as warnings (`−1 row: N seats / +1 row: N seats`).

## Code references

| File | What it owns |
|---|---|
| `renderer/solver/index.js` | Dispatcher; picks a style solver. |
| `renderer/solver/geom.js` | Local-frame transform, scan-line, aisle-subtract, `tagObstructions`, `itemTouchesAny` (fill+edge modes), `clusterSeatsByProximity` (for seat-count labels). |
| `renderer/solver/theaterSolver.js` | Scan-line row fit; chevron placement; per-section maxPerRow cap. |
| `renderer/solver/classroomSolver.js` | Same row mechanic but units are tables; chair pips placed relative to each table. |
| `renderer/solver/roundsSolver.js` | Round-table grid; `offsetRows` hex packing; `fixedAisles` toggle (even vs flush-to-aisle); crescent auto-detect for chair count ≤ 6. |
| `renderer/solver/mixedSolver.js` | Calls solveClassroom + solveTheater with a split point; optimizer mode iterates depths. |
| `renderer/ui/objectInfo.js` (`solveSeatingZone` call site, ~line 786) | Where userAisles + obstructions are collected and threaded into the solver. |

## What NOT to do

- ❌ **Don't do math on `zone.vertices` directly in a solver.** Always go
  through `intoLocalFrame()`. World-coord math silently breaks on
  rotated zones.
- ❌ **Don't clamp `chevronAngle` to a positive range.** It must accept
  negatives (reflect across centerline negates the sign).
- ❌ **Don't gate chevron on `cleanSpans.length > 1`** without the
  `aisleCount === 0` escape — that's what made 0-aisle chevron silently
  flat for a release.
- ❌ **Don't rename "Goal" to "Cap" or "Target" anywhere.** It's the
  user-facing label of the `preference: 'exact'` mode; the term is
  deliberate.
- ❌ **Don't push walls into `BLOCKING` as fill-mode.** Use
  `tagObstructions()` which routes walls to edge mode. Filling a wall
  polygon drops every chair in the room.
- ❌ **Don't add a `Pattern` dropdown.** The old `pattern: 'straight' |
  'chevron'` field was scaffolding before chevron became a separate
  boolean. Chevron is `{ chevron: bool, chevronAngle: number }` now.
- ❌ **Don't filter out hidden aisles from the userAisles list.** A
  hidden aisle is still a structural cut to the layout.
- ❌ **Don't try to support aisle-split mixed seating in a single row.**
  Mixed splits vertically only (front classroom / back theater). If
  someone asks for "classroom on the left + theater on the right," that's
  two zones, not one.
- ❌ **Don't make `seatCountLabel` or `tableNumbering` required fields.**
  Old zones won't have them; readers must default if missing.
