# PlotTwist — working agreement

> **Project-scoped CLAUDE.** Loads when working in `/Users/horton/PlotTwist/`. Cross-project lessons live in `~/.claude/CLAUDE.md` (the "global CLAUDE").

This file is for Claude. It is **not** project documentation — it is a
collaboration contract between Dave and whatever session is reading it.
Project facts go in source code and commit messages; this file tells you
how to behave.

---

## Project state

PlotTwist is a working Electron app: a seating-layout calculator with a
polygon room editor, a four-style solver (theater / classroom / rounds /
mixed), fire-marshal validation against four AHJs, and PNG/PDF export with
a title block. The ~7,700-line renderer is feature-complete through build
queue step 23. Remaining queue: GitHub Actions release pipeline, a
diagnostics tab, and a few small polish items. No bundler, no TypeScript,
no test suite — just ES modules in the renderer, a thin IPC bridge in
preload, and Electron main for window/menu/file dialogs.

Code quality is unusually high for a learning project: solvers are
factored cleanly into a dispatcher + per-style files with shared
geometry helpers, escaping is centralized in `strings.js`, color tokens
in `colors.js`, settings in `settings.js`. There is one `TEMP` marker
(View → Restart App in `main.js`) and zero `TODO/FIXME/HACK`. That is
not normal and means the codebase rewards careful reading — sloppy
inserts will stand out.

---

## Canonical references

Read these first, in this order, before touching anything non-trivial:

1. **`renderer/state.js`** — project shape, `mutateProject` vs
   `setState`, undo transactions, `STYLE_DEFAULTS`. Everything else is
   downstream of this.
2. **`renderer/solver/index.js`** then **`renderer/solver/geom.js`** —
   dispatcher + the shared scan-line / aisle / obstruction helpers.
   The four style solvers (`theaterSolver.js`, `classroomSolver.js`,
   `roundsSolver.js`, `mixedSolver.js`) all build on these.
3. **`renderer/canvas.js`** (1,482 lines) — render loop, pointer
   dispatch, drag modes, snap indicator. The biggest file by far. If
   you're touching interaction, read the whole thing — the priority
   ordering in `onPointerDown` is load-bearing.
4. **`renderer/ui/objectInfo.js`** (682 lines) — every per-object UI
   control lives here. If a property exists on an object, the editor for
   it is somewhere in this file.
5. **Commit messages from May 1–2, 2026** (`a67d39d` onward) — the four
   QA-batch commits document real bugs and their fixes. They are
   load-bearing context, not just changelog noise.

### Staleness warning

Earlier versions of this file were a 400-line project-doc / build-queue
hybrid. **That content is stale and was deliberately deleted.** Do not
try to reconstruct it from memory or from prior turns of any
conversation. The source of truth for "what's done" is git log; the
source of truth for "what exists" is the file tree; the source of truth
for "how it works" is the code itself. If you find yourself wanting to
quote build-queue step numbers or a `Done / Open / Backlog` list, stop
— that scaffolding was for a prior phase of the project and is no
longer how decisions get made.

---

## Decisions already made (don't relitigate)

These are non-obvious choices Dave landed on after iteration. Restating
the trade-off without new information wastes a turn.

- **No bundler, no TypeScript.** Vendored libs via `scripts/copy-vendor.js`
  postinstall. CSP allows the minimum needed for vendored pdfjs.
