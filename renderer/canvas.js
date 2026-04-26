// SVG canvas: scene graph, pan/zoom, render, hit-testing.
// World units = inches. The SVG viewBox itself is expressed in inches so the
// math is simple — pan = shift viewBox origin, zoom = scale viewBox dimensions.

import { state, setState, subscribe, mutateProject, activeRoom, selectedObjects, styleFor, uid } from './state.js'
import { objectBounds, unionBounds, hitTest, distToSegment, snapToAxis } from './geom.js'
import { formatInches } from './units.js'
import { startRectDraw,    updateRectDraw,    endRectDraw }    from './tools/rectTool.js'
import { startPolygonDraw, addPolygonVertex,  cancelPolygonDraw, finishPolygonDraw } from './tools/polygonTool.js'
import { startSelectDrag,  updateSelectDrag,  endSelectDrag }  from './tools/selectTool.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

let host, svg, gridLayer, objectLayer, handleLayer, toolLayer, statusEl
let drag = null   // { mode, ... }

export function initCanvas(container) {
  host = container
  host.innerHTML = `
    <div class="canvas-frame">
      <svg class="floor-svg"></svg>
      <div class="canvas-status"></div>
      <div class="tab-edit-popover" hidden></div>
    </div>
  `
  svg       = host.querySelector('.floor-svg')
  statusEl  = host.querySelector('.canvas-status')
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
  window.addEventListener('resize', render)

  subscribe(render)
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
  const objs = room ? room.objects : []
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

  // Tool dispatch
  if (state.activeTool === 'select') {
    // Hit handles first, then objects.
    const handle = e.target.closest('[data-handle]')
    if (handle) {
      drag = startSelectDrag('resize', { handle: handle.dataset.handle, start: w })
      svg.setPointerCapture(e.pointerId)
      return
    }
    const vertex = e.target.closest('[data-vertex]')
    if (vertex) {
      drag = startSelectDrag('vertex', {
        objectId: vertex.dataset.objectId,
        vertexIdx: parseInt(vertex.dataset.vertex, 10),
        start: w,
      })
      svg.setPointerCapture(e.pointerId)
      return
    }
    const hit = hitTopMost(w.x, w.y, room.objects)
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
      drag = startSelectDrag('move', { start: w })
      svg.setPointerCapture(e.pointerId)
    } else {
      setState({ selection: [], tabEdit: null })
    }
    return
  }

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

  // All other rectangle-based tools
  const rectTypes = ['floor', 'aisle', 'obstruction', 'stage', 'tech']
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
  if (drag.mode === 'draw-rect') {
    updateRectDraw([Math.round(w.x), Math.round(w.y)])
  } else if (drag.mode === 'move' || drag.mode === 'resize' || drag.mode === 'vertex') {
    updateSelectDrag(drag, w)
  }
}

function onPointerUp(e) {
  if (!drag) return
  try { svg.releasePointerCapture(e.pointerId) } catch {}
  if (drag.mode === 'draw-rect') {
    endRectDraw()
  } else if (drag.mode === 'move' || drag.mode === 'resize' || drag.mode === 'vertex') {
    endSelectDrag(drag)
  }
  drag = null
}

function onDoubleClick(e) {
  if (state.activeTool === 'walls' && state.drawingPolygon) {
    finishPolygonDraw()
    e.preventDefault()
  }
}

function onContextMenu(e) {
  e.preventDefault()
  const w = screenToWorld(e.clientX, e.clientY)
  const room = activeRoom(); if (!room) return

  // If clicking a vertex of a selected polygon, delete it.
  const vTarget = e.target.closest('[data-vertex]')
  if (vTarget) {
    const oid = vTarget.dataset.objectId
    const vi  = parseInt(vTarget.dataset.vertex, 10)
    mutateProject(p => {
      const r = p.rooms.find(r => r.id === state.activeRoomId)
      const o = r.objects.find(o => o.id === oid)
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
          const r = p.rooms.find(r => r.id === state.activeRoomId)
          const obj = r.objects.find(x => x.id === o.id)
          obj.vertices.splice(i + 1, 0, [Math.round(w.x), Math.round(w.y)])
        })
        return
      }
    }
  }
}

function hitTopMost(x, y, objects) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]
    if (o.hidden || o.locked) continue
    if (hitTest(o, x, y)) return o
  }
  return null
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  applyViewport()
  renderGrid()
  renderObjects()
  renderHandles()
  renderToolLayer()
  renderStatus()
  updateCursor()
}

function updateCursor() {
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
  const v = state.viewport
  const rect = svg.getBoundingClientRect()
  if (!rect.width) return

  // Choose grid step in inches based on zoom: keep major step 50–150 px on screen.
  const targetMajorPx = 90
  const inchesPerPx = v.w / rect.width
  const targetInches = targetMajorPx * inchesPerPx
  const candidates = [12, 24, 60, 120, 240, 600, 1200, 2400, 6000, 12000]
  let major = candidates[candidates.length - 1]
  for (const c of candidates) { if (c >= targetInches) { major = c; break } }
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
  for (const o of room.objects) {
    if (o.hidden) continue
    const node = renderObject(o)
    if (node) objectLayer.appendChild(node)
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
  } else if (o.kind === 'polygon') {
    const s = styleFor(o)
    el = document.createElementNS(SVG_NS, o.vertices.length >= 3 ? 'polygon' : 'polyline')
    el.setAttribute('points', o.vertices.map(v => v.join(',')).join(' '))
    el.setAttribute('fill',         s.fill)
    el.setAttribute('fill-opacity', s.fillOpacity)
    el.setAttribute('stroke',       s.stroke)
    el.setAttribute('stroke-width', s.strokeWidth * pxToWorldDist(1))
    el.setAttribute('vector-effect','non-scaling-stroke')
  } else {
    return null
  }

  el.dataset.objectId = o.id
  el.classList.add('plot-object', `plot-${o.type}`)
  if (o.locked) el.classList.add('plot-locked')
  if (state.selection.includes(o.id)) el.classList.add('plot-selected')
  return el
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
