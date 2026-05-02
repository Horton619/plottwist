// Classroom solver — table-aware. Tables run with their long side parallel to
// the stage, chairs sit on the audience side (between table and stage) facing
// forward. Row pitch is FRONT-of-table to FRONT-of-table; the standard hotel
// banquet default is 4'-6" (54").
//
// Pattern dispatch lives here so 'chevron' / 'curved' can plug in later.

import { bbox, intoLocalFrame, worldToLocal, localToWorld, horizontalSpans, subtractRanges, computeAislePositions, fitUnits, obstructionToWorldPolygon, itemTouchesAny } from './geom.js'

const PATTERNS = {
  straight: solveStraight,
}

export function solveClassroom(zone, opts = {}) {
  const fn = PATTERNS[zone.pattern] || PATTERNS.straight
  return fn(zone, opts)
}

function solveStraight(zone, opts) {
  const warnings = []
  const verts = zone.vertices
  if (!verts || verts.length < 3) {
    return { rows: [], seats: [], tables: [], totalSeats: 0, warnings: ['Zone has too few vertices.'] }
  }

  const { localVerts, anchor } = intoLocalFrame(zone)
  const lb = bbox(localVerts)

  // Same projection trick as theaterSolver — user-drawn aisles get cut from
  // each row's spans alongside the auto-placed ones. Wider-than-tall aisles
  // (in local frame) become Y-direction row breaks.
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
    if ((b.maxX - b.minX) > (b.maxY - b.minY)) {
      horizontalAisles.push([b.minY, b.maxY])
    } else {
      verticalAisles.push(poly)
    }
  }
  horizontalAisles.sort((a, b) => a[0] - b[0])

  // Obstructions — collected as world polygons for a post-place point-in-poly
  // filter. Tables AND chairs whose centers fall inside get dropped.
  const obstructionWorldPolys = ((opts && opts.obstructions) || [])
    .map(obstructionToWorldPolygon)
    .filter(Boolean)

  const rowH       = Math.max(24, zone.rowSpacing || 54)
  const tableW     = Math.max(24, zone.tableW || 96)        // long dimension (parallel to stage)
  const tableD     = Math.max(12, zone.tableD || 18)        // short dimension (front-to-back)
  const chairW     = Math.max(8,  zone.chairW || 18)
  const chairD     = Math.max(8,  zone.chairD || 20)
  const chairsPer  = Math.max(1,  zone.chairsPerTable || 3)
  const tableGap   = Math.max(0,  zone.tableGap || 0)       // gap between tables in a row
  const maxPerRow  = Math.max(1,  zone.maxPerRow || Infinity)

  // Read the new aisles config; fall back to legacy centerAisle for safety.
  const aisleCount = (zone.aisles?.count != null)
    ? Math.max(0, zone.aisles.count)
    : (zone.centerAisle?.enabled === false ? 0 : 1)
  const aisleW = Math.max(0, zone.aisles?.width ?? zone.centerAisle?.width ?? 144)

  // Chevron — rotates the OUTERMOST sections inward. Each chevron'd row is a
  // continuous angled line of tables anchored at the aisle edge; chair offsets
  // rotate with their parent table so chairs stay locked to their seat.
  const chevron      = !!zone.chevron
  const chevronAngle = Math.max(0, Math.min(45, zone.chevronAngle ?? 15))

  // Section cap for the per-section table count AND the auto-aisle spacing.
  //   • Standalone classroom: 24' fire-code cap (no aisle longer than 24'
  //     of tables in a row).
  //   • Mixed classroom: the parent solver passes opts.sectionWCap pinned
  //     to the theater section width so classroom rows line up under the
  //     same aisles as the theater rows behind them.
  const SECTION_W_CAP = opts.sectionWCap ?? (24 * 12)
  const tablesPerSection = Math.max(1,
    Math.floor((SECTION_W_CAP + tableGap) / Math.max(1, tableW + tableGap)))
  const sectionW = aisleCount > 0 ? SECTION_W_CAP : 0
  const aisleCenters = computeAislePositions(aisleCount, aisleW, sectionW)

  // Row unit depth = chair depth + table depth (chair sits behind the table).
  // We need both to fit before we can claim the row.
  const rowUnitD = chairD + tableD

  const target = (zone.preference === 'exact')
    ? Math.max(1, zone.target || 1)
    : Infinity

  const rows = []
  const seats = []
  const tables = []
  let totalSeats = 0
  let rowIdx = 0

  // Honor a y-bound from a parent solver (mixed) — defaults to full polygon.
  const yStart = opts.yStart ?? lb.minY
  const yEnd   = opts.yEnd   ?? lb.maxY
  let yTop = yStart
  while (yTop + rowUnitD <= yEnd + 0.5) {
    if (totalSeats >= target) break

    // Skip past horizontal aisles so the next row sits flush below them.
    let jumped = false
    for (const [aMinY, aMaxY] of horizontalAisles) {
      if (yTop + rowUnitD > aMinY && yTop < aMaxY) {
        yTop = aMaxY
        jumped = true
        break
      }
    }
    if (jumped) continue

    // Tables sit at the FRONT of the row unit (closer to the stage).
    // Table center y = yTop + tableD/2.
    // Chair center y sits behind the table = yTop + tableD + chairD/2.
    const tableCenterY = yTop + tableD / 2
    const chairCenterY = yTop + tableD + chairD / 2

    // Fit-test along a horizontal slice through the table line.
    const spans = horizontalSpans(localVerts, tableCenterY)
    if (!spans.length) { yTop += rowH; rowIdx++; continue }

    const autoRanges = aisleCenters.map(c => [c - aisleW / 2, c + aisleW / 2])
    const userRanges = verticalAisles.flatMap(poly => horizontalSpans(poly, tableCenterY))
    const allRanges  = [...autoRanges, ...userRanges]

    const cleanSpans = allRanges.length
      ? subtractRanges(spans, allRanges)
      : spans.map(([x0, x1]) => ({ x0, x1, justify: 'center' }))

    const rowTables = []
    let rowSeatCount = 0
    let spanIdx = 0
    for (const span of cleanSpans) {
      const { x0, x1, justify } = span
      const usable = x1 - x0
      let { count, blockW } = fitUnits(usable, tableW, tableGap)
      if (count <= 0) { spanIdx++; continue }

      if (count > tablesPerSection) count = tablesPerSection
      if (count <= 0) { spanIdx++; continue }
      blockW = count * tableW + (count - 1) * tableGap

      // Chevron applies only to OUTER sections in multi-section layouts.
      // Each chevron'd row is a continuous angled line — first table flush
      // at the inner (aisle) edge, subsequent tables walk outward at the
      // chevron angle, all rotated as a group.
      const isOuter = chevron && cleanSpans.length > 1
                     && (spanIdx === 0 || spanIdx === cleanSpans.length - 1)
      // Sign convention: positive chevronAngle slants the row's outer end
      // TOWARD the stage (smaller y). Negative reverses.
      const sectionAngle = isOuter
        ? (justify === 'right' ? +chevronAngle : -chevronAngle)
        : 0

      if (sectionAngle === 0) {
        // Standard horizontal placement.
        let cursor
        if      (justify === 'left')  cursor = x0
        else if (justify === 'right') cursor = x1 - blockW
        else                          cursor = x0 + (usable - blockW) / 2
        for (let i = 0; i < count; i++) {
          rowTables.push({
            xCenter: cursor + tableW / 2,
            yTableC: tableCenterY,
            yChairC: chairCenterY,
            seatsOn: chairsPer,
            sectionIdx: spanIdx,
            chevronRot: 0,
          })
          rowSeatCount += chairsPer
          cursor += tableW + tableGap
        }
      } else {
        // Chevron placement: anchor first table flush at the aisle edge,
        // walk outward along the angled row direction.
        const angRad = sectionAngle * Math.PI / 180
        const cs = Math.cos(angRad), sn = Math.sin(angRad)
        const baseDirX = (justify === 'right') ? -1 : +1
        const dirX = baseDirX * cs
        const dirY = baseDirX * sn
        const stepLen = tableW + tableGap
        const anchorX = (justify === 'right') ? x1 - tableW / 2 : x0 + tableW / 2
        // Conservative rotated y-extent above the table center (table top edge)
        // and below (chair bottom edge).
        const halfTabAbove  = (tableW / 2) * Math.abs(sn) + (tableD / 2) * Math.abs(cs)
        const chairExtremeY = (tableW / 2) * Math.abs(sn) + (tableD / 2 + chairD) * Math.abs(cs) + chairD / 2
        for (let i = 0; i < count; i++) {
          const tx = anchorX + i * stepLen * dirX
          const ty = tableCenterY + i * stepLen * dirY
          if (justify === 'right' && tx - tableW / 2 < x0) break
          if (justify === 'left'  && tx + tableW / 2 > x1) break
          // Don't let the table+chair unit encroach on a horizontal aisle.
          if (horizontalAisles.length) {
            let hit = false
            for (const [aMinY, aMaxY] of horizontalAisles) {
              if (ty + chairExtremeY > aMinY && ty - halfTabAbove < aMaxY) { hit = true; break }
            }
            if (hit) break
          }
          rowTables.push({
            xCenter: tx,
            yTableC: ty,
            yChairC: ty,                  // unused in chevron path; chair offset is computed via rotation
            seatsOn: chairsPer,
            sectionIdx: spanIdx,
            chevronRot: sectionAngle,
          })
          rowSeatCount += chairsPer
        }
      }
      spanIdx++
    }

    if (rowTables.length) {
      rows.push({ index: rowIdx, y: tableCenterY, count: rowSeatCount })
      for (const t of rowTables) {
        const tableIdx = tables.length
        const [twx, twy] = localToWorld([t.xCenter, t.yTableC], zone.rotation, anchor)
        const rotZone   = zone.rotation || 0
        const finalTabRot = ((rotZone + (t.chevronRot || 0)) % 360 + 360) % 360
        tables.push({
          x: twx, y: twy, w: tableW, d: tableD,
          rotation: finalTabRot, row: rowIdx,
          sectionIdx: t.sectionIdx,
        })

        if (t.seatsOn > 0) {
          // Chair offsets RELATIVE TO TABLE CENTER, in the table's pre-rotation
          // frame: spread along the long axis (x), one chair-depth offset on
          // the audience side (y = +(tableD + chairD) / 2).
          const cellW = tableW / t.seatsOn
          const offY  = (tableD + chairD) / 2
          const cAng  = (t.chevronRot || 0) * Math.PI / 180
          const cs    = Math.cos(cAng), sn = Math.sin(cAng)
          for (let i = 0; i < t.seatsOn; i++) {
            const offX = -tableW / 2 + cellW / 2 + i * cellW
            // Rotate the offset by chevronRot so chairs follow their tilted table.
            const rdx = offX * cs - offY * sn
            const rdy = offX * sn + offY * cs
            const [cwx, cwy] = localToWorld([t.xCenter + rdx, t.yTableC + rdy], zone.rotation, anchor)
            seats.push({
              x: cwx, y: cwy, w: chairW, d: chairD,
              rotation: finalTabRot, row: rowIdx,
              tableIdx, sectionIdx: t.sectionIdx,
            })
          }
        }
      }
      totalSeats += rowSeatCount
    }
    rowIdx++
    yTop += rowH
  }

  // Post-place obstruction filter — table + its chairs are ONE UNIT. A unit
  // is dropped if the table OR any of its chairs has a corner inside any
  // obstruction polygon. Avoids orphan chairs floating in a pillar's hole.
  let finalSeats  = seats
  let finalTables = tables
  let finalTotal  = totalSeats
  let finalRows   = rows
  if (obstructionWorldPolys.length) {
    // Group chair indices by their parent tableIdx so we can test each unit.
    const chairsByTable = new Map()
    seats.forEach((s, i) => {
      const k = s.tableIdx ?? -1
      if (!chairsByTable.has(k)) chairsByTable.set(k, [])
      chairsByTable.get(k).push(i)
    })
    const survivors = new Set()
    tables.forEach((t, idx) => {
      if (itemTouchesAny(t, obstructionWorldPolys)) return
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

  if (zone.preference === 'exact' && zone.target > 0) {
    const delta = finalTotal - zone.target
    if (delta > 0) warnings.push(`+${delta} over goal of ${zone.target} (one row's spill).`)
    else if (delta < 0) warnings.push(`${-delta} short of goal (${zone.target}). Polygon couldn't fit more rows.`)
  }

  return { rows: finalRows, seats: finalSeats, tables: finalTables, totalSeats: finalTotal, warnings }
}