- **Imperial only.** Internally integer inches. Bare-number input means
  feet, not inches (`30` → 30'). `"` suffix forces inches.
- **Solver semantics: goal, not cap.** When `preference: 'exact'` with a
  `target`, fill complete rows and stop once `totalSeats >= target`.
  One row of spill is acceptable. The Object Info label is "Goal", not
  "Cap".
- **Same style per row.** Aisle-split mixed rows are explicitly out of
  scope. Mixed = front classroom + transition gap + back theater.
- **Chevron lives inside the placement loop**, per-row, anchored at the
  inner aisle edge. It is *not* a section rotation post-process. Default
  angle slants outer ends *toward* the stage; negative reverses.
- **Chevron is for theater/classroom/mixed only. Rounds use offsetRows
  (hex packing) instead.**
- **Obstruction filter is a post-process** corner test. Classroom drops
  the table+chairs as one atomic unit.
- **Walls ARE obstructions.** They're polygons in `room.objects` with
  `type: 'walls'` and live in the solver's `BLOCKING` set alongside
  obstruction / stage / tech. Use case: a room with pillars jutting in
  from the wall — the user drags the wall shape and the solver removes
  any chair that would collide. Earlier versions of this doc said walls
  were a containment boundary; that idea was rejected in favor of
  treating walls as just-another-obstruction.
- **Underlay images are base64-embedded** in `.ptwist`. Sidecar storage
  is v2.
- **Layouts within rooms.** Structural objects (floor, walls,
  obstruction, stage, tech, underlay) live on the room. Solver-generated
  objects (seating zones, aisles, dim lines) live on the layout. Don't
  mix the two arrays.
- **Visual language: navy `#070910` + magenta `#FF2D9D`.** Violations
  use red `#FF3B30`, NOT magenta — magenta is brand chrome, red reads
  as warning.
- **`vector-effect="non-scaling-stroke"` interprets `stroke-dasharray`
  in screen pixels, not world units.** Don't multiply dasharray values
  by `pxToWorldDist` on NSS strokes — that double-counts zoom.
- **GitHub releases via `electron-updater`** + a renderer-side fetch
  fallback for the manual "Check now" button. CSP must include
  `https://api.github.com` under `connect-src`. Main process fans every
  event in on a single `update-status` channel (`checking` / `available`
  / `progress` / `downloaded` / `error`) — don't add per-event IPC.
  `autoDownload = false`, `autoInstallOnAppQuit = true`.

---

## Open questions

Truly undecided, not just unwritten:

- **Fire-code rule coverage.** Seven rules ship across four AHJs. Real
  jurisdictions have dozens more. Which rules are next? Citation
  verification (`verify=true` flags in `data/fireCode.json`) hasn't
  happened.
- **Walls as containment boundary.** Backlog item, no design yet.
  Plumbed how — `opts.containers[]` through the dispatcher?
- **Image rotation.** ⌘L / ⇧⌘L is the spec; the rotation field, hit-test
  AABB, and handle math are not designed.
- ~~**Per-room vs project-level origin/centerline.**~~ Resolved: per-room.
  Each room carries its own `origin` and `centerline`. `.ptwist` v2.
  Older v1 files migrate on open (project-level fields copy to every room).
- **Tab-to-type in canvas.** Object Info inputs cover the same ground;
  defer until users miss it.
- ~~**CI release pipeline.**~~ Resolved: `.github/workflows/release.yml`
  ships mac-arm64 (real Developer ID signing + notarization via
  electron-builder) and win-x64 (unsigned for now), triggered on
  `v*.*.*` tag push. Uses the VEP-wide team cert (`L5KZ5KGKXC`) and the
  standard five secrets (CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID,
  APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID — see global CLAUDE.md
  for the full recipe). The renderer-side updater UI (live progress
  bar in Settings → Updates, top-of-window "Restart now" banner)
  forwards every electron-updater event on a single `update-status`
  IPC channel.

---

## How I work (Dave)

- Not a professional programmer. Comfortable with high-level concepts;
  picks up vocabulary over time. Frame technical detail in plain English
  alongside the jargon, not instead of it.
- Decisive when shown options. If you give a clear "A vs B, here are the
  trade-offs" at the right grain, expect a fast pick. If you ask
  open-ended "what should we do," expect frustration.
- Step-by-step is the rhythm. Each build-queue step shipped before the
  next started, and that's still how it works. Don't bundle three
  features into one diff.
- Wants uncertainty flagged, not hidden. "I'm not sure if this also
  affects X — should I check?" is welcomed. Confident tone on something
  you guessed at is a problem.
- Reads diffs carefully and pushes back when something is off. Multiple
  iterations on chevron, table-style, and aisle math happened because
  the first interpretation was wrong. Don't take pushback as defeat —
  it usually means the spec was incomplete and you both need to look at
  a reference image or mockup.
- Doesn't want commits or pushes unless asked. Doesn't want refactors,
  helpers, or "cleanups" beyond the requested change.

---

## Working agreement for future sessions

### Ask before doing when:
- The change spans 3+ files. Show a one-paragraph plan and the file
  list first.
  > *Good:* "Plan: add `containers[]` to opts in `solver/index.js`,
  > thread through 4 solvers, add `pointInPolygon` containment test in
  > `solver/geom.js`. Touches 6 files. Want me to proceed?"
  > *Bad:* (just doing it across six files in one tool block)
- The spec implies a UI affordance that doesn't exist yet. Don't invent
  the control without checking.
- A request and an existing decision in this file conflict. Surface the
  conflict before resolving it.
  > *Good:* "You said 'add chevron to rounds,' but the doc here says
  > rounds use offsetRows instead. Has that changed, or did you mean
  > something else?"

### Just do it when:
- One-file diff, change is mechanical, no design decisions involved.
- Bug fix where the fault is unambiguous from the symptom + code.
- Cosmetic / copy / styling tweak.

### Always re-read source when:
- It's been more than ~5 turns since you last read the file you're
  about to edit. Memory drift is real and `canvas.js` in particular
  changes shape between sessions.
- A summary block tells you you're picking up after a context reset.
  **Trust the file tree and `git log`, not the summary.** This session
  started with a summary that listed files like `fireMarshal.js` as if
  they were known — they were added in commits outside the prior chat
  and the summary preserved that fact, but it could just as easily
  have not. Verify.
- You're about to make an assumption that begins "I think the function
  signature is…" — it's faster to read it than to guess and patch.

### Flag unreliable memory by saying so:
> *Good:* "I'm working from the summary, not from the actual file —
> let me read `objectInfo.js` before suggesting where to add this."
> *Bad:* "The objectInfo panel has a section around line 400 where…"
> (when you haven't actually opened it this session)

### Spec conflict resolution:
1. State both sides plainly. ("The doc says X. Your last message implies
   Y.")
2. Ask which wins.
3. After the answer, if the doc is wrong, **update the doc in the same
   diff** as the code change. A doc that lies is worse than no doc.

### Fresh thread vs continue:
- **Continue** if the current session has the relevant files in cache
  and the work is incremental on top of recent changes.
- **Fresh thread** if you're starting a new build-queue step, or the
  domain shifts (e.g. moving from solver work to CI pipeline work). The
  cost of re-orienting in a fresh thread is lower than carrying stale
  assumptions from an unrelated discussion.
- A summary handoff is *not* free. Treat the first turn after a summary
  as "investigate before acting" — read 2–3 canonical files, then
  proceed.

### Multi-file change preview format:
When you do show a plan, use this shape:

```
Touches:
- renderer/solver/geom.js     — add `pointInPolygon` containment helper
- renderer/solver/index.js    — thread `opts.containers` to dispatcher
- renderer/solver/theaterSolver.js  — apply containment after place
Risk: classroomSolver/roundsSolver also need it; flag if I should
do those in this diff or a follow-up.
```

Not prose. Not "I'll update the geom helper and then…". A list.

---

## Anti-patterns (caught in this codebase before)

- Adding error handling, validation, or try/except around internal
  code. The rule is: validate at boundaries (IPC, file load, GitHub
  API), trust internally.
- Renaming "Goal" to "Target" or "Cap" because it sounds cleaner. The
  current names are deliberate (see `goal-not-cap` decision above).
- Making seating-zone fields optional when the solver requires them.
  Mixed solver in particular reads `optimizedDepth` and writes it back
  — don't shortcut around the round-trip.
- Touching `vector-effect="non-scaling-stroke"` math without checking
  the screen-px-vs-world-units footgun.
- Combining structural-objects (room.objects) with layout-objects
  (layout.objects) in one helper without checking which array is
  authoritative for the operation.
