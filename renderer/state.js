// Central state + tiny pub-sub. All world units are integer inches.

import { getSetting } from './settings.js'

const listeners = new Set()

// ── Undo/redo ──────────────────────────────────────────────────────────────
// Each mutateProject() call snapshots the project BEFORE applying changes,
// pushing the snapshot onto the undo stack. Drags would generate dozens of
// snapshots per gesture, so we wrap them in a "transaction" — beginTransaction
// before the drag starts, endTransaction when it ends; only the first mutation
// inside a transaction snapshots, so the entire drag collapses to one step.

let inTransaction   = false
let transactionDirty = false   // true once the current transaction has snapshotted

function snapshotProject() {
  return typeof structuredClone === 'function'
    ? structuredClone(state.project)
    : JSON.parse(JSON.stringify(state.project))
}

function pushUndoSnapshot() {
  state.undoStack.push(snapshotProject())
  const limit = Math.max(10, getSetting('undoDepth') || 80)
  while (state.undoStack.length > limit) state.undoStack.shift()
  state.redoStack = []   // any new mutation invalidates the redo path
}

export const state = {
  project:        { rooms: [] },
  activeRoomId:   null,
  activeLayoutId: null,
  activeTool:     'select',
  selection:      [],                              // array of object ids
  viewport:       { x: -600, y: -420, w: 1200, h: 840 },  // 100' × 70', centered on origin
  drawingPolygon: null,                            // { vertices: [[x,y]...], cursor: [x,y], shiftSnap: bool }
  drawingRect:    null,                            // { startX, startY, x, y, w, h, type }
  drawingDim:     null,                            // { x1, y1, x2, y2 } — dim line in progress
  tabEdit:        null,                            // { objectId, fieldIndex }
  calibration:    null,                            // { objectId, clicks: [[x,y]...] } when scaling an underlay
  shapeClipboard: [],                              // copied non-image objects for ⌘C/⌘V
  snapIndicator:  null,                            // { x, y, kind } when a drag is currently snapping
  pickMode:       null,                            // 'origin' | 'centerline' | null — next canvas click sets that property
  dirty:          false,
  filePath:       null,
  undoStack:      [],                              // each entry: deep-cloned project snapshot
  redoStack:      [],
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
  // Snapshot BEFORE the mutation so undo restores the pre-mutation state.
  // In a transaction, only snapshot on the first mutation of the gesture.
  if (inTransaction) {
    if (!transactionDirty) {
      pushUndoSnapshot()
      transactionDirty = true
    }
  } else {
    pushUndoSnapshot()
  }
  fn(state.project)
  state.dirty = true
  if (window.plottwist) window.plottwist.setDirty(true)
  notify()
}

// Wrap a drag (or any multi-mutation gesture) so its mutations collapse to
// one undo step. Calling beginTransaction is idempotent within an open one.
export function beginTransaction() {
  if (inTransaction) return
  inTransaction = true
  transactionDirty = false
}

export function endTransaction() {
  inTransaction = false
  transactionDirty = false
}

export function undo() {
  if (!state.undoStack.length) return
  state.redoStack.push(snapshotProject())
  state.project = state.undoStack.pop()
  state.dirty = true
  if (window.plottwist) window.plottwist.setDirty(true)
  notify()
}

export function redo() {
  if (!state.redoStack.length) return
  state.undoStack.push(snapshotProject())
  state.project = state.redoStack.pop()
  state.dirty = true
  if (window.plottwist) window.plottwist.setDirty(true)
  notify()
}

export function clearHistory() {
  state.undoStack = []
  state.redoStack = []
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

export function activeLayout() {
  const room = activeRoom()
  if (!room) return null
  return (room.layouts || []).find(l => l.id === state.activeLayoutId) || null
}

export function selectedObjects() {
  const room = activeRoom()
  if (!room) return []
  const layout = activeLayout()
  const fromRoom   = room.objects.filter(o => state.selection.includes(o.id))
  const fromLayout = layout ? layout.objects.filter(o => state.selection.includes(o.id)) : []
  return [...fromRoom, ...fromLayout]
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
  underlay:    { fill: 'none',    fillOpacity: 0,    stroke: 'none',    strokeWidth: 0,   label: 'Underlay' },
  seating:     { fill: '#FF2D9D', fillOpacity: 0.08, stroke: '#FF2D9D', strokeWidth: 1.5, label: 'Seating Zone' },
  dim:         { fill: 'none',    fillOpacity: 0,    stroke: '#5be7d4', strokeWidth: 1,   label: 'Dimension' },
}

// Auto-generate a friendly name when an object doesn't have one yet.
// Pass layout as the container when the object lives in a layout, room otherwise.
export function objectName(obj, container) {
  if (obj.name) return obj.name
  const label = (TYPE_STYLES[obj.type] && TYPE_STYLES[obj.type].label) || obj.type
  if (!container) return label
  const sameType = container.objects.filter(o => o.type === obj.type)
  if (sameType.length <= 1) return label
  const idx = sameType.indexOf(obj) + 1
  return `${label} ${idx}`
}

// Move an object's array index within an arbitrary objects[] array.
export function reorderObject(container, fromIdx, toIdx) {
  if (fromIdx === toIdx) return
  const [item] = container.objects.splice(fromIdx, 1)
  container.objects.splice(toIdx, 0, item)
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
