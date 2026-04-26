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

- **Electron** + vanilla HTML/CSS/JS renderer (per VEP family)
- **SVG** for the floorplan canvas — every object is a clickable DOM node, makes selection/handles/transforms easy and exports to PDF as true vectors
- **No Python.** Unlike SlideFluid (PPTX parsing) and FlowCast (video), PlotTwist is pure geometry + rendering. PNG export via SVG → canvas/dataURL. PDF export via `pdf-lib` or Electron's built-in `webContents.printToPDF()`.
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

- **Underlay tracing** — drop a PNG/PDF of an existing floorplan and trace over it. Useful when a venue sends a PDF you want to copy from. Polygon tool covers most needs without it. Defer to v2.
- **Curved walls / arc segments.** Polygon tool with straight edges only in v1.
- **Metric units.**
- **Cloud sync / multi-user.**
- **Real Vectorworks file IO.**
- **Aisle-split mixed-style rows.**

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

## Repo

`Horton619/plottwist` — release on `v*` tag push, ad-hoc signed only (no Apple Developer account).

---

## Initial scaffold target

```
PlotTwist/
├── package.json           # electron, electron-builder, electron-updater, pdf-lib
├── main.js                # Electron main, window, IPC, project file I/O
├── preload.js             # contextBridge → window.plottwist
├── renderer/
│   ├── index.html
│   ├── styles.css
│   ├── app.js             # top-level state + layout switching
│   ├── canvas.js          # SVG scene, pan/zoom, selection, handles
│   ├── tools/             # rectTool.js, aisleTool.js, seatTool.js, ...
│   ├── solver/            # capacitySolver.js, layoutEngine.js, fireCode.js
│   └── ui/                # objectInfo.js, projectSidebar.js, toolbar.js
├── data/
│   └── fireCode.json
├── build/                 # icons, dmg-background
├── .github/workflows/release.yml
├── .gitignore
└── CLAUDE.md
```

---

## Build order (rough roadmap)

1. **Scaffold** — Electron skeleton, navy + magenta chrome, footer, empty SVG canvas
2. **Room construction** — rectangle tool, handles, tab-to-type, Object Info panel
3. **Object types** — toolbar, floor/aisle/obstruction/stage/tech table, fill/stroke/name controls
4. **Project model** — save/load .ptwist files, rooms + layouts sidebar
5. **Theater solver** — single-style, fits target into a zone with fire-code-aware spacing
6. **Classroom solver** — single-style, table-aware
7. **Rounds solver** — full + crescent
8. **Mixed solver** — theater + classroom in one zone, optimize for preference
9. **Fire code engine** — load jurisdictions, validate live, magenta callouts on violations
10. **Export** — PNG and PDF with annotation overlay
11. **CI / release** — GitHub Actions, draft promotion, ad-hoc signing
12. **Diagnostics tab** — preflight, log tail, auto-updater UI

Don't build ahead. Each step ships before the next starts.
