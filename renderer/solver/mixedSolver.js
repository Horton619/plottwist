// ─────────────────────────────────────────────────────────────────────────
// Mixed solver — front classroom + back theater, vertically split at
// `zone.classroomDepth` from the local-frame front. Calls solveClassroom
// and solveTheater directly (bypassing the dispatcher) with inner zone
// configs that pin classroom section width to whatever the theater rows
// use so auto-aisles line up cleanly through both regions.
//
// ⚠ Read docs/SOLVER.md before editing.
//
// Key invariants:
//   • Inner solves run UNCONSTRAINED (`preference: 'max', target: undefined`)
//     so the optimizer can measure full counts at each depth.
//   • Optimizer mode (`zone.preference === 'exact'`) iterates classroom
//     row counts and picks the depth nearest the goal; writes the chosen
//     depth back as `optimizedDepth` for the UI to display.
//   • Transition gap is measured from the LAST classroom table's
//     audience-side edge to the FIRST theater chair's stage-side edge —
//     NOT from `splitY`. Computing from splitY leaves a row-pitch
//     leftover and the rendered gap was wrong (~9' instead of 6').
//   • Aisle-split mixed rows are explicitly out of scope. Same style per row.
// ─────────────────────────────────────────────────────────────────────────

import { intoLocalFrame, bbox } from './geom.js'
import { solveTheater }   from './theaterSolver.js'
import { solveClassroom } from './classroomSolver.js'

export function solveMixed(zone, opts = {}) {
  const verts = zone.vertices
  if (!verts || verts.length < 3) {
    return { rows: [], seats: [], tables: [], totalSeats: 0, warnings: ['Zone has too few vertices.'] }
  }

  const { localVerts } = intoLocalFrame(zone)
  const lb = bbox(localVerts)

  // ── Optimizer mode ─────────────────────────────────────────────────────
  // When the user has set a target (Cap seats checked) we iterate classroom
  // row counts and pick the depth whose total seats lands closest to target.
  // The chosen depth comes back on the result as `optimizedDepth` so the UI
  // can write it onto the zone for the user to see and tweak.
  if (zone.preference === 'exact' && zone.target > 0) {
    const classroomPitch = zone.rowSpacingClassroom || 54
    const polyH    = lb.maxY - lb.minY
    const maxRows  = Math.max(1, Math.floor(polyH / classroomPitch))
    let best = null
    let bestDelta = Infinity
    let bestDepth = 0
    for (let n = 0; n <= maxRows; n++) {
      const depth = n * classroomPitch
      const r = solveAtDepth(zone, opts, lb, depth)
      const delta = Math.abs(r.totalSeats - zone.target)
      if (delta < bestDelta) {
        bestDelta = delta
        best = r
        bestDepth = depth
      }
      // Total seats is monotonically non-increasing as classroom depth grows
      // (theater is denser), so once we drop below target we can stop early.
      if (r.totalSeats < zone.target) break
    }
    if (best) {
      const warnings = [...best.warnings]
      const delta = best.totalSeats - zone.target
      const sign  = delta > 0 ? '+' : ''
      const optimalRowCount = Math.round(bestDepth / classroomPitch)
      // Neighbor totals: what would one more / one fewer classroom row give?
      // Useful for "do I have room to push more classroom?" decisions.
      const lessRes = optimalRowCount > 0
        ? solveAtDepth(zone, opts, lb, (optimalRowCount - 1) * classroomPitch)
        : null
      const moreRes = (optimalRowCount + 1) <= maxRows
        ? solveAtDepth(zone, opts, lb, (optimalRowCount + 1) * classroomPitch)
        : null
      warnings.push(`Goal ${zone.target} → landed ${best.totalSeats} (${sign}${delta}) at ${optimalRowCount} classroom row${optimalRowCount === 1 ? '' : 's'}.`)
      if (lessRes) warnings.push(`−1 row (${optimalRowCount - 1}): ${lessRes.totalSeats} seats.`)
      if (moreRes) warnings.push(`+1 row (${optimalRowCount + 1}): ${moreRes.totalSeats} seats.`)
      return { ...best, optimizedDepth: bestDepth, warnings }
    }
  }

  return solveAtDepth(zone, opts, lb, Math.max(0, zone.classroomDepth || 0))
}

