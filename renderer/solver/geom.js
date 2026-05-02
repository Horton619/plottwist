// Shared geometry for seating solvers. All math runs in the zone's facing-up
// frame: the user's facing direction (zone.rotation, 0=up) points up.

export function centroid(verts) {
  let sx = 0, sy = 0
  for (const [x, y] of verts) { sx += x; sy += y }
  return [sx / verts.length, sy / verts.length]
}

export function bbox(verts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of verts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

// Rotate a point by `deg` degrees clockwise (positive = CW in screen coords
// where y goes down, matching the toolbar convention 0=up / 90=right).
export function rotatePoint([x, y], deg) {
  const r = deg * Math.PI / 180
  const cos = Math.cos(r), sin = Math.sin(r)
  return [x * cos - y * sin, x * sin + y * cos]
}

// Returns sorted [x_start, x_end] spans where horizontal line y=yLine crosses
// the polygon's interior. Even-odd scanline.
export function horizontalSpans(verts, yLine) {
  const xs = []
  const n = verts.length
  for (let i = 0; i < n; i++) {
    const [x1, y1] = verts[i]
    const [x2, y2] = verts[(i + 1) % n]
    if ((y1 <= yLine && y2 > yLine) || (y2 <= yLine && y1 > yLine)) {
      const t = (yLine - y1) / (y2 - y1)
      xs.push(x1 + t * (x2 - x1))
    }
  }
  xs.sort((a, b) => a - b)
  const spans = []
  for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i + 1]])
  return spans
}

// Cuts an aisle [aMin, aMax] out of [x0, x1]. Returns 0..2 spans tagged with
// `justify` ('left' / 'right' / 'center') so the solver knows whether to pack
// rows against the aisle edge. Spans on the LEFT of the aisle justify RIGHT
// (their right edge sits flush against the aisle); spans on the RIGHT justify
// LEFT. Spans that don't touch any aisle stay centered.
export function subtractAisle([x0, x1], aMin, aMax) {
  if (aMax <= x0) return [{ x0, x1, justify: 'left'  }]   // span fully right of aisle → push toward aisle (left edge)
  if (aMin >= x1) return [{ x0, x1, justify: 'right' }]   // span fully left  of aisle → push toward aisle (right edge)
  const out = []
  if (aMin > x0) out.push({ x0, x1: aMin, justify: 'right' })
  if (aMax < x1) out.push({ x0: aMax, x1, justify: 'left'  })
  return out
}

// Compute aisle centerline positions for `count` aisles of width `aisleW`,
// laid out symmetrically around x=0 with `sectionWidth` between them.
//
//   count=1 → center aisle at x=0
//   count=2 → no center aisle; sections of `sectionWidth` either side of 0,
//             aisles at the section boundaries
//   count=3 → center aisle plus two outer aisles, spaced one section apart
//   count=N → general pattern; positions returned sorted left → right
export function computeAislePositions(count, aisleW, sectionWidth) {
  if (count <= 0) return []
  const pitch = sectionWidth + aisleW
  const positions = []
  if (count % 2 === 1) {
    // Odd count → center aisle at 0, additional pairs spaced by `pitch`.
    positions.push(0)
    const half = (count - 1) / 2
    for (let k = 1; k <= half; k++) {
      positions.push( k * pitch)
      positions.push(-k * pitch)
    }
  } else {
    // Even count → no center aisle; first pair offset half a section + half an aisle.
    const half = count / 2
    const offset = sectionWidth / 2 + aisleW / 2
    for (let k = 0; k < half; k++) {
      positions.push( offset + k * pitch)
      positions.push(-offset - k * pitch)
    }
  }
  return positions.sort((a, b) => a - b)
}

// Compute aisle centerline positions for the rounds "shift" layout: aisles
// flush against tightly-packed table blocks, with leftover slack at the
// polygon's two outer edges (split evenly). Returns positions in the same
// local-frame coordinates as the polygon's bbox (minX is the polygon's left
// edge). Returns [] when no tables fit at all.
export function computeShiftedRoundAislePositions(count, aisleW, polyW, lbMinX, tableD, tableSpacing) {
  if (count <= 0) return []
  let N = 0
  for (let trial = 1; trial < 1000; trial++) {
    const trialBlockW = trial * tableD + (trial - 1) * tableSpacing
    const totalUsed   = (count + 1) * trialBlockW + count * aisleW
    if (totalUsed > polyW) break
    N = trial
  }
  if (N === 0) return []
  const blockW     = N * tableD + (N - 1) * tableSpacing
  const totalUsed  = (count + 1) * blockW + count * aisleW
  const outerSlack = Math.max(0, polyW - totalUsed)
  const leftEdge   = lbMinX + outerSlack / 2
  const positions = []
  for (let k = 0; k < count; k++) {
    positions.push(leftEdge + (k + 1) * blockW + (k + 0.5) * aisleW)
  }
  return positions
}

