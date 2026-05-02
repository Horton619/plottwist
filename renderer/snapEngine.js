// snapEngine.js — anchor-based snapping during drag.
//
// During a move drag the engine collects "anchor" points from every visible,
// unlocked object (corners, edge midpoints, center) and tests the dragged
// object's anchors against them. When a pair is within tolerance, the drag
// is offset so the anchors coincide and a snap indicator is set so the tool
// layer can draw a marker.

import { activeRoom, activeLayout, selectedObjects } from './state.js'

// Returns an array of { x, y, kind } anchor points for the object.
// kind = 'corner' | 'midpoint' | 'center' (used only for visual differentiation).
export function getSnapPoints(obj) {
  const points = []
  if (obj.kind === 'rect' || obj.kind === 'image') {
    const { x, y, w, h } = obj
    // Four corners
    points.push({ x,         y,         kind: 'corner' })
    points.push({ x: x + w,  y,         kind: 'corner' })
    points.push({ x: x + w,  y: y + h,  kind: 'corner' })
    points.push({ x,         y: y + h,  kind: 'corner' })
    // Edge midpoints
    points.push({ x: x + w / 2, y,             kind: 'midpoint' })
    points.push({ x: x + w,     y: y + h / 2,  kind: 'midpoint' })
    points.push({ x: x + w / 2, y: y + h,      kind: 'midpoint' })
    points.push({ x,            y: y + h / 2,  kind: 'midpoint' })
    // Center
    points.push({ x: x + w / 2, y: y + h / 2, kind: 'center' })
    return points
  }
  if (obj.kind === 'polygon' && obj.vertices?.length >= 2) {
    let cx = 0, cy = 0
    for (const [vx, vy] of obj.vertices) {
      points.push({ x: vx, y: vy, kind: 'corner' })
      cx += vx; cy += vy
    }
    cx /= obj.vertices.length; cy /= obj.vertices.length
    for (let i = 0; i < obj.vertices.length; i++) {
      const [ax, ay] = obj.vertices[i]
      const [bx, by] = obj.vertices[(i + 1) % obj.vertices.length]
      points.push({ x: (ax + bx) / 2, y: (ay + by) / 2, kind: 'midpoint' })
    }
    points.push({ x: cx, y: cy, kind: 'center' })
    return points
  }
  if (obj.kind === 'dim') {
    points.push({ x: obj.x1, y: obj.y1, kind: 'corner' })
    points.push({ x: obj.x2, y: obj.y2, kind: 'corner' })
    points.push({ x: (obj.x1 + obj.x2) / 2, y: (obj.y1 + obj.y2) / 2, kind: 'midpoint' })
    return points
  }
  return []
}

// Collect every snap anchor in the current room + active layout, optionally
// excluding objects whose ids are in `excludeIds` (used to exclude the dragged
// objects so they don't snap to themselves). Includes solver-output chairs
// and tables so dim measurements can land cleanly on a seat or table center.
export function collectSnapAnchors(excludeIds = new Set()) {
  const room   = activeRoom()
  const layout = activeLayout()
  const anchors = []
  const all = [...(room?.objects || []), ...(layout?.objects || [])]
  for (const o of all) {
    if (excludeIds.has(o.id) || o.hidden || o.locked) continue
    anchors.push(...getSnapPoints(o))
    // Seating zones expose their solver-placed chairs and tables too — useful
    // for "12' from the front of row 4" style measurements.
    if (o.type === 'seating' && o.result) {
      for (const s of (o.result.seats  || [])) anchors.push({ x: s.x, y: s.y, kind: 'center' })
      for (const t of (o.result.tables || [])) anchors.push({ x: t.x, y: t.y, kind: 'center' })
    }
  }
  return anchors
}

