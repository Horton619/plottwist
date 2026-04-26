// Polygon (walls) drawing tool. Click to place vertices, shift to snap to
// 0/45/90° increments, double-click or Enter to close, Esc to cancel.

import { state, mutateProject, setState, uid } from '../state.js'
import { rerenderTools } from '../canvas.js'

export function startPolygonDraw(point) {
  state.drawingPolygon = { vertices: [point], cursor: point, shiftSnap: false }
  rerenderTools()
}

export function addPolygonVertex(point) {
  if (!state.drawingPolygon) return
  // Don't add a duplicate of the previous vertex.
  const verts = state.drawingPolygon.vertices
  const last = verts[verts.length - 1]
  if (last[0] === point[0] && last[1] === point[1]) return
  verts.push(point)
  rerenderTools()
}

export function cancelPolygonDraw() {
  state.drawingPolygon = null
  rerenderTools()
}

export function finishPolygonDraw() {
  const dp = state.drawingPolygon
  state.drawingPolygon = null
  if (!dp || dp.vertices.length < 3) {
    rerenderTools()
    return
  }
  const id = uid('obj')
  mutateProject(p => {
    const room = p.rooms.find(r => r.id === state.activeRoomId)
    if (!room) return
    room.objects.push({
      id, kind: 'polygon', type: 'walls',
      vertices: dp.vertices.slice(),
    })
  })
  setState({ selection: [id], activeTool: 'select' })
}
