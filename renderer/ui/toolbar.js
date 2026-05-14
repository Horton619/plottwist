// Top toolbar: tool selection + fit-to-content button.

import { state, setState, subscribe } from '../state.js'
import { fitToContent } from '../canvas.js'
import { cancelPolygonDraw } from '../tools/polygonTool.js'

// Tools split into two groups: VENUE (room geometry) and LAYOUT (seating).
const TOOL_GROUPS = [
  {
    label: 'Venue',
    tools: [
      { id: 'select',      label: 'Select',      hint: 'V' },
      { id: 'floor',       label: 'Floor',       hint: 'F' },
      { id: 'obstruction', label: 'Obstruction', hint: 'O' },
      { id: 'stage',       label: 'Stage',       hint: 'G' },
      { id: 'tech',        label: 'Tech',        hint: 'T' },
      { id: 'walls',       label: 'Walls',       hint: 'W' },
      { id: 'door',        label: 'Door',        hint: 'R' },
      { id: 'dim',         label: 'Dim',         hint: 'D' },
    ],
  },
  {
    label: 'Layout',
    tools: [
      { id: 'aisle',       label: 'Aisle',       hint: 'A' },
      { id: 'seating',     label: 'Seating',     hint: 'S' },
    ],
  },
]

export function initToolbar(host) {
  host.innerHTML = `
    <div class="toolbar">
      <div class="tool-stripe" data-stripe="tools"></div>
      <div class="tool-spacer"></div>
      <button class="tool-btn fit-btn" data-action="fit" title="Fit to content (⌘6)">Fit</button>
    </div>
  `
  const stripe = host.querySelector('[data-stripe="tools"]')

  TOOL_GROUPS.forEach(g => {
    const groupEl = document.createElement('div')
    groupEl.className = 'tool-group-card'
    const label = document.createElement('span')
    label.className = 'tool-group-label'
    label.textContent = g.label
    groupEl.appendChild(label)

    const btnRow = document.createElement('div')
    btnRow.className = 'tool-group-btns'
    for (const t of g.tools) {
      const btn = document.createElement('button')
      btn.className = 'tool-btn'
      btn.dataset.tool = t.id
      btn.title = `${t.label} (${t.hint})`
      btn.innerHTML = `<span class="tool-label">${t.label}</span><span class="tool-hint">${t.hint}</span>`
      btn.addEventListener('click', () => selectTool(t.id))
      btnRow.appendChild(btn)
    }
    groupEl.appendChild(btnRow)
    stripe.appendChild(groupEl)
  })
  host.querySelector('[data-action="fit"]').addEventListener('click', fitToContent)
  subscribe(render)
  render()

  function render() {
    for (const btn of stripe.querySelectorAll('.tool-btn')) {
      btn.classList.toggle('active', btn.dataset.tool === state.activeTool)
    }
  }
}

// Polygon tools: cancel an in-progress draw if you switch away from them.
const POLYGON_TOOLS = new Set(['walls'])

export function selectTool(toolId) {
  if (state.drawingPolygon && !POLYGON_TOOLS.has(toolId)) cancelPolygonDraw()
  setState({ activeTool: toolId })
}
