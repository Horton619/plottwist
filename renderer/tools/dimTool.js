// Dim line tool — drag from start to end to draft a measurement line. Both
// endpoints snap to nearby anchors (corners, midpoints, centers, plus solver
// chair/table centers) within a screen-space tolerance, and the snap point
// gets a cyan ring while the cursor is locked on it.

import { state, mutateProject, setState, uid } from '../state.js'
import { rerenderTools } from '../canvas.js'
import { snapPointToAnchors } from '../snapEngine.js'

export function startDimDraw([x, y], snapTol = 0) {
  const snap = snapTol > 0 ? snapPointToAnchors(x, y, snapTol) : null
  if (snap) {
    state.drawingDim = { x1: snap.x, y1: snap.y, x2: snap.x, y2: snap.y }
    state.snapIndicator = snap
  } else {
    state.drawingDim = { x1: x, y1: y, x2: x, y2: y }
    state.snapIndicator = null
  }
  rerenderTools()
}

export function updateDimDraw([x, y], shiftKey = false, snapTol = 0) {
  if (!state.drawingDim) return
  const dd = state.drawingDim
  let nx = x, ny = y
  if (shiftKey) {
    // Shift = constrain to horizontal/vertical/45°.
    const dx = x - dd.x1, dy = y - dd.y1
    if (Math.abs(dx) >= Math.abs(dy) * 2)        ny = dd.y1                   // horizontal
    else if (Math.abs(dy) >= Math.abs(dx) * 2)   nx = dd.x1                   // vertical
    else {                                                                   // 45°
      const sign = Math.sign(dx) || 1
      const signY = Math.sign(dy) || 1
      const m = Math.min(Math.abs(dx), Math.abs(dy))
      nx = dd.x1 + sign  * m
      ny = dd.y1 + signY * m
    }
  }
  // Snap the END point to a nearby anchor. Skip while shift is held since the
  // user explicitly wants axis-locked motion.
  const snap = (!shiftKey && snapTol > 0) ? snapPointToAnchors(nx, ny, snapTol) : null
  if (snap) {
    dd.x2 = snap.x; dd.y2 = snap.y
    state.snapIndicator = snap
  } else {
    dd.x2 = Math.round(nx); dd.y2 = Math.round(ny)
    state.snapIndicator = null
  }
  rerenderTools()
}

export function endDimDraw() {
  state.snapIndicator = null
  const dd = state.drawingDim
  state.drawingDim = null
  if (!dd) { rerenderTools(); return }
  const dx = dd.x2 - dd.x1, dy = dd.y2 - dd.y1
  if (Math.hypot(dx, dy) < 6) { rerenderTools(); return }   // ignore micro-drags
  const id = uid('obj')
  mutateProject(p => {
    const room = p.rooms.find(r => r.id === state.activeRoomId)
    if (!room) return
    room.objects.push({
      id, kind: 'dim', type: 'dim',
      x1: dd.x1, y1: dd.y1, x2: dd.x2, y2: dd.y2,
    })
  })
  setState({ selection: [id], activeTool: 'select' })
}