// Apply a list of aisle ranges (each [aMin, aMax]) to a list of horizontal
// spans. Threads the cuts through one at a time. A cut that doesn't intersect
// a span LEAVES THE SPAN UNCHANGED — that way the closest-aisle justify tag
// already on the span (from a prior cut) survives later cuts that are further
// away.
//
// `spans` is an array of [x0, x1] tuples (raw output of horizontalSpans).
export function subtractRanges(spans, ranges) {
  let out = spans.map(([x0, x1]) => ({ x0, x1, justify: 'center' }))
  for (const [aMin, aMax] of ranges) {
    if (aMax <= aMin) continue
    const next = []
    for (const span of out) {
      // No intersection → leave the span (and its justify) alone.
      if (aMax <= span.x0 || aMin >= span.x1) { next.push(span); continue }
      // Aisle splits the span — left piece justifies right (toward this aisle),
      // right piece justifies left.
      if (aMin > span.x0) next.push({ x0: span.x0, x1: aMin,    justify: 'right' })
      if (aMax < span.x1) next.push({ x0: aMax,    x1: span.x1, justify: 'left'  })
    }
    out = next
  }
  return out
}

// Backward-compat helper: convert (centers + uniform width) to the new range
// format, then use subtractRanges. Kept so existing solver call sites compile
// while we move them over.
export function subtractAisles(spans, aisleCenters, aisleW) {
  const ranges = aisleCenters.map(c => [c - aisleW / 2, c + aisleW / 2])
  return subtractRanges(spans, ranges)
}

// Distance from a point to a line segment.
export function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// Point-in-polygon — delegated to renderer/geom.js so solver and renderer
// can never disagree on edge-case behavior. Import locally so callers
// inside this module (itemTouchesAny, etc.) can reach the symbol; re-export
// for solver files that consume it through './geom.js'.
import { pointInPolygon } from '../geom.js'
export { pointInPolygon }

// Convert an obstruction object (rect or polygon) to a world-space polygon.
export function obstructionToWorldPolygon(o) {
  if (o.kind === 'rect') {
    return [
      [o.x,         o.y],
      [o.x + o.w,   o.y],
      [o.x + o.w,   o.y + o.h],
      [o.x,         o.y + o.h],
    ]
  }
  if (o.kind === 'polygon' && o.vertices?.length >= 3) {
    return o.vertices.slice()
  }
  return null
}

// Compute the four world-space corners of a placed seat or table accounting
// for its rotation. The shape is centered on (item.x, item.y) with
// width=item.w along the local-x axis and depth=item.d along local-y, then
// rotated by item.rotation degrees clockwise.
export function placedItemCorners(item) {
  const w2 = (item.w || 18) / 2
  const d2 = (item.d || 20) / 2
  const r  = (item.rotation || 0) * Math.PI / 180
  const cos = Math.cos(r), sin = Math.sin(r)
  const local = [[-w2, -d2], [w2, -d2], [w2, d2], [-w2, d2]]
  return local.map(([lx, ly]) => [
    item.x + lx * cos - ly * sin,
    item.y + lx * sin + ly * cos,
  ])
}

// Conservative test: does ANY corner of the placed item fall inside ANY of
// the given polygons? Used to drop chairs/tables that overlap obstructions.
export function itemTouchesAny(item, polys) {
  const corners = placedItemCorners(item)
  for (const poly of polys) {
    for (const [x, y] of corners) {
      if (pointInPolygon(x, y, poly)) return true
    }
  }
  return false
}

// Convert a row's (xCenter, yCenter) in the rotated frame back to world coords.
export function localToWorld(local, rotation, anchor) {
  const [wx, wy] = rotatePoint(local, rotation)
  return [wx + anchor[0], wy + anchor[1]]
}

// Project a polygon into the zone's rotated (facing-up) frame around its centroid.
// Returns { localVerts, anchor } — anchor = world centroid for round-tripping.
export function intoLocalFrame(zone) {
  const c = centroid(zone.vertices)
  const localVerts = zone.vertices.map(([x, y]) => rotatePoint([x - c[0], y - c[1]], -zone.rotation))
  return { localVerts, anchor: c }
}

// Project a single world-space point into the zone's local (facing-up) frame
// using its centroid as the anchor. Used to bring user-drawn aisles or guides
// into the same coordinate system the solver scans rows in.
export function worldToLocal([x, y], zone, anchor = null) {
  const c = anchor || centroid(zone.vertices)
  return rotatePoint([x - c[0], y - c[1]], -zone.rotation)
}

// Span-fitting helper: how many fixed-width units fit in `usable`, with `gap`
// between units? Returns { count, blockW }. count of 0 means nothing fits.
export function fitUnits(usable, unitW, gap) {
  if (usable < unitW) return { count: 0, blockW: 0 }
  const denom = unitW + gap
  const count = Math.floor((usable + gap) / denom)
  return { count, blockW: count * unitW + (count - 1) * gap }
}
