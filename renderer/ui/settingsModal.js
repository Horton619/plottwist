// settingsModal.js — preferences dialog with tabs.
// Opens via Cmd+, (menu event 'menu-open-settings'). Three tabs:
//   • Workspace  — origin, centerline, grid, snap (live editing tools)
//   • Defaults   — nudge amounts + per-style solver defaults + auto-save / undo
//   • Updates    — current version + manual GitHub release check

import { state, setState, mutateProject, subscribe, activeRoom } from '../state.js'
import { getSetting, setSetting, resetAllSettings, SETTINGS_DEFAULTS, onSettingsChange } from '../settings.js'
import { formatInches, parseInches } from '../units.js'
import { checkForUpdates, compareVersions } from '../updater.js'
import { loadFireCodeData, getProjectJurisdictions } from '../fireMarshal.js'
import { escapeHtml as escape } from '../strings.js'

let modalEl = null
let activeTab = 'workspace'
let currentVersion = '0.0.0'
let fireCodeData = null

export async function initSettingsModal() {
  if (window.plottwist?.getAppVersion) {
    try { currentVersion = await window.plottwist.getAppVersion() } catch {}
  }
  ensureRoot()
  // Re-render when settings or project state change.
  onSettingsChange(() => { if (isOpen()) render() })
  subscribe(() => { if (isOpen()) render() })
}

export function openSettings(tab = activeTab) {
  ensureRoot()
  activeTab = tab
  modalEl.classList.add('open')
  render()
  // Focus the active tab button so keyboard users land somewhere sensible.
  modalEl.querySelector('.settings-tab.active')?.focus()
}

export function closeSettings() {
  if (modalEl) modalEl.classList.remove('open')
}

export function isOpen() {
  return !!modalEl && modalEl.classList.contains('open')
}

function ensureRoot() {
  if (modalEl) return
  modalEl = document.createElement('div')
  modalEl.className = 'settings-modal'
  modalEl.innerHTML = `<div class="settings-overlay"></div><div class="settings-panel"></div>`
  modalEl.querySelector('.settings-overlay').addEventListener('click', closeSettings)
  document.body.appendChild(modalEl)
  // Esc closes.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen() && !state.pickMode) closeSettings()
  })
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  const panel = modalEl.querySelector('.settings-panel')
  panel.innerHTML = `
    <div class="settings-header">
      <span class="settings-title">Settings</span>
      <button class="settings-close" data-action="close" title="Close (Esc)">×</button>
    </div>
    <div class="settings-tabs">
      ${tabBtn('workspace', 'Workspace')}
      ${tabBtn('defaults',  'Defaults')}
      ${tabBtn('fireCode',  'Fire Code')}
      ${tabBtn('updates',   'Updates')}
    </div>
    <div class="settings-body" data-body></div>
    <div class="settings-footer">
      <button class="ghost-btn small" data-action="reset-all">Reset all to defaults</button>
      <button class="block-btn small" data-action="close">Done</button>
    </div>
  `
  panel.querySelector('[data-body]').appendChild(renderTab(activeTab))
  // Header / footer / tab handlers
  panel.querySelectorAll('[data-action="close"]').forEach(b => b.addEventListener('click', closeSettings))
  panel.querySelector('[data-action="reset-all"]').addEventListener('click', () => {
    if (!confirm('Reset every setting to its default? Your project data is unaffected.')) return
    resetAllSettings()
    render()
  })
  panel.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    activeTab = b.dataset.tab
    render()
  }))
}

function tabBtn(id, label) {
  return `<button class="settings-tab ${activeTab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`
}

function renderTab(id) {
  const wrap = document.createElement('div')
  wrap.className = 'settings-tab-content'
  if      (id === 'workspace') wrap.appendChild(renderWorkspaceTab())
  else if (id === 'defaults')  wrap.appendChild(renderDefaultsTab())
  else if (id === 'fireCode')  wrap.appendChild(renderFireCodeTab())
  else if (id === 'updates')   wrap.appendChild(renderUpdatesTab())
  return wrap
}

// ── Tab: Workspace ────────────────────────────────────────────────────────

