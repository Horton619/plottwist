# PlotTwist

Standalone seating layout calculator and visualizer for live event planning. Snarky-but-professional voice. Part of the Visual Entropy Productions app family alongside SlideFluid and FlowCast.

---

## What it does

Takes a venue rectangle and answers questions like:

- "220 seats, mix of theater and classroom, as much classroom as possible — what's the layout?"
- "How many seats do we have if we do 5 rows classroom and the rest theater?"
- "Can we fit 300 theater style in this room?"

The visual layout is the proof. Calculations and visualization are tightly coupled — every number on screen has a drawn-out validation behind it.

Reference outputs (style we want to produce): magenta annotation callouts on a clean drafted plan view — totals, dimensions, jurisdiction warnings — exportable to PNG and PDF for proposals.

---

## Stack

- **Electron** + vanilla HTML/CSS/JS renderer with native ES modules (per VEP family, no bundler)
- **SVG** for the floorplan canvas — every object is a clickable DOM node, makes selection/handles/transforms easy and exports to PDF as true vectors. World units = integer inches, expressed directly in the SVG `viewBox`.
- **No Python.** Unlike SlideFluid (PPTX parsing) and FlowCast (video), PlotTwist is pure geometry + rendering. PNG export via SVG → canvas/dataURL. PDF export via `pdf-lib` or Electron's built-in `webContents.printToPDF()`.
- **pdfjs-dist** for rasterizing dropped/pasted PDF underlays (page 1 → PNG at 2× scale, baked into the project file as base64). Vendored into `renderer/vendor/pdfjs/` by `scripts/copy-vendor.js`, lazy-loaded.
- **polygon-clipping** for boolean operations on rect/polygon shapes (Join → Polygon today; Subtract / Intersect when we add them). Vendored as a UMD bundle, loaded with a classic `<script>` so it attaches to `window.polygonClipping`.
- **electron-builder** for .dmg / .exe packaging
- **electron-updater** for auto-updates via GitHub Releases
- **GitHub Actions** for CI: Mac arm64 + Windows x64 (mirroring FlowCast's working pipeline, minus the Python job)

---

## Visual language

- Navy / grey / white base scheme. Background `#070910`. Text white/light grey hierarchy.
- Accent: **hot magenta `#FF2D9D`** (drafting-marker pink). Tunable. Distinct from SlideFluid teal and FlowCast blue.
- Footer: `position: fixed; bottom: 0; z-index: 50` — "© 2026 Visual Entropy Productions" left, `veproductions.net` link right. No AVSC branding.
- **Voice: snarky but professional.** Dry copy in error messages, empty states, and tooltips. Visual chrome stays clean and tool-like — the joke lives in the words, not in the design.

---

## Units

**Imperial only.** Feet and inches. No metric toggle. Internally store everything as integer inches; render as `12'-6"` style.

---

## Core features

### 1. Room construction

Real venues are rarely rectangular. Full polygon authoring is required, modeled on Vectorworks' tools.

**Shape tools:**

- **Rectangle tool** — corner + edge handles, drag-to-draw
- **Polygon tool** — click to place vertices, double-click or Enter to close. **Hold Shift** while placing or dragging vertices to snap segment angles to 0° / 45° / 90° / 135° / 180°.
- **Vertex editing** — select a polygon, drag any vertex, right-click an edge to insert a vertex, right-click a vertex to delete

**Boolean operations** (Vectorworks-style, applied to selected shapes):

- **Union / Join** — merge two shapes into one
- **Subtract / Clip** — cut one shape out of another (used to carve obstructions out of a floor)
- **Intersect** — keep only the overlap

These operations let the user build any venue shape from primitives — a rectangle with a clipped pillar, two unioned rectangles for an L-shape, etc.

**Common interactions:**

- **Tab-to-type:** select a shape, press Tab, type a dimension (`24'`, `40'-6"`, `36"`), Enter to commit. For polygons, Tab cycles through edges/vertices for precise dimensioning.
- Click an object → **Object Info panel** on the right shows bounding width, height, sq ft, position, and the object's properties (and per-vertex coordinates for polygons)
- Per-object: fill (color + opacity), pattern fill (color + opacity), stroke (color + thickness)
- Optional **displayed name** with font / size / opacity / color controls — used to label rooms, sections, zones

### 2. Object types (toolbar across the top)

- **Floor** — usable seating area
- **Aisle** — egress paths; defaults handled by solver
- **Obstruction** — pillars, walls, immovables
- **Stage** — used as the "front" of the room for orienting seating
- **Tech table** — back-of-house production positions

### 3. Seating tool

- Drop a seating zone the same way as the floor tool
- Choose style: **theater / classroom / rounds / mixed (theater + classroom)**
- For mixed: enter target seat count + preference (e.g., "max classroom") → solver fills the zone

### 4. The solver

**Inputs:**

- Available area (the seating zone polygon, after aisles and obstructions are subtracted)
- Style (single or theater + classroom mix)
- Target seat count
- Preference: maximize one style / hit exact count / report max possible

**Approach:**

Scan-line layout — for each row y-position, intersect the zone polygon with that horizontal strip to get one or more usable intervals, then fit seats/tables within each interval. Handles arbitrary polygon zones (L-shapes, trapezoids, rooms with carved-out columns), not just rectangles.

**Constraints (hard):**

- **Same style per row.** This is the standard rule. Aisle-split mixed rows are non-standard and explicitly out of scope for v1.
- Respect fire-code spacing for the strictest active jurisdiction
- Theater: 12 max per row default
- Theater row spacing default = chair depth (e.g., 18×20 chair → 20" front-to-front)

**Defaults:**

- Center aisle 12' wide, user-shrinkable to 6'
- Layout centers in space and mirrors outward from the aisle
- Aisle width auto-computed from occupant load, user-overridable

### 5. Fire code

Strictest jurisdictions to model first, with toggleable strictness. The strictest active jurisdiction governs the layout:

- **Cook County** (Chicago)
- **Clark County** (Las Vegas)
- **Buena Vista** (Disney FL — Reedy Creek / Lake Buena Vista improvement district)
- **Reidy Creek** (Disney CA properties — Anaheim/Disneyland)

Common rules to encode in `data/fireCode.json`:

- Min aisle width as a function of occupant load (rough rule: occupants ÷ 50 = required aisle inches, plus jurisdiction-specific minimums)
- Min spacing between rounds (4' = no-go, 5' okay in some jurisdictions, 6' okay everywhere)
- Min row spacing for theater based on chair width
- Max seats between an aisle and the wall
- Dead-end aisle limits

The solver flags violations inline with magenta callouts on the layout.

---

## Default dimensions

Hotel banquet standards. **All user-modifiable per project and per zone.**

### Tables

| Table          | Default seats | Max seats |
| -------------- | ------------- | --------- |
| 6' × 18"       | 2 classroom   | 3         |
| 6' × 30"       | 3 classroom   | 3         |
| 8' × 18"       | 3 classroom   | 4         |
| 8' × 30"       | 4 classroom   | 4         |
| 60" round      | 8 full        | 5 crescent / 8 full |
| 72" round      | 10 full       | 5–7 crescent / 8–12 full (jurisdiction-dependent) |

### Chairs

- Banquet chair: **18" wide × 20" deep**, no arms

### Spacing

- Classroom front-to-front: **4'-6"**
- Theater row-to-row: **chair depth (20" default)**, scales with chair size for jurisdictional egress
- Theater max per row: **12**
- Center aisle: **12' default, 6' min**

---

## Project model

```
Project (.ptwist file, JSON)
├── Rooms[]
│   ├── name, dimensions, shape
│   ├── obstructions, stage, tech tables
│   └── Layouts[]
│       ├── name (e.g., "Theater 220", "Mixed 175")
│       ├── seating zones, aisles
│       └── solver inputs + outputs
```

**Premiere-style sidebar** lists rooms and their layouts. Click to switch active layout. Layouts within a room share the room geometry — change the room shape and all layouts reflow.

---

## Export

- **PNG** of active layout (raster snapshot)
- **PDF** of active layout (vector, suitable for proposals)
- Both include the magenta callout style (totals, dimensions, jurisdiction warnings)

---

## Out of scope for v1

- **Curved walls / arc segments.** Polygon tool with straight edges only in v1.
- **Metric units.**
- **Cloud sync / multi-user.**
- **Real Vectorworks file IO.**
- **Aisle-split mixed-style rows.**
- **Multi-page PDF underlays.** Page 1 only when a PDF is imported. v2.
- **External image storage / sidecar files.** Underlays are base64-embedded in the `.ptwist` JSON; that gets heavy for ≥ ~5MB images. v2 splits them into a sidecar folder.

### Already pulled forward from v2

- **Underlay tracing** — drop/paste/import PNG/JPG/PDF, two-click + distance calibration, trace over with the Walls polygon tool. Shipped.

---

## UX patterns to carry forward (from SlideFluid / FlowCast)

- Snarky-professional empty states and error toasts
- Object Info panel that updates live as objects are dragged or resized
- Action buttons that cycle through states (Idle → Working → Result → Reset)
- Diagnostics tab with preflight check, log tail (last 80 lines), auto-updater UI
- Keyboard-first: Tab to type dimensions, arrow keys to nudge, Cmd+Z undo, Cmd+S save
- Convert/calculate is a reversible operation — re-running with new inputs replaces results, doesn't append

---

## Lessons from FlowCast & SlideFluid (CI / packaging — must carry forward)

- **electron-builder creates GitHub Releases as drafts.** Add an explicit `gh release edit "$TAG" --draft=false --latest` step at the end of the last platform job.
- **Windows runner defaults to PowerShell.** Add `shell: bash` to any step using bash syntax (parameter expansion etc.).
- **`macos-latest` is arm64.** Pass `--arm64` explicitly to electron-builder.
- **Ad-hoc sign Mac builds** with `codesign --deep --force --sign -` before DMG packaging. Document the "unidentified developer → System Settings → Privacy & Security → Open Anyway" first-launch dance in release notes.
- Build unpackaged with `--dir --arm64` first, sign, then `--prepackaged` for DMG.
- `dist/` and `node_modules/` are gitignored.
- `.gitignore` should include build outputs, OS files (.DS_Store, Thumbs.db), editor files (.vscode, .idea), and any temp/log dirs.

---

## Lessons from PlotTwist build sessions (so far)

**Vendoring runtime libs (`renderer/vendor/`) instead of bundling.**
A `postinstall` step (`scripts/copy-vendor.js`) copies third-party files from `node_modules` into `renderer/vendor/` (gitignored). Keeps the renderer CSP simple (`'self'`) without adding a bundler.
- ESM libs with workers (pdfjs-dist): copy `pdf.mjs` + `pdf.worker.mjs`, set `GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.mjs'`. Lazy-import via `await import()` so the library only loads when needed.
- UMD libs that need globals (polygon-clipping): copy the UMD file and load it via a classic `<script>` in `index.html` *before* the module script. The UMD attaches to `window.<name>` for the modules to reference.

**CSP for renderer with images + workers** — needed to add to the default `'self'`:

```
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self' blob:;
img-src   'self' data: blob:;
connect-src 'self' data: blob:;
```

`img-src data:` is the one that bites — `<image href="data:...">` for embedded underlays silently 404s without it. `wasm-unsafe-eval` is required by some pdfjs decoding paths.

**SVG canvas with `viewBox` in inches.** Pan = shift origin; zoom = scale `w`/`h`. For cursor-anchored zoom, keep the world point under the cursor stationary across the transform. Use `vector-effect="non-scaling-stroke"` on every handle/stroke so they stay constant pixel-size regardless of zoom. Tag SVG elements with `data-*` attributes and hit-test via `event.target.closest('[data-attr]')` in pointerdown — no manual hit-testing needed for handles.

**Tiny pub-sub state (`state.js`).** `subscribe`, `notify`, `mutateProject` (flips dirty + notifies), `setState` (just notifies). Whole-tree re-render on every change is fine for a few hundred objects. Drag interactions mutate in place during the gesture; commit on `pointerup` is implicit.

**Tool dispatch.** A single `onPointerDown` that checks mode flags (`spaceDown`, `state.calibration`, drawing-polygon) in priority order, then falls through to per-tool logic. Avoids fragile per-tool listener juggling.

**Calibration mode pattern.** A top-level state flag (`state.calibration`) gates *click* dispatch and shows a banner overlay. Wheel-based pan/zoom must NOT be gated on the flag — keep navigation always-on so users can frame their reference points. Add space-bar drag as a universal pan escape hatch.

**Boolean operations** (polygon-clipping). Watch for two error cases the lib will hand back: disjoint inputs returning a multi-polygon, and outputs with holes — both need user-facing errors since v1 doesn't model multipolygons or holes.

**Image data URLs in `.ptwist`.** Simple, single-file projects, but a 4MB PNG becomes ~5.3MB of base64. v2 will sidecar large images.

**Render order vs. layer-panel order.** The internal `room.objects[]` is bottom-of-stack first (last in array renders on top, painting over earlier ones). The Photoshop-convention layers panel reads top-down, so the panel reverses the array on render. Drag-reorder math has to translate visual above/below into array index moves — easy to get backwards.

**Solver dispatch via `solver/index.js`.** Each style (`theater`, `classroom`, `rounds`, `mixed`) is a separate file under `renderer/solver/`. The dispatcher routes by `zone.style` and forwards `opts` (which carries user-drawn aisles, venue obstructions, optional y-bounds for the mixed solver). Shared scan-line helpers live in `solver/geom.js`: `intoLocalFrame` / `worldToLocal` / `localToWorld` (rotation transforms around zone centroid), `horizontalSpans` (polygon ↔ horizontal line intersections), `subtractRanges` + `subtractObstructions` (cut aisle / obstruction ranges out of a span list, tagging with `justify` for flush-edge layout), `computeAislePositions` / `computeShiftedRoundAislePositions` (auto-aisle placement), `pointInPolygon` / `itemTouchesAny` / `obstructionToWorldPolygon` / `placedItemCorners` (post-place collision), `fitUnits` (greedy chair/table fit with min spacing).

**Goal-not-cap solver semantics.** When a zone has `preference: 'exact'` and a `target` seat count, the solver fills full rows and stops once `totalSeats >= target` (one row of "spill" above target is acceptable). Mixed runs in optimizer mode: iterates classroom row counts, picks the depth whose total lands closest to target (over or under), and writes `optimizedDepth` back to the zone so the user sees what was chosen. The Object Info panel labels this **Goal**, not **Cap**.

**Aisle math conventions.** Auto-aisles compute centerline positions via `computeAislePositions(count, aisleW, sectionW)` where `sectionW` is style-dependent (theater: `maxPerRow × chairW`; classroom: 24'×12 fire-code cap, but capped to theater-aligned width when called from mixed; rounds with `fixedAisles=true`: polygon evenly subdivided; rounds with `fixedAisles=false`: tight blocks flush against shifted aisles). User-drawn aisles get classified by their LOCAL-frame aspect ratio: wider-than-tall → horizontal aisle (row stepper jumps past in y), taller-than-wide → vertical aisle (per-row x-cut alongside the auto aisles).

**Obstruction filter is a post-process.** Solvers place chairs/tables ignoring obstructions, then `itemTouchesAny` corner-tests each placed seat (and each table) against `obstructionToWorldPolygon`-ified `BLOCKING` venue objects (`obstruction`, `stage`, `tech`). For classroom, the table + its chairs are an atomic unit — if any chair corner OR the table itself touches an obstruction, the whole unit drops. Stage / tech objects are blocking by default (chairs can't sit on the stage).

**Settings module (`settings.js`).** Single localStorage namespace `plottwist:settings:*`. Defaults live in `SETTINGS_DEFAULTS`; `getSetting(k)` falls through to default if no override. Subscribers (`onSettingsChange`) re-render dependent UI live (canvas grid, snap behavior, etc.). The Settings modal (`ui/settingsModal.js`) opens via Cmd+, with three tabs — Workspace (origin, centerline, grid, snap), Defaults (nudge, solver pre-fills, auto-save, undo depth), Updates (version + GitHub release check). Cmd+Shift+R relaunches via `app.relaunch() + app.exit(0)` (TEMP dev-only, marked for removal pre-ship).

**Snap engine (`snapEngine.js`).** During a `move` drag (only — vertex/resize don't snap yet), every visible / unlocked object's anchors (corners + edge midpoints + center, plus seating-zone solver chair/table centers) are tested against the dragged object's anchors at the proposed offset. Within tolerance (`snapTolerance` setting, default 8 px), the drag offset is adjusted so the closest pair coincides. Edge snap (perpendicular foot of any rect/polygon/dim line edge) is added for the Dim tool's two clicks via `snapPointToAnchors()`. Shift-locked drags skip snap.

**Undo / redo (`state.js`).** Each `mutateProject()` call pushes a `structuredClone(state.project)` snapshot to `state.undoStack` (limit reads from `getSetting('undoDepth')`, default 80). `beginTransaction()` / `endTransaction()` batches drag mutations so a whole gesture is one undo step. Cmd+Z / Cmd+Shift+Z. History is wiped on file open / new project.

---

## Repo

`Horton619/plottwist` — release on `v*` tag push, ad-hoc signed only (no Apple Developer account).

---

## Current file layout

```
PlotTwist/
├── package.json
├── main.js                       # Electron main, IPC, window, menus (Settings… ⌘,, TEMP "Restart App" ⌘⇧R)
├── preload.js                    # contextBridge → window.plottwist (incl. openExternal, getAppVersion)
├── scripts/
│   └── copy-vendor.js            # postinstall: vendor pdfjs + polygon-clipping
├── renderer/
│   ├── index.html                # CSP, sidebar+layers split, vendor script tag, app.js entry
│   ├── styles.css                # navy + magenta chrome, settings modal, pick-mode + update banners
│   ├── app.js                    # entry: keyboard (incl. ⌘Z, arrow nudge, ⌘,), file menu, image import,
│   │                             #   shape clipboard, pick-mode banner, auto-save, launch update check
│   ├── state.js                  # pub-sub state, undo/redo + transactions, project model, type styles
│   ├── settings.js               # localStorage-backed settings (defaults + listeners)
│   ├── updater.js                # GitHub releases check + semver compare
│   ├── snapEngine.js             # anchor + edge snap, getSnapPoints / collectSnapAnchors / snapPointToAnchors
│   ├── geom.js                   # bounds, area, hit-test (incl. dim), distToSegment, axis snap
│   ├── units.js                  # parseInches / formatInches / formatSqFt
│   ├── canvas.js                 # SVG scene, pan/zoom, calibration, snap indicator, origin + centerline
│   │                             #   guides, auto-aisle preview, table/chair/dim render, pick-mode handlers
│   ├── shapeOps.js               # polygon-clipping wrapper (union; subtract/intersect later)
│   ├── imageImport.js            # PNG/JPG/PDF → data URL (lazy pdfjs)
│   ├── solver/
│   │   ├── index.js              # solveSeatingZone(zone, opts) dispatcher
│   │   ├── geom.js               # intoLocalFrame, horizontalSpans, subtractRanges/Obstructions,
│   │   │                         #   computeAislePositions / computeShiftedRoundAislePositions,
│   │   │                         #   pointInPolygon, itemTouchesAny, fitUnits, etc.
│   │   ├── theaterSolver.js      # row-scan, in-line chevron placement
│   │   ├── classroomSolver.js    # table-aware row-scan, in-line chevron, atomic table-unit obstruction filter
│   │   ├── roundsSolver.js       # grid/hex (offset rows) placement, fixed-aisles vs shift-mode aisles
│   │   └── mixedSolver.js        # front classroom + transition gap + back theater, with optimizer
│   ├── tools/
│   │   ├── rectTool.js           # rect drag for floor / aisle / obstr / stage / tech / SEATING (4-vertex poly)
│   │   ├── polygonTool.js        # walls polygon, STYLE_DEFAULTS, TABLE_PRESETS / ROUND_PRESETS / MIXED_TABLE_PRESETS
│   │   ├── dimTool.js            # drag-to-place dim line, snaps both endpoints
│   │   ├── selectTool.js         # move/resize/vertex drags, shift-axis-lock, translates seating result with zone
│   │   └── imageTool.js
│   ├── ui/
│   │   ├── toolbar.js            # VENUE / LAYOUT tool groups
│   │   ├── projectSidebar.js     # rooms + nested layouts hierarchy w/ eye + lock per layout
│   │   ├── objectList.js         # Photoshop-style layers panel, split into Venue / Layout sections
│   │   ├── objectInfo.js         # right pane — per-style seating UI, dim length+angle inputs, origin-relative X/Y
│   │   ├── settingsModal.js      # ⌘, modal — 3 tabs: Workspace / Defaults / Updates
│   │   └── icons.js              # inline SVG icons (eye / lock)
│   └── vendor/                   # gitignored; populated by `npm install`
│       ├── pdfjs/
│       └── polygon-clipping/
├── mockups/                      # standalone HTML mockups for design conversations
│   ├── seating-styles.html       # table & chair render-style options
│   ├── chevron-interpretations.html  # rotation-pivot exploration
│   └── chevron-mockups.html      # implemented behavior preview (theater / classroom / mixed × ± horz aisle)
├── data/
│   └── fireCode.json             # placeholder {} — populate during fire-code step
├── build/                        # icons, dmg-bg (TBD)
├── .github/workflows/            # release.yml — TBD
├── .gitignore
└── CLAUDE.md
```

**`.ptwist` project file** is JSON:
```
{ version,
  rooms: [{ id, name, objects: [...], layouts: [{ id, name, hidden, locked, objects: [...] }, ...] }, ...],
  origin:     { x, y },                                    // displayed-coords origin (Settings → Workspace)
  centerline: { enabled, x, color, thickness } }            // optional vertical guide
```

Object `kind`: `rect` / `polygon` / `image` / `dim`. Object `type`: `floor` / `aisle` / `obstruction` / `stage` / `tech` / `walls` / `underlay` / `dim` / `seating`. Seating polygons carry their solver config (`style`, `pattern`, `rotation`, `target`, `preference`, `aisles`, `fixedAisles`, `offsetRows`, `chevron` / `chevronAngle`, `transitionGap` for mixed, etc.) and a cached `result: { rows, seats, tables, totalSeats, warnings, optimizedDepth? }`. Common overrides: `name`, `hidden`, `locked`, `fill`, `fillOpacity`, `stroke`, `strokeWidth`, `opacity`. Underlay images are base64-embedded.

---

## Build order — progress + queue

Don't build ahead. Each step ships before the next starts.

### Done

1. ✅ **Scaffold** — Electron skeleton, navy + magenta chrome, footer, console-forwarding in dev.
2. ✅ **Room construction** — rectangle tool for floor/aisle/obstruction/stage/tech, walls polygon tool with shift-snap (0/45/90°), corner + mid-edge handles, right-click vertex insert/delete, ⌘6 fit, multi-room sidebar with new/rename/delete.
3. ✅ **Object types + Object Info** — full toolbar, fill/stroke/opacity per object, name field, area + bounds + per-vertex coords, live W/H/X/Y inputs (parse `24'`, `24'-6"`, `36"`, bare inches).
4. ✅ **Project model** — `.ptwist` save/load shipped. Layouts-within-rooms wired: each room carries `layouts[]`, sidebar shows them with independent eye/lock, active layout renders at full opacity while other visible layouts dim to 35%. Structural objects (floor, walls, obstruction, stage, tech, underlay) stay in `room.objects`; solver-generated objects (seating zones, aisles) will live in `layout.objects`.

### Pulled forward from v2

- ✅ **Underlay import** — PNG / JPG / PDF via file picker, drag-drop, ⌘V paste. PDFs lazy-load pdfjs at import time, page 1 → PNG at 2× scale, baked into the project as base64.
- ✅ **Two-click + distance calibration** with first-point pinned. Re-callable via the **Set Scale…** button on a selected underlay.
- ✅ **Photoshop-style layers panel** — visibility / lock SVG icons, drag-reorder, right-click Duplicate/Delete, double-click rename, top-of-list = top-of-stack.
- ✅ **Boolean Union** (Join → Polygon) via vendored polygon-clipping. Subtract / Intersect not yet wired but the lib is available.
- ✅ **Shape clipboard** — ⌘C / ⌘X / ⌘V on rect / polygon objects. Image clipboard takes priority on paste so a copied screenshot still rasterizes.
- ✅ **Universal pan** — wheel + ⇧wheel + space-bar drag (or middle-mouse drag) work in any mode including calibration.

### Next up (priority order)

5. ✅ **Layouts within rooms** — each room has `layouts[]`; sidebar shows room → layouts hierarchy with eye/lock per layout; active layout renders full, others dimmed; old .ptwist files auto-migrate with a default Layout 1.
6. ✅ **Theater solver (v1)** — Seating polygon tool (S key) drops a zone into the active layout. Object Info panel exposes style / pattern / facing (rotation) / Goal seat count / row spacing / max-per-row / aisle count + width. Solver scans rows in the zone's facing-up frame, intersects each row strip with the polygon, subtracts auto + user-drawn aisles, and lays 18×20 chairs flush against aisle edges. Toolbar split into VENUE and LAYOUT groups; layers panel split into the same two sections.
7. ✅ **Classroom solver** — table-aware. Object Info enables Classroom in the Style dropdown and shows a table-preset picker (6'×18", 8'×18", 6'×30", 8'×30") plus chairs/table. Solver fits tables along each row with chairs on the audience-facing edge, evenly distributed across the table width; row pitch defaults to 4'-6". Style dispatch refactored: `solver/index.js` routes by `zone.style`, with `theaterSolver.js` / `classroomSolver.js` plugging in. Shared scan-line helpers extracted to `solver/geom.js`. Result shape extended with `tables[]`. Switching styles auto-applies that style's defaults from `STYLE_DEFAULTS` (overridable via Settings → Defaults). Section width capped at 24' for fire-code.
8. ✅ **Rounds solver** — 60" / 72" / Custom diameter, configurable chair count (≤ 6 auto-renders crescent, ≥ 7 renders full circle), 5' default edge-to-edge spacing. **Fixed aisles** toggle: ON (default) distributes tables evenly across each section with even-with-min-spacing gaps; OFF runs SHIFT mode — tables tightly packed, aisles flush to blocks, slack pools at polygon outer edges (helper in `solver/geom.js#computeShiftedRoundAislePositions`). **Offset rows** toggle does proper hex packing (alternate rows shifted by half-pitch, row pitch shrinks to `pitch × √3/2` so diagonal table-center distance equals horizontal pitch). Outer chair-footprint circle drawn at `tableR + chairD` for collision visualization.
9. ✅ **Mixed solver** — front classroom + 6' transition gap + back theater. Tap **Mixed** in the dropdown → 50/50 split is seeded from polygon height. **Goal** seat count + Solve runs the optimizer (iterates classroom row counts, picks depth closest to target — over or under is fine). Result warnings include the chosen depth + ±1 row neighbor counts so the user can fine-tune. Inner classroom solve gets `sectionWCap` pinned to theater section width so 6' tables come out 3-per-section to match the 12 theater chairs above. Default classroom table is 6'×18" with 2 seats; only 6×18 / 8×18 / 6×30 are exposed in mixed (no 8×30, depth-greedy).
10. ✅ **Aisle objects + obstruction filter** — Aisle tool drops a real rect-kind aisle object in the active layout; solver respects user-drawn aisles alongside auto-placed ones (vertical aisles cut x-spans, horizontal aisles cause row-skipping in y). Stage / obstruction / tech are blocking — chairs that overlap (corner test) get dropped from the solve; classroom drops the whole table+chairs unit atomically. Width labels with arrow callouts on every aisle (always horizontal text, ⊥ arrows on the long axis).
11. ✅ **Chevron seating** — outer-section chevron for theater / classroom / mixed (NOT rounds — rounds get offsetRows instead). Each chevron'd row is a CONTINUOUS angled line of items anchored flush at the inner aisle edge, walking outward at `chevronAngle°` (default 15°, range −45..+45). Section stays rectangular, aisle stays straight; items that walk past the section's outer x-edge or into a horizontal aisle are dropped per-item. Positive angle slants outer end TOWARD the stage (default); negative reverses. Logic lives IN the placement loops (theaterSolver / classroomSolver), not as a post-process.
12. ✅ **Settings panel** — ⌘, opens the modal. **Workspace** tab: origin (with "Pick on canvas" mode), centerline (color, thickness, X position, "Pick on canvas" mode), grid (show + spacing), snap (enable + tolerance px). **Defaults** tab: nudge small / large, theater row pitch, classroom row pitch, aisle width, mixed transition gap, round table size / chair count / spacing, auto-save interval, undo history depth. **Updates** tab: current version, "Check now" button (fetches `api.github.com/repos/Horton619/plottwist/releases/latest`, opens via `shell.openExternal`), auto-check on launch toggle. Object Info displays X/Y inputs as origin-relative.
13. ✅ **Snap + nudge** — `snapEngine.js`: anchor snap (corners + edge midpoints + centers + chair / table centers from solver results) AND edge snap (perpendicular foot of any rect / polygon / dim segment) within `snapTolerance` px during a `move` drag and during dim-line drawing. Cyan ring + crosshair indicator. Shift-locked drags skip snap. Arrow-key nudge moves selected objects by `nudgeSmall` (default 1') / shift+arrow `nudgeLarge` (6'); each press is one undo step.
14. ✅ **Undo / redo** — Cmd+Z / Cmd+Shift+Z. Drags are wrapped in transactions so each gesture is one history step. Limit configurable via Settings. Cleared on file new / open. Selection / active room / viewport are NOT in undo (those use `setState`, only `mutateProject` snapshots).
15. ✅ **Auto-save + auto-update-check** — autoSaveInterval setting (off / 1 / 5 / 15 min). Re-arms on settings change. Skips Untitled projects. Auto-check fires 2 s after launch when enabled; dismissable banner if a newer release is published.
16. ✅ **Dim tool** — `D` key. Drag from start to end → teal dashed measurement line with end ticks + length label. Both endpoints snap (incl. edge snap to walls / polygon edges / chair-table centers). Object Info exposes Length AND Angle as editable inputs that pivot the END around the START.

### Open queue

17. ◻ **Fire code engine** — load jurisdictions from `data/fireCode.json` (Cook, Clark, Buena Vista, Reidy Creek), validate live, render magenta callouts on violations.
18. ◻ **Export** — PNG (raster) + PDF (vector via `pdf-lib`) with annotation overlay.
19. ◻ **Boolean Subtract / Intersect** — same UI pattern as Join, separate buttons in the multi-select Object Info panel.
20. ◻ **CI / release** — GitHub Actions per FlowCast pattern: Mac arm64 + Windows x64, ad-hoc Mac signing, draft promotion via `gh release edit … --draft=false --latest`.
21. ◻ **Diagnostics tab** — preflight check, log tail, auto-updater UI.
22. ◻ **Vertex / resize drag snapping** — snap engine currently handles `move` only; vertex and resize drags don't snap yet. Plumb the same `getSnapPoints` lookup into both other drag modes.
23. ◻ **Draggable aisle dim labels** — TODO comment in `canvas.js#buildAisleDimCallout`. Click + drag the callout along the aisle's long axis; persist the position fraction on the aisle object.
24. ◻ **Strip TEMP "Restart App" menu** before shipping (View → Restart App, ⌘⇧R, marked TEMP in `main.js`).

### Backlog / nice-to-have

- Tab-to-type in canvas (currently the right-panel inputs cover the same ground; defer until users miss it).
- Calibration on per-image basis with a stored `pxPerInch` so the underlay can be re-rendered at known scales.
- Multi-image batch calibration — currently each new import clobbers the previous calibration session.
- Underlay sidecar storage to keep `.ptwist` files small.
- Per-room origin / centerline (currently project-level — fine for one-venue projects, less so for multi-venue).
- Auto-optimize Mixed beyond goal-target (max classroom / max theater modes).
- Seat / row numbering in the rendered output.
- Hex packing for theater / classroom (currently rounds only).
- Curved (fan) row pattern for theater — chairs face a focal point instead of sharing one rotation.