// Run the front-classroom / back-theater split at a specific classroom depth.
function solveAtDepth(zone, opts, lb, classroomDepth) {
  const splitY = Math.min(lb.minY + classroomDepth, lb.maxY)
  // 6' transition aisle measured from the LAST classroom table's audience-side
  // edge to the FIRST theater chair's stage-side edge. Computing it from
  // splitY (the end of the classroom region) leaves a row-pitch leftover plus
  // the chair depth, so the rendered gap was ~9' instead of 6'.
  const transitionGap = Math.max(0, zone.transitionGap ?? 72)
  const useGap = classroomDepth > 0 && splitY < lb.maxY

  // How many classroom rows actually fit in [lb.minY, splitY]?
  // Mirror of classroomSolver's row-stepping (yTop + rowUnitD <= yEnd + 0.5).
  const classroomRowH = zone.rowSpacingClassroom || 54
  const tableD = zone.tableD ?? 18
  const chairD = zone.chairD ?? 20
  const rowUnitD = tableD + chairD
  const fittingRows = (classroomDepth >= rowUnitD)
    ? Math.floor((classroomDepth - rowUnitD + 0.5) / classroomRowH) + 1
    : 0
  // Audience-side edge of the LAST classroom table (where chairs sit BEHIND).
  const lastClassroomTableEdge = fittingRows > 0
    ? lb.minY + (fittingRows - 1) * classroomRowH + tableD
    : lb.minY
  const theaterYStart = useGap
    ? Math.min(lastClassroomTableEdge + transitionGap, lb.maxY)
    : splitY

  // Inner zone configs overlay the classroom/theater-specific params on top
  // of the user's zone. Calling solveX directly bypasses the dispatcher.
  const classroomZone = {
    ...zone,
    style:      'classroom',
    rowSpacing: zone.rowSpacingClassroom || 54,
    tableW:     zone.tableW         ?? 96,
    tableD:     zone.tableD         ?? 18,
    chairsPerTable: zone.chairsPerTable ?? 3,
    // Inner solves run UNCONSTRAINED so the optimizer (or split) can measure
    // the full seat count at each depth. The mixed-level goal lives on the
    // outer zone and is consumed by solveOptimized above.
    preference: 'max',
    target:     undefined,
  }
  const theaterZone = {
    ...zone,
    style:      'theater',
    rowSpacing: zone.rowSpacing || 20,
    maxPerRow:  zone.maxPerRow  || 12,
    preference: 'max',
    target:     undefined,
  }

  // Pin the classroom section width to whatever the theater rows will use,
  // so 6' tables come out at 3-per-section to match theater's 12 chairs
  // (3 × 6' = 12 × 18" = 216"). 8' tables drop to 2-per-section, also
  // 192-216" wide. Same auto-aisle positions for both halves.
  const chairW   = zone.chairW || 18
  const seatGap  = zone.seatGap || 0
  const theaterSectionW = (theaterZone.maxPerRow * chairW)
                        + ((theaterZone.maxPerRow - 1) * seatGap)

  const classroomRes = (classroomDepth > 0)
    ? solveClassroom(classroomZone, {
        ...opts, yStart: lb.minY, yEnd: splitY, sectionWCap: theaterSectionW,
      })
    : { rows: [], seats: [], tables: [], totalSeats: 0, warnings: [] }
  const theaterRes = (theaterYStart < lb.maxY)
    ? solveTheater(theaterZone, { ...opts, yStart: theaterYStart, yEnd: lb.maxY })
    : { rows: [], seats: [], tables: [], totalSeats: 0, warnings: [] }

  // Re-index theater rows so their indices don't collide with classroom's.
  const offset = classroomRes.rows.length
  const reindexedTheaterRows  = theaterRes.rows.map(r => ({ ...r, index: r.index + offset }))
  const reindexedTheaterSeats = theaterRes.seats.map(s => ({ ...s, row: s.row + offset }))
  const reindexedTheaterTables = (theaterRes.tables || []).map(t => ({ ...t, row: t.row + offset }))

  return {
    rows:       [...classroomRes.rows, ...reindexedTheaterRows],
    seats:      [...classroomRes.seats, ...reindexedTheaterSeats],
    tables:     [...(classroomRes.tables || []), ...reindexedTheaterTables],
    totalSeats: classroomRes.totalSeats + theaterRes.totalSeats,
    warnings:   [...(classroomRes.warnings || []), ...(theaterRes.warnings || [])],
  }
}
