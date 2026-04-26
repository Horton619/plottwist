// Rectangle drawing tool — used for floor, aisle, obstruction, stage, tech.

import { state, mutateProject, setState, uid, activeRoom } from '../state.js'
import { rerenderTools } from '../canvas.js'

export function startRectDraw(type, [x, y]) {
  state.drawingRect = { type, startX: x, startY: y, x, y, w: 0, h: 0 }
  rerenderTools()
}

export function updateRectDraw([x, y]) {
  const dr = state.drawingRect
  if (!dr) return
  dr.w = x - dr.startX
  dr.h = y - dr.startY
  dr.x = dr.startX
  dr.y = dr.startY
  rerenderTools()
}

export function endRectDraw() {
  const dr = state.drawingRect
  state.drawingRect = null
  if (!dr) return rerenderTools()
  // Normalize negative dimensions
  let x = dr.x, y = dr.y, w = dr.w, h = dr.h
  if (w < 0) { x = x + w; w = -w }
  if (h < 0) { y = y + h; h = -h }
  if (w < 6 || h < 6) {                     // ignore micro-rects (< 6")
    rerenderTools()
    return
  }
  const id = uid('obj')
  mutateProject(p => {
    const room = p.rooms.find(r => r.id === state.activeRoomId)
    if (!room) return
    room.objects.push({
      id, kind: 'rect', type: dr.type,
      x, y, w, h,
    })
  })
  setState({ selection: [id], activeTool: 'select' })
}
