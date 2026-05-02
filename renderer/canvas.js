// SVG canvas: scene graph, pan/zoom, render, hit-testing.
// World units = inches. The SVG viewBox itself is expressed in inches so the
// math is simple — pan = shift viewBox origin, zoom = scale viewBox dimensions.

import { state, setState, subscribe, mutateProject, activeRoom, activeLayout, selectedObjects, styleFor, uid, beginTransaction, endTransaction } from './state.js'
import { objectBounds, unionBounds, hitTest, distToSegment, snapToAxis } from './geom.js'
import { formatInches, parseInches } from './units.js'
import { startRectDraw,    updateRectDraw,    endRectDraw }    from './tools/rectTool.js'
import { startPolygonDraw, addPolygonVertex,  cancelPolygonDraw, finishPolygonDraw } from './tools/polygonTool.js'
import { startSelectDrag,  updateSelectDrag,  endSelectDrag }  from './tools/selectTool.js'
import { startDimDraw,     updateDimDraw,     endDimDraw }     from './tools/dimTool.js'
import { computeAislePositions, computeShiftedRoundAislePositions } from './solver/geom.js'
import { getSetting, onSettingsChange } from './settings.js'
import { computeMoveSnap, computeDragPointSnap } from './snapEngine.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

let host, svg, gridLayer, objectLayer, handleLayer, toolLayer, statusEl
let drag = null   // { mode, ... }
let spaceDown = false  // space-bar held → temporary pan tool

export function initCanvas(container) {
  host = container
  host.innerHTML = `
    <div class="canvas-frame">
      <svg class="floor-svg"></svg>
      <div class="canvas-status"></div>
      <div class="cal-banner" hidden>
        <span class="cal-msg"></span>
        <input class="cal-input" placeholder="e.g. 10' or 120&quot;" hidden>
        <button class="cal-apply"  hidden>Apply</button>
        <button class="cal-cancel">Cancel</button>
      </div>
    </div>
  `
  svg       = host.querySelector('.floor-svg')
  statusEl  = host.querySelector('.canvas-status')
  bindCalibrationUi(host)
  svg.setAttribute('xmlns', SVG_NS)

  gridLayer   = document.createElementNS(SVG_NS, 'g'); gridLayer.setAttribute('class', 'grid-layer')
  objectLayer = document.createElementNS(SVG_NS, 'g'); objectLayer.setAttribute('class', 'object-layer')
  handleLayer = document.createElementNS(SVG_NS, 'g'); handleLayer.setAttribute('class', 'handle-layer')
  toolLayer   = document.createElementNS(SVG_NS, 'g'); toolLayer.setAttribute('class', 'tool-layer')
  svg.appendChild(gridLayer)
  svg.appendChild(objectLayer)
  svg.appendChild(handleLayer)
  svg.appendChild(toolLayer)

  applyViewport()

  svg.addEventListener('wheel',       onWheel, { passive: false })
  svg.addEventListener('pointerdown', onPointerDown)
  svg.addEventListener('pointermove', onPointerMove)
  svg.addEventListener('pointerup',   onPointerUp)
  svg.addEventListener('dblclick',    onDoubleClick)
  svg.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('resize',   render)
  window.addEventListener('keydown',  onSpaceDown)
  window.addEventListener('keyup',    onSpaceUp)

  subscribe(render)
  onSettingsChange(render)   // grid/snap/etc. updates trigger an immediate re-render
  render()
}

// ── Viewport / coords ──────────────────────────────────────────────────────

