// Geometry helpers for objects and bounds.

export function rectArea(o) { return o.w * o.h }

export function polygonArea(verts) {
  let a = 0
  for (let i = 0; i < verts.length; i++) {
    const [x1, y1] = verts[i]
    const [x2, y2] = verts[(i + 1) % verts.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a / 2)
}

export function objectArea(o) {
  if (o.kind === 'rect' || o.kind === 'image') return rectArea(o)
  if (o.kind === 'polygon') return polygonArea(o.vertices)
  return 0
}

export function objectBounds(o) {
  if (o.kind === 'rect' || o.kind === 'image') {
    return { x: o.x, y: o.y, w: o.w, h: o.h }
  }
  if (o.kind === 'polygon') {
    if (!o.vertices.length) return { x: 0, y: 0, w: 0, h: 0 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of o.vertices) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  return { x: 0, y: 0, w: 0, h: 0 }
}

// Bounds spanning multiple objects, padded.
export function unionBounds(objects, padInches = 36) {
  if (!objects.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const o of objects) {
    const b = objectBounds(o)
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.w > maxX) maxX = b.x + b.w
    if (b.y + b.h > maxY) maxY = b.y + b.h
  }
  return { x: minX - padInches, y: minY - padInches, w: (maxX - minX) + padInches * 2, h: (maxY - minY) + padInches * 2 }
}

// Snap an angle (radians) to the nearest 45° step.
export function snapAngle(rad) {
  const step = Math.PI / 4
  return Math.round(rad / step) * step
}

// Given a previous vertex and a current point, return the snapped point.
export function snapToAxis(prev, cur) {
  const dx = cur[0] - prev[0]
  const dy = cur[1] - prev[1]
  const dist = Math.hypot(dx, dy)
  if (dist < 1) return cur.slice()
  const ang = snapAngle(Math.atan2(dy, dx))
  return [Math.round(prev[0] + Math.cos(ang) * dist), Math.round(prev[1] + Math.sin(ang) * dist)]
}

// Point-in-polygon test (ray casting).
export function pointInPolygon(px, py, verts) {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const [xi, yi] = verts[i], [xj, yj] = verts[j]
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi || 1e-9) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

export function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
}

export function hitTest(o, px, py) {
  if (o.kind === 'rect' || o.kind === 'image') return pointInRect(px, py, o)
  if (o.kind === 'polygon') {
    if (o.vertices.length < 3) return false
    return pointInPolygon(px, py, o.vertices)
  }
  return false
}

// Distance from a point to a line segment.
export function distToSegment(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
