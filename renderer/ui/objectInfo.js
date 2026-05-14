// Right panel: live properties of the current selection.

import { state, setState, subscribe, mutateProject, selectedObjects, TYPE_STYLES, styleFor, objectName, activeRoom, activeLayout, uid } from '../state.js'
import { objectBounds, objectArea } from '../geom.js'
import { formatInches, formatSqFt, parseInches } from '../units.js'
import { unionShapes, subtractShapes, intersectShapes, mergedType } from '../shapeOps.js'
import { startCalibration } from '../canvas.js'
import { solveSeatingZone } from '../solver/index.js'
import { STYLE_DEFAULTS, TABLE_PRESETS, ROUND_PRESETS, MIXED_TABLE_PRESETS, setLabelDefaults } from '../tools/polygonTool.js'
import { setDoorDefaults } from '../tools/rectTool.js'
import { getSetting } from '../settings.js'
import { escapeAttr } from '../strings.js'

// Coordinate display helpers — show X/Y relative to the project origin so
// users can read positions from their chosen reference point. Internal
// storage stays in world coords; we only translate at the input boundary.
function originX() { return activeRoom()?.origin?.x || 0 }
function originY() { return activeRoom()?.origin?.y || 0 }
function formatCoord(value, axis) {
  return formatInches(value - (axis === 'x' ? originX() : originY()))
}
function parseCoord(text, axis) {
  const v = parseInches(text)
  return v == null ? null : v + (axis === 'x' ? originX() : originY())
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
      // Combined seat math — only includes solved seating zones in the selection.
      const seated = sel.filter(o => o.type === 'seating' && o.result?.totalSeats)
      const combinedSeats = seated.reduce((a, o) => a + o.result.totalSeats, 0)
      // Boolean ops mutate venue (room) shapes only. If any selected object
      // lives in a layout (aisle, seating zone, etc.) we hide the buttons
      // rather than risk leaving zombie objects in layout.objects.
      const room = activeRoom()
      const allRoomObjs   = sel.every(o => room.objects.includes(o))
      const joinable = allRoomObjs && sel.every(o => o.kind === 'rect' || o.kind === 'polygon')
      const mixedContainers = sel.every(o => o.kind === 'rect' || o.kind === 'polygon') && !allRoomObjs
      // Base for Subtract = lowest stack-order shape (matches applyBoolean's
      // sort). Showing the name removes the 50/50 guesswork from the user.
      const baseShape = joinable
        ? [...sel].sort((a, b) => room.objects.indexOf(a) - room.objects.indexOf(b))[0]
        : null
      const baseName = baseShape ? objectName(baseShape, room) : ''
      panel.innerHTML = `
        <div class="panel-section">
          <div class="panel-title">${sel.length} objects selected</div>
          <div class="prop-row"><span class="prop-key">Total area</span><span class="prop-val">${formatSqFt(totalArea)}</span></div>
          ${seated.length >= 2 ? `
            <div class="prop-row"><span class="prop-key">Combined seats</span><span class="prop-val accent">${combinedSeats}</span></div>
            <p class="panel-hint">${seated.map(o => `${escapeAttr(objectName(o, room))}: ${o.result.totalSeats}`).join(' + ')}</p>
          ` : ''}
        </div>
        ${joinable ? `
          <div class="panel-section">
            <div class="panel-section-title">Boolean</div>
            <button class="block-btn" data-action="join">Join → Polygon</button>
            <button class="block-btn" data-action="subtract">Subtract</button>
            <button class="block-btn" data-action="intersect">Intersect</button>
            <p class="panel-hint"><b>Base:</b> ${escapeAttr(baseName)} (the bottom-most layer). Subtract removes the others from it; Intersect keeps the overlap.</p>
          </div>
        ` : mixedContainers ? `
          <div class="panel-section">
            <div class="panel-section-title">Boolean</div>
            <p class="panel-hint warn">Boolean ops only run on venue shapes. Layout objects (aisles, seating) can't be merged.</p>
          </div>
        ` : ''}
        ${reflectSection(room, sel.length)}
      `
      const joinBtn      = panel.querySelector('[data-action="join"]')
      const subtractBtn  = panel.querySelector('[data-action="subtract"]')
      const intersectBtn = panel.querySelector('[data-action="intersect"]')
      if (joinBtn)      joinBtn.addEventListener('click',     () => applyBoolean('Join',      unionShapes))
      if (subtractBtn)  subtractBtn.addEventListener('click', () => applyBoolean('Subtract',  subtractShapes))
      if (intersectBtn) intersectBtn.addEventListener('click',() => applyBoolean('Intersect', intersectShapes))
      const reflectBtn = panel.querySelector('[data-action="reflect"]')
      if (reflectBtn) reflectBtn.addEventListener('click', () => applyReflect())
      return
    }

    const o = sel[0]
    const room = activeRoom()
    const b = objectBounds(o)
    const area = objectArea(o)
    const s = styleFor(o)
    const typeLabel = (TYPE_STYLES[o.type] && TYPE_STYLES[o.type].label) || o.type
    const kindLabel = ({ rect: 'Rectangle', polygon: 'Polygon', image: 'Image', dim: 'Dim Line' })[o.kind] || o.kind
    const isBoxed = o.kind === 'rect' || o.kind === 'image'
    const isDim   = o.kind === 'dim'
    const dimLen  = isDim ? Math.hypot(o.x2 - o.x1, o.y2 - o.y1) : 0
    const dimAngle = isDim ? Math.atan2(o.y2 - o.y1, o.x2 - o.x1) * 180 / Math.PI : 0

    panel.innerHTML = `
      <div class="panel-section">
        <div class="panel-title">
          <input class="title-input" data-field="name" value="${escapeAttr(objectName(o, room))}" placeholder="${typeLabel}">
        </div>
        <div class="panel-sub">${typeLabel} · ${kindLabel}</div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Geometry</div>
        ${isBoxed ? `
          <div class="prop-row"><span class="prop-key">Width</span><input class="prop-input" data-field="w" value="${formatInches(o.w)}"></div>
          <div class="prop-row"><span class="prop-key">Height</span><input class="prop-input" data-field="h" value="${formatInches(o.h)}"></div>
          <div class="prop-row"><span class="prop-key">X</span><input class="prop-input" data-coord="x" data-field="x" value="${formatCoord(o.x, 'x')}"></div>
          <div class="prop-row"><span class="prop-key">Y</span><input class="prop-input" data-coord="y" data-field="y" value="${formatCoord(o.y, 'y')}"></div>
          <div class="prop-row"><span class="prop-key">Area</span><span class="prop-val accent">${formatSqFt(area)}</span></div>
        ` : isDim ? `
          <div class="prop-row"><span class="prop-key">Length</span><input class="prop-input" data-dim="length" value="${formatInches(dimLen)}"></div>
          <div class="prop-row"><span class="prop-key">Angle</span>
            <input type="number" class="num-input" data-dim="angle" min="-180" max="360" step="0.5" value="${Math.round(dimAngle * 10) / 10}">
            <span class="prop-val small">°</span>
          </div>
          <div class="prop-row"><span class="prop-key">Start X</span><input class="prop-input" data-coord="x" data-field="x1" value="${formatCoord(o.x1, 'x')}"></div>
          <div class="prop-row"><span class="prop-key">Start Y</span><input class="prop-input" data-coord="y" data-field="y1" value="${formatCoord(o.y1, 'y')}"></div>
          <div class="prop-row"><span class="prop-key">End X</span><input class="prop-input" data-coord="x" data-field="x2" value="${formatCoord(o.x2, 'x')}"></div>
          <div class="prop-row"><span class="prop-key">End Y</span><input class="prop-input" data-coord="y" data-field="y2" value="${formatCoord(o.y2, 'y')}"></div>
        ` : `
          <div class="prop-row"><span class="prop-key">Bounding</span><span class="prop-val">${formatInches(b.w)} × ${formatInches(b.h)}</span></div>
          <div class="prop-row"><span class="prop-key">Vertices</span><span class="prop-val">${o.vertices.length}</span></div>
          <div class="prop-row"><span class="prop-key">Area</span><span class="prop-val accent">${formatSqFt(area)}</span></div>
        `}
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
      ` : isDim ? '' : `
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
      ${o.type === 'seating' ? renderSeatingControls(o) : ''}
      ${o.type === 'door' ? renderDoorControls(o) : ''}
      ${o.kind === 'polygon' ? `
        <div class="panel-section">
          <div class="panel-section-title">Vertices</div>
          <div class="vertex-list">
            ${o.vertices.map(([x, y], i) => `
              <div class="vertex-row">
                <span class="vertex-idx">${i}</span>
                <input class="prop-input compact" data-vertex="${i}" data-axis="x" value="${formatCoord(x, 'x')}">
                <input class="prop-input compact" data-vertex="${i}" data-axis="y" value="${formatCoord(y, 'y')}">
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      ${reflectSection(room, 1)}
    `

    // Wire inputs
    const update = (patch) => {
      mutateProject(() => Object.assign(o, patch))
    }
    panel.querySelectorAll('.prop-input').forEach(inp => {
      const handler = () => {
        const field = inp.dataset.field
        if (field) {
          // X / Y / x1 / y1 / x2 / y2 are origin-relative; everything else
          // (W, H, etc.) is a delta and parses with plain inches.
          const coordAxis = inp.dataset.coord
          const v = coordAxis ? parseCoord(inp.value, coordAxis) : parseInches(inp.value)
          if (v != null) update({ [field]: v })
        } else if (inp.dataset.vertex != null) {
          const axis = inp.dataset.axis
          const v = parseCoord(inp.value, axis)
          if (v == null) return
          const idx  = parseInt(inp.dataset.vertex, 10)
          mutateProject(() => {
            if (axis === 'x') o.vertices[idx][0] = v
            else              o.vertices[idx][1] = v
          })
        }
      }
      inp.addEventListener('change', handler)
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { handler(); inp.blur() } })
    })

    // Dim-line length / angle inputs pivot the END point around the START so
    // the start anchor stays fixed. Both feel more useful day-to-day than
    // editing raw endpoint coordinates.
    panel.querySelectorAll('[data-dim]').forEach(inp => {
      const field = inp.dataset.dim
      const handler = () => {
        if (field === 'length') {
          const v = parseInches(inp.value)
          if (v == null || v < 1) return
          const dx = o.x2 - o.x1, dy = o.y2 - o.y1
          const cur = Math.hypot(dx, dy)
          if (cur < 0.001) {
            // Degenerate dim — default to a horizontal extension.
            mutateProject(() => { o.x2 = o.x1 + v; o.y2 = o.y1 })
            return
          }
          const ux = dx / cur, uy = dy / cur
          mutateProject(() => {
            o.x2 = Math.round(o.x1 + ux * v)
            o.y2 = Math.round(o.y1 + uy * v)
          })
        } else if (field === 'angle') {
          const deg = parseFloat(inp.value)
          if (!Number.isFinite(deg)) return
          const dx = o.x2 - o.x1, dy = o.y2 - o.y1
          const cur = Math.hypot(dx, dy) || 1
          const r = deg * Math.PI / 180
          mutateProject(() => {
            o.x2 = Math.round(o.x1 + Math.cos(r) * cur)
            o.y2 = Math.round(o.y1 + Math.sin(r) * cur)
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
      if (!inp.dataset.field) return    // seating-zone inputs use data-zone instead
      inp.addEventListener('change', () => update({ [inp.dataset.field]: parseFloat(inp.value) }))
    })
    const scaleBtn = panel.querySelector('[data-action="scale"]')
    if (scaleBtn) {
      scaleBtn.addEventListener('click', () => startCalibration(o.id))
    }
    const reflectBtn = panel.querySelector('[data-action="reflect"]')
    if (reflectBtn) reflectBtn.addEventListener('click', () => applyReflect())
    if (o.type === 'seating') wireSeatingControls(panel, o)
    if (o.type === 'door')    wireDoorControls(panel, o)
  }
}

// ── Seating zone controls (theater for v1) ────────────────────────────────

function renderSeatingControls(o) {
  const result     = o.result
  // Read the new `aisles` config; tolerate the legacy centerAisle shape on
  // older zones that haven't been re-saved yet.
  const aisleCount = o.aisles?.count ?? (o.centerAisle?.enabled === false ? 0 : 1)
  const aisleW     = o.aisles?.width ?? o.centerAisle?.width ?? 144
  const styleLabel = o.style.charAt(0).toUpperCase() + o.style.slice(1)

  // Style-specific control rows.
  const styleSpecific =
      o.style === 'classroom' ? renderClassroomRows(o)
    : o.style === 'rounds'    ? renderRoundsRows(o)
    : o.style === 'mixed'     ? renderMixedRows(o)
    :                            renderTheaterRows(o)

  // Aisle controls apply to all styles. Mixed forwards the aisle config to
  // its inner classroom + theater solvers (with classroom's section width
  // pinned to the theater's so the aisles line up cleanly through both).
  const showAisleControls = true
  // Pattern dropdown was scaffolding for chevron/curved variants before
  // chevron became its own checkbox. Removed.
  const showPatternControl = false

  return `
    <div class="panel-section">
      <div class="panel-section-title">Seating — ${styleLabel}</div>
      <div class="prop-row"><span class="prop-key">Style</span>
        <select class="select-input" data-zone="style">
          <option value="theater"   ${o.style === 'theater'   ? 'selected' : ''}>Theater</option>
          <option value="classroom" ${o.style === 'classroom' ? 'selected' : ''}>Classroom</option>
          <option value="rounds"    ${o.style === 'rounds'    ? 'selected' : ''}>Rounds</option>
          <option value="mixed"     ${o.style === 'mixed'     ? 'selected' : ''}>Mixed</option>
        </select>
      </div>
      ${showPatternControl ? `
        <div class="prop-row"><span class="prop-key">Pattern</span>
          <select class="select-input" data-zone="pattern">
            <option value="straight" ${o.pattern === 'straight' ? 'selected' : ''}>Straight</option>
            <option value="chevron"  disabled>Chevron (soon)</option>
          </select>
        </div>
      ` : ''}
      <div class="prop-row"><span class="prop-key">Facing</span>
        <input type="number" class="num-input" data-zone="rotation" min="0" max="359" step="5" value="${o.rotation || 0}">
        <span class="prop-val small">°</span>
      </div>
      <div class="prop-row" title="Aim for this seat count. The solver fills full rows; for Mixed it picks the classroom/theater split that lands closest to the goal. A bit of spill above the goal is expected.">
        <span class="prop-key">Goal</span>
        <input type="checkbox" data-zone-cap="enabled" ${o.preference === 'exact' ? 'checked' : ''}
               title="Tick to set a target seat count. The solver stops adding rows once the goal is met, finishing the current row.">
        <input type="number" class="num-input" data-zone="target" min="1" step="1"
               value="${o.target || ''}" placeholder="seat goal"
               title="Goal seat count — solver aims for this. Mixed: optimizes the split. Theater/Classroom/Rounds: stops after a row crosses the goal."
               ${o.preference === 'exact' ? '' : 'disabled'}>
      </div>
      ${styleSpecific}
      ${showAisleControls ? `
        <div class="prop-row"><span class="prop-key">Aisles</span>
          <input type="number" class="num-input" data-zone-aisle="count" min="0" max="9" step="1" value="${aisleCount}">
          <input class="prop-input" data-zone-aisle="width" value="${formatInches(aisleW)}" ${aisleCount > 0 ? '' : 'disabled'} placeholder="width">
        </div>
      ` : ''}
      <button class="block-btn solve-btn" data-action="solve">Solve</button>
      ${result ? `
        <div class="solve-result">
          <div class="prop-row"><span class="prop-key">Seats</span><span class="prop-val accent">${result.totalSeats}</span></div>
          <div class="prop-row"><span class="prop-key">Rows</span><span class="prop-val">${result.rows.length}</span></div>
          ${result.tables?.length ? `<div class="prop-row"><span class="prop-key">Tables</span><span class="prop-val">${result.tables.length}</span></div>` : ''}
          ${result.warnings && result.warnings.length ? `<p class="panel-hint warn">${result.warnings.join('<br>')}</p>` : ''}
          <button class="ghost-btn small" data-action="clear-solve">Clear</button>
        </div>
      ` : '<p class="panel-hint">Drop a Seating zone, pick a style, hit Solve.</p>'}
    </div>
    ${renderSeatLabelControls(o)}
    ${o.style === 'rounds' ? renderTableNumberingControls(o) : ''}
  `
}

// ── Door controls ────────────────────────────────────────────────────────
// Edits to swing / opens / hinge / width on a single door also update the
// session defaults so subsequent doors drawn this session inherit the look.

function renderDoorControls(o) {
  const w = o.width ?? 72
  return `
    <div class="panel-section">
      <div class="panel-section-title">Door</div>
      <div class="prop-row"><span class="prop-key">Swing</span>
        <select class="select-input" data-door="swing">
          <option value="dual"   ${o.swing === 'dual'   ? 'selected' : ''}>Dual (double door)</option>
          <option value="single" ${o.swing === 'single' ? 'selected' : ''}>Single</option>
        </select>
      </div>
      <div class="prop-row"><span class="prop-key">Opens</span>
        <select class="select-input" data-door="opens">
          <option value="out" ${o.opens === 'out' ? 'selected' : ''}>Outward (default)</option>
          <option value="in"  ${o.opens === 'in'  ? 'selected' : ''}>Inward</option>
        </select>
      </div>
      ${o.swing !== 'dual' ? `
        <div class="prop-row"><span class="prop-key">Hinge</span>
          <select class="select-input" data-door="hinge">
            <option value="left"  ${o.hinge === 'left'  ? 'selected' : ''}>Left</option>
            <option value="right" ${o.hinge === 'right' ? 'selected' : ''}>Right</option>
          </select>
        </div>
      ` : ''}
      <div class="prop-row"><span class="prop-key">Width</span>
        <input class="prop-input" data-door-inches="width" value="${formatInches(w)}">
      </div>
      <p class="panel-hint">Defaults: dual at 6′, single at 3′. Edits become the session default for new doors. Place on the wall using the Door (R) tool.</p>
    </div>
  `
}

function wireDoorControls(panel, o) {
  panel.querySelectorAll('[data-door]').forEach(inp => {
    const field = inp.dataset.door
    inp.addEventListener('change', () => {
      mutateProject(() => {
        if (field === 'swing') {
          o.swing = inp.value
          // Re-default width when the user flips swing type IF the current
          // width matches the prior default for that type — otherwise leave
          // the user's custom value alone.
          if (inp.value === 'dual'   && (o.width === 36)) o.width = 72
          if (inp.value === 'single' && (o.width === 72)) o.width = 36
        }
        else if (field === 'opens') o.opens = inp.value
        else if (field === 'hinge') o.hinge = inp.value
      })
      setDoorDefaults({ [field]: inp.value })
    })
  })
  panel.querySelectorAll('[data-door-inches]').forEach(inp => {
    inp.addEventListener('change', () => {
      const v = parseInches(inp.value)
      if (v == null || v <= 0) return
      mutateProject(() => {
        o.width = v
        // Rebuild the rect dimensions so the threshold and swing both reflect
        // the new opening. The "long axis" stays the long axis; the short
        // axis (swing radius) follows opening width 1:1.
        const horizontal = o.w >= o.h
        if (horizontal) { o.w = v; o.h = v }
        else            { o.h = v; o.w = v }
      })
      setDoorDefaults({ width: v })
    })
  })
}

function renderSeatLabelControls(o) {
  const lbl = o.seatCountLabel || { show: true, fill: '#070910', textColor: '#FF2D9D', fontSize: 24 }
  return `
    <div class="panel-section">
      <div class="panel-section-title">Seat Count Label</div>
      <div class="prop-row"><span class="prop-key">Show</span>
        <input type="checkbox" data-zone-label="show" ${lbl.show !== false ? 'checked' : ''}>
      </div>
      <div class="prop-row"><span class="prop-key">Background</span>
        <input type="color" class="color-input" data-zone-label="fill" value="${lbl.fill || '#070910'}">
      </div>
      <div class="prop-row"><span class="prop-key">Text</span>
        <input type="color" class="color-input" data-zone-label="textColor" value="${lbl.textColor || '#FF2D9D'}">
      </div>
      <div class="prop-row"><span class="prop-key">Size</span>
        <input type="number" class="num-input" data-zone-label="fontSize" min="8" max="120" step="2" value="${lbl.fontSize || 24}">
      </div>
      <p class="panel-hint">One label per chair cluster (chairs separated by an aisle). Edits here become the default for new zones in this session.</p>
    </div>
  `
}

function renderTableNumberingControls(o) {
  const tn = o.tableNumbering || { show: false, corner: 'tl', direction: 'h' }
  return `
    <div class="panel-section">
      <div class="panel-section-title">Table Numbering</div>
      <div class="prop-row"><span class="prop-key">Show</span>
        <input type="checkbox" data-zone-tnum="show" ${tn.show ? 'checked' : ''}>
      </div>
      <div class="prop-row"><span class="prop-key">Start corner</span>
        <select class="select-input" data-zone-tnum="corner" ${tn.show ? '' : 'disabled'}>
          <option value="tl" ${tn.corner === 'tl' ? 'selected' : ''}>Top-left</option>
          <option value="tr" ${tn.corner === 'tr' ? 'selected' : ''}>Top-right</option>
          <option value="bl" ${tn.corner === 'bl' ? 'selected' : ''}>Bottom-left</option>
          <option value="br" ${tn.corner === 'br' ? 'selected' : ''}>Bottom-right</option>
        </select>
      </div>
      <div class="prop-row"><span class="prop-key">Direction</span>
        <select class="select-input" data-zone-tnum="direction" ${tn.show ? '' : 'disabled'}>
          <option value="h" ${tn.direction === 'h' ? 'selected' : ''}>Rows (serpentine)</option>
          <option value="v" ${tn.direction === 'v' ? 'selected' : ''}>Columns (serpentine)</option>
        </select>
      </div>
      <p class="panel-hint">When on, each round table gets a per-table number instead of a cluster total.</p>
    </div>
  `
}

function renderTheaterRows(o) {
  return `
    <div class="prop-row"><span class="prop-key">Row spacing</span>
      <input class="prop-input" data-zone-inches="rowSpacing" value="${formatInches(o.rowSpacing || 20)}">
    </div>
    <div class="prop-row"><span class="prop-key">Max / row</span>
      <input type="number" class="num-input" data-zone="maxPerRow" min="1" step="1" value="${o.maxPerRow || 12}">
    </div>
    ${renderChevronRows(o)}
  `
}

function renderClassroomRows(o) {
  // Match current dimensions to a preset id, else "custom".
  const matched = TABLE_PRESETS.find(p => p.w === o.tableW && p.d === o.tableD)
  const presetId = matched ? matched.id : 'custom'
  return `
    <div class="prop-row"><span class="prop-key">Table</span>
      <select class="select-input" data-zone-table="preset">
        ${TABLE_PRESETS.map(p => `<option value="${p.id}" ${p.id === presetId ? 'selected' : ''}>${p.label}</option>`).join('')}
        ${matched ? '' : `<option value="custom" selected>Custom (${formatInches(o.tableW)} × ${formatInches(o.tableD)})</option>`}
      </select>
    </div>
    <div class="prop-row"><span class="prop-key">Chairs / table</span>
      <input type="number" class="num-input" data-zone="chairsPerTable" min="1" max="6" step="1" value="${o.chairsPerTable || 3}">
    </div>
    <div class="prop-row"><span class="prop-key">Row spacing</span>
      <input class="prop-input" data-zone-inches="rowSpacing" value="${formatInches(o.rowSpacing || 54)}">
    </div>
    ${renderChevronRows(o)}
  `
}

function renderRoundsRows(o) {
  const matchedSize = ROUND_PRESETS.find(p => p.d === o.tableD)
  const sizeId = matchedSize ? matchedSize.id : 'custom'
  const chairs = o.chairsPerTable || 10
  const layoutHint = chairs <= 6 ? 'Crescent — chairs face the stage.'
                                 : 'Full circle — chairs around the table.'
  return `
    <div class="prop-row"><span class="prop-key">Table size</span>
      <select class="select-input" data-zone-round="size">
        ${ROUND_PRESETS.map(p => `<option value="${p.id}" ${p.id === sizeId ? 'selected' : ''}>${p.label}</option>`).join('')}
        <option value="custom" ${sizeId === 'custom' ? 'selected' : ''}>Custom</option>
      </select>
    </div>
    ${sizeId === 'custom' ? `
      <div class="prop-row"><span class="prop-key">Diameter</span>
        <input class="prop-input" data-zone-inches="tableD" value="${formatInches(o.tableD || 72)}">
      </div>
    ` : ''}
    <div class="prop-row" title="≤ 6 chairs renders crescent (chairs face the stage). 7+ renders full circle.">
      <span class="prop-key">Chairs / table</span>
      <input type="number" class="num-input" data-zone="chairsPerTable" min="2" max="20" step="1" value="${chairs}">
    </div>
    <p class="panel-hint">${layoutHint}</p>
    <div class="prop-row"><span class="prop-key">Spacing</span>
      <input class="prop-input" data-zone-inches="tableSpacing" value="${formatInches(o.tableSpacing ?? 60)}">
    </div>
    <div class="prop-row" title="Checked: tables distribute evenly across each section. Unchecked: tables flush against the aisle, extra space accumulates at the polygon's outer edge.">
      <span class="prop-key">Fixed aisles</span>
      <input type="checkbox" data-zone-bool="fixedAisles" ${o.fixedAisles !== false ? 'checked' : ''}>
      <span class="prop-val small">${o.fixedAisles !== false ? 'even gaps' : 'flush to aisle'}</span>
    </div>
    <div class="prop-row" title="Alternate rows shift by half a pitch so adjacent diagonal table centers stay the same distance apart as same-row neighbors (hex packing, 60° offset).">
      <span class="prop-key">Offset rows</span>
      <input type="checkbox" data-zone-bool="offsetRows" ${o.offsetRows ? 'checked' : ''}>
    </div>
  `
}

// Shared chevron rows used by theater / classroom / mixed renderers. Chevron
// rotates the outermost sections of a multi-section layout inward by the
// chevron angle (helpful for long ballrooms where end audiences need to face
// the stage rather than straight ahead).
function renderChevronRows(o) {
  return `
    <div class="prop-row" title="Outermost sections rotate inward toward the venue centerline. Only applies when there are 2+ sections (i.e., aisles are present).">
      <span class="prop-key">Chevron</span>
      <input type="checkbox" data-zone-bool="chevron" ${o.chevron ? 'checked' : ''}>
    </div>
    ${o.chevron ? `
      <div class="prop-row" title="Positive = rows slant toward the stage at the outer end (default). Negative = rows slant away from the stage.">
        <span class="prop-key">Chevron angle</span>
        <input type="number" class="num-input" data-zone="chevronAngle" min="-45" max="45" step="1" value="${o.chevronAngle ?? 15}">
        <span class="prop-val small">°</span>
      </div>
    ` : ''}
  `
}

function renderMixedRows(o) {
  const matched = MIXED_TABLE_PRESETS.find(p => p.w === o.tableW && p.d === o.tableD)
  const presetId = matched ? matched.id : 'custom'
  return `
    <div class="prop-row"><span class="prop-key">Classroom depth</span>
      <input class="prop-input" data-zone-inches="classroomDepth" value="${formatInches(o.classroomDepth || 0)}">
    </div>
    <div class="prop-row"><span class="prop-key">Table</span>
      <select class="select-input" data-zone-mixed-table="preset">
        ${MIXED_TABLE_PRESETS.map(p => `<option value="${p.id}" ${p.id === presetId ? 'selected' : ''}>${p.label}</option>`).join('')}
        ${matched ? '' : `<option value="custom" selected>Custom (${formatInches(o.tableW)} × ${formatInches(o.tableD)})</option>`}
      </select>
    </div>
    <div class="prop-row"><span class="prop-key">Chairs / table</span>
      <input type="number" class="num-input" data-zone="chairsPerTable" min="2" max="4" step="1" value="${o.chairsPerTable || 2}">
    </div>
    <div class="prop-row" title="Walkway between the back of classroom and the front of theater. Default 6'.">
      <span class="prop-key">Transition gap</span>
      <input class="prop-input" data-zone-inches="transitionGap" value="${formatInches(o.transitionGap ?? 72)}">
    </div>
    <div class="prop-row"><span class="prop-key">Theater spacing</span>
      <input class="prop-input" data-zone-inches="rowSpacing" value="${formatInches(o.rowSpacing || 20)}">
    </div>
    <div class="prop-row"><span class="prop-key">Classroom spacing</span>
      <input class="prop-input" data-zone-inches="rowSpacingClassroom" value="${formatInches(o.rowSpacingClassroom || 54)}">
    </div>
    <div class="prop-row"><span class="prop-key">Max / row</span>
      <input type="number" class="num-input" data-zone="maxPerRow" min="1" step="1" value="${o.maxPerRow || 12}">
    </div>
    ${renderChevronRows(o)}
    <p class="panel-hint">Default 50/50 split; tick Goal with a target to auto-optimize the depth.</p>
  `
}

function wireSeatingControls(panel, o) {
  const update = (patch) => mutateProject(() => Object.assign(o, patch))

  panel.querySelectorAll('[data-zone]').forEach(inp => {
    const field = inp.dataset.zone
    const handler = () => {
      const raw = inp.type === 'number' ? parseFloat(inp.value) : inp.value
      if (raw === '' || (typeof raw === 'number' && isNaN(raw))) return
      // Style switch: apply that style's defaults for any field the user
      // hasn't already touched (we treat present fields as touched).
      if (field === 'style' && raw !== o.style) {
        const defaults = STYLE_DEFAULTS[raw] || {}
        const patch = { style: raw, result: null }   // clear stale solve
        for (const [k, v] of Object.entries(defaults)) {
          // Always overwrite style-specific defaults — switching styles
          // is a fresh-start gesture.
          patch[k] = v
        }
        // Settings overrides — pull live preference values for the new style
        // so user defaults take effect on every style switch.
        if (raw === 'theater') {
          patch.rowSpacing = getSetting('defaultTheaterRowSpacing')
        }
        if (raw === 'classroom') {
          patch.rowSpacing = getSetting('defaultClassroomRowSpacing')
        }
        if (raw === 'rounds') {
          patch.tableD         = getSetting('defaultRoundTableSize')
          patch.chairsPerTable = getSetting('defaultRoundChairCount')
          patch.tableSpacing   = getSetting('defaultRoundTableSpacing')
        }
        if (raw === 'mixed') {
          patch.rowSpacing          = getSetting('defaultTheaterRowSpacing')
          patch.rowSpacingClassroom = getSetting('defaultClassroomRowSpacing')
          patch.transitionGap       = getSetting('defaultMixedTransitionGap')
        }
        if (patch.aisles && patch.aisles.width != null) {
          patch.aisles = { ...patch.aisles, width: getSetting('defaultAisleWidth') }
        }
        // Auto-pick a sensible chair count for the default classroom table.
        if (raw === 'classroom' && !patch.chairsPerTable) {
          const preset = TABLE_PRESETS.find(p => p.w === patch.tableW && p.d === patch.tableD)
          if (preset) patch.chairsPerTable = preset.seats
        }
        // Mixed default: 50/50 split based on the polygon's current height,
        // minus the transition gap so each section gets the same usable depth.
        // The user can dial it from there; ticking Goal + a target then
        // hands control to the optimizer.
        if (raw === 'mixed') {
          const b = objectBounds(o)
          const gap = STYLE_DEFAULTS.mixed.transitionGap ?? 72
          patch.classroomDepth = Math.round(Math.max(0, (b.h - gap) / 2))
        }
        mutateProject(() => Object.assign(o, patch))
        return
      }
      update({ [field]: raw })
    }
    inp.addEventListener('change', handler)
  })

  // Classroom table-preset dropdown: writes tableW/tableD/chairsPerTable in one go.
  panel.querySelectorAll('[data-zone-table]').forEach(inp => {
    inp.addEventListener('change', () => {
      const preset = TABLE_PRESETS.find(p => p.id === inp.value)
      if (!preset) return
      mutateProject(() => {
        o.tableW = preset.w
        o.tableD = preset.d
        o.chairsPerTable = preset.seats
      })
    })
  })

  // Mixed-style table-preset dropdown: writes only tableW/tableD. Chairs per
  // table is a separate input so the user can mix any density.
  panel.querySelectorAll('[data-zone-mixed-table]').forEach(inp => {
    inp.addEventListener('change', () => {
      const preset = MIXED_TABLE_PRESETS.find(p => p.id === inp.value)
      if (!preset) return
      mutateProject(() => {
        o.tableW = preset.w
        o.tableD = preset.d
      })
    })
  })

  // Round-table size dropdown: writes diameter only. Chair count is its own
  // input below, and crescent vs full is auto-derived from the chair count.
  // Picking "Custom" triggers a re-render that exposes a Diameter input.
  panel.querySelectorAll('[data-zone-round="size"]').forEach(inp => {
    inp.addEventListener('change', () => {
      const preset = ROUND_PRESETS.find(p => p.id === inp.value)
      if (preset) {
        mutateProject(() => { o.tableD = preset.d })
      } else {
        // "custom" — no immediate change; the diameter input shows on re-render.
        mutateProject(() => { /* re-render to reveal the diameter input */ })
      }
    })
  })

  // Boolean checkboxes mapped to a single zone field (e.g., crescent).
  panel.querySelectorAll('[data-zone-bool]').forEach(inp => {
    const field = inp.dataset.zoneBool
    inp.addEventListener('change', () => {
      mutateProject(() => { o[field] = inp.checked })
    })
  })
  panel.querySelectorAll('[data-zone-inches]').forEach(inp => {
    const field = inp.dataset.zoneInches
    const handler = () => {
      const v = parseInches(inp.value)
      if (v != null) update({ [field]: v })
    }
    inp.addEventListener('change', handler)
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { handler(); inp.blur() } })
  })
  // Cap-seats checkbox toggles preference between 'max' (no cap) and 'exact'
  // (cap at the typed target). When the box is unchecked, target is irrelevant
  // and the solver will pack as many seats as fit.
  panel.querySelectorAll('[data-zone-cap]').forEach(inp => {
    inp.addEventListener('change', () => {
      mutateProject(() => { o.preference = inp.checked ? 'exact' : 'max' })
    })
  })
  panel.querySelectorAll('[data-zone-aisle]').forEach(inp => {
    const field = inp.dataset.zoneAisle
    inp.addEventListener('change', () => {
      mutateProject(() => {
        if (!o.aisles) o.aisles = { count: 1, width: 144 }
        if (field === 'count') {
          const n = parseInt(inp.value, 10)
          if (Number.isFinite(n) && n >= 0) o.aisles.count = n
        } else if (field === 'width') {
          const v = parseInches(inp.value)
          if (v != null) o.aisles.width = v
        }
        // Drop legacy field once user touches the new control.
        delete o.centerAisle
      })
    })
  })

  // Seat-count label fields. Edits also become the session default for
  // newly-created zones so the user can theme once and have it stick.
  panel.querySelectorAll('[data-zone-label]').forEach(inp => {
    const field = inp.dataset.zoneLabel
    inp.addEventListener('change', () => {
      mutateProject(() => {
        if (!o.seatCountLabel) o.seatCountLabel = { show: true, fill: '#070910', textColor: '#FF2D9D', fontSize: 24 }
        if (field === 'show')           o.seatCountLabel.show     = inp.checked
        else if (field === 'fill')      o.seatCountLabel.fill     = inp.value
        else if (field === 'textColor') o.seatCountLabel.textColor = inp.value
        else if (field === 'fontSize')  o.seatCountLabel.fontSize = parseInt(inp.value, 10) || 24
      })
      // Propagate to session defaults so the next zone inherits this look.
      setLabelDefaults({ [field]: field === 'show' ? inp.checked : (field === 'fontSize' ? parseInt(inp.value, 10) || 24 : inp.value) })
    })
  })

  // Rounds-only: table-numbering toggle + corner/direction.
  panel.querySelectorAll('[data-zone-tnum]').forEach(inp => {
    const field = inp.dataset.zoneTnum
    inp.addEventListener('change', () => {
      mutateProject(() => {
        if (!o.tableNumbering) o.tableNumbering = { show: false, corner: 'tl', direction: 'h' }
        if (field === 'show')           o.tableNumbering.show      = inp.checked
        else if (field === 'corner')    o.tableNumbering.corner    = inp.value
        else if (field === 'direction') o.tableNumbering.direction = inp.value
      })
    })
  })

  const solveBtn = panel.querySelector('[data-action="solve"]')
  if (solveBtn) solveBtn.addEventListener('click', () => {
    // Sibling aisle objects in the active layout become real cuts the solver
    // honors. Lets the user manually carve egress paths and watch chairs reflow.
    const layout = activeLayout()
    const room   = activeRoom()
    // Hidden aisles still impact the solve — visibility is a display concern,
    // not a structural one. Hide an aisle to reduce visual clutter without
    // breaking the layout it shaped.
    const userAisles = (layout?.objects || [])
      .filter(a => a.type === 'aisle' && a.kind === 'rect')
    // Venue-level objects that physically block seating: walls (the room
    // shell, including pillars jutting in), obstructions (free-standing
    // columns), stages, and tech tables. Floors are skipped — floors are
    // just the area boundary, not a physical structure.
    const BLOCKING = new Set(['walls', 'obstruction', 'stage', 'tech'])
    const obstructions = (room?.objects || [])
      .filter(o2 => BLOCKING.has(o2.type) && !o2.hidden)
    const res = solveSeatingZone(o, { userAisles, obstructions })
    mutateProject(() => {
      o.result = res
      // Mixed optimizer writes back the chosen split depth so the user sees
      // it (and can fine-tune from there).
      if (res.optimizedDepth != null) o.classroomDepth = res.optimizedDepth
    })
  })
  const clearBtn = panel.querySelector('[data-action="clear-solve"]')
  if (clearBtn) clearBtn.addEventListener('click', () => {
    mutateProject(() => { o.result = null })
  })
}

