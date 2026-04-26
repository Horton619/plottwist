// Top toolbar: tool selection + fit-to-content button.

import { state, setState, subscribe } from '../state.js'
import { fitToContent } from '../canvas.js'
import { cancelPolygonDraw } from '../tools/polygonTool.js'

const TOOLS = [
  { id: 'select',      label: 'Select',      hint: 'V' },
  { id: 'floor',       label: 'Floor',       hint: 'F' },
  { id: 'aisle',       label: 'Aisle',       hint: 'A' },
  { id: 'obstruction', label: 'Obstruction', hint: 'O' },
  { id: 'stage',       label: 'Stage',       hint: 'G' },
  { id: 'tech',        label: 'Tech Table',  hint: 'T' },
  { id: 'walls',       label: 'Walls',       hint: 'W' },
]

export function initToolbar(host) {
  host.innerHTML = `
    <div class="toolbar">
      <div class="tool-group" data-group="tools"></div>
      <div class="tool-divider"></div>
      <button class="tool-btn" data-action="fit" title="Fit to content (⌘6)">Fit</button>
    </div>
  `
  const group = host.querySelector('[data-group="tools"]')
  for (const t of TOOLS) {
    const btn = document.createElement('button')
    btn.className = 'tool-btn'
    btn.dataset.tool = t.id
    btn.title = `${t.label} (${t.hint})`
    btn.innerHTML = `<span class="tool-label">${t.label}</span><span class="tool-hint">${t.hint}</span>`
    btn.addEventListener('click', () => selectTool(t.id))
    group.appendChild(btn)
  }
  host.querySelector('[data-action="fit"]').addEventListener('click', fitToContent)
  subscribe(render)
  render()

  function render() {
    for (const btn of group.querySelectorAll('.tool-btn')) {
      btn.classList.toggle('active', btn.dataset.tool === state.activeTool)
    }
  }
}

export function selectTool(toolId) {
  if (state.drawingPolygon && toolId !== 'walls') cancelPolygonDraw()
  setState({ activeTool: toolId })
}
