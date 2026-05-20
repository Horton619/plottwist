# Canvas + snap engine

> Load this doc when touching `renderer/canvas.js`, `renderer/snapEngine.js`,
> drag behaviors, pointer dispatch, vertex/edge handles, mid-edge handles,
> or anything mentioning "snap" / "drag mode" / "handle."

## TL;DR

`canvas.js` (~1,800 lines) is the largest file by far. Three jobs:

1. **Render** — viewport (pan/zoom via SVG viewBox), object layer, handle
   layer, tool-preview layer.
2. **Pointer dispatch** — `onPointerDown` walks a priority order; the
   ordering is load-bearing.
3. **Drag modes** — `move`, `resize`, `vertex`, `edge` (perpendicular
   edge slide), `aisle-dim`, `pan`, plus tool-specific draw modes.

`snapEngine.js` provides anchor points (corners / midpoints / center) and
runs anchor↔anchor + edge-snap matching during drags.

## The decisions / invariants (locked in)

### Pointer dispatch (canvas.js `onPointerDown`)

Priority order — DO NOT reorder. Each check returns early if it fires:

1. Right-click → handled in contextmenu (not here)
2. Space-bar pan OR middle-mouse → pan mode
3. `state.calibration` → consume click as calibration point
4. `state.pickMode === 'origin'` → place origin, exit pick mode
5. `state.pickMode === 'centerline'` → place centerline, exit pick mode
6. Active tool === 'select' → handle hits → vertex / mid-edge / aisle-dim /
   object hit-test (layout first, then venue) → marquee
7. Other tools (polygon, dim, rect) → start their respective draw mode

### Mid-edge handle behavior

- **Bare click on a mid-edge handle drags the WHOLE EDGE perpendicular
  to itself.** Both endpoint vertices translate by the same signed
  perpendicular offset. The dragged edge stays parallel to its original
  orientation; adjacent edges deform.
- **Alt + click on the same handle inserts a vertex at the midpoint
  and starts a vertex drag** on that new vertex. Power-user shortcut for
  what used to be the bare-click behavior.
- **Right-click on an edge** is the discoverable "Insert vertex here"
  path (in `onContextMenu`).
- **Cursor reflects the action.** Mid-edge handles use a direction-aware
  resize cursor (`ns-resize` for horizontal edges, `ew-resize` for
  vertical, `nesw/nwse-resize` for diagonals) computed inline per handle.
  When alt is held globally, `body.alt-held` flips them all to `copy`
  (plus icon) signaling vertex-insert mode.

### Drag modes the codebase recognizes

| Mode | Purpose | Mutates |
|---|---|---|
| `move` | Translate selection | `o.x/y` or `o.vertices` per object |
| `resize` | Corner-handle resize on rect/image | `o.x/y/w/h` |
| `vertex` | Drag a single polygon vertex | `o.vertices[i]` |
| `edge` | Drag whole edge perpendicular | `o.vertices[i] & i+1` |
| `aisle-dim` | Slide aisle dim label along long axis | `o.dimLabelFrac` |
| `pan` | Pan viewport | `state.viewport.x/y` |
| Tool-specific | `draw-rect`, `draw-polygon`, `draw-dim` | `state.drawingRect / drawingPolygon / drawingDim` |

### Render quirks

- **`vector-effect="non-scaling-stroke"` interprets `stroke-dasharray`
  in SCREEN PIXELS, not world units.** If you multiply a dasharray
  value by `pxToWorldDist`, you've double-counted the zoom. Keep
  dasharrays as constants on NSS strokes.
- **The "snap indicator" is a separate transient layer.** `state.
  snapIndicator = { x, y, kind }` is set by the snap engine during a
  drag and rendered as a cyan ring in `renderToolLayer`.
- **Layout objects render ON TOP of room (venue) objects.** Active layout
  is drawn last so seating sits over the floor / walls.

### Snap engine

- **Anchor points come from `getSnapPoints(obj)`** — corners +
  edge-midpoints + center for rects/images/polygons; both endpoints +
  midpoint for dim lines. `collectSnapAnchors(excludeIds)` walks the
  visible non-dragged objects (including solver-output chairs and tables)
  to build the candidate pool.
- **Move-drag snap = anchor↔anchor + centerline pull + edge snap.**
  - Anchor↔anchor: closest pair within `snapTolerance` wins.
  - Centerline pull: only midpoint/center anchors on the dragged shape
    are eligible; distance counted in X only.
  - Edge snap: every visible non-dragged object's perimeter is a snap
    target — drag an aisle, catch the side of a stage.
- **Shift = AGGRESSIVE snap, not bypass.** Tolerance × 3, plus an extra
  1.5× pull radius to the centerline for midpoint/center anchors. Old
  convention was "shift bypasses snap" — that was reversed. Bypass = turn
  snap off in Settings.

## Code references

| File | What it owns |
|---|---|
| `renderer/canvas.js` | Render loop, pointer dispatch, drag modes, all `build*` helpers (chair, table, door, aisle dim callout, etc.), grid, guides, fire-marshal callouts, handles. |
| `renderer/snapEngine.js` | `getSnapPoints`, `collectSnapAnchors`, `computeMoveSnap`, `computeDragPointSnap`, edge-snap helpers. |
| `renderer/colors.js` | `BRAND` and `ANNOT` color tokens used throughout canvas + export. |

## What NOT to do

- ❌ **Don't reorder the `onPointerDown` priority list.** A wrong order
  silently swallows clicks (e.g. clicking a vertex would start a marquee
  instead).
- ❌ **Don't multiply `stroke-dasharray` by `pxToWorldDist` on an NSS
  stroke.** That double-counts zoom and the dashes get weird.
- ❌ **Don't add a new `addEventListener` on `window` for canvas input.**
  All pointer events route through the central `onPointerDown` /
  `onPointerMove` / `onPointerUp` so priority + drag-state stays
  consistent. Keyboard events on `window` are fine.
- ❌ **Don't make shift bypass snap.** Shift = aggressive snap. The
  bypass affordance is the Settings → Workspace → Snap toggle.
- ❌ **Don't change the mid-edge handle to insert a vertex on bare
  click.** That was the old behavior; bare = drag-edge now. Alt is the
  vertex-insert shortcut.
- ❌ **Don't render solver-output chairs/tables in `room.objects`.**
  They live on the seating zone's `result` and are drawn by `buildChair`
  / `buildTable` inside the seating-zone group.
- ❌ **Don't trust mouse coordinates raw.** `screenToWorld(clientX,
  clientY)` is the converter; the SVG viewBox makes screen↔world math
  non-obvious.