function applyViewport() {
  const { x, y, w, h } = state.viewport
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`)
}

function screenToWorld(clientX, clientY) {
  const rect = svg.getBoundingClientRect()
  const sx = (clientX - rect.left) / rect.width
  const sy = (clientY - rect.top)  / rect.height
  const v  = state.viewport
  return { x: v.x + sx * v.w, y: v.y + sy * v.h }
}

function pxToWorldDist(px) {
  const rect = svg.getBoundingClientRect()
  return px * (state.viewport.w / rect.width)
}

// ── Pan / zoom ─────────────────────────────────────────────────────────────

function onWheel(e) {
  e.preventDefault()
  if (e.shiftKey) {
    // Shift + trackpad/wheel → pan
    const v = state.viewport
    const factor = v.w / svg.getBoundingClientRect().width
    state.viewport = { ...v, x: v.x + e.deltaX * factor, y: v.y + e.deltaY * factor }
    applyViewport()
    renderStatus()
  } else {
    // Wheel/scroll OR pinch (deltaY with ctrlKey) → zoom toward cursor
    const factor = Math.exp(-e.deltaY * 0.0025)
    zoomAt(e.clientX, e.clientY, factor)
  }
}

function zoomAt(clientX, clientY, factor) {
  const v = state.viewport
  // Clamp zoom so viewport is always between 6" and 1000ft wide.
  const minW = 72, maxW = 12000 * 12
  const newW = Math.min(maxW, Math.max(minW, v.w / factor))
  const newH = newW * (v.h / v.w)
  const rect = svg.getBoundingClientRect()
  const sx = (clientX - rect.left) / rect.width
  const sy = (clientY - rect.top)  / rect.height
  const wx = v.x + sx * v.w
  const wy = v.y + sy * v.h
  state.viewport = { x: wx - sx * newW, y: wy - sy * newH, w: newW, h: newH }
  applyViewport()
  renderStatus()
}

export function fitToContent() {
  const room = activeRoom()
  const roomObjs = room ? room.objects : []
  const layoutObjs = (room?.layouts || []).flatMap(l => l.objects)
  const objs = [...roomObjs, ...layoutObjs]
  let bounds = unionBounds(objs, 60)
  if (!bounds) {
    // Empty room — fit a 100ft × 70ft region centered on origin.
    bounds = { x: -600, y: -420, w: 1200, h: 840 }
  }
  // Maintain the SVG aspect ratio so we don't stretch.
  const rect = svg.getBoundingClientRect()
  const aspect = rect.width / rect.height
  let { x, y, w, h } = bounds
  if (w / h > aspect) {
    const newH = w / aspect
    y -= (newH - h) / 2
    h = newH
  } else {
    const newW = h * aspect
    x -= (newW - w) / 2
    w = newW
  }
  state.viewport = { x, y, w, h }
  applyViewport()
  renderStatus()
}

// ── Pointer / tools ────────────────────────────────────────────────────────

function onPointerDown(e) {
  if (e.button === 2) return                       // right-click handled in contextmenu
  const w = screenToWorld(e.clientX, e.clientY)
  const room = activeRoom()
  if (!room) return

  // Space-bar pan — works in any mode (calibration, drawing, etc.)
  if (spaceDown || e.button === 1) {
    drag = {
      mode: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startV: { ...state.viewport },
    }
    svg.style.cursor = 'grabbing'
    svg.setPointerCapture(e.pointerId)
    return
  }

  // Calibration mode intercepts all canvas clicks until 2 points are picked.
  if (state.calibration) {
    addCalibrationPoint([Math.round(w.x), Math.round(w.y)])
    return
  }

  // Origin / centerline pick modes — set the chosen project field, exit mode.
  if (state.pickMode === 'origin') {
    mutateProject(p => {
      if (!p.origin) p.origin = { x: 0, y: 0 }
      p.origin.x = Math.round(w.x)
      p.origin.y = Math.round(w.y)
    })
    setState({ pickMode: null })
    return
  }
  if (state.pickMode === 'centerline') {
    mutateProject(p => {
      if (!p.centerline) p.centerline = { enabled: true, x: 0, color: '#5be7d4', thickness: 1.5 }
      p.centerline.enabled = true
      p.centerline.x = Math.round(w.x)
    })
    setState({ pickMode: null })
    return
  }

  // Tool dispatch
  if (state.activeTool === 'select') {
    // Hit handles first, then objects.
    const handle = e.target.closest('[data-handle]')
    if (handle) {
      beginTransaction()
      drag = startSelectDrag('resize', { handle: handle.dataset.handle, start: w })
      svg.setPointerCapture(e.pointerId)
      return
    }
    // Mid-edge handle: insert a fresh vertex at the midpoint and immediately
    // turn the gesture into a vertex-drag for that new vertex.
    const midHandle = e.target.closest('[data-mid-edge]')
    if (midHandle) {
      const oid = midHandle.dataset.objectId
      const edgeIdx = parseInt(midHandle.dataset.midEdge, 10)
      const layout = activeLayout()
      const obj = room.objects.find(o => o.id === oid)
        || (layout ? layout.objects.find(o => o.id === oid) : null)
      if (obj && obj.kind === 'polygon') {
        const a = obj.vertices[edgeIdx]
        const b = obj.vertices[(edgeIdx + 1) % obj.vertices.length]
        const mid = [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)]
        const insertAt = edgeIdx + 1
        // Transaction wraps both the vertex insert AND the subsequent drag —
        // one undo step rolls back the inserted vertex and any motion.
        beginTransaction()
        mutateProject(() => { obj.vertices.splice(insertAt, 0, mid) })
        drag = startSelectDrag('vertex', {
          objectId:  oid,
          vertexIdx: insertAt,
          start:     w,
        })
        svg.setPointerCapture(e.pointerId)
      }
      return
    }
    const vertex = e.target.closest('[data-vertex]')
    if (vertex) {
      beginTransaction()
      drag = startSelectDrag('vertex', {
        objectId: vertex.dataset.objectId,
        vertexIdx: parseInt(vertex.dataset.vertex, 10),
        start: w,
      })
      svg.setPointerCapture(e.pointerId)
      return
    }
    // Aisle dim-label drag — slides the dim line along the aisle's long axis.
    const aisleDim = e.target.closest('[data-aisle-dim-id]')
    if (aisleDim) {
      const aisleId = aisleDim.dataset.aisleDimId
      const layout  = activeLayout()
      const aisle   = (layout?.objects || []).find(o => o.id === aisleId)
                   || room.objects.find(o => o.id === aisleId)
      if (aisle && !aisle.locked && !aisle.hidden) {
        beginTransaction()
        drag = {
          mode: 'aisle-dim',
          aisleId,
          axis: aisleDim.dataset.aisleAxis,    // 'x' (horizontal aisle) | 'y' (vertical)
        }
        svg.setPointerCapture(e.pointerId)
        return
      }
    }
    // Hit-test against active layout first (visually on top), then venue.
    const layout = activeLayout()
    const layoutHit = layout && !layout.hidden && !layout.locked
      ? hitTopMost(w.x, w.y, layout.objects)
      : null
    const hit = layoutHit || hitTopMost(w.x, w.y, room.objects)
    if (hit) {
      const additive = e.shiftKey
      let sel = state.selection.slice()
      if (additive) {
        if (sel.includes(hit.id)) sel = sel.filter(i => i !== hit.id)
        else sel.push(hit.id)
      } else if (!sel.includes(hit.id)) {
        sel = [hit.id]
      }
      setState({ selection: sel, tabEdit: null })
      beginTransaction()
      drag = startSelectDrag('move', { start: w })
      svg.setPointerCapture(e.pointerId)
    } else {
      setState({ selection: [], tabEdit: null })
    }
    return
  }

  // Walls is the only polygon tool — seating now defaults to rect drawing.
  if (state.activeTool === 'walls') {
    if (!state.drawingPolygon) {
      startPolygonDraw([Math.round(w.x), Math.round(w.y)])
    } else {
      const last = state.drawingPolygon.vertices[state.drawingPolygon.vertices.length - 1]
      const next = e.shiftKey ? snapToAxis(last, [w.x, w.y]) : [Math.round(w.x), Math.round(w.y)]
      addPolygonVertex(next)
    }
    return
  }

  // Dim line tool — drag two-point measurement. Endpoints snap to nearby
  // anchors (corners / midpoints / chairs / tables / etc.) within tolerance.
  if (state.activeTool === 'dim') {
    drag = { mode: 'draw-dim' }
    const tol = getSetting('snapEnabled') ? pxToWorldDist(getSetting('snapTolerance')) : 0
    startDimDraw([Math.round(w.x), Math.round(w.y)], tol)
    svg.setPointerCapture(e.pointerId)
    return
  }

  // All rectangle-based tools (now includes seating).
  const rectTypes = ['floor', 'aisle', 'obstruction', 'stage', 'tech', 'seating']
  if (rectTypes.includes(state.activeTool)) {
    drag = { mode: 'draw-rect' }
    startRectDraw(state.activeTool, [Math.round(w.x), Math.round(w.y)])
    svg.setPointerCapture(e.pointerId)
  }
}

function onPointerMove(e) {
  const w = screenToWorld(e.clientX, e.clientY)

  // Polygon preview tracks even without a drag because vertices are committed on click.
  if (state.activeTool === 'walls' && state.drawingPolygon) {
    const last = state.drawingPolygon.vertices[state.drawingPolygon.vertices.length - 1]
    const cursor = e.shiftKey ? snapToAxis(last, [w.x, w.y]) : [Math.round(w.x), Math.round(w.y)]
    state.drawingPolygon.cursor = cursor
    state.drawingPolygon.shiftSnap = e.shiftKey
    renderToolLayer()
  }

  if (!drag) return
  if (drag.mode === 'pan') {
    const rect = svg.getBoundingClientRect()
    const factor = drag.startV.w / rect.width
    state.viewport = {
      ...state.viewport,
      x: drag.startV.x - (e.clientX - drag.startClientX) * factor,
      y: drag.startV.y - (e.clientY - drag.startClientY) * factor,
    }
    applyViewport()
    renderStatus()
    return
  }
  if (drag.mode === 'draw-rect') {
    updateRectDraw([Math.round(w.x), Math.round(w.y)])
  } else if (drag.mode === 'draw-dim') {
    const tol = getSetting('snapEnabled') ? pxToWorldDist(getSetting('snapTolerance')) : 0
    updateDimDraw([Math.round(w.x), Math.round(w.y)], e.shiftKey, tol)
  } else if (drag.mode === 'aisle-dim') {
    const layout = activeLayout()
    const aisle  = (layout?.objects || []).find(o => o.id === drag.aisleId)
                || activeRoom()?.objects.find(o => o.id === drag.aisleId)
    if (!aisle) return
    let frac
    if (drag.axis === 'x') {
      frac = (w.x - aisle.x) / aisle.w
    } else {
      frac = (w.y - aisle.y) / aisle.h
    }
    if (!isFinite(frac)) return
    frac = Math.max(0.05, Math.min(0.95, frac))
    mutateProject(() => { aisle.dimLabelFrac = Math.round(frac * 100) / 100 })
    return
  } else if (drag.mode === 'move' || drag.mode === 'resize' || drag.mode === 'vertex') {
    drag.shiftHeld = e.shiftKey

    // Anchor snapping. Move drags pull the WHOLE selection by a delta; vertex
    // and resize drags snap the cursor itself, since the underlying math
    // already uses cursor deltas. Tolerance + on/off come from Settings.
    let snappedWorld = w
    if (!drag.shiftHeld && getSetting('snapEnabled')) {
      const tol = pxToWorldDist(getSetting('snapTolerance'))
      if (drag.mode === 'move') {
        const dx = Math.round(w.x - drag.start.x)
        const dy = Math.round(w.y - drag.start.y)
        const snap = computeMoveSnap(drag, dx, dy, tol)
        if (snap) {
          state.snapIndicator = snap.indicator
          snappedWorld = { x: w.x + snap.offsetX, y: w.y + snap.offsetY }
        } else if (state.snapIndicator) {
          state.snapIndicator = null
        }
      } else {
        const snap = computeDragPointSnap(drag, w.x, w.y, tol)
        if (snap) {
          state.snapIndicator = { x: snap.x, y: snap.y, kind: snap.kind }
          snappedWorld = { x: snap.x, y: snap.y }
        } else if (state.snapIndicator) {
          state.snapIndicator = null
        }
      }
    } else if (state.snapIndicator) {
      state.snapIndicator = null
    }

    updateSelectDrag(drag, snappedWorld)
  }
}

function onPointerUp(e) {
  if (!drag) return
  try { svg.releasePointerCapture(e.pointerId) } catch {}
  if (drag.mode === 'pan') {
    drag = null
    updateCursor()
    return
  }
  if (drag.mode === 'draw-rect') {
    endRectDraw()
  } else if (drag.mode === 'draw-dim') {
    endDimDraw()
  } else if (drag.mode === 'aisle-dim') {
    endTransaction()
  } else if (drag.mode === 'move' || drag.mode === 'resize' || drag.mode === 'vertex') {
    endSelectDrag(drag)
    endTransaction()    // close the undo group; a no-op gesture leaves no history entry
    state.snapIndicator = null
  }
  drag = null
}

function onSpaceDown(e) {
  if (e.code !== 'Space' || e.repeat) return
  const tag = e.target && e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  e.preventDefault()
  spaceDown = true
  if (!drag) svg.style.cursor = 'grab'
}

function onSpaceUp(e) {
  if (e.code !== 'Space') return
  spaceDown = false
  if (!drag) updateCursor()
}

function onDoubleClick(e) {
  if (state.activeTool === 'walls' && state.drawingPolygon) {
    finishPolygonDraw('walls')
    e.preventDefault()
  }
}

function onContextMenu(e) {
  e.preventDefault()
  const w = screenToWorld(e.clientX, e.clientY)
  const room = activeRoom(); if (!room) return

  // Helper: find a polygon object by id, looking in venue then active layout.
  const findPoly = (root, oid) => {
    const r = root.rooms.find(r => r.id === state.activeRoomId)
    if (!r) return null
    let o = r.objects.find(o => o.id === oid)
    if (o) return o
    const layout = (r.layouts || []).find(l => l.id === state.activeLayoutId)
    return layout ? layout.objects.find(o => o.id === oid) : null
  }

  // If clicking a vertex of a selected polygon, delete it.
  const vTarget = e.target.closest('[data-vertex]')
  if (vTarget) {
    const oid = vTarget.dataset.objectId
    const vi  = parseInt(vTarget.dataset.vertex, 10)
    mutateProject(p => {
      const o = findPoly(p, oid)
      if (o && o.kind === 'polygon' && o.vertices.length > 3) o.vertices.splice(vi, 1)
    })
    return
  }
  // If on a polygon edge of a selected polygon, insert a vertex.
  const sel = selectedObjects().filter(o => o.kind === 'polygon')
  const tol = pxToWorldDist(8)
  for (const o of sel) {
    for (let i = 0; i < o.vertices.length; i++) {
      const a = o.vertices[i], b = o.vertices[(i + 1) % o.vertices.length]
      if (distToSegment([w.x, w.y], a, b) <= tol) {
        mutateProject(p => {
          const obj = findPoly(p, o.id)
          if (obj) obj.vertices.splice(i + 1, 0, [Math.round(w.x), Math.round(w.y)])
        })
        return
      }
    }
  }
}

function hitTopMost(x, y, objects) {
  const tol = pxToWorldDist(6)   // 6 px around thin shapes (dim lines, etc.)
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]
    if (o.hidden || o.locked) continue
    if (hitTest(o, x, y, tol)) return o
  }
  return null
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  applyViewport()
  renderGrid()
  renderGuides()        // origin marker + centerline (drawn under objects)
  renderObjects()
  renderHandles()
  renderToolLayer()
  renderFireMarshal()   // magenta callouts; only visible while the sheet is open
  renderStatus()
  renderCalibration()
  updateCursor()
}

// Numbered magenta callouts — anchored at each violation in
// state.fireMarshal.result.violations. Drawn last so they layer above objects
// and handles. Scaled to a constant pixel size via pxToWorldDist.
let fireMarshalLayer = null
function renderFireMarshal() {
  if (!fireMarshalLayer) {
    fireMarshalLayer = document.createElementNS(SVG_NS, 'g')
    fireMarshalLayer.setAttribute('class', 'fire-marshal-layer')
    svg.appendChild(fireMarshalLayer)
  } else {
    while (fireMarshalLayer.firstChild) fireMarshalLayer.removeChild(fireMarshalLayer.firstChild)
    svg.appendChild(fireMarshalLayer)   // re-attach last so it stays on top
  }
  const fm = state.fireMarshal
  if (!fm || !fm.open || !fm.result) return
  const focusedId = fm.focusedId
  const r = pxToWorldDist(13)
  for (const v of fm.result.violations) {
    if (!v.anchor || v.severity === 'info') continue
    const isFocused = v.id === focusedId
    const g = document.createElementNS(SVG_NS, 'g')
    g.setAttribute('class', 'fm-callout')
    // Outer halo on focused violations.
    if (isFocused) {
      const halo = document.createElementNS(SVG_NS, 'circle')
      halo.setAttribute('cx', v.anchor.x); halo.setAttribute('cy', v.anchor.y)
      halo.setAttribute('r', pxToWorldDist(22))
      halo.setAttribute('fill', 'none')
      halo.setAttribute('stroke', '#FF3B30')
      halo.setAttribute('stroke-width', pxToWorldDist(2))
      halo.setAttribute('vector-effect', 'non-scaling-stroke')
      halo.setAttribute('opacity', 0.6)
      g.appendChild(halo)
    }
    const circ = document.createElementNS(SVG_NS, 'circle')
    circ.setAttribute('cx', v.anchor.x); circ.setAttribute('cy', v.anchor.y)
    circ.setAttribute('r', r)
    circ.setAttribute('fill', '#FF3B30')
    circ.setAttribute('stroke', '#fff')
    circ.setAttribute('stroke-width', pxToWorldDist(1.5))
    circ.setAttribute('vector-effect', 'non-scaling-stroke')
    g.appendChild(circ)
    const t = document.createElementNS(SVG_NS, 'text')
    t.setAttribute('x', v.anchor.x); t.setAttribute('y', v.anchor.y)
    t.setAttribute('text-anchor', 'middle')
    t.setAttribute('dominant-baseline', 'central')
    t.setAttribute('fill', '#fff')
    t.setAttribute('font-size', pxToWorldDist(13))
    t.setAttribute('font-weight', '700')
    t.setAttribute('font-family', 'system-ui, sans-serif')
    t.textContent = String(v.id)
    g.appendChild(t)
    fireMarshalLayer.appendChild(g)
  }
}

let guideLayer = null
function renderGuides() {
  if (!guideLayer) {
    guideLayer = document.createElementNS(SVG_NS, 'g')
    guideLayer.setAttribute('class', 'guide-layer')
    // Insert above grid, below objects.
    svg.insertBefore(guideLayer, objectLayer)
  }
  while (guideLayer.firstChild) guideLayer.removeChild(guideLayer.firstChild)

  const v = state.viewport
  const yTop = v.y, yBot = v.y + v.h, xLeft = v.x, xRight = v.x + v.w

  // Centerline (project-level vertical guide).
  const cl = state.project.centerline
  if (cl && cl.enabled) {
    const line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', cl.x); line.setAttribute('y1', yTop)
    line.setAttribute('x2', cl.x); line.setAttribute('y2', yBot)
    line.setAttribute('stroke', cl.color || '#5be7d4')
    line.setAttribute('stroke-width', pxToWorldDist(cl.thickness ?? 1.5))
    line.setAttribute('stroke-dasharray', `${pxToWorldDist(8)} ${pxToWorldDist(4)}`)
    line.setAttribute('vector-effect', 'non-scaling-stroke')
    line.setAttribute('opacity', 0.7)
    guideLayer.appendChild(line)
  }

  // Origin marker — small crosshair + 0,0 label.
  const origin = state.project.origin
  if (origin) {
    const r = pxToWorldDist(8)
    const cross = document.createElementNS(SVG_NS, 'path')
    cross.setAttribute('d',
      `M ${origin.x - r} ${origin.y} L ${origin.x + r} ${origin.y} ` +
      `M ${origin.x} ${origin.y - r} L ${origin.x} ${origin.y + r}`
    )
    cross.setAttribute('stroke', '#fff')
    cross.setAttribute('stroke-width', pxToWorldDist(1))
    cross.setAttribute('vector-effect', 'non-scaling-stroke')
    cross.setAttribute('opacity', 0.55)
    guideLayer.appendChild(cross)
    const ring = document.createElementNS(SVG_NS, 'circle')
    ring.setAttribute('cx', origin.x); ring.setAttribute('cy', origin.y)
    ring.setAttribute('r', pxToWorldDist(4))
    ring.setAttribute('fill', 'none')
    ring.setAttribute('stroke', '#fff')
    ring.setAttribute('stroke-width', pxToWorldDist(0.8))
    ring.setAttribute('vector-effect', 'non-scaling-stroke')
    ring.setAttribute('opacity', 0.55)
    guideLayer.appendChild(ring)
  }
}

function updateCursor() {
  if (state.calibration) { svg.style.cursor = 'crosshair'; return }
  const cur = ({
    select: 'default',
    floor:  'crosshair',
    aisle:  'crosshair',
    obstruction: 'crosshair',
    stage:  'crosshair',
    tech:   'crosshair',
    walls:  'crosshair',
  })[state.activeTool] || 'default'
  svg.style.cursor = cur
}

function renderGrid() {
  while (gridLayer.firstChild) gridLayer.removeChild(gridLayer.firstChild)
  if (!getSetting('showGrid')) return                  // hidden via Settings → Workspace
  const v = state.viewport
  const rect = svg.getBoundingClientRect()
  if (!rect.width) return

  // Spacing — 'auto' picks a step based on zoom; numeric values lock the step.
  const userSpacing = getSetting('gridSpacing')
  const targetMajorPx = 90
  const inchesPerPx = v.w / rect.width
  const targetInches = targetMajorPx * inchesPerPx
  const candidates = [12, 24, 60, 120, 240, 600, 1200, 2400, 6000, 12000]
  let major = candidates[candidates.length - 1]
  for (const c of candidates) { if (c >= targetInches) { major = c; break } }
  // Override with the user's chosen fixed spacing if set.
  if (typeof userSpacing === 'number' && userSpacing > 0) major = userSpacing
  const minor = major / (major === 12 ? 4 : major === 24 ? 4 : 5)

  const drawLines = (step, cls) => {
    const x0 = Math.floor(v.x / step) * step
    const x1 = Math.ceil((v.x + v.w) / step) * step
    const y0 = Math.floor(v.y / step) * step
    const y1 = Math.ceil((v.y + v.h) / step) * step
    for (let x = x0; x <= x1; x += step) {
      const ln = document.createElementNS(SVG_NS, 'line')
      ln.setAttribute('x1', x); ln.setAttribute('x2', x)
      ln.setAttribute('y1', y0); ln.setAttribute('y2', y1)
      ln.setAttribute('class', cls)
      gridLayer.appendChild(ln)
    }
    for (let y = y0; y <= y1; y += step) {
      const ln = document.createElementNS(SVG_NS, 'line')
      ln.setAttribute('y1', y); ln.setAttribute('y2', y)
      ln.setAttribute('x1', x0); ln.setAttribute('x2', x1)
      ln.setAttribute('class', cls)
      gridLayer.appendChild(ln)
    }
  }
  drawLines(minor, 'grid-minor')
  drawLines(major, 'grid-major')

  // Origin axes
  const ax = document.createElementNS(SVG_NS, 'line')
  ax.setAttribute('x1', v.x); ax.setAttribute('x2', v.x + v.w)
  ax.setAttribute('y1', 0);   ax.setAttribute('y2', 0)
  ax.setAttribute('class', 'grid-axis')
  gridLayer.appendChild(ax)
  const ay = document.createElementNS(SVG_NS, 'line')
  ay.setAttribute('x1', 0);   ay.setAttribute('x2', 0)
  ay.setAttribute('y1', v.y); ay.setAttribute('y2', v.y + v.h)
  ay.setAttribute('class', 'grid-axis')
  gridLayer.appendChild(ay)

  gridLayer.dataset.major = major
}

function renderObjects() {
  while (objectLayer.firstChild) objectLayer.removeChild(objectLayer.firstChild)
  const room = activeRoom()
  if (!room) return

  // Room structural objects — always at base opacity.
  for (const o of room.objects) {
    if (o.hidden) continue
    const node = renderObject(o)
    if (node) objectLayer.appendChild(node)
  }

  // Layout objects — active layout at full opacity, others dimmed to 35%.
  for (const layout of (room.layouts || [])) {
    if (layout.hidden) continue
    const isActive = layout.id === state.activeLayoutId
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.dataset.layoutId = layout.id
    if (!isActive) g.setAttribute('opacity', '0.35')
    for (const o of layout.objects) {
      if (o.hidden) continue
      const node = renderObject(o)
      if (node) g.appendChild(node)
    }
    if (g.childNodes.length) objectLayer.appendChild(g)
  }
}

function renderObject(o) {
  let el

  if (o.kind === 'image') {
    el = document.createElementNS(SVG_NS, 'image')
    el.setAttribute('x', o.x); el.setAttribute('y', o.y)
    el.setAttribute('width',  Math.max(1, o.w))
    el.setAttribute('height', Math.max(1, o.h))
    el.setAttribute('href', o.src)
    el.setAttribute('preserveAspectRatio', 'none')
    el.setAttribute('opacity', o.opacity ?? 0.6)
  } else if (o.kind === 'dim') {
    el = buildDimGraphic(o, /* preview */ false)
  } else if (o.kind === 'rect') {
    const s = styleFor(o)
    el = document.createElementNS(SVG_NS, 'rect')
    el.setAttribute('x', o.x); el.setAttribute('y', o.y)
    el.setAttribute('width',  o.w); el.setAttribute('height', o.h)
    el.setAttribute('fill',         s.fill)
    el.setAttribute('fill-opacity', s.fillOpacity)
    el.setAttribute('stroke',       s.stroke)
    el.setAttribute('stroke-width', s.strokeWidth * pxToWorldDist(1))
    el.setAttribute('vector-effect','non-scaling-stroke')
    // Aisle rects: wrap with a dim callout so the user always sees the gap.
    if (o.type === 'aisle') {
      const g = document.createElementNS(SVG_NS, 'g')
      g.appendChild(el)
      g.appendChild(buildAisleDimCallout(o.x, o.y, o.w, o.h, 0, { aisleId: o.id, frac: o.dimLabelFrac ?? 0.5 }))
      el = g
    }
  } else if (o.kind === 'polygon') {
    const s = styleFor(o)
    // Seating zones get a wrapper group: zone polygon + computed chairs + aisle stripe.
    if (o.type === 'seating') {
      const g = document.createElementNS(SVG_NS, 'g')
      const poly = document.createElementNS(SVG_NS, o.vertices.length >= 3 ? 'polygon' : 'polyline')
      poly.setAttribute('points', o.vertices.map(v => v.join(',')).join(' '))
      poly.setAttribute('fill',         s.fill)
      poly.setAttribute('fill-opacity', s.fillOpacity)
      poly.setAttribute('stroke',       s.stroke)
      poly.setAttribute('stroke-width', s.strokeWidth * pxToWorldDist(1))
      poly.setAttribute('vector-effect','non-scaling-stroke')
      poly.setAttribute('stroke-dasharray', `${pxToWorldDist(6)} ${pxToWorldDist(4)}`)
      g.appendChild(poly)
      // Auto-aisles (from zone.aisles.count) — translucent yellow stripes so the
      // user can see where the cuts are, especially when combined with manually
      // drawn aisle objects.
      const autoAisles = buildAutoAisles(o)
      if (autoAisles) g.appendChild(autoAisles)
      // Facing arrow at the centroid.
      g.appendChild(buildFacingArrow(o))
      // Solver output — tables first (under chairs), then chairs on top.
      if (o.result?.tables) {
        for (const table of o.result.tables) g.appendChild(buildTable(table))
      }
      if (o.result?.seats) {
        for (const seat of o.result.seats) g.appendChild(buildChair(seat))
      }
      el = g
    } else {
      el = document.createElementNS(SVG_NS, o.vertices.length >= 3 ? 'polygon' : 'polyline')
      el.setAttribute('points', o.vertices.map(v => v.join(',')).join(' '))
      el.setAttribute('fill',         s.fill)
      el.setAttribute('fill-opacity', s.fillOpacity)
      el.setAttribute('stroke',       s.stroke)
      el.setAttribute('stroke-width', s.strokeWidth * pxToWorldDist(1))
      el.setAttribute('vector-effect','non-scaling-stroke')
    }
  } else {
    return null
  }

  el.dataset.objectId = o.id
  el.classList.add('plot-object', `plot-${o.type}`)
  if (o.locked) el.classList.add('plot-locked')
  if (state.selection.includes(o.id)) el.classList.add('plot-selected')
  return el
}

// One classroom or round table.
//   kind: 'round' → drawn as a circle (diameter = table.w = table.d)
//   else          → rectangle with rounded corners (banquet-style classroom)
// Both get a centered dimension label (e.g., 5' for a 60" round, 8' for an
// 8' classroom table) so size reads at a glance.
function buildTable(table) {
  const g = document.createElementNS(SVG_NS, 'g')
  g.setAttribute('transform', `translate(${table.x} ${table.y}) rotate(${table.rotation || 0})`)
  g.setAttribute('class', 'plot-table')

  const isRound = table.kind === 'round'
  const w = table.w, d = table.d

  if (isRound) {
    // Outer chair-footprint circle (faint dashed) — visualizes the area the
    // chairs around this table occupy, and matches the polygon-fit test the
    // solver uses.
    if (table.chairD) {
      const outer = document.createElementNS(SVG_NS, 'circle')
      outer.setAttribute('cx', 0); outer.setAttribute('cy', 0)
      outer.setAttribute('r', w / 2 + table.chairD)
      outer.setAttribute('fill', 'none')
      outer.setAttribute('stroke', '#FF2D9D')
      outer.setAttribute('stroke-width', pxToWorldDist(0.4))
      outer.setAttribute('stroke-opacity', 0.28)
      outer.setAttribute('stroke-dasharray', `${pxToWorldDist(3)} ${pxToWorldDist(3)}`)
      outer.setAttribute('vector-effect', 'non-scaling-stroke')
      g.appendChild(outer)
    }
    const c = document.createElementNS(SVG_NS, 'circle')
    c.setAttribute('cx', 0); c.setAttribute('cy', 0)
    c.setAttribute('r', w / 2)
    c.setAttribute('fill', '#1a1f2e')
    c.setAttribute('stroke', '#FF2D9D')
    c.setAttribute('stroke-width', pxToWorldDist(0.6))
    c.setAttribute('vector-effect', 'non-scaling-stroke')
    g.appendChild(c)
  } else {
    const r = document.createElementNS(SVG_NS, 'rect')
    r.setAttribute('x', -w / 2); r.setAttribute('y', -d / 2)
    r.setAttribute('width', w);  r.setAttribute('height', d)
    r.setAttribute('rx', 2)
    r.setAttribute('fill', '#1a1f2e')
    r.setAttribute('stroke', '#FF2D9D')
    r.setAttribute('stroke-width', pxToWorldDist(0.6))
    r.setAttribute('vector-effect', 'non-scaling-stroke')
    g.appendChild(r)
  }

  // Dimension label — long side (or diameter for rounds) in feet.
  const ft = w / 12
  const ftLabel = (Math.abs(ft - Math.round(ft)) < 0.05)
    ? `${Math.round(ft)}'`
    : `${ft.toFixed(1)}'`
  const fontSize = isRound ? Math.min(w * 0.18, 12) : Math.min(d * 0.55, 9)
  const label = document.createElementNS(SVG_NS, 'text')
  label.setAttribute('x', 0); label.setAttribute('y', 0)
  label.setAttribute('text-anchor', 'middle')
  label.setAttribute('dominant-baseline', 'central')
  label.setAttribute('font-size', fontSize)
  label.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
  label.setAttribute('fill', '#FF2D9D')
  label.setAttribute('opacity', '0.55')
  label.textContent = ftLabel
  g.appendChild(label)

  return g
}

