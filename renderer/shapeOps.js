// Boolean operations on rectangles + polygons. Backed by polygon-clipping
// (vendored UMD, attached to window.polygonClipping by index.html).

import { TYPE_STYLES } from './state.js'

// Convert a rectangle/polygon object to a polygon-clipping geometry.
// polygon-clipping geometry: [ [ outer-ring, hole-ring*, ... ] ] (multipolygon).
// We always emit a single-polygon, single-ring geometry.
function toGeom(o) {
  if (o.kind === 'rect') {
    const { x, y, w, h } = o
    return [[[
      [x,     y    ],
      [x + w, y    ],
      [x + w, y + h],
      [x,     y + h],
      [x,     y    ],
    ]]]
  }
  if (o.kind === 'polygon') {
    const ring = o.vertices.map(v => v.slice())
    // polygon-clipping wants closed rings.
    if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
      ring.push(ring[0].slice())
    }
    return [[ring]]
  }
  return null
}

// Turn a polygon-clipping result into a flat outer ring of integer points.
// Strips the closing-duplicate vertex so it matches our internal storage.
// Returns null on disjoint or empty result.
function flattenResult(result) {
  if (!result || !result.length) return null
  if (result.length > 1) return { error: 'multipart' }     // disjoint pieces
  const polygon = result[0]
  if (!polygon || !polygon.length) return null
  const ring = polygon[0]
  if (!ring || ring.length < 4) return null
  const out = ring.slice(0, -1).map(([x, y]) => [Math.round(x), Math.round(y)])
  return { vertices: out, hasHoles: polygon.length > 1 }
}

// Compute the union of two-or-more rect/polygon objects. Returns
// { vertices: [[x,y]...] } on success, or { error: '...' } on failure.
export function unionShapes(objects) {
  if (!window.polygonClipping) {
    return { error: 'polygon-clipping library not loaded' }
  }
  const geoms = objects.map(toGeom).filter(Boolean)
  if (geoms.length < 2) return { error: 'Need at least two shapes to join.' }

  let result
  try {
    result = window.polygonClipping.union(geoms[0], ...geoms.slice(1))
  } catch (err) {
    return { error: err.message || 'Union failed.' }
  }
  const flat = flattenResult(result)
  if (!flat)              return { error: 'Empty result.' }
  if (flat.error === 'multipart') return { error: 'Selected shapes are disjoint — they need to overlap or touch to merge.' }
  if (flat.hasHoles)      return { error: 'Result has holes; holes are not supported in v1.' }
  return { vertices: flat.vertices }
}

// Type for the merged polygon — match the first object's type when sensible.
// "underlay" / "image" can never be the merge type — fall back to "floor".
export function mergedType(objects) {
  for (const o of objects) {
    if (o.kind === 'rect' || o.kind === 'polygon') {
      if (TYPE_STYLES[o.type]) return o.type
    }
  }
  return 'floor'
}
