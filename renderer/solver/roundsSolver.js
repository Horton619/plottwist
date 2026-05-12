// Rounds solver — circular tables in a grid, chairs distributed around the
// perimeter. Two patterns:
//   • full     — chairs evenly around 360°
//   • crescent — chairs only on the audience side (the +y hemisphere in
//                local frame, i.e., facing the stage)
//
// Aisles work the same way they do for theater/classroom: rows are scanned
// y by y, horizontal spans get cut by aisles (auto + user-drawn), and table
// blocks justify against the aisle edge. The justify reference is the TABLE
// edge, not the chair circumference — chairs naturally extend past the table
// into the aisle space, which is the expected banquet layout.
//
// Polygon fit DOES use the chair circumference (tableR + chairD) so chairs
// don't hang off the polygon edge.

import {
  bbox, intoLocalFrame, worldToLocal, localToWorld,
  horizontalSpans, subtractRanges, computeAislePositions,
  computeShiftedRoundAislePositions, fitUnits,
  distToSegment, pointInPolygon,
  tagObstructions, itemTouchesAny,
} from './geom.js'

export function solveRounds(zone, opts = {}) {
  const verts = zone.vertices
  if (!verts || verts.length < 3) {
    return { rows: [], seats: [], tables: [], totalSeats: 0, warnings: ['Zone has too few vertices.'] }
  }

  const { localVerts, anchor } = intoLocalFrame(zone)
  const lb = bbox(localVerts)

  const tableD       = Math.max(36, zone.tableD || 72)
  const tableR       = tableD / 2
  const chairsPer    = Math.max(2, zone.chairsPerTable || 10)
  // Auto-derived: 6 or fewer chairs face the stage in a crescent (audience
  // side of the table only); 7+ spread evenly around the full circle.
  const crescent     = chairsPer <= 6
  const chairW       = zone.chairW || 18
  const chairD       = zone.chairD || 20
  const tableSpacing = Math.max(0, zone.tableSpacing ?? 60)
  const pitch        = tableD + tableSpacing
  const fitR         = tableR + chairD     // outer chair-footprint radius

  // Offset rows: alternate rows shift x by half the horizontal pitch and
  // row pitch shrinks to pitch * sin(60°) so adjacent diagonal table centers
  // stay the same distance apart as same-row neighbors (proper hex packing).
  const offsetRows = !!zone.offsetRows
  const rowPitchY  = offsetRows ? pitch * Math.sqrt(3) / 2 : pitch

  // ── Aisles ─────────────────────────────────────────────────────────────
  const aisleCount = (zone.aisles?.count != null)
    ? Math.max(0, zone.aisles.count)
    : 0
  const aisleW = Math.max(0, zone.aisles?.width ?? 144)
  const polyW  = lb.maxX - lb.minX
  const fixedAisles = zone.fixedAisles !== false   // default true (even gaps)

  // Aisle position strategy:
  //   fixedAisles=true  → aisles at evenly-divided polygon positions; tables
  //                       distribute with even gaps inside each section.
  //   fixedAisles=false → SHIFT mode. We figure out how many tightly-packed
  //                       tables fit per section, place aisles flush against
  //                       those blocks, and let any extra width pool at the
  //                       polygon's two outer edges (split evenly).
  let aisleCenters
  if (aisleCount === 0) {
    aisleCenters = []
  } else if (fixedAisles) {
    const sectionW = Math.max(tableD, (polyW - aisleCount * aisleW) / (aisleCount + 1))
    aisleCenters = computeAislePositions(aisleCount, aisleW, sectionW)
  } else {
    aisleCenters = computeShiftedRoundAislePositions(
      aisleCount, aisleW, polyW, lb.minX, tableD, tableSpacing
    )
  }

  // User-drawn aisles classified by aspect (same as theater/classroom).
  const userAisleLocalPolys = ((opts && opts.userAisles) || []).map(a => ([
    [a.x,           a.y],
    [a.x + a.w,     a.y],
    [a.x + a.w,     a.y + a.h],
    [a.x,           a.y + a.h],
  ].map(p => worldToLocal(p, zone, anchor))))
  const horizontalAisles = []
  const verticalAisles   = []
  for (const poly of userAisleLocalPolys) {
    const b = bbox(poly)
    if ((b.maxX - b.minX) > (b.maxY - b.minY)) horizontalAisles.push([b.minY, b.maxY])
    else verticalAisles.push(poly)
  }
  horizontalAisles.sort((a, b) => a[0] - b[0])

  // Honor y-bounds (mixed solver passes these).
  const yStart = opts.yStart ?? lb.minY
  const yEnd   = opts.yEnd   ?? lb.maxY

  const tables = []
  const seats  = []
  const rows   = []
  let totalSeats = 0
  let rowIdx = 0

  // Step rows by `pitch` from the top, leaving tableR padding so the table
  // top edge sits at the start of its band.
  // Honor a goal seat count — fill complete rows then break (a row's worth
  // of spill above the goal is acceptable per the app's "goal not cap" rule).
  const target = (zone.preference === 'exact')
    ? Math.max(1, zone.target || 1)
    : Infinity

  let yc = yStart + tableR
  while (yc + tableR <= yEnd + 0.5) {
    if (totalSeats >= target) break
    // Skip past any horizontal aisle that overlaps this row.
    let jumped = false
    for (const [aMinY, aMaxY] of horizontalAisles) {
      if (yc + tableR > aMinY && yc - tableR < aMaxY) {
        yc = aMaxY + tableR
        jumped = true
        break
      }
    }
    if (jumped) continue

    const spans = horizontalSpans(localVerts, yc)
    if (!spans.length) { yc += pitch; continue }

    const autoRanges = aisleCenters.map(c => [c - aisleW / 2, c + aisleW / 2])
    const userRanges = verticalAisles.flatMap(p => horizontalSpans(p, yc))
    const allRanges  = [...autoRanges, ...userRanges]

    const cleanSpans = allRanges.length
      ? subtractRanges(spans, allRanges)
      : spans.map(([x0, x1]) => ({ x0, x1, justify: 'center' }))

    // Per-span placement. Tables/chairs are computed in local frame and then
    // pushed to the world arrays. (Chevron lives on row-based styles, not
    // rounds — it's applied as a post-process step in those solvers.)
    let rowCount = 0
    let spanIdx = 0
    for (const span of cleanSpans) {
      const { x0, x1, justify } = span
      const usable = x1 - x0
      const fit = fitUnits(usable, tableD, tableSpacing)
      if (fit.count <= 0) { spanIdx++; continue }

      const N = fit.count
      const blockW = N * tableD + (N - 1) * tableSpacing
      let betweenGap, leftCursor

      if (fixedAisles) {
        // Even-with-min-spacing — see comment above.
        const slack = Math.max(0, usable - N * tableD)
        const evenGap = slack / (N + 1)
        let endGap
        if (evenGap >= tableSpacing) {
          endGap = evenGap; betweenGap = evenGap
        } else {
          betweenGap = tableSpacing
          endGap = Math.max(0, (usable - blockW) / 2)
        }
        leftCursor = x0 + endGap
      } else {
        // Aisle-flush justify — block hugs the aisle edge per the span tag.
        betweenGap = tableSpacing
        if      (justify === 'left')  leftCursor = x0
        else if (justify === 'right') leftCursor = x1 - blockW
        else                          leftCursor = x0 + (usable - blockW) / 2
      }
      const localPitch = tableD + betweenGap

      // Offset rows: shift cursor by half the horizontal pitch on odd rows.
      // Tables that fall outside the span get dropped by circleFitsInPolygon.
      if (offsetRows && (rowIdx % 2 === 1)) leftCursor += pitch / 2

      // Build local-frame tables + chairs for this section.
      const localTables = []
      const localChairs = []
      let cursor = leftCursor
      for (let i = 0; i < N; i++) {
        const xc = cursor + tableR
        cursor += localPitch
        if (!circleFitsInPolygon(xc, yc, fitR, localVerts)) continue
        const localTblIdx = localTables.length
        localTables.push({ x: xc, y: yc })

        const angSpan    = crescent ? 180 : 360
        const sectorSize = angSpan / chairsPer
        const chairCircleR = tableR + chairD / 2
        for (let k = 0; k < chairsPer; k++) {
          const angDeg = (k + 0.5) * sectorSize
          const angRad = angDeg * Math.PI / 180
          const cx = xc + chairCircleR * Math.cos(angRad)
          const cy = yc + chairCircleR * Math.sin(angRad)
          const localRot = (angDeg + 270) % 360   // chair faces table center
          localChairs.push({ x: cx, y: cy, rot: localRot, parentLocalIdx: localTblIdx })
        }
      }

      // Push to world arrays.
      const tableIdxOffset = tables.length
      for (const t of localTables) {
        const [twx, twy] = localToWorld([t.x, t.y], zone.rotation, anchor)
        tables.push({
          x: twx, y: twy,
          w: tableD, d: tableD,
          rotation: 0,
          row: rowIdx,
          kind: 'round',
          chairD,
        })
      }
      for (const c of localChairs) {
        const [cwx, cwy] = localToWorld([c.x, c.y], zone.rotation, anchor)
        const finalRot = ((c.rot + (zone.rotation || 0)) % 360 + 360) % 360
        seats.push({
          x: cwx, y: cwy,
          w: chairW, d: chairD,
          rotation: finalRot,
          row: rowIdx,
          tableIdx: tableIdxOffset + c.parentLocalIdx,
        })
      }
      rowCount   += localTables.length * chairsPer
      totalSeats += localTables.length * chairsPer
      spanIdx++
    }

    if (rowCount > 0) {
      rows.push({ index: rowIdx, y: yc, count: rowCount })
      rowIdx++
    }
    yc += rowPitchY
  }

  // ── Obstruction filter ─────────────────────────────────────────────────
  // Atomic table-units: a table goes if any of its chair corners or its own
  // chair circumference touches the obstruction.
  const obstructionWorldPolys = tagObstructions((opts && opts.obstructions) || [])

  let finalTables = tables
  let finalSeats  = seats
  let finalTotal  = totalSeats
  let finalRows   = rows
  if (obstructionWorldPolys.length) {
    const chairsByTable = new Map()
    seats.forEach((s, i) => {
      const k = s.tableIdx ?? -1
      if (!chairsByTable.has(k)) chairsByTable.set(k, [])
      chairsByTable.get(k).push(i)
    })
    const survivors = new Set()
    tables.forEach((t, idx) => {
      // Use the chair-footprint circle for the table-vs-obstruction test —
      // any obstruction polygon that overlaps the circle (center inside, or
      // any vertex of the obstruction inside the circle) drops the unit.
      if (circleHitsAnyPolygon(t.x, t.y, (t.w / 2) + (t.chairD || 20), obstructionWorldPolys)) return
      const chairIdxs = chairsByTable.get(idx) || []
      const anyChairHit = chairIdxs.some(ci => itemTouchesAny(seats[ci], obstructionWorldPolys))
      if (!anyChairHit) survivors.add(idx)
    })
    finalTables = tables.filter((_, i) => survivors.has(i))
    finalSeats  = seats.filter(s => survivors.has(s.tableIdx))
    finalTotal  = finalSeats.length
    const byRow = new Map()
    for (const s of finalSeats) byRow.set(s.row, (byRow.get(s.row) || 0) + 1)
    finalRows = rows.map(r => ({ ...r, count: byRow.get(r.index) || 0 }))
                    .filter(r => r.count > 0)
  }

  const warnings = []
  if (zone.preference === 'exact' && zone.target > 0) {
    const delta = finalTotal - zone.target
    if (delta > 0) warnings.push(`+${delta} over goal of ${zone.target} (one row's spill).`)
    else if (delta < 0) warnings.push(`${-delta} short of goal (${zone.target}). Polygon couldn't fit more rounds.`)
  }

  return { rows: finalRows, seats: finalSeats, tables: finalTables, totalSeats: finalTotal, warnings }
}

// Does a circle of `radius` centered at (cx,cy) fit fully inside `vertices`?
function circleFitsInPolygon(cx, cy, radius, vertices) {
  if (!pointInPolygon(cx, cy, vertices)) return false
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    if (distToSegment([cx, cy], a, b) < radius) return false
  }
  return true
}

// Coarse circle-vs-polygon overlap test for the obstruction collision check.
// Returns true if EITHER the polygon's vertices fall inside the circle OR
// the circle's center is inside the polygon OR any polygon edge passes
// within `radius` of the center.
function circleHitsAnyPolygon(cx, cy, radius, obstructions) {
  for (const ob of obstructions) {
    const poly = ob.poly
    // 'edge' mode (walls): only edges count — polygon interior is decorative.
    if (ob.mode !== 'edge' && pointInPolygon(cx, cy, poly)) return true
    for (const [vx, vy] of poly) {
      if (Math.hypot(vx - cx, vy - cy) <= radius) return true
    }
    for (let i = 0; i < poly.length; i++) {
      if (distToSegment([cx, cy], poly[i], poly[(i + 1) % poly.length]) <= radius) return true
    }
  }
  return false
}