// One chair — translucent magenta fill, magenta hairline stroke around all
// four sides, and a heavier stroke on the BACK edge (the side facing AWAY
// from the table / stage, so the chair "faces" inward toward what it's at).
//
// Local frame: chair sits with its front at -y and back at +y. Rotation is
// applied last so the back-stroke rotates with the chair.
function buildChair(seat) {
  const g = document.createElementNS(SVG_NS, 'g')
  g.setAttribute('transform', `translate(${seat.x} ${seat.y}) rotate(${seat.rotation || 0})`)
  g.setAttribute('class', 'plot-chair')

  const w = seat.w, d = seat.d
  const r = document.createElementNS(SVG_NS, 'rect')
  r.setAttribute('x', -w / 2); r.setAttribute('y', -d / 2)
  r.setAttribute('width', w);  r.setAttribute('height', d)
  r.setAttribute('rx', 1.5)
  r.setAttribute('fill', '#FF2D9D')
  r.setAttribute('fill-opacity', 0.32)
  r.setAttribute('stroke', '#FF2D9D')
  r.setAttribute('stroke-width', pxToWorldDist(0.5))
  r.setAttribute('vector-effect', 'non-scaling-stroke')
  g.appendChild(r)

  // Back-of-chair stroke — heavier line on the far side from the table.
  const back = document.createElementNS(SVG_NS, 'line')
  back.setAttribute('x1', -w / 2); back.setAttribute('y1', d / 2)
  back.setAttribute('x2',  w / 2); back.setAttribute('y2', d / 2)
  back.setAttribute('stroke', '#FF2D9D')
  back.setAttribute('stroke-width', pxToWorldDist(2))
  back.setAttribute('stroke-linecap', 'round')
  back.setAttribute('vector-effect', 'non-scaling-stroke')
  g.appendChild(back)

  return g
}