function renderWorkspaceTab() {
  const room    = activeRoom()
  const origin  = room?.origin     || { x: 0, y: 0 }
  const cl      = room?.centerline || { enabled: false, x: 0, color: '#5be7d4', thickness: 1.5 }
  const roomName = room?.name || '(no room)'

  const root = document.createElement('div')
  root.className = 'settings-form'
  root.innerHTML = `
    <h3>Origin <span class="settings-room-tag">${escape(roomName)}</span></h3>
    <p class="settings-hint">Origin and centerline are per-room — pick the active room in the sidebar to edit a different one. All X/Y coordinates display relative to the origin. Set it to a known reference point (a stage corner, room center, etc.).</p>
    <div class="settings-row"><span class="settings-key">Origin X</span>
      <input class="prop-input" data-origin="x" value="${formatInches(origin.x || 0)}">
    </div>
    <div class="settings-row"><span class="settings-key">Origin Y</span>
      <input class="prop-input" data-origin="y" value="${formatInches(origin.y || 0)}">
    </div>
    <div class="settings-row settings-actions">
      <button class="ghost-btn small" data-action="set-origin">Pick on canvas…</button>
      <button class="ghost-btn small" data-action="reset-origin">Reset to (0, 0)</button>
    </div>

    <h3>Centerline</h3>
    <p class="settings-hint">A vertical reference line drawn through the venue at a chosen X position. Useful for symmetric stage layouts.</p>
    <div class="settings-row"><span class="settings-key">Show centerline</span>
      <input type="checkbox" data-centerline="enabled" ${cl.enabled ? 'checked' : ''}>
    </div>
    <div class="settings-row"><span class="settings-key">X position</span>
      <input class="prop-input" data-centerline="x" value="${formatInches(cl.x || 0)}">
    </div>
    <div class="settings-row"><span class="settings-key">Color</span>
      <input type="color" class="color-input" data-centerline="color" value="${cl.color || '#5be7d4'}">
    </div>
    <div class="settings-row"><span class="settings-key">Thickness</span>
      <input type="number" class="num-input" data-centerline="thickness" min="0.25" max="6" step="0.25" value="${cl.thickness ?? 1.5}">
    </div>
    <div class="settings-row settings-actions">
      <button class="ghost-btn small" data-action="set-centerline">Pick X on canvas…</button>
    </div>

    <h3>Grid</h3>
    <div class="settings-row"><span class="settings-key">Show grid</span>
      <input type="checkbox" data-setting="showGrid" ${getSetting('showGrid') ? 'checked' : ''}>
    </div>
    <div class="settings-row"><span class="settings-key">Spacing</span>
      <select class="select-input" data-setting="gridSpacing">
        ${gridOption('auto', 'Auto')}
        ${gridOption('12',   '1\'-0"')}
        ${gridOption('24',   '2\'-0"')}
        ${gridOption('60',   '5\'-0"')}
        ${gridOption('120',  '10\'-0"')}
      </select>
    </div>

    <h3>Snap</h3>
    <div class="settings-row"><span class="settings-key">Enable anchor snap</span>
      <input type="checkbox" data-setting="snapEnabled" ${getSetting('snapEnabled') ? 'checked' : ''}>
    </div>
    <div class="settings-row"><span class="settings-key">Tolerance (px)</span>
      <input type="number" class="num-input" data-setting="snapTolerance" min="2" max="32" step="1" value="${getSetting('snapTolerance')}">
    </div>
  `

  // Live origin / centerline writes into the active room.
  const withActiveRoom = (fn) => mutateProject(p => {
    const rm = p.rooms.find(r => r.id === state.activeRoomId)
    if (!rm) return
    fn(rm)
  })
  root.querySelectorAll('[data-origin]').forEach(inp => {
    const axis = inp.dataset.origin
    inp.addEventListener('change', () => {
      const v = parseInches(inp.value)
      if (v == null) return
      withActiveRoom(rm => {
        if (!rm.origin) rm.origin = { x: 0, y: 0 }
        rm.origin[axis] = v
      })
    })
  })
  root.querySelectorAll('[data-centerline]').forEach(inp => {
    const field = inp.dataset.centerline
    inp.addEventListener('change', () => {
      withActiveRoom(rm => {
        if (!rm.centerline) rm.centerline = { enabled: false, x: 0, color: '#5be7d4', thickness: 1.5 }
        if (field === 'enabled')   rm.centerline.enabled = inp.checked
        else if (field === 'color') rm.centerline.color  = inp.value
        else if (field === 'thickness') rm.centerline.thickness = parseFloat(inp.value)
        else if (field === 'x') {
          const v = parseInches(inp.value)
          if (v != null) rm.centerline.x = v
        }
      })
    })
  })

  // Pick-on-canvas modes.
  root.querySelector('[data-action="set-origin"]').addEventListener('click', () => {
    setState({ pickMode: 'origin' })
    closeSettings()
  })
  root.querySelector('[data-action="set-centerline"]').addEventListener('click', () => {
    setState({ pickMode: 'centerline' })
    closeSettings()
  })
  root.querySelector('[data-action="reset-origin"]').addEventListener('click', () => {
    withActiveRoom(rm => { rm.origin = { x: 0, y: 0 } })
  })

  wireSettingInputs(root)
  return root
}

