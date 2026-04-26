// Selection tool: drag to move, drag handles to resize, drag vertices to edit
// polygon shape. Mutations are committed in-place during the drag (the SVG
// is small enough to re-render cheaply); endSelectDrag is just a hook.

import { state, mutateProject, selectedObjects, activeRoom } from '../state.js'

export function startSelectDrag(mode, opts) {
  // Snapshot the original geometry of every selected object so we can compute
  // deltas relative to drag-start — avoids drift from accumulating rounding.
  const sel = selectedObjects()
  const snapshot = new Map()
  for (const o of sel) {
    if (o.kind === 'rect')    snapshot.set(o.id, { x: o.x, y: o.y, w: o.w, h: o.h })
    if (o.kind === 'polygon') snapshot.set(o.id, { vertices: o.vertices.map(v => v.slice()) })
  }
  return { mode, ...opts, snapshot }
}

export function updateSelectDrag(drag, world) {
  const dx = Math.round(world.x - drag.start.x)
  const dy = Math.round(world.y - drag.start.y)
  const room = activeRoom()
  if (!room) return

  if (drag.mode === 'move') {
    mutateProject(() => {
      for (const o of room.objects) {
        if (!state.selection.includes(o.id)) continue
        const orig = drag.snapshot.get(o.id)
        if (!orig) continue
        if (o.kind === 'rect') {
          o.x = orig.x + dx
          o.y = orig.y + dy
        } else if (o.kind === 'polygon') {
          o.vertices = orig.vertices.map(([x, y]) => [x + dx, y + dy])
        }
      }
    })
    return
  }

  if (drag.mode === 'resize') {
    const target = selectedObjects()[0]
    if (!target || target.kind !== 'rect') return
    const orig = drag.snapshot.get(target.id)
    if (!orig) return
    let { x, y, w, h } = orig
    const right  = x + w
    const bottom = y + h
    const handle = drag.handle
    if (handle.includes('w')) { x = orig.x + dx; w = right - x }
    if (handle.includes('e')) { w = orig.w + dx }
    if (handle.includes('n')) { y = orig.y + dy; h = bottom - y }
    if (handle.includes('s')) { h = orig.h + dy }
    // Prevent flipping past zero
    if (w < 1) { x = right - 1; w = 1 }
    if (h < 1) { y = bottom - 1; h = 1 }
    mutateProject(() => {
      target.x = x; target.y = y; target.w = w; target.h = h
    })
    return
  }

  if (drag.mode === 'vertex') {
    const target = room.objects.find(o => o.id === drag.objectId)
    if (!target || target.kind !== 'polygon') return
    const orig = drag.snapshot.get(target.id)
    if (!orig) return
    mutateProject(() => {
      const v = orig.vertices[drag.vertexIdx]
      if (!v) return
      target.vertices[drag.vertexIdx] = [v[0] + dx, v[1] + dy]
    })
    return
  }
}

export function endSelectDrag(_drag) {
  // No-op for now — mutateProject already marked dirty during the drag.
}
