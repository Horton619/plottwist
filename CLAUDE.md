# PlotTwist

> **Project-scoped CLAUDE.** Loads when working in `/Users/horton/PlotTwist/`.
> Cross-project lessons live in `~/.claude/CLAUDE.md` (the "global CLAUDE").

PlotTwist is a working Electron app: a seating-layout calculator with a
polygon room editor, a four-style solver (theater / classroom / rounds /
mixed), fire-marshal validation against four AHJs, and PNG/PDF export with
a title block. Shipped v0.1.5. No bundler, no TypeScript, no test suite —
just ES modules in the renderer, a thin IPC bridge in preload, and Electron
main for window/menu/file dialogs.

---

## ⚠ READ FIRST — load the right topic doc before writing code

| If your task touches… | Read first |
|---|---|
| chevron, aisles, row pitch, classroom depth, goal/cap, mixed seating, `renderer/solver/*` | [`docs/SOLVER.md`](docs/SOLVER.md) |
| `state.project` mutations, undo, paste/duplicate, container routing, openProject migrations, `state.js` / `app.js` | [`docs/STATE.md`](docs/STATE.md) |
| `canvas.js`, drag modes, vertex/edge handles, mid-edge behavior, snap engine, pointer dispatch, NSS dasharray | [`docs/CANVAS_AND_SNAP.md`](docs/CANVAS_AND_SNAP.md) |
| fire-code rules, AHJ values, `fireMarshal.js`, capacity bar, adding a new rule | [`docs/FIRE_MARSHAL.md`](docs/FIRE_MARSHAL.md) |
| `exportLayout.js`, export dialog, title block, theme palette, PNG/PDF output | [`docs/EXPORT.md`](docs/EXPORT.md) |
| signing, notarization, `.github/workflows/release.yml`, `package.json` build block, autoUpdater, update banner | [`docs/RELEASES.md`](docs/RELEASES.md) |

If your task touches multiple areas, load multiple docs. Don't skip them
even on small changes — the docs are sized small (50–150 lines each) so
loading two is still cheap.

---

## Universal rules (apply everywhere)

- **Don't commit until asked.** When asked, draft a focused message; never
  `git push` without explicit instruction.
- **Don't refactor / extract / rename beyond the requested change.** Three
  similar lines is better than a premature abstraction.
- **Don't add error handling around internal code.** Validate at boundaries
  only (IPC, file load, GitHub API). Trust internally.
- **Don't add `what` comments.** Only `why` — hidden constraints,
  workarounds, surprises.
