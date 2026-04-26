// Inserts an underlay image into the active room. Default sizing: 1 image
// pixel = 1 inch, with the image fit-scaled if larger than ~80% of the
// current viewport's smaller dimension. User can resize via corner handles.

import { state, mutateProject, setState, uid, activeRoom } from '../state.js'

export function insertImageAt(imageData, worldPoint = null) {
  const room = activeRoom()
  if (!room) return null

  const v = state.viewport
  const target = worldPoint || { x: v.x + v.w / 2, y: v.y + v.h / 2 }

  // Default scale: 1 pixel = 1 inch. If that produces something larger than
  // 80% of the current viewport's shorter side, scale it to fit so the image
  // is visible on insert. User can resize after.
  let w = imageData.naturalWidth  || 800
  let h = imageData.naturalHeight || 600
  const limit = Math.min(v.w, v.h) * 0.8
  const longest = Math.max(w, h)
  if (longest > limit) {
    const k = limit / longest
    w *= k; h *= k
  }
  w = Math.round(w); h = Math.round(h)

  const id = uid('img')
  mutateProject(p => {
    const r = p.rooms.find(r => r.id === state.activeRoomId)
    if (!r) return
    // Underlays default to the bottom of the stack (rendered first, behind
    // everything else). User can reorder via the layers panel.
    r.objects.unshift({
      id, kind: 'image', type: 'underlay',
      name:    imageData.name || 'Underlay',
      x:       Math.round(target.x - w / 2),
      y:       Math.round(target.y - h / 2),
      w, h,
      src:     imageData.dataUrl,
      opacity: 0.6,
      hidden:  false,
      locked:  false,
    })
  })
  setState({ selection: [id], activeTool: 'select' })
  return id
}
