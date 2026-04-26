// Left sidebar: rooms list with new / rename / delete.

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
    const id = uid('room')
    mutateProject(p => {
      p.rooms.push({ id, name: `Room ${p.rooms.length + 1}`, objects: [] })
    })
    setState({ activeRoomId: id, selection: [] })
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
      const item = document.createElement('div')
      item.className = 'room-item' + (room.id === state.activeRoomId ? ' active' : '')
      item.innerHTML = `
        <span class="room-name" data-room-id="${room.id}">${escapeHtml(room.name)}</span>
        <span class="room-meta">${room.objects.length}</span>
        <button class="row-action" data-action="rename" title="Rename">⟳</button>
        <button class="row-action danger" data-action="delete" title="Delete">×</button>
      `
      item.querySelector('.room-name').addEventListener('click', () => {
        setState({ activeRoomId: room.id, selection: [] })
        fitToContent()
      })
      item.querySelector('[data-action="rename"]').addEventListener('click', (e) => {
        e.stopPropagation()
        const next = prompt('Room name', room.name)
        if (next && next.trim()) {
          mutateProject(p => {
            const r = p.rooms.find(r => r.id === room.id); if (r) r.name = next.trim()
          })
        }
      })
      item.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation()
        if (!confirm(`Delete "${room.name}"?`)) return
        mutateProject(p => { p.rooms = p.rooms.filter(r => r.id !== room.id) })
        if (state.activeRoomId === room.id) {
          const next = state.project.rooms[0]
          setState({ activeRoomId: next ? next.id : null, selection: [] })
        }
      })
      list.appendChild(item)
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