- **Imperial only, integer inches internally.** Bare-number input means
  feet (`30` → 30'). `"` suffix forces inches.
- **`mutateProject(fn)` is the only path that snapshots for undo and dirties
  the file.** `setState(patch)` is for transient state.
- **`vector-effect="non-scaling-stroke"` interprets `stroke-dasharray` in
  screen pixels, not world units.** Don't multiply by `pxToWorldDist`.
- **Solver-generated objects (seating, aisles, dim lines) live on a
  LAYOUT, not the room.** Type-aware routing; see STATE.md.
- **Shift = aggressive snap, not bypass.** Bypass = the Settings toggle.

---

## Stack

- **Electron** 29 (main + Chromium renderer, preload bridge with
  `contextIsolation: true`, `nodeIntegration: false`).
- **Vanilla ES modules in the renderer.** No bundler, no TypeScript,
  no JSX. Direct DOM + SVG.
- **Vendored libs** copied at postinstall (`scripts/copy-vendor.js`):
  `polygon-clipping` for boolean ops, `pdfjs-dist` for PDF underlay
  import. `electron-updater` is a normal npm dep.
- **CSP** allows `'self'`, `data:`, `blob:`, `wasm-unsafe-eval` (pdfjs
  worker), and `https://api.github.com` (renderer-side update check).

## Current state

Shipped v0.1.5 with: walls + obstructions + stages + tech as venue
chrome; doors with single/dual swing + opens-in/out; seating zones with
4 styles; auto-aisles + user aisles; per-zone seat-count labels;
per-room origin + centerline + reflect-across-centerline; fire-marshal
validator with 9 rules across 4 AHJs + capacity bar; PNG + PDF export
with light/dark theme; in-app auto-update via GitHub Releases (mac
arm64 signed + notarized, win x64 unsigned).

## Project structure

```
main.js                            Electron main: BrowserWindow, menus, IPC
preload.js                         contextBridge bridge (file dialogs, IPC)
data/fireCode.json                 Fire-code rules + per-AHJ values        → docs/FIRE_MARSHAL.md
build/                             Icons, entitlements, DMG bg, icon.svg   → docs/RELEASES.md
.github/workflows/release.yml      Tag-driven build pipeline               → docs/RELEASES.md
scripts/build-icons.sh             Regenerates icon.icns / .ico / dmg-bg
renderer/
  app.js                           Bootstrap, file open/save, migrations    → docs/STATE.md
  state.js                         State + mutateProject + undo             → docs/STATE.md
  settings.js                      localStorage-backed preferences
  canvas.js                        Render + pointer dispatch + drag         → docs/CANVAS_AND_SNAP.md
  snapEngine.js                    Anchor + edge snap                       → docs/CANVAS_AND_SNAP.md
  geom.js                          Generic geometry (pointInPolygon, bounds)
  shapeOps.js                      Boolean union / subtract / intersect
  exportLayout.js                  Paper-scaled SVG output                  → docs/EXPORT.md
  fireMarshal.js                   Validator + strictest-AHJ merge          → docs/FIRE_MARSHAL.md
  updater.js                       Renderer-side GitHub REST fallback       → docs/RELEASES.md
  imageImport.js                   PDF / PNG / JPG underlay import
  strings.js                       Shared escapeHtml / escapeAttr / escapeText
  units.js                         Inches ↔ feet'-inches" parse/format
  colors.js                        BRAND + ANNOT color tokens
  solver/
    index.js                       Style dispatcher                         → docs/SOLVER.md
    geom.js                        Local frame, scan-line, tagObstructions  → docs/SOLVER.md
    theaterSolver.js               Row fit + chevron + per-section cap      → docs/SOLVER.md
    classroomSolver.js             Same row mechanic, table units           → docs/SOLVER.md
    roundsSolver.js                Round tables, hex packing, crescent      → docs/SOLVER.md
    mixedSolver.js                 Classroom + theater split + optimizer    → docs/SOLVER.md
  tools/
    rectTool.js                    Rect drag for floor/aisle/stage/etc/door → docs/STATE.md
    polygonTool.js                 Polygon draw for walls + seating zones   → docs/STATE.md
    dimTool.js                     Dim line draw
    imageTool.js                   Insert underlay image
    selectTool.js                  Hit-test helpers used by canvas.js
  ui/
    toolbar.js                     Tool selection chrome
    projectSidebar.js              Rooms + layouts list, add/rename/delete
    objectList.js                  Layers panel + running seat total
    objectInfo.js                  Per-object property editor               → docs/STATE.md + SOLVER.md
    settingsModal.js               Settings dialog (Workspace/Defaults/FireCode/Updates)
    exportDialog.js                Page Setup + Export                      → docs/EXPORT.md
    fireMarshalSheet.js            Slide-in violations panel                → docs/FIRE_MARSHAL.md
    icons.js                       SVG icon literals (eye, lock, etc.)
```

## Data model

```
project (saved as .ptwist v2)
├── rooms[]                        Each room is a venue
│   ├── id, name
│   ├── origin: { x, y }           Per-room as of v2; v1 migrates on load
│   ├── centerline: { enabled, x, color, thickness }
│   ├── objects[]                  Structural: floor, walls, obstruction,
│   │                              stage, tech, underlay image, door
│   └── layouts[]                  Each layout is a configuration
│       ├── id, name, hidden, locked
│       └── objects[]              Solver-generated: seating, aisle, dim
└── fireCode: { jurisdictions[] }  Active AHJ ids

LAYOUT_OBJECT_TYPES = new Set(['seating', 'aisle', 'dim'])
  ↑ enforced via migration on every project open; never push these into room.objects
```

## Environment & credentials

- Node + npm + Electron toolchain. No Python.
- `gh` CLI authenticated.
- Apple signing: VEP team cert `L5KZ5KGKXC`, 5 GH secrets per the
  global CLAUDE recipe. See `docs/RELEASES.md`.

## Running locally

- `npm start` — Electron app, no packaging. Auto-updater is a no-op in
  dev (only fires when `app.isPackaged`).
- `npm run dist:mac` — Build a notarized DMG locally (needs the 5
  Apple env vars set).
- `npm run release:mac` / `release:win` — Build AND publish to GitHub
  (CI does this on tag push; running it locally is rare).
- Tag-driven release: `git tag v0.1.X && git push origin v0.1.X`.

## Universal quirks (cross-cutting, too small for a topic doc)

- **No bundler, no TypeScript.** Vendored libs via postinstall. Don't
  introduce a build step.
- **Per-zone fields can be missing on old data.** Fields like
  `seatCountLabel`, `tableNumbering`, `seatGap`, etc. default to safe
  values if undefined — don't make them required.
- **Hidden ≠ removed.** A hidden aisle still counts in solver math. A
  hidden seating zone still ships data into the project file. Hidden is
  purely a render-time concern.
- **`pattern` field on seating zones was scaffolding.** Removed from
  the UI; chevron is its own boolean now. Old `.ptwist` files may still
  carry `pattern: 'straight'` — ignore it.
- **Don't add a `Restart App` menu item.** There's still a TEMP one in
  `main.js:96` for dev iteration; remove it before final ship.

## Branding / design

Navy `#070910` background, magenta accent `#FF2D9D`. Fire-marshal
violations use red `#FF3B30` (NOT magenta — red reads as warning;
magenta is brand chrome). Print export inverts: white paper, dark-navy
strokes (`#1a2942`), brand-color reserved for the TOTAL SEATS headline.

Visual language defaults inherit from the global CLAUDE.

## Open work

Truly undecided, not just unwritten:

- **Fire-code rule coverage.** 9 rules ship across 4 AHJs; real
  jurisdictions have dozens more. Citation verification (`verify=true`
  flags) hasn't happened.
- **Walls as containment boundary.** Backlog. Walls currently work as
  edge-only obstructions (stroke blocks chairs); some users may want
  "drop chairs outside the wall polygon" too.
- **Walls + floors integration.** "Click on a wall polygon → auto-add a
  matching floor" was promised in a recent session but not built.
- **Image rotation.** ⌘L / ⇧⌘L is the spec; rotation field + hit-test
  AABB + handle math undone.
- **Tab-to-type in canvas.** Object Info inputs cover the same ground;
  defer until users miss it.

## How I (Dave) work

- Not a professional programmer. Comfortable with high-level concepts;
  picks up vocabulary over time. Frame technical detail in plain English
  alongside the jargon, not instead of it.
- Decisive when shown options. "A vs B, here are the trade-offs" → fast
  pick. Open-ended "what should we do" → frustration.
- Step-by-step. Don't bundle three features into one diff.
- Wants uncertainty flagged. "I'm not sure if this affects X — should I
  check?" is welcomed. Confident tone on a guess is a problem.
- Reads diffs carefully and pushes back. Multiple iterations on chevron,
  table-style, and aisle math happened because the first interpretation
  was wrong. Pushback usually means the spec was incomplete — look at a
  reference image or mockup before another try.

## Working agreement

### Ask before doing when:
- Change spans 3+ files. Show a one-paragraph plan + file list first.
- Spec implies a UI affordance that doesn't exist yet.
- A request and a documented decision conflict — surface the conflict,
  don't silently resolve it.

### Just do it when:
- One-file diff, mechanical change, no design decisions.
- Bug fix where the fault is unambiguous.
- Cosmetic / copy / styling tweak.

### Always re-read source when:
- It's been more than ~5 turns since you last read the file.
- A summary block tells you you're picking up after a context reset.
  Trust the file tree and `git log` over the summary.
- You're about to make an assumption that starts "I think the function
  signature is…" — read it instead.

### Multi-file change preview format:
```
Touches:
- renderer/solver/geom.js     — add `pointInPolygon` containment helper
- renderer/solver/index.js    — thread `opts.containers` to dispatcher
- renderer/solver/theaterSolver.js  — apply containment after place
Risk: classroomSolver/roundsSolver also need it; flag if I should
do those in this diff or a follow-up.
```
List, not prose.

## Reference paths

- Global CLAUDE: `~/.claude/CLAUDE.md`
- Reference desktop project (for build/signing patterns): `~/calltime/` is
  web-only; FlowCast / SlideFluid are the closest Electron siblings.