// One dimension line. Two endpoints, a thin dashed line between them, small
// perpendicular tick marks at each end, and a centered distance label.
// Used as a snap target / construction guide. `preview = true` is for the
// drag-in-progress preview (slightly different style — no committed dim object
// exists yet so we accept the partial shape).
function buildDimGraphic(d, preview) {
  const g = document.createElementNS(SVG_NS, 'g')
  g.setAttribute('class', 'plot-dim' + (preview ? ' plot-dim-preview' : ''))
  const stroke = '#5be7d4'
  const dx = d.x2 - d.x1, dy = d.y2 - d.y1
  const len = Math.hypot(dx, dy)
  if (len < 1) return g
  const nx = -dy / len, ny = dx / len    // perpendicular unit vector
  const tick = 8                          // tick length, in world inches

  // Main line
  const line = document.createElementNS(SVG_NS, 'line')
  line.setAttribute('x1', d.x1); line.setAttribute('y1', d.y1)
  line.setAttribute('x2', d.x2); line.setAttribute('y2', d.y2)
  line.setAttribute('stroke', stroke)
  line.setAttribute('stroke-width', pxToWorldDist(1))
  line.setAttribute('stroke-dasharray', `${pxToWorldDist(5)} ${pxToWorldDist(3)}`)
  line.setAttribute('vector-effect', 'non-scaling-stroke')
  line.setAttribute('opacity', preview ? 0.6 : 0.9)
  g.appendChild(line)

  // End ticks (perpendicular short lines)
  for (const [x, y] of [[d.x1, d.y1], [d.x2, d.y2]]) {
    const t = document.createElementNS(SVG_NS, 'line')
    t.setAttribute('x1', x - nx * tick); t.setAttribute('y1', y - ny * tick)
    t.setAttribute('x2', x + nx * tick); t.setAttribute('y2', y + ny * tick)
    t.setAttribute('stroke', stroke)
    t.setAttribute('stroke-width', pxToWorldDist(1.2))
    t.setAttribute('stroke-linecap', 'round')
    t.setAttribute('vector-effect', 'non-scaling-stroke')
    g.appendChild(t)
  }

  // Distance label, centered, slightly above the line on its perpendicular.
  const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2
  const off = 9   // offset from line, in world inches
  const lx = cx + nx * off, ly = cy + ny * off
  // Rotate text to be parallel to the line; flip if it would read upside-down.
  let angDeg = Math.atan2(dy, dx) * 180 / Math.PI
  if (angDeg > 90 || angDeg < -90) angDeg += 180

  const text = document.createElementNS(SVG_NS, 'text')
  text.setAttribute('x', lx); text.setAttribute('y', ly)
  text.setAttribute('text-anchor', 'middle')
  text.setAttribute('dominant-baseline', 'central')
  text.setAttribute('font-size', 8)
  text.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
  text.setAttribute('fill', stroke)
  text.setAttribute('opacity', preview ? 0.7 : 0.95)
  text.setAttribute('transform', `rotate(${angDeg} ${lx} ${ly})`)
  text.textContent = formatDimLength(len)
  g.appendChild(text)

  if (!preview) g.dataset.objectId = d.id
  return g
}

