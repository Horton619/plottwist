// Theater solver — scan-line row fit. Single style, straight rows for v1.
// Pattern dispatch lives here so 'chevron' / 'curved' can plug in later.

import { bbox, intoLocalFrame, worldToLocal, localToWorld, horizontalSpans, subtractRanges, computeAislePositions, fitUnits, tagObstructions, itemTouchesAny } from './geom.js'

const PATTERNS = {
  straight: solveStraight,
  // chevron: solveChevron,
}

export function solveTheater(zone, opts = {}) {
  const fn = PATTERNS[zone.pattern] || PATTERNS.straight
  return fn(zone, opts)
}

// ── Straight rows ──────────────────────────────────────────────────────────

function solveStraight(zone, opts) {
  const warnings = []
  const verts = zone.vertices
  if (!verts || verts.length < 3) {
    return { rows: [], seats: [], tables: [], totalSeats: 0, warnings: ['Zone has too few vertices.'] }
  }

  const { localVerts, anchor } = intoLocalFrame(zone)
  const lb = bbox(localVerts)

  // Project user-drawn aisles into the zone's local frame once up front.
  // Each aisle becomes a 4-vertex polygon in local coords; we then classify
  // by local-frame aspect ratio:
  //   wider than tall  → "horizontal" aisle, breaks rows in Y (rows below it
  //                       pack flush against its bottom edge)
  //   taller than wide → "vertical" aisle, gets X-cut from each row's spans
  //                       same way the auto aisles do
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

  // Obstructions (pillars, walls, etc.) — collected as world-space polygons so
  // we can do a simple point-in-polygon filter on the placed seats AFTER the
  // row math runs. No section-splitting, no justify shifting; chairs that fall
  // inside the obstruction just get dropped.
  const obstructionWorldPolys = tagObstructions((opts && opts.obstructions) || [])

  const rowH      = Math.max(8, zone.rowSpacing || 20)
  const chairW    = Math.max(8, zone.chairW || 18)
  const chairD    = Math.max(8, zone.chairD || 20)
  const seatGap   = Math.max(0, zone.seatGap || 0)
  const maxPerRow = Math.max(1, zone.maxPerRow || 12)

  // Chevron — rotates the OUTERMOST sections inward. Each chevron'd row is
  // a continuous angled line of chairs, NOT a rotation of the whole section.
  const chevron      = !!zone.chevron
  // Clamp to [-45, 45]. Negative = chevron slants AWAY from the stage
  // (e.g. reflected-across-centerline zones get a negated chevronAngle so
  // their outer ends still point toward the stage on the mirrored side).
  const chevronAngle = Math.max(-45, Math.min(45, zone.chevronAngle ?? 15))

  // Read the new aisles config; fall back to legacy centerAisle for safety.
  const aisleCount = (zone.aisles?.count != null)
    ? Math.max(0, zone.aisles.count)
    : (zone.centerAisle?.enabled === false ? 0 : 1)
  const aisleW = Math.max(0, zone.aisles?.width ?? zone.centerAisle?.width ?? 144)
  // Section width = max chairs between aisles × chair width (+ between-chair gap).
  const sectionW = aisleCount > 0
    ? maxPerRow * chairW + (maxPerRow - 1) * seatGap
    : 0
  const aisleCenters = computeAislePositions(aisleCount, aisleW, sectionW)

  const target = (zone.preference === 'exact')
    ? Math.max(1, zone.target || 1)
    : Infinity

  const rows = []
  const seats = []
  let totalSeats = 0
  let rowIdx = 0

  // Honor a y-bound from a parent solver (mixed) — defaults to full polygon.
  const yStart = opts.yStart ?? lb.minY
  const yEnd   = opts.yEnd   ?? lb.maxY
  let yTop = yStart
  while (yTop + chairD <= yEnd + 0.5) {
    if (totalSeats >= target) break

    // If this row's chair-strip overlaps a horizontal aisle, jump past the
    // aisle so the next row sits flush against its bottom edge.
    let jumped = false
    for (const [aMinY, aMaxY] of horizontalAisles) {
      if (yTop + chairD > aMinY && yTop < aMaxY) {
        yTop = aMaxY
        jumped = true
        break
      }
    }
    if (jumped) continue

    const yCenter = yTop + chairD / 2
    const spans = horizontalSpans(localVerts, yCenter)
    if (!spans.length) { yTop += rowH; rowIdx++; continue }

    // Build the cut list: auto-placed aisles (constant per row) + vertical
    // user-drawn aisles (their x-range at this y).
    const autoRanges = aisleCenters.map(c => [c - aisleW / 2, c + aisleW / 2])
    const userRanges = verticalAisles.flatMap(poly => horizontalSpans(poly, yCenter))
    const allRanges  = [...autoRanges, ...userRanges]

    let cleanSpans = allRanges.length
      ? subtractRanges(spans, allRanges)
      : spans.map(([x0, x1]) => ({ x0, x1, justify: 'center' }))

    // Chevron with zero aisles: anchor every span at its LEFT edge so the
    // row slants in a single direction (rightward + toward the stage with
    // positive chevronAngle). User builds a symmetric V by drawing a second
    // zone and reflecting it across the room's centerline. The isOuter
    // check below also accepts single-span rows in this mode.
    if (chevron && aisleCount === 0 && cleanSpans.length) {
      cleanSpans = cleanSpans.map(s => ({ ...s, justify: 'left' }))
    }

    const rowSeats = []
    let spanIdx = 0
    for (const span of cleanSpans) {
      const { x0, x1, justify } = span
      const usable = x1 - x0
      let { count, blockW } = fitUnits(usable, chairW, seatGap)
      if (count <= 0) { spanIdx++; continue }
      // Cap PER SECTION (not per row) — matches fire-code "12 max between aisles".
      if (count > maxPerRow) {
        count  = maxPerRow
        blockW = count * chairW + (count - 1) * seatGap
      }
      if (count <= 0) { spanIdx++; continue }

      // Chevron applies to: (a) outer sections of a multi-span row (with
      // aisles, the first/last spans flanking the aisles), and (b) every
      // span when there are zero aisles (single-direction slope; user
      // mirrors with Reflect to make a V). Chairs that walk past the
      // section's outer x bound get dropped.
      const isOuter = chevron && (
        aisleCount === 0
          ? true
          : (cleanSpans.length > 1 && (spanIdx === 0 || spanIdx === cleanSpans.length - 1))
      )
      // Sign convention: positive chevronAngle slants the row's outer end
      // TOWARD the stage (smaller y). Negative reverses it.
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
          rowSeats.push({
            xCenter: cursor + chairW / 2, yCenter,
            sectionIdx: spanIdx, chevronRot: 0,
          })
          cursor += chairW + seatGap
        }
      } else {
        // Chevron placement: anchor first chair flush at the aisle edge,
        // step outward along the angled row direction. Stops on outer-x
        // bound OR if the chair would walk into a horizontal aisle.
        const angRad = sectionAngle * Math.PI / 180
        const cs = Math.cos(angRad), sn = Math.sin(angRad)
        const baseDirX = (justify === 'right') ? -1 : +1
        const dirX = baseDirX * cs
        const dirY = baseDirX * sn
        const stepLen = chairW + seatGap
        const anchorX = (justify === 'right') ? x1 - chairW / 2 : x0 + chairW / 2
        // Rotated chair half-extent in y (axis-aligned bbox of rotated chair).
        const halfChairY = (chairW / 2) * Math.abs(sn) + (chairD / 2) * Math.abs(cs)
        for (let i = 0; i < count; i++) {
          const cx = anchorX + i * stepLen * dirX
          const cy = yCenter + i * stepLen * dirY
          if (justify === 'right' && cx - chairW / 2 < x0) break
          if (justify === 'left'  && cx + chairW / 2 > x1) break
          // Don't let the chair encroach on a horizontal aisle.
          if (horizontalAisles.length) {
            let hit = false
            for (const [aMinY, aMaxY] of horizontalAisles) {
              if (cy + halfChairY > aMinY && cy - halfChairY < aMaxY) { hit = true; break }
            }
            if (hit) break
          }
          rowSeats.push({
            xCenter: cx, yCenter: cy,
            sectionIdx: spanIdx, chevronRot: sectionAngle,
          })
        }
      }
      spanIdx++
    }

    if (rowSeats.length) {
      rows.push({ index: rowIdx, y: yCenter, count: rowSeats.length })
      for (const s of rowSeats) {
        const [wx, wy] = localToWorld([s.xCenter, s.yCenter], zone.rotation, anchor)
        // Chevron'd chairs rotate by sectionAngle on top of zone rotation.
        const finalRot = (((zone.rotation || 0) + (s.chevronRot || 0)) % 360 + 360) % 360
        seats.push({
          x: wx, y: wy, w: chairW, d: chairD,
          rotation: finalRot, row: rowIdx,
          sectionIdx: s.sectionIdx,
        })
      }
      totalSeats += rowSeats.length
    }
    rowIdx++
    yTop += rowH
  }

  // Drop chairs whose footprint touches an obstruction. We check all four
  // rotated corners (not just the center) so chairs poking into a pillar
  // edge are removed cleanly.
  let finalSeats = seats
  let finalTotal = totalSeats
  let finalRows  = rows
  if (obstructionWorldPolys.length) {
    finalSeats = seats.filter(s => !itemTouchesAny(s, obstructionWorldPolys))
    finalTotal = finalSeats.length
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

  return { rows: finalRows, seats: finalSeats, tables: [], totalSeats: finalTotal, warnings }
}