// Snap a single point to the nearest anchor within `tolerance`. Tests both
// point anchors (corners, midpoints, centers, chair/table centers) AND any
// point along a visible object's edges (rect sides, polygon segments, dim
// lines). Returns the snapped point with its `kind`, or null if nothing is
// within tolerance. Used by the Dim tool while drawing.
export function snapPointToAnchors(x, y, tolerance) {
  let best = null
  let bestDist = tolerance

  // Point anchors first.
  const anchors = collectSnapAnchors()
  for (const a of anchors) {
    const d = Math.hypot(a.x - x, a.y - y)
    if (d < bestDist) { bestDist = d; best = { x: a.x, y: a.y, kind: a.kind } }
  }

  // Edge snap — perpendicular foot or nearest endpoint of every visible edge.
  const room   = activeRoom()
  const layout = activeLayout()
  const all = [...(room?.objects || []), ...(layout?.objects || [])]
  for (const o of all) {
    if (o.hidden || o.locked) continue
    for (const [a, b] of getObjectEdges(o)) {
      const cp = closestPointOnSegment([x, y], a, b)
      const d = Math.hypot(cp[0] - x, cp[1] - y)
      if (d < bestDist) {
        bestDist = d
        best = { x: Math.round(cp[0]), y: Math.round(cp[1]), kind: 'edge' }
      }
    }
  }

  return best
}

// Edges of an object as [[a, b], ...] segments. Skips images / round tables /
// kinds we can't easily express as polygons.
function getObjectEdges(o) {
  if (o.kind === 'rect' || o.kind === 'image') {
    const { x, y, w, h } = o
    return [
      [[x,     y    ], [x + w, y    ]],
      [[x + w, y    ], [x + w, y + h]],
      [[x + w, y + h], [x,     y + h]],
      [[x,     y + h], [x,     y    ]],
    ]
  }
  if (o.kind === 'polygon' && o.vertices?.length >= 2) {
    const edges = []
    for (let i = 0; i < o.vertices.length; i++) {
      edges.push([o.vertices[i], o.vertices[(i + 1) % o.vertices.length]])
    }
    return edges
  }
  if (o.kind === 'dim') return [[[o.x1, o.y1], [o.x2, o.y2]]]
  return []
}

function closestPointOnSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return [ax, ay]
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return [ax + t * dx, ay + t * dy]
}

// Reconstruct an object at its proposed (post-move) position from the drag's
// snapshot of its original geometry. Used so we can test snap against the
// dragged object's predicted anchors without touching the live object.
function objectAtOffset(o, orig, dx, dy) {
  if (o.kind === 'rect' || o.kind === 'image') {
    return { ...o, x: orig.x + dx, y: orig.y + dy, w: orig.w, h: orig.h }
  }
  if (o.kind === 'polygon') {
    return { ...o, vertices: orig.vertices.map(([x, y]) => [x + dx, y + dy]) }
  }
  if (o.kind === 'dim') {
    return { ...o, x1: orig.x1 + dx, y1: orig.y1 + dy, x2: orig.x2 + dx, y2: orig.y2 + dy }
  }
  return o
}

// Compute the best snap during a move drag.
//   - drag: the current drag state (has .snapshot of original geometry)
//   - dx, dy: the proposed delta from drag.start (already shift-locked if applicable)
//   - tolerance: world-units distance within which to snap
//
// Returns { offsetX, offsetY, indicator: { x, y, kind } } or null.
export function computeMoveSnap(drag, dx, dy, tolerance) {
  const sel = selectedObjects().filter(o => !o.hidden && !o.locked)
  if (!sel.length) return null

  const selIds = new Set(sel.map(o => o.id))
  const candidates = collectSnapAnchors(selIds)
  if (!candidates.length) return null

  // Dragged anchors at the proposed offset position.
  const draggedAnchors = []
  for (const o of sel) {
    const orig = drag.snapshot?.get(o.id)
    if (!orig) continue
    const moved = objectAtOffset(o, orig, dx, dy)
    draggedAnchors.push(...getSnapPoints(moved))
  }
  if (!draggedAnchors.length) return null

  // Closest pair within tolerance wins.
  let best = null
  let bestDist = tolerance
  for (const a of draggedAnchors) {
    for (const b of candidates) {
      const ddx = b.x - a.x, ddy = b.y - a.y
      const dist = Math.hypot(ddx, ddy)
      if (dist < bestDist) {
        bestDist = dist
        best = { offsetX: ddx, offsetY: ddy, indicator: { x: b.x, y: b.y, kind: b.kind } }
      }
    }
  }
  return best
}