function clampFrac(v) {
  if (typeof v !== 'number' || !isFinite(v)) return 0.5
  return Math.max(0.05, Math.min(0.95, v))
}

function formatDimLength(inches) {
  // Foot/inch like 12'-6". Match the conventions used in units.js.
  const totalIn = Math.round(inches)
  const ft = Math.floor(totalIn / 12)
  const inRem = totalIn - ft * 12
  if (ft === 0) return `${inRem}"`
  if (inRem === 0) return `${ft}'-0"`
  return `${ft}'-${inRem}"`
}

// Dimension callout for an aisle. Always reads horizontally:
//   • Vertical aisle (taller than wide) → horizontal arrows pointing inward
//     at the left & right edges, with the X-distance label between them.
//   • Horizontal aisle (wider than tall) → vertical arrows at the top & bottom
//     edges, label written horizontally to the side.
//
// `worldX/Y/W/H` define the aisle rect in whatever frame the parent group is
// rendering in (world for user aisles, local-frame for auto-aisle stripes).
// `counterRotateDeg` keeps the label upright when the parent group is rotated
// (used by auto-aisles inside the seating zone group).
//
// `interactive` (when supplied with an aisleId) tags the group so canvas
// pointerdown can pick it up for the slide-along-long-axis drag, and reads
// `frac` (0..1) for the position of the dim line along the aisle's long
// axis. Auto-aisle stripes inside seating zones don't pass `interactive`.
function buildAisleDimCallout(worldX, worldY, w, h, counterRotateDeg = 0, interactive = null) {
  const isWide = w > h
  const widthVal = Math.min(w, h)
  const label = formatDimLength(widthVal)
  const stroke = '#d4a72c'
  const sw = pxToWorldDist(0.8)
  const arrow = pxToWorldDist(6)   // arrowhead size (~6px on screen)
  const frac = clampFrac(interactive?.frac ?? 0.5)

  const g = document.createElementNS(SVG_NS, 'g')
  g.setAttribute('class', 'aisle-dim')
  if (interactive?.aisleId) {
    g.setAttribute('data-aisle-dim-id', interactive.aisleId)
    g.setAttribute('data-aisle-axis', isWide ? 'x' : 'y')
    g.style.cursor = isWide ? 'ew-resize' : 'ns-resize'
  } else {
    g.setAttribute('pointer-events', 'none')
  }

  if (!isWide) {
    // Vertical aisle: horizontal dim line, position along Y-axis = frac.
    const dimY = worldY + h * frac
    const x1 = worldX, x2 = worldX + w

    const line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', x1); line.setAttribute('y1', dimY)
    line.setAttribute('x2', x2); line.setAttribute('y2', dimY)
    line.setAttribute('stroke', stroke)
    line.setAttribute('stroke-width', sw)
    line.setAttribute('opacity', 0.65)
    line.setAttribute('vector-effect', 'non-scaling-stroke')
    g.appendChild(line)

    // Arrows INSIDE the aisle pointing OUTWARD: tip at the edge, body inward.
    g.appendChild(arrowhead(x1, dimY, 180, arrow, stroke))   // tip at left edge, points left out
    g.appendChild(arrowhead(x2, dimY, 0,   arrow, stroke))   // tip at right edge, points right out

    const cx = (x1 + x2) / 2
    const cy = dimY - arrow - pxToWorldDist(3)
    g.appendChild(dimText(cx, cy, label, widthVal, stroke, counterRotateDeg))
  } else {
    // Horizontal aisle: vertical dim line, position along X-axis = frac.
    const dimX = worldX + w * frac
    const y1 = worldY, y2 = worldY + h

    const line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', dimX); line.setAttribute('y1', y1)
    line.setAttribute('x2', dimX); line.setAttribute('y2', y2)
    line.setAttribute('stroke', stroke)
    line.setAttribute('stroke-width', sw)
    line.setAttribute('opacity', 0.65)
    line.setAttribute('vector-effect', 'non-scaling-stroke')
    g.appendChild(line)

    g.appendChild(arrowhead(dimX, y1, 270, arrow, stroke))   // top tip, points up out
    g.appendChild(arrowhead(dimX, y2,  90, arrow, stroke))   // bottom tip, points down out

    // Label horizontal, set to the right of the dim line.
    const cx = dimX + arrow * 1.6
    const cy = (y1 + y2) / 2
    g.appendChild(dimText(cx, cy, label, widthVal, stroke, counterRotateDeg, 'start'))
  }
  return g
}

