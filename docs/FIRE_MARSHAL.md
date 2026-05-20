# Fire marshal validator

> Load this doc when adding / modifying fire-code rules, AHJ values,
> capacity math, or anything in `renderer/fireMarshal.js`,
> `renderer/ui/fireMarshalSheet.js`, or `data/fireCode.json`.

## TL;DR

On-demand validator. User picks one or more **AHJs** (jurisdictions) in
Settings → Fire Code; Tools → Fire Marshal Check (⌘⇧F) runs the
validator against the active layout and shows a panel with violations
plus a **capacity bar** (occupancy / egress required / egress present /
shortfall). Per-rule strictest-active-jurisdiction wins. Every value in
`data/fireCode.json` carries `verify=true` — **none of it is
authoritative**, all should be confirmed with the actual AHJ.

## The decisions / invariants (locked in)

- **One rule definition + one direction + one strictest-merge.** Adding
  a rule means: (a) rule descriptor in `data/fireCode.json`'s top-level
  `rules` block, (b) per-AHJ value object under each jurisdiction's
  `values`, (c) `STRICTNESS[ruleId] = 'max'|'min'` in `fireMarshal.js`,
  (d) a validator block in `runFireMarshal()`.
- **`STRICTNESS` direction is the merge function.** `'max'` (most rules)
  picks the largest value across active AHJs — strictest min-width is
  the largest. `'min'` (max-seats-per-row, egressMaxDistance) picks the
  smallest — strictest seat-count cap is the smallest number.
- **`runFireMarshal()` returns a uniform result shape:**
  ```js
  {
    activeIds:     [...],
    jurisdictions: [{ id, name }, ...],
    strictest:     { [ruleId]: { value, code, jurisdictionIds:[id...], ... } },
    violations:    [{ id, severity, ruleId, ruleLabel, jurisdictionId,
                      jurisdictionName, code, message, anchor, objectId }],
    summary:       { errors, warnings, info,
                     occupancy, egressRequired, egressPresent, egressDeficit },
  }
  ```
- **Violations carry a world-coord `anchor`** for the canvas overlay
  (numbered red dots). `null` anchor = render in the sheet only (not on
  the canvas).
- **Capacity bar lives in `result.summary`.** Occupancy = solver-placed
  seats across all visible seating zones. Egress required = occupancy ×
  `aisleCapacityFactor` (IBC 1005.3.2 level egress; stairs would use
  0.3, we use 0.2). Egress present = sum of door widths. Deficit becomes
  its own violation tied to the capacity factor's AHJ.
- **Severity tiers: 'error' / 'warn' / 'info'.** Error = code violation;
  warn = can't validate (no doors placed, missing data); info =
  informational note (no AHJ selected). The sheet color-codes them.
- **Rules that need an aisle skip when aisle count is 0.**
  maxSeatsRowOneAisle/TwoAisles only meaningfully apply when there's an
  aisle to egress past. The validator has an explicit skip.
- **Wall-clearance uses point-to-segment distance**, not point-in-poly.
  `distancePointToSegment` in `fireMarshal.js`. Walls are stroke-only
  obstructions for the solver too — same idea.
- **Egress distance is straight-line, not pathfinding.** Approximation
  of IBC 1017.2 travel-distance. If obstructions force a detour, the
  actual path could exceed the limit; we don't model that yet.
- **No doors placed = warning (not error).** "Can't validate" is
  informational. The user might not have placed doors yet.

## Current rule inventory (9 rules)

| ruleId | Unit | Direction | Notes |
|---|---|---|---|
| `aisleMinWidth` | inches | max | Strictest active min wins. |
| `aisleCapacityFactor` | in/occ | max | Multiplied by occupancy → required width. |
| `theaterRowClearMin` | inches | max | `rowSpacing − chairD ≥ value`. |
| `maxSeatsRowOneAisle` | count | min | Rows that egress to ONE aisle. |
| `maxSeatsRowTwoAisles` | count | min | Rows that egress to TWO aisles. |
| `roundsBackToBackMin` | inches | max | Round-table back-to-back chair clearance. |
| `stageClearanceMin` | inches | max | Front row to stage. |
| `wallClearanceMin` | inches | max | Seat to nearest wall edge. |
| `egressMaxDistance` | feet | min | Furthest seat to nearest door. |

## Code references

| File | What it owns |
|---|---|
| `renderer/fireMarshal.js` | Validator, `STRICTNESS` map, `strictestValues` merge, `runFireMarshal` (per-rule blocks), `distancePointToSegment`, `distanceFromPointToRect`. |
| `renderer/ui/fireMarshalSheet.js` | The slide-in panel; capacity bar, violations list, jurisdictions chips, re-run button. |
| `data/fireCode.json` | Rule definitions + AHJ values + citations. All values have `verify=true` and a `note` field. |
| `renderer/ui/settingsModal.js` (Fire Code tab) | AHJ checkboxes. State stored on `state.project.fireCode.jurisdictions`. |

## Adding a new rule (recipe)

1. Add the rule descriptor in `data/fireCode.json` under `"rules"`:
   ```json
   "myRule": { "label": "...", "unit": "in", "appliesTo": ["..."], "description": "..." }
   ```
2. Add per-AHJ values under EACH jurisdiction's `"values"`:
   ```json
   "myRule": { "value": 36, "code": "IBC X.Y", "verify": true, "note": "..." }
   ```
3. Add to `STRICTNESS` in `fireMarshal.js`:
   ```js
   myRule: 'max',  // or 'min'
   ```
4. Add the validator block in `runFireMarshal()`:
   ```js
   const r = result.strictest.myRule
   if (r) {
     for (const z of seatingZones) {
       // compute, then push({ severity, ruleId: 'myRule', ... })
     }
   }
   ```

## What NOT to do

- ❌ **Don't treat `verify=true` values as authoritative.** They're
  planning aids. The disclaimer in `fireCode.json`'s top-level
  `_disclaimer` field is loadbearing — keep it.
- ❌ **Don't change a rule's `STRICTNESS` direction without thinking.**
  Picking `'min'` for `aisleMinWidth` would silently let the laxest
  jurisdiction win — exact opposite of the user's intent.
- ❌ **Don't read AHJ values from anywhere other than
  `result.strictest`.** Direct lookups skip the merge.
- ❌ **Don't push violations without an `anchor` field even if null.**
  The sheet expects all keys present; missing `anchor` crashes the
  canvas-callout pass.
- ❌ **Don't fold `wallClearance` math into the solver as a hard drop.**
  It's a SOFT rule — the solver still places chairs against walls; fire
  marshal warns. Conflating soft validation with hard placement breaks
  the "what would this AHJ object to" workflow.
- ❌ **Don't add IBC values without a `code` reference and a `note`.**
  Future you needs to verify the source.
- ❌ **Don't filter hidden aisles from the user-aisle list for the
  fire-marshal pass.** Hidden ≠ removed. Aisle filter:
  `o.type === 'aisle' && o.kind === 'rect'` — no `!o.hidden`.
