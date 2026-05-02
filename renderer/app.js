// PlotTwist — renderer entry point. Wires modules + global keyboard shortcuts.

import { state, setState, subscribe, mutateProject, markClean, uid, activeRoom, activeLayout, undo, redo, clearHistory, beginTransaction, endTransaction } from './state.js'
import { getSetting, onSettingsChange } from './settings.js'
import { checkForUpdates } from './updater.js'
import { initSettingsModal, openSettings } from './ui/settingsModal.js'
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
    const roomId = uid('room')
    const layoutId = uid('layout')
    state.project.rooms.push({ id: roomId, name: 'Room 1', objects: [], layouts: [{ id: layoutId, name: 'Layout 1', hidden: false, locked: false, objects: [] }] })
    state.activeRoomId = roomId
    state.activeLayoutId = layoutId
  }
  // Initialize per-project workspace fields if missing.
  if (!state.project.origin)     state.project.origin = { x: 0, y: 0 }
  if (!state.project.centerline) state.project.centerline = { enabled: false, x: 0, color: '#5be7d4', thickness: 1.5 }

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
  bindLeftPaneSplit()
  initSettingsModal()
  bindPickModeBanner()
  bindAutoSave()
  runLaunchUpdateCheck()
})

// Auto-save: timer fires every `autoSaveInterval` minutes (when > 0). Only
// saves when the project is dirty AND has a file path (Untitled projects are
// skipped — there's no meaningful place to save them silently).
let autoSaveTimer = null
function bindAutoSave() {
  const arm = () => {
    if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null }
    const minutes = parseInt(getSetting('autoSaveInterval'), 10)
    if (!minutes || minutes <= 0) return
    autoSaveTimer = setInterval(() => {
      if (state.dirty && state.filePath) saveProject(false).catch(err => console.error('auto-save failed', err))
    }, minutes * 60 * 1000)
  }
  arm()
  onSettingsChange(arm)
}

// Auto-check on launch — fires once after a short delay so the UI has time
// to settle. If a newer release is available, shows a dismissable banner.
async function runLaunchUpdateCheck() {
  if (!getSetting('autoCheckUpdates')) return
  if (!window.plottwist?.getAppVersion) return
  setTimeout(async () => {
    try {
      const current = await window.plottwist.getAppVersion()
      const res = await checkForUpdates(current)
      if (res.ok && res.isNewer) showUpdateBanner(res)
    } catch (err) { console.warn('update check failed', err) }
  }, 2000)
}

function showUpdateBanner(res) {
  const banner = document.createElement('div')
  banner.className = 'update-banner'
  banner.innerHTML = `
    <span>PlotTwist <b>${res.latest}</b> is available — you're on v${res.current}.</span>
    <button class="block-btn small" data-action="open">View release</button>
    <button class="ghost-btn small" data-action="dismiss">Dismiss</button>
  `
  document.body.appendChild(banner)
  banner.querySelector('[data-action="open"]').addEventListener('click', () => {
    if (window.plottwist?.openExternal) window.plottwist.openExternal(res.url)
    else window.open(res.url, '_blank')
  })
  banner.querySelector('[data-action="dismiss"]').addEventListener('click', () => banner.remove())
}

// Floating banner shown while the user is picking origin / centerline on the
// canvas. Click anywhere on the canvas to commit; Esc or the cancel button
// to abort.
function bindPickModeBanner() {
  const banner = document.createElement('div')
  banner.className = 'pick-banner'
  banner.style.display = 'none'
  document.body.appendChild(banner)
  subscribe(() => {
    const m = state.pickMode
    if (!m) { banner.style.display = 'none'; return }
    banner.style.display = ''
    const label = m === 'origin' ? 'Click on the canvas to set the origin'
                : m === 'centerline' ? 'Click on the canvas to place the centerline'
                : ''
    banner.innerHTML = `<span>${label}</span><button data-cancel>Cancel · Esc</button>`
    banner.querySelector('[data-cancel]').onclick = () => setState({ pickMode: null })
  })
}

