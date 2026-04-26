// PlotTwist — renderer entry point. Wires modules + global keyboard shortcuts.

import { state, setState, subscribe, mutateProject, markClean, uid, activeRoom } from './state.js'
import { initCanvas, fitToContent, cancelCalibration } from './canvas.js'
import { initToolbar, selectTool } from './ui/toolbar.js'
import { initProjectSidebar }      from './ui/projectSidebar.js'
import { initObjectInfo }          from './ui/objectInfo.js'
import { initObjectList }          from './ui/objectList.js'
import { cancelPolygonDraw, finishPolygonDraw } from './tools/polygonTool.js'
import { insertImageAt }           from './tools/imageTool.js'
import { importImageSource }       from './imageImport.js'

// ── Bootstrap ──────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  // Seed an initial room so the canvas isn't a no-op on first launch.
  if (!state.project.rooms.length) {
    const id = uid('room')
    state.project.rooms.push({ id, name: 'Room 1', objects: [] })
    state.activeRoomId = id
  }

  initToolbar(document.getElementById('toolbar'))
  initProjectSidebar(document.getElementById('sidebar'))
  initObjectList(document.getElementById('layers'))
  initObjectInfo(document.getElementById('info'))
  initCanvas(document.getElementById('canvas'))
  initTitle()
  fitToContent()

  if (window.plottwist) {
    window.plottwist.onMenuEvent(handleMenuEvent)
  }
  bindKeyboard()
  bindImageImport()
})

function initTitle() {
  subscribe(() => {
    const dirty = state.dirty ? ' •' : ''
    const name = state.filePath ? state.filePath.split(/[\\/]/).pop().replace(/\.ptwist$/, '') : 'Untitled'
    document.title = `PlotTwist — ${name}${dirty}`
  })
}

// ── Keyboard ───────────────────────────────────────────────────────────────

function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    // Don't intercept when the user is typing in an input/textarea.
    const tag = e.target && e.target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur()
      return
    }

    // Cmd/Ctrl-6 → fit to content
    if ((e.metaKey || e.ctrlKey) && e.key === '6') {
      e.preventDefault()
      fitToContent()
      return
    }

    // Polygon drawing finish/cancel
    if (state.drawingPolygon) {
      if (e.key === 'Enter')  { e.preventDefault(); finishPolygonDraw(); return }
      if (e.key === 'Escape') { e.preventDefault(); cancelPolygonDraw();  return }
    }

    // Calibration cancel
    if (state.calibration && e.key === 'Escape') {
      e.preventDefault(); cancelCalibration(); return
    }

    // ⌘C / ⌘X copy selected shapes (image clipboard takes priority on paste)
    if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
      if (state.selection.length) { e.preventDefault(); copyShapes() }
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'x' || e.key === 'X')) {
      if (state.selection.length) {
        e.preventDefault()
        copyShapes()
        deleteSelection()
      }
      return
    }

    // Tool shortcuts
    const toolMap = { v: 'select', f: 'floor', a: 'aisle', o: 'obstruction', g: 'stage', t: 'tech', w: 'walls' }
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase()
      if (toolMap[k]) { selectTool(toolMap[k]); return }
    }

    // Delete selection
    if ((e.key === 'Backspace' || e.key === 'Delete') && state.selection.length) {
      e.preventDefault()
      deleteSelection()
      return
    }

    // Esc → deselect
    if (e.key === 'Escape') {
      setState({ selection: [] })
      return
    }
  })
}

// ── File menu ──────────────────────────────────────────────────────────────

async function handleMenuEvent(ev) {
  if (ev === 'menu-new-project')       return newProject()
  if (ev === 'menu-open-project')      return openProject()
  if (ev === 'menu-save-project')      return saveProject(false)
  if (ev === 'menu-save-project-as')   return saveProject(true)
  if (ev === 'menu-insert-image')      return pickAndInsertImage()
  if (ev === 'menu-save-and-quit') {
    const ok = await saveProject(false)
    if (ok && window.plottwist) window.plottwist.quitNow()
  }
}

function newProject() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return
  const id = uid('room')
  state.project = { rooms: [{ id, name: 'Room 1', objects: [] }] }
  state.activeRoomId = id
  state.selection = []
  state.filePath = null
  markClean(null)
  fitToContent()
}

async function openProject() {
  if (!window.plottwist) return
  if (state.dirty && !confirm('Discard unsaved changes?')) return
  const res = await window.plottwist.openProjectDialog()
  if (res.canceled || !res.filePaths || !res.filePaths.length) return
  const path = res.filePaths[0]
  try {
    const text = await window.plottwist.readFile(path)
    const data = JSON.parse(text)
    if (!data || !Array.isArray(data.rooms)) throw new Error('Not a PlotTwist project file.')
    state.project = { rooms: data.rooms }
    state.activeRoomId = data.rooms[0] ? data.rooms[0].id : null
    state.selection = []
    markClean(path)
    fitToContent()
  } catch (err) {
    alert(`Couldn't open project: ${err.message}`)
  }
}

// ── Image import (paste / drop / file picker) ────────────────────────────

