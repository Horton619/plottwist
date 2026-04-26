// Right panel: live properties of the current selection.

import { state, subscribe, mutateProject, selectedObjects, TYPE_STYLES, styleFor } from '../state.js'
import { objectBounds, objectArea } from '../geom.js'
import { formatInches, formatSqFt, parseInches } from '../units.js'

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
      panel.innerHTML = `
        <div class="panel-section">
          <div class="panel-title">${sel.length} objects selected</div>
          <div class="prop-row"><span class="prop-key">Total area</span><span class="prop-val">${formatSqFt(totalArea)}</span></div>
        </div>
      `
      return
    }

    const o = sel[0]
    const b = objectBounds(o)
    const area = objectArea(o)
    const s = styleFor(o)
    const typeLabel = (TYPE_STYLES[o.type] && TYPE_STYLES[o.type].label) || o.type

    panel.innerHTML = `
      <div class="panel-section">
        <div class="panel-title">${typeLabel}</div>
        <div class="panel-sub">${o.kind === 'rect' ? 'Rectangle' : 'Polygon'} · ${o.id.slice(-6)}</div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Geometry</div>
        ${o.kind === 'rect' ? `
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
    panel.querySelectorAll('.color-input').forEach(inp => {
      inp.addEventListener('input', () => update({ [inp.dataset.field]: inp.value }))
    })
    panel.querySelectorAll('.range-input').forEach(inp => {
      inp.addEventListener('input', () => update({ [inp.dataset.field]: parseFloat(inp.value) }))
    })
    panel.querySelectorAll('.num-input').forEach(inp => {
      inp.addEventListener('change', () => update({ [inp.dataset.field]: parseFloat(inp.value) }))
    })
  }
}