// Drag the horizontal bar between the rooms list and the layers panel.
// Persists the chosen height in localStorage so the layout sticks across runs.
function bindLeftPaneSplit() {
  const pane    = document.querySelector('.sidebar-pane')
  const handle  = pane && pane.querySelector('.left-split')
  if (!pane || !handle) return

  // Restore previous height (clamped to a sensible range).
  const saved = parseInt(localStorage.getItem('plottwist:rooms-h') || '', 10)
  if (Number.isFinite(saved)) {
    pane.style.setProperty('--rooms-h', `${clampRoomsH(saved, pane)}px`)
  }

  let startY = 0, startH = 0
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    handle.classList.add('dragging')
    startY = e.clientY
    const cs = getComputedStyle(pane)
    startH = parseInt(cs.getPropertyValue('--rooms-h') || '220', 10) || 220
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup',   onUp,   { once: true })
    handle.addEventListener('pointercancel', onUp, { once: true })
  })

  function onMove(e) {
    const next = clampRoomsH(startH + (e.clientY - startY), pane)
    pane.style.setProperty('--rooms-h', `${next}px`)
  }
  function onUp() {
    handle.classList.remove('dragging')
    handle.removeEventListener('pointermove', onMove)
    const final = parseInt(getComputedStyle(pane).getPropertyValue('--rooms-h'), 10)
    if (Number.isFinite(final)) localStorage.setItem('plottwist:rooms-h', String(final))
  }
}

function clampRoomsH(px, pane) {
  const total = pane.getBoundingClientRect().height
  const min = 100, max = Math.max(min, total - 140) // always leave 140px for layers
  return Math.max(min, Math.min(max, px))
}

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

    // ⌘Z undo / ⌘⇧Z redo. Skip when typing in an input — already returned above.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      if (e.shiftKey) redo()
      else            undo()
      return
    }

    // Arrow-key nudge. Each press is one undo step; shift = larger amount.
    // Amounts persist in localStorage; defaults are 1' / 6' (in inches).
    if (state.selection.length && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      e.preventDefault()
      const amt = e.shiftKey ? getSetting('nudgeLarge') : getSetting('nudgeSmall')
      let dx = 0, dy = 0
      if (e.key === 'ArrowLeft')  dx = -amt
      if (e.key === 'ArrowRight') dx =  amt
      if (e.key === 'ArrowUp')    dy = -amt
      if (e.key === 'ArrowDown')  dy =  amt
      nudgeSelection(dx, dy)
      return
    }

    // Polygon drawing finish/cancel — pass current tool so the right type lands.
    if (state.drawingPolygon) {
      if (e.key === 'Enter')  { e.preventDefault(); finishPolygonDraw(state.activeTool); return }
      if (e.key === 'Escape') { e.preventDefault(); cancelPolygonDraw();  return }
    }

    // Calibration cancel
    if (state.calibration && e.key === 'Escape') {
      e.preventDefault(); cancelCalibration(); return
    }
    // Pick-mode (origin / centerline) cancel
    if (state.pickMode && e.key === 'Escape') {
      e.preventDefault(); setState({ pickMode: null }); return
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
    const toolMap = { v: 'select', f: 'floor', a: 'aisle', o: 'obstruction', g: 'stage', t: 'tech', w: 'walls', s: 'seating', d: 'dim' }
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
  if (ev === 'menu-open-settings')     return openSettings()
}

function newProject() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return
  const roomId = uid('room')
  const layoutId = uid('layout')
  state.project = {
    rooms: [{ id: roomId, name: 'Room 1', objects: [], layouts: [{ id: layoutId, name: 'Layout 1', hidden: false, locked: false, objects: [] }] }],
    origin:     { x: 0, y: 0 },
    centerline: { enabled: false, x: 0, color: '#5be7d4', thickness: 1.5 },
  }
  state.activeRoomId = roomId
  state.activeLayoutId = layoutId
  state.selection = []
  state.filePath = null
  clearHistory()
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
    // Migrate rooms that pre-date layouts.
    for (const room of data.rooms) {
      if (!room.layouts || !room.layouts.length) {
        const layoutId = uid('layout')
        room.layouts = [{ id: layoutId, name: 'Layout 1', hidden: false, locked: false, objects: [] }]
      }
    }
    state.project = {
      rooms: data.rooms,
      origin:     data.origin     ?? { x: 0, y: 0 },
      centerline: data.centerline ?? { enabled: false, x: 0, color: '#5be7d4', thickness: 1.5 },
    }
    state.activeRoomId = data.rooms[0] ? data.rooms[0].id : null
    state.activeLayoutId = data.rooms[0]?.layouts?.[0]?.id ?? null
    state.selection = []
    clearHistory()
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
  const layout = activeLayout()
  const allObjs = [...room.objects, ...(layout ? layout.objects : [])]
  // Skip images — those round-trip via the system clipboard (paste image again).
  state.shapeClipboard = allObjs
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
    // Check room objects first, then active layout objects.
    let container = room
    let idx = room.objects.findIndex(o => o.id === id)
    if (idx < 0) {
      const layout = (room.layouts || []).find(l => l.id === state.activeLayoutId)
      if (layout) { container = layout; idx = layout.objects.findIndex(o => o.id === id) }
    }
    if (idx < 0) return
    const dup = JSON.parse(JSON.stringify(container.objects[idx]))
    dup.id = uid('obj')
    newId = dup.id
    offsetObject(dup, PASTE_OFFSET_INCHES, PASTE_OFFSET_INCHES)
    container.objects.splice(idx + 1, 0, dup)
  })
  if (newId) setState({ selection: [newId] })
}

