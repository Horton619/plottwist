// Solver dispatch — picks a style-specific solver, returns a uniform shape.
//
// Result shape (fields a style may omit):
//   {
//     rows:       [{ index, y, count }],
//     seats:      [{ x, y, w, d, rotation, row }],   // chair rects
//     tables:     [{ x, y, w, d, rotation, row }],   // table rects (classroom)
//     totalSeats: number,
//     warnings:   string[],
//   }

import { solveTheater }   from './theaterSolver.js'
import { solveClassroom } from './classroomSolver.js'
import { solveRounds }    from './roundsSolver.js'
import { solveMixed }     from './mixedSolver.js'

const STYLES = {
  theater:   solveTheater,
  classroom: solveClassroom,
  rounds:    solveRounds,
  mixed:     solveMixed,
}

// `opts.userAisles` — array of aisle rect objects (from the layout) that the
// solver should subtract from each row. Each aisle: { x, y, w, h } in world
// coords. The solver projects them into the zone's local (rotation-aligned)
// frame and treats their per-row x-range as additional cuts.
export function solveSeatingZone(zone, opts = {}) {
  const fn = STYLES[zone.style]
  if (!fn) {
    return { rows: [], seats: [], tables: [], totalSeats: 0, warnings: [`${zone.style} solver isn't built yet.`] }
  }
  return fn(zone, opts)
}