// Replace the multi-selection with a single derived polygon. The opFn is one
// of unionShapes / subtractShapes / intersectShapes.
//
// For Subtract specifically, the FIRST array element (lowest z-order) is the
// base surface, and the rest are cutters — this matches the panel hint "bottom
// layer minus the rest." We sort by stack order before calling the op.
function applyBoolean(opLabel, opFn) {
  const sel = selectedObjects()
  if (sel.length < 2) return

  const room = activeRoom()
  if (!room) return
  // Defensive — the panel should already hide the buttons, but if any selected
  // object isn't in the active room's objects[] we'd leave it as a zombie in
  // its layout. Bail with a clear message instead.
  if (!sel.every(o => room.objects.includes(o))) {
    alert(`${opLabel}: only venue shapes can be combined. Move shapes between containers first.`)
    return
  }
  // Sort by ROOM stack order — earlier index = bottom-most. selection[] order
  // is click order, which isn't what we want for Subtract semantics.
  const indexOf = (o) => room.objects.indexOf(o)
  const ordered = [...sel].sort((a, b) => indexOf(a) - indexOf(b))

  const result = opFn(ordered)
  if (result.error) { alert(`${opLabel}: ${result.error}`); return }

  const newType = mergedType(ordered)
  const newId = uid('obj')
  const sourceIds = new Set(ordered.map(s => s.id))
  mutateProject(p => {
    const r = p.rooms.find(rm => rm.id === state.activeRoomId)
    if (!r) return
    let insertAt = r.objects.length
    for (let i = 0; i < r.objects.length; i++) {
      if (sourceIds.has(r.objects[i].id)) { insertAt = i; break }
    }
    r.objects = r.objects.filter(o => !sourceIds.has(o.id))
    const insertIdx = Math.min(insertAt, r.objects.length)
    r.objects.splice(insertIdx, 0, {
      id: newId,
      kind: 'polygon',
      type: newType,
      vertices: result.vertices,
    })
  })
  setState({ selection: [newId] })
}