function arrowhead(x, y, angleDeg, size, color) {
  // Filled triangle. Tip at (x,y), pointing in `angleDeg` direction
  // (0=right, 90=down, 180=left, 270=up).
  const rad = angleDeg * Math.PI / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const baseX = x - cos * size, baseY = y - sin * size
  const px = -sin, py = cos
  const halfW = size * 0.5
  const ax = baseX + px * halfW, ay = baseY + py * halfW
  const bx = baseX - px * halfW, by = baseY - py * halfW
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', `M ${x} ${y} L ${ax} ${ay} L ${bx} ${by} Z`)
  path.setAttribute('fill', color)
  return path
}

function dimText(cx, cy, label, widthInches, color, counterRotateDeg, anchor = 'middle') {
  const text = document.createElementNS(SVG_NS, 'text')
  text.setAttribute('x', cx); text.setAttribute('y', cy)
  text.setAttribute('text-anchor', anchor)
  text.setAttribute('dominant-baseline', 'central')
  text.setAttribute('font-size', Math.min(widthInches * 0.42, 10))
  text.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
  text.setAttribute('fill', color)
  text.setAttribute('opacity', 0.95)
  text.setAttribute('pointer-events', 'none')
  // Counter-rotate so the label stays horizontal even when the parent group
  // is rotated (auto-aisles inside a tilted seating zone, etc.).
  if (counterRotateDeg) text.setAttribute('transform', `rotate(${counterRotateDeg} ${cx} ${cy})`)
  text.textContent = label
  return text
}