// ── Tab: Defaults ─────────────────────────────────────────────────────────

function renderDefaultsTab() {
  const root = document.createElement('div')
  root.className = 'settings-form'
  root.innerHTML = `
    <h3>Nudge</h3>
    <p class="settings-hint">Arrow keys move selected objects by these amounts. Shift+arrow uses the larger value.</p>
    ${inchRow('Small (arrow)',         'nudgeSmall')}
    ${inchRow('Large (shift+arrow)',   'nudgeLarge')}

    <h3>Theater</h3>
    ${inchRow('Row pitch',             'defaultTheaterRowSpacing')}

    <h3>Classroom</h3>
    ${inchRow('Row pitch',             'defaultClassroomRowSpacing')}

    <h3>Aisles &amp; Mixed</h3>
    ${inchRow('Aisle width',           'defaultAisleWidth')}
    ${inchRow('Mixed transition gap',  'defaultMixedTransitionGap')}

    <h3>Rounds</h3>
    ${inchRow('Default size',          'defaultRoundTableSize')}
    <div class="settings-row"><span class="settings-key">Default chair count</span>
      <input type="number" class="num-input" data-setting="defaultRoundChairCount" min="2" max="20" step="1" value="${getSetting('defaultRoundChairCount')}">
    </div>
    ${inchRow('Default table spacing', 'defaultRoundTableSpacing')}

    <h3>Project</h3>
    <div class="settings-row"><span class="settings-key">Auto-save</span>
      <select class="select-input" data-setting="autoSaveInterval">
        <option value="0"  ${getSetting('autoSaveInterval') === 0  ? 'selected' : ''}>Off</option>
        <option value="1"  ${getSetting('autoSaveInterval') === 1  ? 'selected' : ''}>Every 1 minute</option>
        <option value="5"  ${getSetting('autoSaveInterval') === 5  ? 'selected' : ''}>Every 5 minutes</option>
        <option value="15" ${getSetting('autoSaveInterval') === 15 ? 'selected' : ''}>Every 15 minutes</option>
      </select>
    </div>
    <div class="settings-row"><span class="settings-key">Undo history depth</span>
      <input type="number" class="num-input" data-setting="undoDepth" min="10" max="500" step="10" value="${getSetting('undoDepth')}">
    </div>
  `
  wireSettingInputs(root)
  return root
}

// ── Tab: Fire Code ────────────────────────────────────────────────────────

