// PlotTwist — renderer entry point. Wires modules + global keyboard shortcuts.

import { state, setState, subscribe, mutateProject, markClean, uid, activeRoom } from './state.js'
import { initCanvas, fitToContent } from './canvas.js'
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

    // Tool shortcuts
    const toolMap = { v: 'select', f: 'floor', a: 'aisle', o: 'obstruction', g: 'stage', t: 'tech', w: 'walls' }
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase()
      if (toolMap[k]) { selectTool(toolMap[k]); return }
    }

    // Delete selection
    if ((e.key === 'Backspace' || e.key === 'Delete') && state.selection.length) {
      e.preventDefault()
      const ids = new Set(state.selection)
      mutateProject(p => {
        const r = p.rooms.find(r => r.id === state.activeRoomId)
        if (r) r.objects = r.objects.filter(o => !ids.has(o.id))
      })
      setState({ selection: [] })
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
    const items = e.clipboardData && e.clipboardData.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const blob = item.getAsFile()
        if (blob) {
          e.preventDefault()
          await importAndInsert(blob, null)
        }
        return
      }
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
