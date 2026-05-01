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

---

## Repo

`Horton619/plottwist` — release on `v*` tag push, ad-hoc signed only (no Apple Developer account).

---

## Current file layout

```
PlotTwist/
├── package.json
├── main.js                    # Electron main, IPC, window, menus
├── preload.js                 # contextBridge → window.plottwist
├── scripts/
│   └── copy-vendor.js         # postinstall: vendor pdfjs + polygon-clipping
├── renderer/
│   ├── index.html             # CSP, vendor script tag, app.js entry
│   ├── styles.css             # navy + magenta chrome, layers panel, calibration banner
│   ├── app.js                 # entry: keyboard, file menu, image import, shape clipboard
│   ├── state.js               # pub-sub state, project model, type styles, reorder/name helpers
│   ├── geom.js                # bounds, area, hit-test, segment distance, 45° snap
│   ├── units.js               # parseInches / formatInches / formatSqFt
│   ├── canvas.js              # SVG scene, pan/zoom, calibration, midpoint handles
│   ├── shapeOps.js            # polygon-clipping wrapper (union; subtract/intersect later)
│   ├── imageImport.js         # PNG/JPG/PDF → data URL (lazy pdfjs)
│   ├── tools/
│   │   ├── rectTool.js
│   │   ├── polygonTool.js
│   │   ├── selectTool.js
│   │   └── imageTool.js
│   ├── ui/
│   │   ├── toolbar.js
│   │   ├── projectSidebar.js
│   │   ├── objectList.js      # Photoshop-style layers panel
│   │   ├── objectInfo.js
│   │   └── icons.js           # inline SVG icons (eye / lock)
│   └── vendor/                # gitignored; populated by `npm install`
│       ├── pdfjs/
│       └── polygon-clipping/
├── data/
│   └── fireCode.json          # placeholder {} — populate during fire-code step
├── build/                     # icons, dmg-bg (TBD)
├── .github/workflows/         # release.yml — TBD
├── .gitignore
└── CLAUDE.md
```

**`.ptwist` project file** is JSON: `{ version, rooms: [{ id, name, objects: [...] }] }`. Each object has `id`, `kind` (rect / polygon / image), `type` (floor / aisle / obstruction / stage / tech / walls / underlay), plus geometry and the optional `name`, `hidden`, `locked`, `fill`, `fillOpacity`, `stroke`, `strokeWidth`, `opacity` overrides. Underlay images are base64-embedded.

---

## Build order — progress + queue

Don't build ahead. Each step ships before the next starts.

### Done

1. ✅ **Scaffold** — Electron skeleton, navy + magenta chrome, footer, console-forwarding in dev.
2. ✅ **Room construction** — rectangle tool for floor/aisle/obstruction/stage/tech, walls polygon tool with shift-snap (0/45/90°), corner + mid-edge handles, right-click vertex insert/delete, ⌘6 fit, multi-room sidebar with new/rename/delete.
3. ✅ **Object types + Object Info** — full toolbar, fill/stroke/opacity per object, name field, area + bounds + per-vertex coords, live W/H/X/Y inputs (parse `24'`, `24'-6"`, `36"`, bare inches).
4. ⚠ **Project model** — `.ptwist` save/load shipped. **Layouts-within-rooms is NOT yet built**: rooms own objects directly; the spec wants rooms to share geometry across multiple layouts (Theater 220, Mixed 175, etc.). Wire that nesting before the solver lands so seating zones can swap without touching room geometry.

### Pulled forward from v2

- ✅ **Underlay import** — PNG / JPG / PDF via file picker, drag-drop, ⌘V paste. PDFs lazy-load pdfjs at import time, page 1 → PNG at 2× scale, baked into the project as base64.
- ✅ **Two-click + distance calibration** with first-point pinned. Re-callable via the **Set Scale…** button on a selected underlay.
- ✅ **Photoshop-style layers panel** — visibility / lock SVG icons, drag-reorder, right-click Duplicate/Delete, double-click rename, top-of-list = top-of-stack.
- ✅ **Boolean Union** (Join → Polygon) via vendored polygon-clipping. Subtract / Intersect not yet wired but the lib is available.
- ✅ **Shape clipboard** — ⌘C / ⌘X / ⌘V on rect / polygon objects. Image clipboard takes priority on paste so a copied screenshot still rasterizes.
- ✅ **Universal pan** — wheel + ⇧wheel + space-bar drag (or middle-mouse drag) work in any mode including calibration.

### Next up (priority order)

5. ◻ **Layouts within rooms** — nest each room's seating layouts under `Layouts[]` per the original spec; sidebar reflects "room → layouts" hierarchy. Lands BEFORE the theater solver so it has a place to live.
6. ◻ **Theater solver** — single-style, scan-line fit into a zone polygon with fire-code-aware spacing. 12-per-row default, 20" front-to-front, 12'/6' aisle.
7. ◻ **Classroom solver** — single-style, table-aware (6'×18", 6'×30", 8'×18", 8'×30").
8. ◻ **Rounds solver** — full + crescent (60", 72").
9. ◻ **Mixed solver** — theater + classroom in one zone, optimize for `max classroom` / `max theater` / `exact count`.
10. ◻ **Fire code engine** — load jurisdictions from `data/fireCode.json` (Cook, Clark, Buena Vista, Reidy Creek), validate live, render magenta callouts on violations.
11. ◻ **Export** — PNG (raster) + PDF (vector via `pdf-lib`) with annotation overlay.
12. ◻ **Boolean Subtract / Intersect** — same UI pattern as Join, separate buttons in the multi-select Object Info panel.
13. ◻ **CI / release** — GitHub Actions per FlowCast pattern: Mac arm64 + Windows x64, ad-hoc Mac signing, draft promotion via `gh release edit … --draft=false --latest`.
14. ◻ **Diagnostics tab** — preflight check, log tail, auto-updater UI.

### Backlog / nice-to-have

- Tab-to-type in canvas (currently the right-panel inputs cover the same ground; defer until users miss it).
- Calibration on per-image basis with a stored `pxPerInch` so the underlay can be re-rendered at known scales.
- Multi-image batch calibration — currently each new import clobbers the previous calibration session.
- Underlay sidecar storage to keep `.ptwist` files small.