function bindImageImport() {
  // The "+" button in the layers panel dispatches this event.
  window.addEventListener('plottwist:insert-image', () => pickAndInsertImage())

  // Clipboard paste anywhere in the app
  window.addEventListener('paste', async (e) => {
    const tag = e.target && e.target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return    // don't steal text paste

    // Priority 1: image in system clipboard → rasterize/insert
    const items = e.clipboardData && e.clipboardData.items
    if (items) {
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (blob) {
            e.preventDefault()
            await importAndInsert(blob, null)
            return
          }
        }
      }
    }

    // Priority 2: shapes from internal clipboard (⌘C earlier)
    if (state.shapeClipboard && state.shapeClipboard.length) {
      e.preventDefault()
      pasteShapes()
    }
  })

  // Drop files onto the canvas
  const canvasEl = document.getElementById('canvas')
  canvasEl.addEventListener('dragover', (e) => {
    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      canvasEl.classList.add('dropping')
    }
  })
  canvasEl.addEventListener('dragleave', () => canvasEl.classList.remove('dropping'))
  canvasEl.addEventListener('drop', async (e) => {
    canvasEl.classList.remove('dropping')
    if (!e.dataTransfer || !e.dataTransfer.files.length) return
    e.preventDefault()
    // Compute drop point in world coords
    const svg = canvasEl.querySelector('svg')
    const rect = svg.getBoundingClientRect()
    const sx = (e.clientX - rect.left) / rect.width
    const sy = (e.clientY - rect.top)  / rect.height
    const v = state.viewport
    const point = { x: v.x + sx * v.w, y: v.y + sy * v.h }
    for (const file of e.dataTransfer.files) {
      await importAndInsert(file, point)
    }
  })
}

async function pickAndInsertImage() {
  if (!window.plottwist) return
  const res = await window.plottwist.openImageDialog()
  if (res.canceled || !res.filePaths || !res.filePaths.length) return
  for (const path of res.filePaths) {
    try {
      const buf = await window.plottwist.readBinaryFile(path)
      // IPC delivers Buffer as Uint8Array; normalize to ArrayBuffer.
      const ab = (buf.buffer && buf.byteLength != null)
        ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        : buf
      const name = path.split(/[\\/]/).pop()
      const mime = sniffMimeFromName(name)
      const data = await importImageSource({ arrayBuffer: ab, mimeType: mime, name })
      insertImageAt(data, null)
    } catch (err) {
      console.error('image import failed', err)
      alert(`Couldn't import "${path.split(/[\\/]/).pop()}": ${err.message}`)
    }
  }
}

async function importAndInsert(blobOrFile, worldPoint) {
  try {
    const data = await importImageSource(blobOrFile)
    insertImageAt(data, worldPoint)
  } catch (err) {
    console.error('image import failed', err)
    alert(`Couldn't import image: ${err.message}`)
  }
}

// ── Shape clipboard (⌘C / ⌘X / ⌘V) ────────────────────────────────────────

const PASTE_OFFSET_INCHES = 24    // 2' nudge so the duplicate is visible

function copyShapes() {
  const sel = state.selection
  if (!sel.length) return
  const room = activeRoom()
  if (!room) return
  // Skip images — those round-trip via the system clipboard (paste image again).
  state.shapeClipboard = room.objects
    .filter(o => sel.includes(o.id) && o.kind !== 'image')
    .map(o => JSON.parse(JSON.stringify(o)))
}

function pasteShapes() {
  if (!state.shapeClipboard.length) return
  const newIds = []
  mutateProject(p => {
    const room = p.rooms.find(r => r.id === state.activeRoomId)
    if (!room) return
    for (const proto of state.shapeClipboard) {
      const dup = JSON.parse(JSON.stringify(proto))
      dup.id = uid('obj')
      newIds.push(dup.id)
      offsetObject(dup, PASTE_OFFSET_INCHES, PASTE_OFFSET_INCHES)
      room.objects.push(dup)
    }
  })
  setState({ selection: newIds })
}

export function duplicateObjectById(id) {
  let newId = null
  mutateProject(p => {
    const room = p.rooms.find(r => r.id === state.activeRoomId)
    if (!room) return
    const idx = room.objects.findIndex(o => o.id === id)
    if (idx < 0) return
    const dup = JSON.parse(JSON.stringify(room.objects[idx]))
    dup.id = uid('obj')
    newId = dup.id
    offsetObject(dup, PASTE_OFFSET_INCHES, PASTE_OFFSET_INCHES)
    room.objects.splice(idx + 1, 0, dup)
  })
  if (newId) setState({ selection: [newId] })
}

function offsetObject(o, dx, dy) {
  if (o.kind === 'rect' || o.kind === 'image') { o.x += dx; o.y += dy }
  else if (o.kind === 'polygon') o.vertices = o.vertices.map(([x, y]) => [x + dx, y + dy])
}

function deleteSelection() {
  const ids = new Set(state.selection)
  mutateProject(p => {
    const r = p.rooms.find(r => r.id === state.activeRoomId)
    if (r) r.objects = r.objects.filter(o => !ids.has(o.id))
  })
  setState({ selection: [] })
}

export function deleteObjectById(id) {
  mutateProject(p => {
    const r = p.rooms.find(r => r.id === state.activeRoomId)
    if (r) r.objects = r.objects.filter(o => o.id !== id)
  })
  setState({ selection: state.selection.filter(s => s !== id) })
}

function sniffMimeFromName(name) {
  const ext = (name.match(/\.([^.]+)$/) || [])[1]
  const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', pdf: 'application/pdf' }
  return map[String(ext || '').toLowerCase()] || ''
}

async function saveProject(forceDialog) {
  if (!window.plottwist) return false
  let path = state.filePath
  if (!path || forceDialog) {
    const res = await window.plottwist.saveProjectDialog('Untitled.ptwist')
    if (res.canceled || !res.filePath) return false
    path = res.filePath
  }
  const data = JSON.stringify({ version: 1, rooms: state.project.rooms }, null, 2)
  try {
    await window.plottwist.writeFile(path, data)
    markClean(path)
    return true
  } catch (err) {
    alert(`Couldn't save project: ${err.message}`)
    return false
  }
}
