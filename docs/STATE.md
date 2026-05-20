# State model & containers

> Load this doc when adding state fields, creating/duplicating/pasting
> objects, working on undo/redo, or anything in `state.js` / `app.js`'s
> migration / save / load paths.

## TL;DR

Three forms of state with three different mutation rules:

| Form | Where | How to mutate | Undo? | Persists? |
|---|---|---|---|---|
| **Project** | `state.project` | `mutateProject(fn)` | Yes (snapshot) | Yes (`.ptwist` file) |
| **Settings** | `localStorage` via `settings.js` | `setSetting(k, v)` | No | Yes (localStorage) |
| **Transient** | other `state.*` fields | `setState(patch)` | No | No (per-session) |

Objects within a project live in one of two containers per room:

| Container | Holds | Why |
|---|---|---|
| `room.objects` | floor, walls, obstruction, stage, tech, underlay image, door | Structural / venue chrome. Travels with the room. |
| `layout.objects` | seating zones, aisles, dim lines | Solver-generated or layout-specific content. Each room can have multiple layouts. |

## The decisions / invariants (locked in)

- **`mutateProject(fn)` is the only path that snapshots for undo and
  flips `dirty=true`.** Touching `state.project` outside `mutateProject`
  silently skips undo and breaks the save indicator.
- **`setState(patch)` notifies subscribers but doesn't touch undo or
  dirty.** Use it for selection, viewport, active room/layout, drag
  state, fire-marshal report — anything you wouldn't expect to undo or
  save.
- **Drags wrap in `beginTransaction()` / `endTransaction()`** so the dozens
  of mutateProject calls during a drag collapse to ONE undo step. First
  mutation in the transaction snapshots; subsequent ones don't.
- **Origin and centerline are per-ROOM** (`room.origin`, `room.centerline`),
  not per-project. `.ptwist` v1 files had them at project level — the
  openProject path migrates v1 fields onto every room and deletes the
  project-level ones.
- **Seating zones, aisles, and dim lines MUST live on a layout, never
  on the room.** `LAYOUT_OBJECT_TYPES = new Set(['seating', 'aisle',
  'dim'])` in `app.js`. The `migrateStrayLayoutObjects()` pass runs on
  bootstrap AND on every openProject — if any of those types ended up in
  `room.objects` (older bug paths or paste sites), they get moved to the
  room's first layout with a console warning.
- **Type-aware paste/duplicate routing.** `pasteShapes()` and
  `duplicateObjectById()` in `app.js` route by object type — layout-type
  goes to active layout, everything else goes to venue. The pre-fix
  paste path pushed everything to `room.objects` and was the source of
  one of the stray-zone bugs.
- **Reflect-across-centerline keeps the original's container.** When
  reflecting a layout-zone, the mirror lands in the same layout; when
  reflecting a venue shape, the mirror lands in the venue.
- **Active room and active layout track separately.** Switching rooms
  preserves the active layout if it belongs to the new room; otherwise
  the room's first layout becomes active.
- **A room always has ≥1 layout.** Layout delete is blocked when there's
  only one. The bootstrap path seeds Room 1 + Layout 1 if `state.project.
  rooms` is empty.
- **Session defaults for label/door styles** live as module-level mutable
  state in `tools/polygonTool.js` (`SESSION_LABEL_DEFAULTS`) and
  `tools/rectTool.js` (`SESSION_DOOR_DEFAULTS`). NOT persisted across
  sessions — fresh launch resets. Edits in Object Info call
  `setLabelDefaults()` / `setDoorDefaults()` so the next-drawn object
  inherits the new style.
- **Underlay images are base64-embedded in `.ptwist`.** Sidecar file
  storage was rejected. `openProject` validates the `data:image/...`
  URL on load — rejects `data:text/html` / `javascript:` smuggling.

## Code references

| File | What it owns |
|---|---|
| `renderer/state.js` | `state` object, `subscribe`/`notify`, `mutateProject`/`setState`, undo/redo, transactions, `TYPE_STYLES`, `objectName`. |
| `renderer/settings.js` | localStorage-backed preferences. Separate listener bus. |
| `renderer/app.js` | Bootstrap, newProject, openProject (with v1→v2 migrations + stray-layout-object migration), saveProject. |
| `renderer/tools/polygonTool.js` | `SESSION_LABEL_DEFAULTS`, `STYLE_DEFAULTS` (per-style seating defaults). |
| `renderer/tools/rectTool.js` | `SESSION_DOOR_DEFAULTS`, defaultSeatingZoneFields. |

## What NOT to do

- ❌ **Don't mutate `state.project` outside `mutateProject`.** Skips undo
  and the save-dirty flag. If you see `state.project.rooms[0].objects.
  push(...)` anywhere outside a `mutateProject` callback, it's a bug.
- ❌ **Don't push a layout-type object (seating / aisle / dim) into
  `room.objects`.** Use the type-aware fallback pattern from
  `rectTool.js`:
  ```js
  if (LAYOUT_TYPES.has(type)) {
    const layout = layouts.find(l => l.id === state.activeLayoutId) || layouts[0]
    if (!layout) { console.warn('no layout'); return }
    layout.objects.push(obj)
  }
  ```
- ❌ **Don't put session-only state in `state.project`.** Toggling it
  creates undo steps and dirties the file. Use `state.x` + `setState`.
- ❌ **Don't put persistent settings in `state.project`.** Settings
  belong to localStorage so they survive across projects.
- ❌ **Don't forget to call `endTransaction()` after a drag.** A leaked
  open transaction breaks undo grouping for the next gesture.
- ❌ **Don't add a new object type without choosing a container.** Edit
  `LAYOUT_OBJECT_TYPES` in app.js when you add one — it gates the
  migration pass.
- ❌ **Don't bypass the SAFE_DATA_IMG check in openProject for underlay
  images.** Allowing arbitrary data: URLs lets `.ptwist` files smuggle
  HTML / JS.
