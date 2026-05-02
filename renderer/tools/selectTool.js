// Selection tool: drag to move, drag handles to resize, drag vertices to edit
// polygon shape. Mutations are committed in-place during the drag (the SVG
// is small enough to re-render cheaply); endSelectDrag is just a hook.

import { state, mutateProject, selectedObjects, activeRoom, activeLayout } from '../state.js'

export function startSelectDrag(mode, opts) {
  // Snapshot the original geometry of every selected object so we can compute
  // deltas relative to drag-start — avoids drift from accumulating rounding.
  const sel = selectedObjects().filter(o => !o.locked && !o.hidden)
  const snapshot = new Map()
  for (const o of sel) {
    if (o.kind === 'rect' || o.kind === 'image') {
      snapshot.set(o.id, { x: o.x, y: o.y, w: o.w, h: o.h })
    }
    if (o.kind === 'dim') {
      snapshot.set(o.id, { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 })
    }
    if (o.kind === 'polygon') {
      const snap = { vertices: o.vertices.map(v => v.slice()) }
      // Seating zones: capture cached chair/table positions so a whole-zone
      // move translates them in lockstep with the polygon (no re-solve needed).
      if (o.type === 'seating' && o.result) {
        snap.result = {
          seats:  (o.result.seats  || []).map(s => ({ ...s })),
          tables: (o.result.tables || []).map(t => ({ ...t })),
        }
      }
      snapshot.set(o.id, snap)
    }
  }
  return { mode, ...opts, snapshot }
}

export function updateSelectDrag(drag, world) {
  let dx = Math.round(world.x - drag.start.x)
  let dy = Math.round(world.y - drag.start.y)
  // Shift held → constrain to dominant axis (whichever has bigger magnitude).
  if (drag.shiftHeld && (drag.mode === 'move' || drag.mode === 'vertex')) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0
    else dx = 0
  }
  const room = activeRoom()
  if (!room) return
  const layout = activeLayout()
  const allObjects = [...room.objects, ...(layout ? layout.objects : [])]

  if (drag.mode === 'move') {
    mutateProject(() => {
      for (const o of allObjects) {
        if (!state.selection.includes(o.id)) continue
        if (o.locked || o.hidden) continue
        const orig = drag.snapshot.get(o.id)
        if (!orig) continue
        if (o.kind === 'rect' || o.kind === 'image') {
          o.x = orig.x + dx
          o.y = orig.y + dy
        } else if (o.kind === 'dim') {
          o.x1 = orig.x1 + dx; o.y1 = orig.y1 + dy
          o.x2 = orig.x2 + dx; o.y2 = orig.y2 + dy
        } else if (o.kind === 'polygon') {
          o.vertices = orig.vertices.map(([x, y]) => [x + dx, y + dy])
          // Translate cached seats/tables along with the zone polygon.
          if (orig.result && o.result) {
            o.result.seats  = orig.result.seats.map(s  => ({ ...s, x: s.x + dx, y: s.y + dy }))
            o.result.tables = orig.result.tables.map(t => ({ ...t, x: t.x + dx, y: t.y + dy }))
          }
        }
      }
    })
    return
  }

  if (drag.mode === 'resize') {
    const target = selectedObjects().find(o => drag.snapshot.has(o.id))
    if (!target || (target.kind !== 'rect' && target.kind !== 'image')) return
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
    const target = allObjects.find(o => o.id === drag.objectId)
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