// Translucent stripes inside the seating zone showing where auto-placed
// aisles will land. Mirrors the solver's computeAislePositions math so the
// preview is exact. Returns null if the zone has no auto aisles.
function buildAutoAisles(zone) {
  const count = zone.aisles?.count ?? (zone.centerAisle?.enabled === false ? 0 : 1)
  if (count <= 0) return null
  const aisleW    = zone.aisles?.width ?? zone.centerAisle?.width ?? 144
  const chairW    = zone.chairW || 18
  const seatGap   = zone.seatGap || 0
  const maxPerRow = zone.maxPerRow || 12

  // Centroid + local bbox so we know how tall to draw the stripes.
  let cx = 0, cy = 0
  for (const [x, y] of zone.vertices) { cx += x; cy += y }
  cx /= zone.vertices.length; cy /= zone.vertices.length
  const r = -((zone.rotation || 0) * Math.PI / 180)
  const cos = Math.cos(r), sin = Math.sin(r)
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity
  for (const [x, y] of zone.vertices) {
    const lx = (x - cx) * cos - (y - cy) * sin
    const ly = (x - cx) * sin + (y - cy) * cos
    if (lx < minX) minX = lx; if (lx > maxX) maxX = lx
    if (ly < minY) minY = ly; if (ly > maxY) maxY = ly
  }

  // Aisle positions — match whatever the active solver does so the visual
  // stripes line up with the placed chairs/tables.
  //   theater                    → maxPerRow chairs of width
  //   classroom                  → 24' fire-code cap
  //   rounds (Fixed aisles ON)   → polygon evenly subdivided
  //   rounds (Fixed aisles OFF)  → SHIFT mode: aisles flush to packed blocks
  const polyW = maxX - minX
  let positions
  if (zone.style === 'rounds' && zone.fixedAisles === false) {
    const tableD       = zone.tableD || 72
    const tableSpacing = zone.tableSpacing ?? 60
    positions = computeShiftedRoundAislePositions(count, aisleW, polyW, minX, tableD, tableSpacing)
  } else {
    const sectionW = (zone.style === 'classroom') ? 24 * 12
                   : (zone.style === 'rounds')    ? Math.max(60, (polyW - count * aisleW) / (count + 1))
                   :                                 maxPerRow * chairW + (maxPerRow - 1) * seatGap
    positions = computeAislePositions(count, aisleW, sectionW)
  }
  if (!positions.length) return null

  const g = document.createElementNS(SVG_NS, 'g')
  g.setAttribute('class', 'plot-auto-aisle')
  g.setAttribute('transform', `translate(${cx} ${cy}) rotate(${zone.rotation || 0})`)
  for (const c of positions) {
    const aMin = c - aisleW / 2
    if (aMin > maxX || aMin + aisleW < minX) continue   // wholly outside polygon
    const stripe = document.createElementNS(SVG_NS, 'rect')
    stripe.setAttribute('x', aMin); stripe.setAttribute('y', minY)
    stripe.setAttribute('width', aisleW); stripe.setAttribute('height', maxY - minY)
    stripe.setAttribute('fill', '#d4a72c')
    stripe.setAttribute('fill-opacity', 0.10)
    stripe.setAttribute('stroke', '#d4a72c')
    stripe.setAttribute('stroke-width', pxToWorldDist(1))
    stripe.setAttribute('stroke-dasharray', `${pxToWorldDist(4)} ${pxToWorldDist(3)}`)
    stripe.setAttribute('stroke-opacity', 0.55)
    stripe.setAttribute('vector-effect', 'non-scaling-stroke')
    g.appendChild(stripe)

    // Dim callout near the stage end of the stripe so it doesn't fight the
    // facing arrow at the centroid. The seating zone group is rotated by
    // zone.rotation, so we counter-rotate the label to keep it horizontal.
    g.appendChild(buildAisleDimCallout(aMin, minY, aisleW, maxY - minY, -(zone.rotation || 0)))
  }
  return g
}

// Facing arrow showing the zone's forward direction. Drawn OUTSIDE the polygon
// at the front edge (in local frame, just above minY) so it doesn't fight
// auto-aisle dim callouts that sit at the polygon centroid.
function buildFacingArrow(zone) {
  // Centroid in world coords.
  let cx = 0, cy = 0
  for (const [x, y] of zone.vertices) { cx += x; cy += y }
  cx /= zone.vertices.length; cy /= zone.vertices.length

  // Local-frame minY → "front" of the zone in its facing direction.
  const r = -((zone.rotation || 0) * Math.PI / 180)
  const cos = Math.cos(r), sin = Math.sin(r)
  let minY = Infinity
  for (const [x, y] of zone.vertices) {
    const ly = (x - cx) * sin + (y - cy) * cos
    if (ly < minY) minY = ly
  }

  // Render in a translated+rotated group so we can draw in local frame.
  const g = document.createElementNS(SVG_NS, 'g')
  g.setAttribute('transform', `translate(${cx} ${cy}) rotate(${zone.rotation || 0})`)
  g.setAttribute('class', 'plot-facing')

  const ay = minY - 18                  // 18" outside the front edge
  const len = 18, head = 7
  const path = document.createElementNS(SVG_NS, 'path')
  // Arrow points UP in local frame (toward the stage / facing direction).
  path.setAttribute('d',
    `M 0 ${ay + len / 2} L 0 ${ay - len / 2} ` +
    `M ${-head / 2} ${ay - len / 2 + head} L 0 ${ay - len / 2} L ${head / 2} ${ay - len / 2 + head}`
  )
  path.setAttribute('stroke', '#FF2D9D')
  path.setAttribute('stroke-width', pxToWorldDist(1.5))
  path.setAttribute('fill', 'none')
  path.setAttribute('vector-effect', 'non-scaling-stroke')
  path.setAttribute('opacity', 0.75)
  g.appendChild(path)
  return g
}

function renderHandles() {
  while (handleLayer.firstChild) handleLayer.removeChild(handleLayer.firstChild)
  const sel = selectedObjects()
  const handlePx = 8
  const hSize = pxToWorldDist(handlePx)

  for (const o of sel) {
    if (o.hidden || o.locked) continue
    if (o.kind === 'rect' || o.kind === 'image') {
      // Bounding box outline
      const box = document.createElementNS(SVG_NS, 'rect')
      box.setAttribute('x', o.x); box.setAttribute('y', o.y)
      box.setAttribute('width',  o.w); box.setAttribute('height', o.h)
      box.setAttribute('class', 'sel-bbox')
      box.setAttribute('vector-effect', 'non-scaling-stroke')
      handleLayer.appendChild(box)

      const handles = [
        ['nw', o.x,         o.y],
        ['n',  o.x + o.w/2, o.y],
        ['ne', o.x + o.w,   o.y],
        ['e',  o.x + o.w,   o.y + o.h/2],
        ['se', o.x + o.w,   o.y + o.h],
        ['s',  o.x + o.w/2, o.y + o.h],
        ['sw', o.x,         o.y + o.h],
        ['w',  o.x,         o.y + o.h/2],
      ]
      for (const [name, hx, hy] of handles) {
        const h = document.createElementNS(SVG_NS, 'rect')
        h.setAttribute('x', hx - hSize/2); h.setAttribute('y', hy - hSize/2)
        h.setAttribute('width', hSize); h.setAttribute('height', hSize)
        h.setAttribute('class', 'sel-handle')
        h.setAttribute('vector-effect', 'non-scaling-stroke')
        h.dataset.handle = name
        h.dataset.objectId = o.id
        handleLayer.appendChild(h)
      }
    } else if (o.kind === 'polygon') {
      // Outline
      const outline = document.createElementNS(SVG_NS, 'polygon')
      outline.setAttribute('points', o.vertices.map(v => v.join(',')).join(' '))
      outline.setAttribute('class', 'sel-bbox')
      outline.setAttribute('vector-effect', 'non-scaling-stroke')
      handleLayer.appendChild(outline)

      // Mid-edge handles (rendered first so corner handles paint on top)
      const midSize = hSize * 0.7
      o.vertices.forEach(([ax, ay], i) => {
        const [bx, by] = o.vertices[(i + 1) % o.vertices.length]
        const mx = (ax + bx) / 2, my = (ay + by) / 2
        const m = document.createElementNS(SVG_NS, 'circle')
        m.setAttribute('cx', mx); m.setAttribute('cy', my)
        m.setAttribute('r', midSize / 2)
        m.setAttribute('class', 'sel-handle sel-midhandle')
        m.setAttribute('vector-effect', 'non-scaling-stroke')
        m.dataset.objectId = o.id
        m.dataset.midEdge = i              // index of the edge whose midpoint this is
        handleLayer.appendChild(m)
      })

      // Corner (vertex) handles
      o.vertices.forEach(([vx, vy], i) => {
        const h = document.createElementNS(SVG_NS, 'rect')
        h.setAttribute('x', vx - hSize/2); h.setAttribute('y', vy - hSize/2)
        h.setAttribute('width', hSize); h.setAttribute('height', hSize)
        h.setAttribute('class', 'sel-handle')
        h.setAttribute('vector-effect', 'non-scaling-stroke')
        h.dataset.objectId = o.id
        h.dataset.vertex = i
        handleLayer.appendChild(h)
      })
    }
  }
}

