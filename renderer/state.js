// Central state + tiny pub-sub. All world units are integer inches.

const listeners = new Set()

export const state = {
  project:        { rooms: [] },
  activeRoomId:   null,
  activeTool:     'select',
  selection:      [],                              // array of object ids
  viewport:       { x: -600, y: -420, w: 1200, h: 840 },  // 100' × 70', centered on origin
  drawingPolygon: null,                            // { vertices: [[x,y]...], cursor: [x,y], shiftSnap: bool }
  drawingRect:    null,                            // { startX, startY, x, y, w, h, type }
  tabEdit:        null,                            // { objectId, fieldIndex }
  dirty:          false,
  filePath:       null,
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function notify() {
  listeners.forEach(fn => fn())
}

export function setState(patch) {
  Object.assign(state, patch)
  notify()
}

export function mutateProject(fn) {
  fn(state.project)
  state.dirty = true
  if (window.plottwist) window.plottwist.setDirty(true)
  notify()
}

export function markClean(filePath) {
  state.dirty = false
  state.filePath = filePath ?? state.filePath
  if (window.plottwist) window.plottwist.setDirty(false)
  notify()
}

export function activeRoom() {
  return state.project.rooms.find(r => r.id === state.activeRoomId) || null
}

export function selectedObjects() {
  const room = activeRoom()
  if (!room) return []
  return room.objects.filter(o => state.selection.includes(o.id))
}

export function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 10)
}

// ── Object-type styling ────────────────────────────────────────────────────
// Defaults the user can override per-object via the Info panel later.

export const TYPE_STYLES = {
  floor:       { fill: '#5a6378', fillOpacity: 0.18, stroke: '#8d96ad', strokeWidth: 1,   label: 'Floor' },
  aisle:       { fill: '#d4a72c', fillOpacity: 0.18, stroke: '#d4a72c', strokeWidth: 1,   label: 'Aisle' },
  obstruction: { fill: '#8b1f3a', fillOpacity: 0.45, stroke: '#c2476f', strokeWidth: 1.5, label: 'Obstruction' },
  stage:       { fill: '#2d5a8a', fillOpacity: 0.32, stroke: '#5a8ec5', strokeWidth: 1.5, label: 'Stage' },
  tech:        { fill: '#5a3d7f', fillOpacity: 0.32, stroke: '#8c63b8', strokeWidth: 1.5, label: 'Tech Table' },
  walls:       { fill: 'none',    fillOpacity: 0,    stroke: '#f1f3f8', strokeWidth: 2.5, label: 'Walls' },
}

export function styleFor(obj) {
  const base = TYPE_STYLES[obj.type] || TYPE_STYLES.floor
  return {
    fill:         obj.fill         ?? base.fill,
    fillOpacity:  obj.fillOpacity  ?? base.fillOpacity,
    stroke:       obj.stroke       ?? base.stroke,
    strokeWidth:  obj.strokeWidth  ?? base.strokeWidth,
  }
}