// ── Reflect over centerline ───────────────────────────────────────────────
// Duplicates the selected objects mirrored across the active room's
// centerline. Solver-zone results are wiped so the user re-solves on the
// mirrored zone (which may now sit against different obstructions).

function reflectSection(room, count) {
  const cl = room?.centerline
  const enabled = cl && cl.enabled
  if (!enabled) {
    return `
      <div class="panel-section">
        <div class="panel-section-title">Reflect</div>
        <p class="panel-hint">Enable a centerline for this room (Settings → Workspace) to mirror objects across it.</p>
      </div>
    `
  }
  const label = count > 1 ? `Reflect ${count} objects` : 'Reflect over centerline'
  return `
    <div class="panel-section">
      <div class="panel-section-title">Reflect</div>
      <button class="block-btn" data-action="reflect">${label}</button>
      <p class="panel-hint">Mirrors a copy of the selection across the room's centerline (x = ${formatInches(cl.x)}).</p>
    </div>
  `
}

function applyReflect() {
  const sel = selectedObjects()
  if (sel.length === 0) return
  const room = activeRoom()
  const cl = room?.centerline
  if (!cl || !cl.enabled) return
  const cx = cl.x
  const newIds = []
  mutateProject(p => {
    const r = p.rooms.find(rm => rm.id === state.activeRoomId)
    if (!r) return
    const layout = (r.layouts || []).find(l => l.id === state.activeLayoutId)
    for (const o of sel) {
      // Find which array the original lives in so the mirror lands beside it.
      const inRoom = r.objects.includes(o)
      const container = inRoom ? r.objects : layout?.objects
      if (!container) continue
      const mirror = reflectObjectAcrossX(o, cx)
      if (!mirror) continue
      mirror.id = uid('obj')
      newIds.push(mirror.id)
      container.push(mirror)
    }
  })
  if (newIds.length) setState({ selection: newIds })
}

function reflectObjectAcrossX(o, cx) {
  const copy = JSON.parse(JSON.stringify(o))
  if (copy.kind === 'rect' || copy.kind === 'image') {
    copy.x = 2 * cx - (copy.x + copy.w)
    return copy
  }
  if (copy.kind === 'polygon') {
    copy.vertices = copy.vertices.map(([x, y]) => [2 * cx - x, y])
    // Seating zones have directional fields that need their sign flipped so
    // the mirrored zone faces the right way and chevrons slant correctly.
    if (copy.type === 'seating') {
      if (copy.rotation     != null) copy.rotation     = -copy.rotation
      if (copy.chevronAngle != null) copy.chevronAngle = -copy.chevronAngle
      copy.result = null                 // re-solve against the mirrored polygon's obstructions
    }
    return copy
  }
  if (copy.kind === 'dim') {
    copy.x1 = 2 * cx - copy.x1
    copy.x2 = 2 * cx - copy.x2
    return copy
  }
  return null
}
