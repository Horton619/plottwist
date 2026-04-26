// Right panel: live properties of the current selection.

import { state, setState, subscribe, mutateProject, selectedObjects, TYPE_STYLES, styleFor, objectName, activeRoom, uid } from '../state.js'
import { objectBounds, objectArea } from '../geom.js'
import { formatInches, formatSqFt, parseInches } from '../units.js'
import { unionShapes, mergedType } from '../shapeOps.js'
import { startCalibration } from '../canvas.js'

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export function initObjectInfo(host) {
  host.innerHTML = `<div class="info-panel" data-panel></div>`
  subscribe(render)
  render()

  function render() {
    const panel = host.querySelector('[data-panel]')
    const sel = selectedObjects()
    if (sel.length === 0) {
      panel.innerHTML = `
        <div class="panel-section">
          <div class="panel-title">Object Info</div>
          <div class="panel-empty">Nothing selected.<br><span class="muted">Click an object, or pick a tool above to draw one.</span></div>
        </div>
      `
      return
    }
    if (sel.length > 1) {
      const totalArea = sel.reduce((a, o) => a + objectArea(o), 0)
      const joinable = sel.every(o => o.kind === 'rect' || o.kind === 'polygon')
      panel.innerHTML = `
        <div class="panel-section">
          <div class="panel-title">${sel.length} objects selected</div>
          <div class="prop-row"><span class="prop-key">Total area</span><span class="prop-val">${formatSqFt(totalArea)}</span></div>
        </div>
        ${joinable ? `
          <div class="panel-section">
            <div class="panel-section-title">Boolean</div>
            <button class="block-btn" data-action="join">Join → Polygon</button>
            <p class="panel-hint">Merges overlapping / touching shapes into a single editable polygon.</p>
          </div>
        ` : ''}
      `
      const joinBtn = panel.querySelector('[data-action="join"]')
      if (joinBtn) joinBtn.addEventListener('click', () => joinSelectedShapes())
      return
    }

    const o = sel[0]
    const room = activeRoom()
    const b = objectBounds(o)
    const area = objectArea(o)
    const s = styleFor(o)
    const typeLabel = (TYPE_STYLES[o.type] && TYPE_STYLES[o.type].label) || o.type
    const kindLabel = ({ rect: 'Rectangle', polygon: 'Polygon', image: 'Image' })[o.kind] || o.kind
    const isBoxed = o.kind === 'rect' || o.kind === 'image'

    panel.innerHTML = `
      <div class="panel-section">
        <div class="panel-title">
          <input class="title-input" data-field="name" value="${escapeAttr(objectName(o, room))}" placeholder="${typeLabel}">
        </div>
        <div class="panel-sub">${typeLabel} · ${kindLabel} · ${o.id.slice(-6)}</div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Geometry</div>
        ${isBoxed ? `
          <div class="prop-row"><span class="prop-key">Width</span><input class="prop-input" data-field="w" value="${formatInches(o.w)}"></div>
          <div class="prop-row"><span class="prop-key">Height</span><input class="prop-input" data-field="h" value="${formatInches(o.h)}"></div>
          <div class="prop-row"><span class="prop-key">X</span><input class="prop-input" data-field="x" value="${formatInches(o.x)}"></div>
          <div class="prop-row"><span class="prop-key">Y</span><input class="prop-input" data-field="y" value="${formatInches(o.y)}"></div>
        ` : `
          <div class="prop-row"><span class="prop-key">Bounding</span><span class="prop-val">${formatInches(b.w)} × ${formatInches(b.h)}</span></div>
          <div class="prop-row"><span class="prop-key">Vertices</span><span class="prop-val">${o.vertices.length}</span></div>
        `}
        <div class="prop-row"><span class="prop-key">Area</span><span class="prop-val accent">${formatSqFt(area)}</span></div>
      </div>
      ${o.kind === 'image' ? `
        <div class="panel-section">
          <div class="panel-section-title">Underlay</div>
          <div class="prop-row">
            <span class="prop-key">Opacity</span>
            <input type="range" class="range-input" data-field="opacity" min="0.05" max="1" step="0.05" value="${o.opacity ?? 0.6}">
            <span class="prop-val small">${Math.round((o.opacity ?? 0.6) * 100)}%</span>
          </div>
          <button class="block-btn" data-action="scale">Set Scale…</button>
          <p class="panel-hint">Click two points on the image, then enter the real-world distance between them.</p>
        </div>
      ` : `
        <div class="panel-section">
          <div class="panel-section-title">Style</div>
          <div class="prop-row">
            <span class="prop-key">Fill</span>
            <input type="color" class="color-input" data-field="fill" value="${s.fill === 'none' ? '#000000' : s.fill}" ${s.fill === 'none' ? 'disabled' : ''}>
            <input type="range" class="range-input" data-field="fillOpacity" min="0" max="1" step="0.05" value="${s.fillOpacity}">
          </div>
          <div class="prop-row">
            <span class="prop-key">Stroke</span>
            <input type="color" class="color-input" data-field="stroke" value="${s.stroke}">
            <input type="number" class="num-input" data-field="strokeWidth" min="0.25" max="10" step="0.25" value="${s.strokeWidth}">
          </div>
        </div>
      `}
      ${o.kind === 'polygon' ? `
        <div class="panel-section">
          <div class="panel-section-title">Vertices</div>
          <div class="vertex-list">
            ${o.vertices.map(([x, y], i) => `
              <div class="vertex-row">
                <span class="vertex-idx">${i}</span>
                <input class="prop-input compact" data-vertex="${i}" data-axis="x" value="${formatInches(x)}">
                <input class="prop-input compact" data-vertex="${i}" data-axis="y" value="${formatInches(y)}">
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `

    // Wire inputs
    const update = (patch) => {
      mutateProject(() => Object.assign(o, patch))
    }
    panel.querySelectorAll('.prop-input').forEach(inp => {
      const handler = () => {
        const field = inp.dataset.field
        if (field) {
          const v = parseInches(inp.value)
          if (v != null) update({ [field]: v })
        } else if (inp.dataset.vertex != null) {
          const v = parseInches(inp.value)
          if (v == null) return
          const idx  = parseInt(inp.dataset.vertex, 10)
          const axis = inp.dataset.axis
          mutateProject(() => {
            if (axis === 'x') o.vertices[idx][0] = v
            else              o.vertices[idx][1] = v
          })
        }
      }
      inp.addEventListener('change', handler)
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { handler(); inp.blur() } })
    })
    const titleInput = panel.querySelector('.title-input')
    if (titleInput) {
      titleInput.addEventListener('change', () => update({ name: titleInput.value.trim() || undefined }))
    }
    panel.querySelectorAll('.color-input').forEach(inp => {
      inp.addEventListener('input', () => update({ [inp.dataset.field]: inp.value }))
    })
    panel.querySelectorAll('.range-input').forEach(inp => {
      inp.addEventListener('input', () => update({ [inp.dataset.field]: parseFloat(inp.value) }))
    })
    panel.querySelectorAll('.num-input').forEach(inp => {
      inp.addEventListener('change', () => update({ [inp.dataset.field]: parseFloat(inp.value) }))
    })
    const scaleBtn = panel.querySelector('[data-action="scale"]')
    if (scaleBtn) {
      scaleBtn.addEventListener('click', () => startCalibration(o.id))
    }
  }
}

// Replace the multi-selection with a single merged polygon.
function joinSelectedShapes() {
  const sel = selectedObjects()
  if (sel.length < 2) return
  const result = unionShapes(sel)
  if (result.error) {
    alert(result.error)
    return
  }
  const newType = mergedType(sel)
  // Position in z-order: bottom-most of the source objects, so the merged
  // polygon doesn't suddenly jump up the stack.
  const newId = uid('obj')
  const sourceIds = new Set(sel.map(s => s.id))
  mutateProject(p => {
    const room = p.rooms.find(r => r.id === state.activeRoomId)
    if (!room) return
    let insertAt = room.objects.length
    for (let i = 0; i < room.objects.length; i++) {
      if (sourceIds.has(room.objects[i].id)) { insertAt = i; break }
    }
    room.objects = room.objects.filter(o => !sourceIds.has(o.id))
    const insertIdx = Math.min(insertAt, room.objects.length)
    room.objects.splice(insertIdx, 0, {
      id: newId,
      kind: 'polygon',
      type: newType,
      vertices: result.vertices,
    })
  })
  setState({ selection: [newId] })
}