function renderToolLayer() {
  while (toolLayer.firstChild) toolLayer.removeChild(toolLayer.firstChild)
  // Active rectangle being drawn
  const dr = state.drawingRect
  if (dr) {
    const r = document.createElementNS(SVG_NS, 'rect')
    r.setAttribute('x', Math.min(dr.x, dr.x + dr.w))
    r.setAttribute('y', Math.min(dr.y, dr.y + dr.h))
    r.setAttribute('width',  Math.abs(dr.w))
    r.setAttribute('height', Math.abs(dr.h))
    r.setAttribute('class', 'tool-preview')
    r.setAttribute('vector-effect', 'non-scaling-stroke')
    toolLayer.appendChild(r)
  }
  // Active polygon being drawn
  const dp = state.drawingPolygon
  if (dp) {
    const pts = dp.vertices.slice()
    if (dp.cursor) pts.push(dp.cursor)
    const pl = document.createElementNS(SVG_NS, 'polyline')
    pl.setAttribute('points', pts.map(p => p.join(',')).join(' '))
    pl.setAttribute('class', 'tool-preview-line')
    pl.setAttribute('vector-effect', 'non-scaling-stroke')
    toolLayer.appendChild(pl)
    // Vertex dots
    const hSize = pxToWorldDist(6)
    for (const [vx, vy] of dp.vertices) {
      const c = document.createElementNS(SVG_NS, 'circle')
      c.setAttribute('cx', vx); c.setAttribute('cy', vy)
      c.setAttribute('r', hSize)
      c.setAttribute('class', 'tool-vertex')
      toolLayer.appendChild(c)
    }
    // Snap indicator on cursor when shift is held
    if (dp.shiftSnap && dp.cursor) {
      const c = document.createElementNS(SVG_NS, 'circle')
      c.setAttribute('cx', dp.cursor[0]); c.setAttribute('cy', dp.cursor[1])
      c.setAttribute('r', pxToWorldDist(8))
      c.setAttribute('class', 'tool-snap')
      c.setAttribute('vector-effect', 'non-scaling-stroke')
      toolLayer.appendChild(c)
    }
  }
  // Active dim line being drawn — preview using the live committed style.
  const dd = state.drawingDim
  if (dd) {
    toolLayer.appendChild(buildDimGraphic(dd, /* preview */ true))
  }

  // Snap indicator — cyan ring over the snap point (and a small cross for
  // visibility). Centers and midpoints get a slightly larger ring than corners.
  const snap = state.snapIndicator
  if (snap) {
    const r = pxToWorldDist(snap.kind === 'corner' ? 5 : 6)
    const ring = document.createElementNS(SVG_NS, 'circle')
    ring.setAttribute('cx', snap.x); ring.setAttribute('cy', snap.y)
    ring.setAttribute('r', r)
    ring.setAttribute('fill', 'none')
    ring.setAttribute('stroke', '#5be7d4')
    ring.setAttribute('stroke-width', pxToWorldDist(1.5))
    ring.setAttribute('vector-effect', 'non-scaling-stroke')
    toolLayer.appendChild(ring)
    const tick = pxToWorldDist(3)
    const cross = document.createElementNS(SVG_NS, 'path')
    cross.setAttribute('d',
      `M ${snap.x - tick} ${snap.y} L ${snap.x + tick} ${snap.y} ` +
      `M ${snap.x} ${snap.y - tick} L ${snap.x} ${snap.y + tick}`
    )
    cross.setAttribute('stroke', '#5be7d4')
    cross.setAttribute('stroke-width', pxToWorldDist(1))
    cross.setAttribute('vector-effect', 'non-scaling-stroke')
    toolLayer.appendChild(cross)
  }
}

function renderStatus() {
  if (!statusEl) return
  const v = state.viewport
  const rect = svg.getBoundingClientRect()
  const ftPerPx = (v.w / rect.width) / 12
  const major = parseFloat(gridLayer.dataset.major || 12)
  const room = activeRoom()
  const objCount = room ? room.objects.length : 0
  statusEl.innerHTML = `
    <span>view <b>${formatInches(v.w)} × ${formatInches(v.h)}</b></span>
    <span>grid <b>${formatInches(major)}</b></span>
    <span>${objCount} object${objCount === 1 ? '' : 's'}</span>
    <span class="status-hint">scroll/pinch zoom · shift+drag pan · ⌘6 fit</span>
  `
}

// Trigger a re-render of just the current drawing previews. Exposed for tools.
export function rerenderTools() { renderToolLayer() }

// Re-render handles when objects move during a drag.
export function rerenderHandles() { renderHandles() }

// ── Calibration (set image scale by clicking two points) ───────────────────

let calBanner, calMsg, calInput, calApply, calCancel

function bindCalibrationUi(rootEl) {
  calBanner = rootEl.querySelector('.cal-banner')
  calMsg    = rootEl.querySelector('.cal-msg')
  calInput  = rootEl.querySelector('.cal-input')
  calApply  = rootEl.querySelector('.cal-apply')
  calCancel = rootEl.querySelector('.cal-cancel')

  calCancel.addEventListener('click', cancelCalibration)
  calApply.addEventListener('click', commitCalibration)
  calInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitCalibration() }
    if (e.key === 'Escape') { e.preventDefault(); cancelCalibration() }
  })
}

export function startCalibration(objectId) {
  state.calibration = { objectId, clicks: [] }
  setState({})  // re-render
  // Defer focus-input slightly until banner is shown
}

export function cancelCalibration() {
  if (!state.calibration) return
  setState({ calibration: null })
}

function addCalibrationPoint(point) {
  const cal = state.calibration
  if (!cal) return
  cal.clicks.push(point)
  if (cal.clicks.length === 2) {
    setState({})
    // Focus input once the banner repaints into "enter distance" mode
    requestAnimationFrame(() => calInput && calInput.focus())
  } else {
    setState({})
  }
}

function commitCalibration() {
  const cal = state.calibration
  if (!cal || cal.clicks.length !== 2) return
  const real = parseInches(calInput.value)
  if (real == null || real <= 0) {
    calInput.classList.add('error')
    calInput.focus()
    return
  }
  const [p1, p2] = cal.clicks
  const currentInches = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
  if (currentInches < 1) { cancelCalibration(); return }
  const k = real / currentInches

  mutateProject(p => {
    const room = p.rooms.find(r => r.id === state.activeRoomId)
    if (!room) return
    const obj = room.objects.find(o => o.id === cal.objectId)
    if (!obj || obj.kind !== 'image') return
    const dx1 = p1[0] - obj.x
    const dy1 = p1[1] - obj.y
    obj.w = Math.max(1, Math.round(obj.w * k))
    obj.h = Math.max(1, Math.round(obj.h * k))
    obj.x = Math.round(p1[0] - dx1 * k)
    obj.y = Math.round(p1[1] - dy1 * k)
  })
  setState({ calibration: null })
}

function renderCalibration() {
  const cal = state.calibration
  if (!calBanner) return
  if (!cal) {
    calBanner.hidden = true
    calInput.value = ''
    calInput.classList.remove('error')
    return
  }
  calBanner.hidden = false
  if (cal.clicks.length === 0) {
    calMsg.innerHTML = `Set scale: click first point on the underlay <span class="cal-hint">— scroll/pinch zooms · ⇧+scroll or space-drag pans · esc cancels</span>`
    calInput.hidden = true; calApply.hidden = true
  } else if (cal.clicks.length === 1) {
    calMsg.innerHTML = `Click second point on the underlay <span class="cal-hint">— scroll/pinch zooms · ⇧+scroll or space-drag pans · esc cancels</span>`
    calInput.hidden = true; calApply.hidden = true
  } else {
    calMsg.textContent = 'Distance between points:'
    calInput.hidden = false; calApply.hidden = false
  }
  // Markers
  const markerSize = pxToWorldDist(5)
  for (const [i, [px, py]] of cal.clicks.entries()) {
    const c = document.createElementNS(SVG_NS, 'circle')
    c.setAttribute('cx', px); c.setAttribute('cy', py)
    c.setAttribute('r', markerSize)
    c.setAttribute('class', 'cal-marker')
    c.setAttribute('vector-effect', 'non-scaling-stroke')
    toolLayer.appendChild(c)
    if (i === 1) {
      const ln = document.createElementNS(SVG_NS, 'line')
      const [a, b] = cal.clicks
      ln.setAttribute('x1', a[0]); ln.setAttribute('y1', a[1])
      ln.setAttribute('x2', b[0]); ln.setAttribute('y2', b[1])
      ln.setAttribute('class', 'cal-line')
      ln.setAttribute('vector-effect', 'non-scaling-stroke')
      toolLayer.appendChild(ln)
    }
  }
}