function offsetObject(o, dx, dy) {
  if (o.kind === 'rect' || o.kind === 'image') { o.x += dx; o.y += dy }
  else if (o.kind === 'polygon') o.vertices = o.vertices.map(([x, y]) => [x + dx, y + dy])
}

// Nudge every selected object by (dx, dy) in inches. Translates rect/image
// origin, dim endpoints, polygon vertices, AND any cached seating-zone
// solver result so chairs/tables move with their parent zone.
// Wrapped in a transaction so each arrow-key press is one undo step.
export function nudgeSelection(dx, dy) {
  if (!dx && !dy) return
  const room = activeRoom()
  if (!room) return
  const layout = activeLayout()
  const allObjects = [...room.objects, ...(layout?.objects || [])]
  const selIds = new Set(state.selection)
  beginTransaction()
  mutateProject(() => {
    for (const o of allObjects) {
      if (!selIds.has(o.id)) continue
      if (o.locked || o.hidden) continue
      if (o.kind === 'rect' || o.kind === 'image') {
        o.x += dx; o.y += dy
      } else if (o.kind === 'dim') {
        o.x1 += dx; o.y1 += dy
        o.x2 += dx; o.y2 += dy
      } else if (o.kind === 'polygon') {
        o.vertices = o.vertices.map(([x, y]) => [x + dx, y + dy])
        if (o.result) {
          if (o.result.seats)  o.result.seats  = o.result.seats .map(s => ({ ...s, x: s.x + dx, y: s.y + dy }))
          if (o.result.tables) o.result.tables = o.result.tables.map(t => ({ ...t, x: t.x + dx, y: t.y + dy }))
        }
      }
    }
  })
  endTransaction()
}

// Dev-console helper for tweaking nudge defaults until a real Settings UI
// lands. e.g. plottwistSetNudge(24, 144) for 2' / 12' nudges.
if (typeof window !== 'undefined') {
  window.plottwistSetNudge = (small, large) => {
    if (small != null) localStorage.setItem('plottwist:nudge-small', String(small))
    if (large != null) localStorage.setItem('plottwist:nudge-large', String(large))
    console.log(`Nudge set: small=${localStorage.getItem('plottwist:nudge-small') || '12'}", large=${localStorage.getItem('plottwist:nudge-large') || '72'}".`)
  }
}

function deleteSelection() {
  const ids = new Set(state.selection)
  mutateProject(p => {
    const r = p.rooms.find(r => r.id === state.activeRoomId)
    if (!r) return
    r.objects = r.objects.filter(o => !ids.has(o.id))
    const layout = (r.layouts || []).find(l => l.id === state.activeLayoutId)
    if (layout) layout.objects = layout.objects.filter(o => !ids.has(o.id))
  })
  setState({ selection: [] })
}

export function deleteObjectById(id) {
  mutateProject(p => {
    const r = p.rooms.find(r => r.id === state.activeRoomId)
    if (!r) return
    r.objects = r.objects.filter(o => o.id !== id)
    const layout = (r.layouts || []).find(l => l.id === state.activeLayoutId)
    if (layout) layout.objects = layout.objects.filter(o => o.id !== id)
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
  const data = JSON.stringify({
    version: 1,
    rooms: state.project.rooms,
    origin: state.project.origin,
    centerline: state.project.centerline,
  }, null, 2)
  try {
    await window.plottwist.writeFile(path, data)
    markClean(path)
    return true
  } catch (err) {
    alert(`Couldn't save project: ${err.message}`)
    return false
  }
}
