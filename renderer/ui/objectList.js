// Photoshop-style layers panel. Top of list = top of z-order.

import { state, setState, subscribe, mutateProject, activeRoom, objectName, reorderObject, TYPE_STYLES } from '../state.js'
import { duplicateObjectById, deleteObjectById } from '../app.js'
import { ICON } from './icons.js'

export function initObjectList(host) {
  host.innerHTML = `
    <div class="layers-panel">
      <div class="layers-header">
        <span class="layers-title">Layers</span>
        <button class="header-btn" data-action="add-image" title="Insert image (⌘⇧I)">Import Image</button>
      </div>
      <div class="layers-list" data-list></div>
    </div>
  `
  host.querySelector('[data-action="add-image"]').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('plottwist:insert-image'))
  })

  // Single document-level listener for the right-click menu (the menu itself
  // lives outside the panel so it can overflow into the canvas if needed).
  document.addEventListener('click', dismissContextMenu)

  subscribe(render)
  render()

  function render() {
    const list = host.querySelector('[data-list]')
    list.innerHTML = ''
    const room = activeRoom()
    if (!room) return
    if (!room.objects.length) {
      const empty = document.createElement('div')
      empty.className = 'layers-empty'
      empty.textContent = 'No objects yet.'
      list.appendChild(empty)
      return
    }
    // Top of stack first (rendered last, painted on top).
    for (let i = room.objects.length - 1; i >= 0; i--) {
      list.appendChild(buildRow(room.objects[i], i))
    }
  }

  function buildRow(o, idx) {
    const room = activeRoom()
    const row = document.createElement('div')
    row.className = 'layer-row'
    row.classList.toggle('active', state.selection.includes(o.id))
    row.classList.toggle('hidden', !!o.hidden)
    row.classList.toggle('locked', !!o.locked)
    row.draggable = true
    row.dataset.index = idx
    row.dataset.objectId = o.id

    const typeLabel = (TYPE_STYLES[o.type] && TYPE_STYLES[o.type].label) || o.type
    const swatchColor = (TYPE_STYLES[o.type] && TYPE_STYLES[o.type].stroke !== 'none')
      ? TYPE_STYLES[o.type].stroke
      : '#98a0b3'

    row.innerHTML = `
      <button class="layer-toggle vis ${o.hidden ? 'off' : 'on'}" data-action="toggle-hidden" title="${o.hidden ? 'Show' : 'Hide'}">${o.hidden ? ICON.eyeClosed : ICON.eyeOpen}</button>
      <button class="layer-toggle lk  ${o.locked ? 'on' : 'off'}" data-action="toggle-locked" title="${o.locked ? 'Unlock' : 'Lock'}">${o.locked ? ICON.lockClosed : ICON.lockOpen}</button>
      <span class="layer-swatch" style="background:${swatchColor}"></span>
      <span class="layer-name" title="Double-click to rename">${escapeHtml(objectName(o, room))}</span>
      <span class="layer-type">${typeLabel}</span>
    `

    row.querySelector('[data-action="toggle-hidden"]').addEventListener('click', (e) => {
      e.stopPropagation()
      mutateProject(() => { o.hidden = !o.hidden })
    })
    row.querySelector('[data-action="toggle-locked"]').addEventListener('click', (e) => {
      e.stopPropagation()
      mutateProject(() => { o.locked = !o.locked })
    })

    row.addEventListener('click', (e) => {
      const additive = e.shiftKey || e.metaKey || e.ctrlKey
      let sel = state.selection.slice()
      if (additive) {
        if (sel.includes(o.id)) sel = sel.filter(i => i !== o.id)
        else sel.push(o.id)
      } else {
        sel = [o.id]
      }
      setState({ selection: sel })
    })

    const nameEl = row.querySelector('.layer-name')
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      const next = prompt('Layer name', objectName(o, room))
      if (next != null && next.trim()) {
        mutateProject(() => { o.name = next.trim() })
      }
    })

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      // If we right-click an unselected layer, select it first.
      if (!state.selection.includes(o.id)) setState({ selection: [o.id] })
      showLayerMenu(e.clientX, e.clientY, o)
    })

    // Drag-reorder
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-layer-idx', String(idx))
      e.dataTransfer.effectAllowed = 'move'
      row.classList.add('dragging')
    })
    row.addEventListener('dragend', () => row.classList.remove('dragging'))
    row.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = row.getBoundingClientRect()
      const above = (e.clientY - rect.top) < rect.height / 2
      row.classList.toggle('drop-above', above)
      row.classList.toggle('drop-below', !above)
    })
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'))
    row.addEventListener('drop', (e) => {
      e.preventDefault()
      row.classList.remove('drop-above', 'drop-below')
      const fromIdx = parseInt(e.dataTransfer.getData('text/x-layer-idx'), 10)
      if (isNaN(fromIdx)) return
      const rect = row.getBoundingClientRect()
      const above = (e.clientY - rect.top) < rect.height / 2
      // List is reversed — visually-above means a HIGHER array index.
      let toIdx = above ? idx + 1 : idx
      if (fromIdx < toIdx) toIdx -= 1
      if (fromIdx === toIdx) return
      mutateProject(() => {
        const r = activeRoom()
        if (r) reorderObject(r, fromIdx, Math.max(0, Math.min(r.objects.length - 1, toIdx)))
      })
    })

    return row
  }
}

// ── Tiny floating context menu ────────────────────────────────────────────

let openMenuEl = null

function showLayerMenu(x, y, obj) {
  dismissContextMenu()
  const menu = document.createElement('div')
  menu.className = 'context-menu'
  menu.innerHTML = `
    <button data-act="duplicate">Duplicate</button>
    <button data-act="delete">Delete</button>
  `
  menu.style.left = `${x}px`
  menu.style.top  = `${y}px`
  document.body.appendChild(menu)
  openMenuEl = menu

  // Clamp to viewport
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect()
    if (r.right > window.innerWidth)  menu.style.left = `${window.innerWidth  - r.width  - 8}px`
    if (r.bottom > window.innerHeight) menu.style.top  = `${window.innerHeight - r.height - 8}px`
  })

  menu.addEventListener('click', (ev) => {
    const act = ev.target && ev.target.dataset && ev.target.dataset.act
    if (!act) return
    if (act === 'duplicate') duplicateObjectById(obj.id)
    if (act === 'delete')    deleteObjectById(obj.id)
    dismissContextMenu()
  })
}

function dismissContextMenu() {
  if (openMenuEl) { openMenuEl.remove(); openMenuEl = null }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