function renderFireCodeTab() {
  const root = document.createElement('div')
  root.className = 'settings-form'

  // Lazy-load the JSON; show a spinner placeholder until it's in.
  if (!fireCodeData) {
    root.innerHTML = `<p class="settings-hint">Loading fire code data…</p>`
    loadFireCodeData().then(d => { fireCodeData = d; if (isOpen() && activeTab === 'fireCode') render() })
                      .catch(err => { root.innerHTML = `<p class="settings-hint warn">Couldn't load: ${err.message}</p>` })
    return root
  }

  const active = new Set(getProjectJurisdictions(state.project))
  const jurisdictionsHtml = Object.entries(fireCodeData.jurisdictions).map(([id, j]) => `
    <label class="fc-juris-row">
      <input type="checkbox" data-juris="${id}" ${active.has(id) ? 'checked' : ''}>
      <div class="fc-juris-body">
        <div class="fc-juris-name">${escape(j.name)}</div>
        <div class="fc-juris-basis">${escape(j.basis)}</div>
      </div>
    </label>
  `).join('')

  root.innerHTML = `
    <h3>Active Jurisdictions</h3>
    <p class="settings-hint">When the Fire Marshal Check runs, the strictest active jurisdiction wins per rule. These are stored on the project so they travel with the .ptwist file.</p>
    <div class="fc-juris-list">${jurisdictionsHtml}</div>

    <h3>Notes</h3>
    <p class="settings-hint">Defaults are seeded from public code references (IBC 2018, NFPA 101, FBC, CBC, Chicago Construction Code) and banquet planning conventions. <b>Verify with your AHJ before relying on this.</b></p>
    <p class="settings-hint">Per-rule overrides aren't editable in v1 — open <code>data/fireCode.json</code> if you need to tweak a value.</p>

    <h3>Rules in v1</h3>
    <ul class="fc-rule-list">
      ${Object.entries(fireCodeData.rules).map(([id, r]) =>
        `<li><b>${escape(r.label)}</b><span class="fc-rule-applies">${(r.appliesTo || []).join(' / ')}</span><div class="fc-rule-desc">${escape(r.description || '')}</div></li>`
      ).join('')}
    </ul>
  `

  root.querySelectorAll('[data-juris]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.juris
      mutateProject(p => {
        if (!p.fireCode) p.fireCode = { jurisdictions: [] }
        if (!Array.isArray(p.fireCode.jurisdictions)) p.fireCode.jurisdictions = []
        const set = new Set(p.fireCode.jurisdictions)
        if (cb.checked) set.add(id)
        else            set.delete(id)
        p.fireCode.jurisdictions = Array.from(set)
      })
    })
  })
  return root
}

// ── Tab: Updates ──────────────────────────────────────────────────────────

function renderUpdatesTab() {
  const root = document.createElement('div')
  root.className = 'settings-form'
  root.innerHTML = `
    <h3>Updates</h3>
    <div class="settings-row"><span class="settings-key">Current version</span>
      <span class="prop-val">v${currentVersion}</span>
    </div>
    <div class="settings-row"><span class="settings-key">Auto-check on launch</span>
      <input type="checkbox" data-setting="autoCheckUpdates" ${getSetting('autoCheckUpdates') ? 'checked' : ''}>
    </div>
    <div class="settings-row settings-actions">
      <button class="block-btn small" data-action="check-updates">Check for updates now</button>
    </div>
    <div class="settings-update-status" data-update-line></div>
    <div class="settings-update-progress" data-update-progress hidden>
      <div class="settings-update-progress-bar"><span data-bar-fill></span></div>
      <div class="settings-update-progress-text" data-bar-text></div>
    </div>
    <div class="settings-row update-status" data-status></div>
  `
  wireSettingInputs(root)
  // Listen to the autoUpdater event stream forwarded by the main process.
  // Paints the line + progress bar live; banner is shown by app.js.
  const lineEl     = root.querySelector('[data-update-line]')
  const progressEl = root.querySelector('[data-update-progress]')
  const barFillEl  = root.querySelector('[data-bar-fill]')
  const barTextEl  = root.querySelector('[data-bar-text]')
  const paint = (s) => {
    if (!s) return
    progressEl.hidden = !(s.type === 'available' || s.type === 'progress' || s.type === 'downloaded')
    if (s.type === 'checking')        lineEl.textContent = 'Checking GitHub Releases…'
    else if (s.type === 'not-available') lineEl.textContent = 'You have the latest version.'
    else if (s.type === 'available') {
      lineEl.innerHTML = `<span class="accent">Update available: v${escape(s.version)} — downloading…</span>`
      barFillEl.style.width = '0%'; barTextEl.textContent = 'Starting…'
    }
    else if (s.type === 'progress') {
      barFillEl.style.width = `${Math.min(100, Math.max(0, s.percent || 0))}%`
      barTextEl.textContent = formatProgress(s)
    }
    else if (s.type === 'downloaded') {
      lineEl.innerHTML = `<span class="accent">v${escape(s.version)} ready — see banner above.</span>`
      barFillEl.style.width = '100%'; barTextEl.textContent = 'Download complete'
    }
    else if (s.type === 'error') {
      lineEl.innerHTML = `<span class="warn">Update error: ${escape(s.message)}</span>`
    }
  }
  // Repaint immediately with whatever the last state was (modal may open mid-flight).
  if (typeof window !== 'undefined' && window.__plottwistUpdateStatus) paint(window.__plottwistUpdateStatus)
  const onStatus = (e) => paint(e.detail)
  window.addEventListener('plottwist:update-status', onStatus)
  // Update the global cache so future modal opens see latest.
  window.addEventListener('plottwist:update-status', (e) => { window.__plottwistUpdateStatus = e.detail })

  root.querySelector('[data-action="check-updates"]').addEventListener('click', async () => {
    const status = root.querySelector('[data-status]')
    status.textContent = 'Checking…'
    // Trigger the real auto-updater check too — it'll stream events through paint().
    if (window.plottwist?.checkForUpdates) window.plottwist.checkForUpdates().catch(() => {})
    // And the renderer-side GitHub REST fallback for the "View release" link,
    // since the main-process path doesn't expose a release URL.
    const res = await checkForUpdates(currentVersion)
    if (!res.ok) {
      status.innerHTML = `<span class="warn">Couldn't reach GitHub: ${escape(res.error)}</span>`
      return
    }
    if (res.isNewer) {
      status.innerHTML = `<span class="accent">Update available: ${escape(res.latest)}</span>
        <button class="block-btn small" data-action="open-release">View release</button>
        <button class="block-btn small" data-action="download-now">Download &amp; install</button>`
      status.querySelector('[data-action="open-release"]').addEventListener('click', () => {
        if (window.plottwist?.openExternal) window.plottwist.openExternal(res.url)
        else window.open(res.url, '_blank')
      })
      status.querySelector('[data-action="download-now"]').addEventListener('click', () => {
        window.plottwist?.downloadUpdate?.()
      })
    } else {
      status.textContent = `You're on the latest release (${res.latest}).`
    }
  })
  return root
}

