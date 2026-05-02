// Left sidebar: rooms with nested layouts. Each layout has independent eye/lock controls.

import { state, setState, subscribe, mutateProject, uid } from '../state.js'
import { fitToContent } from '../canvas.js'

export function initProjectSidebar(host) {
  host.innerHTML = `
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Rooms</span>
        <button class="ghost-btn" data-action="new-room" title="New room">＋</button>
      </div>
      <div class="room-list" data-list="rooms"></div>
    </div>
  `
  host.querySelector('[data-action="new-room"]').addEventListener('click', () => {
    const roomId   = uid('room')
    const layoutId = uid('layout')
    mutateProject(p => {
      p.rooms.push({
        id: roomId,
        name: `Room ${p.rooms.length + 1}`,
        objects: [],
        layouts: [{ id: layoutId, name: 'Layout 1', hidden: false, locked: false, objects: [] }],
      })
    })
    setState({ activeRoomId: roomId, activeLayoutId: layoutId, selection: [] })
    fitToContent()
  })

  subscribe(render)
  render()

  function render() {
    const list = host.querySelector('[data-list="rooms"]')
    list.innerHTML = ''
    if (!state.project.rooms.length) {
      const empty = document.createElement('div')
      empty.className = 'sidebar-empty'
      empty.textContent = 'No rooms yet. Click + to start.'
      list.appendChild(empty)
      return
    }
    for (const room of state.project.rooms) {
      list.appendChild(buildRoomBlock(room))
    }
  }

  // ── Room block ─────────────────────────────────────────────────────────────

  function buildRoomBlock(room) {
    const isActiveRoom = room.id === state.activeRoomId
    const block = document.createElement('div')
    block.className = 'room-block'

    // Room header row
    const roomRow = document.createElement('div')
    roomRow.className = 'room-item' + (isActiveRoom ? ' active' : '')
    roomRow.innerHTML = `
      <span class="room-name">${escapeHtml(room.name)}</span>
      <span class="room-meta">${(room.objects.length + (room.layouts || []).reduce((a, l) => a + l.objects.length, 0))}</span>
      <button class="row-action" data-action="rename-room" title="Rename">⟳</button>
      <button class="row-action danger" data-action="delete-room" title="Delete">×</button>
    `
    roomRow.querySelector('.room-name').addEventListener('click', () => {
      // Activating a room: keep current layout if it belongs to this room,
      // otherwise switch to the room's first layout.
      const layouts = room.layouts || []
      const keepLayout = layouts.find(l => l.id === state.activeLayoutId)
      const newLayout = keepLayout || layouts[0] || null
      setState({ activeRoomId: room.id, activeLayoutId: newLayout ? newLayout.id : null, selection: [] })
      fitToContent()
    })
    roomRow.querySelector('[data-action="rename-room"]').addEventListener('click', (e) => {
      e.stopPropagation()
      const next = prompt('Room name', room.name)
      if (next && next.trim()) {
        mutateProject(p => { const r = p.rooms.find(r => r.id === room.id); if (r) r.name = next.trim() })
      }
    })
    roomRow.querySelector('[data-action="delete-room"]').addEventListener('click', (e) => {
      e.stopPropagation()
      if (!confirm(`Delete "${room.name}" and all its layouts?`)) return
      mutateProject(p => { p.rooms = p.rooms.filter(r => r.id !== room.id) })
      if (state.activeRoomId === room.id) {
        const next = state.project.rooms[0]
        const nextLayout = next?.layouts?.[0] || null
        setState({ activeRoomId: next ? next.id : null, activeLayoutId: nextLayout ? nextLayout.id : null, selection: [] })
      }
    })
    block.appendChild(roomRow)

    // Layout rows (only shown when this room is active)
    if (isActiveRoom) {
      const layoutsEl = document.createElement('div')
      layoutsEl.className = 'layout-list'

      const layouts = room.layouts || []
      for (const layout of layouts) {
        layoutsEl.appendChild(buildLayoutRow(room, layout))
      }

      // + Add Layout button
      const addBtn = document.createElement('button')
      addBtn.className = 'add-layout-btn'
      addBtn.textContent = '+ Add Layout'
      addBtn.addEventListener('click', () => {
        const newId = uid('layout')
        const count = (room.layouts || []).length + 1
        mutateProject(p => {
          const r = p.rooms.find(r => r.id === room.id)
          if (!r.layouts) r.layouts = []
          r.layouts.push({ id: newId, name: `Layout ${count}`, hidden: false, locked: false, objects: [] })
        })
        setState({ activeLayoutId: newId, selection: [] })
      })
      layoutsEl.appendChild(addBtn)
      block.appendChild(layoutsEl)
    }

    return block
  }

  // ── Layout row ─────────────────────────────────────────────────────────────

  function buildLayoutRow(room, layout) {
    const isActive = layout.id === state.activeLayoutId
    const row = document.createElement('div')
    row.className = 'layout-item' + (isActive ? ' active' : '') + (layout.hidden ? ' hidden-layout' : '')

    row.innerHTML = `
      <span class="layout-dot" title="${isActive ? 'Active layout' : 'Click to activate'}"></span>
      <span class="layout-name">${escapeHtml(layout.name)}</span>
      <span class="layout-meta">${layout.objects.length}</span>
      <button class="layout-toggle vis ${layout.hidden ? 'off' : 'on'}" data-action="toggle-hidden" title="${layout.hidden ? 'Show' : 'Hide'}">${layout.hidden ? eyeClosedSvg() : eyeOpenSvg()}</button>
      <button class="layout-toggle lk  ${layout.locked ? 'on' : 'off'}" data-action="toggle-locked" title="${layout.locked ? 'Unlock' : 'Lock'}">${layout.locked ? lockClosedSvg() : lockOpenSvg()}</button>
      <button class="row-action" data-action="rename-layout" title="Rename">⟳</button>
      <button class="row-action danger" data-action="delete-layout" title="Delete">×</button>
    `

    // Clicking anywhere on the row (except buttons) activates the layout
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return
      setState({ activeLayoutId: layout.id, selection: [] })
    })

    row.querySelector('[data-action="toggle-hidden"]').addEventListener('click', (e) => {
      e.stopPropagation()
      mutateProject(() => { layout.hidden = !layout.hidden })
    })
    row.querySelector('[data-action="toggle-locked"]').addEventListener('click', (e) => {
      e.stopPropagation()
      mutateProject(() => { layout.locked = !layout.locked })
    })
    row.querySelector('[data-action="rename-layout"]').addEventListener('click', (e) => {
      e.stopPropagation()
      const next = prompt('Layout name', layout.name)
      if (next && next.trim()) {
        mutateProject(() => { layout.name = next.trim() })
      }
    })
    row.querySelector('[data-action="delete-layout"]').addEventListener('click', (e) => {
      e.stopPropagation()
      const layouts = room.layouts || []
      if (layouts.length <= 1) { alert("A room needs at least one layout."); return }
      if (!confirm(`Delete layout "${layout.name}"?`)) return
      mutateProject(p => {
        const r = p.rooms.find(r => r.id === room.id)
        r.layouts = r.layouts.filter(l => l.id !== layout.id)
      })
      // If we deleted the active layout, switch to the first remaining one.
      if (state.activeLayoutId === layout.id) {
        const remaining = state.project.rooms.find(r => r.id === room.id)?.layouts || []
        setState({ activeLayoutId: remaining[0]?.id ?? null, selection: [] })
      }
    })

    return row
  }
}

// ── Tiny inline SVG icons (same style as objectList) ───────────────────────

function eyeOpenSvg() {
  return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="8" cy="8" rx="5" ry="3.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/></svg>`
}
function eyeClosedSvg() {
  return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8 C4 4 12 4 14 8"/><line x1="4" y1="10" x2="3" y2="12"/><line x1="8" y1="11" x2="8" y2="13"/><line x1="12" y1="10" x2="13" y2="12"/></svg>`
}
function lockClosedSvg() {
  return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>`
}
function lockOpenSvg() {
  return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0" /></svg>`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