function formatProgress(s) {
  const pct  = Math.round(s.percent || 0)
  const mb   = (n) => (n / 1024 / 1024).toFixed(1) + ' MB'
  const speed = (s.bytesPerSecond > 1024 * 1024)
    ? `${(s.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
    : `${Math.round(s.bytesPerSecond / 1024)} KB/s`
  const etaSec = s.bytesPerSecond > 0 ? Math.max(0, (s.total - s.transferred) / s.bytesPerSecond) : 0
  const eta = etaSec < 60 ? `~${Math.round(etaSec)}s left`
            : `~${Math.floor(etaSec / 60)}m ${Math.round(etaSec % 60)}s left`
  const parts = [`${pct}%`, `${mb(s.transferred)} / ${mb(s.total)}`, speed]
  if (s.bytesPerSecond > 0) parts.push(eta)
  return parts.join('  ·  ')
}

// ── Helpers ────────────────────────────────────────────────────────────────

function gridOption(value, label) {
  const cur = String(getSetting('gridSpacing'))
  return `<option value="${value}" ${cur === value ? 'selected' : ''}>${label}</option>`
}

function inchRow(label, key) {
  return `
    <div class="settings-row"><span class="settings-key">${label}</span>
      <input class="prop-input" data-setting-inches="${key}" value="${formatInches(getSetting(key))}">
    </div>
  `
}

function wireSettingInputs(root) {
  // Generic setSetting writers based on data-setting attribute.
  root.querySelectorAll('[data-setting]').forEach(inp => {
    const key = inp.dataset.setting
    const handler = () => {
      let v
      if (inp.type === 'checkbox')      v = inp.checked
      else if (inp.type === 'number')   v = parseFloat(inp.value)
      else if (inp.tagName === 'SELECT') {
        v = inp.value
        // Coerce numeric-string options to numbers (gridSpacing 'auto' stays a string).
        if (v !== 'auto' && /^-?\d+(?:\.\d+)?$/.test(v)) v = parseFloat(v)
      } else v = inp.value
      setSetting(key, v)
    }
    inp.addEventListener('change', handler)
  })
  root.querySelectorAll('[data-setting-inches]').forEach(inp => {
    const key = inp.dataset.settingInches
    const handler = () => {
      const v = parseInches(inp.value)
      if (v != null) setSetting(key, v)
    }
    inp.addEventListener('change', handler)
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { handler(); inp.blur() } })
  })
}
