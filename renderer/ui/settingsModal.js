// settingsModal.js — preferences dialog with tabs.
// Opens via Cmd+, (menu event 'menu-open-settings'). Three tabs:
//   • Workspace  — origin, centerline, grid, snap (live editing tools)
//   • Defaults   — nudge amounts + per-style solver defaults + auto-save / undo
//   • Updates    — current version + manual GitHub release check

import { state, setState, mutateProject, subscribe } from '../state.js'
import { getSetting, setSetting, resetAllSettings, SETTINGS_DEFAULTS, onSettingsChange } from '../settings.js'
import { formatInches, parseInches } from '../units.js'
import { checkForUpdates, compareVersions } from '../updater.js'

let modalEl = null
let activeTab = 'workspace'
let currentVersion = '0.0.0'

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
  else if (id === 'updates')   wrap.appendChild(renderUpdatesTab())
  return wrap
}

// ── Tab: Workspace ────────────────────────────────────────────────────────

function renderWorkspaceTab() {
  const project = state.project
  const origin  = project.origin || { x: 0, y: 0 }
  const cl      = project.centerline || { enabled: false, x: 0, color: '#5be7d4', thickness: 1.5 }

  const root = document.createElement('div')
  root.className = 'settings-form'
  root.innerHTML = `
    <h3>Origin</h3>
    <p class="settings-hint">All X/Y coordinates display relative to the origin. Set it to a known reference point (a stage corner, room center, etc.) so layouts read in meaningful units.</p>
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

  // Live origin / centerline writes into project.
  root.querySelectorAll('[data-origin]').forEach(inp => {
    const axis = inp.dataset.origin
    inp.addEventListener('change', () => {
      const v = parseInches(inp.value)
      if (v == null) return
      mutateProject(p => {
        if (!p.origin) p.origin = { x: 0, y: 0 }
        p.origin[axis] = v
      })
    })
  })
  root.querySelectorAll('[data-centerline]').forEach(inp => {
    const field = inp.dataset.centerline
    inp.addEventListener('change', () => {
      mutateProject(p => {
        if (!p.centerline) p.centerline = { enabled: false, x: 0, color: '#5be7d4', thickness: 1.5 }
        if (field === 'enabled')   p.centerline.enabled = inp.checked
        else if (field === 'color') p.centerline.color  = inp.value
        else if (field === 'thickness') p.centerline.thickness = parseFloat(inp.value)
        else if (field === 'x') {
          const v = parseInches(inp.value)
          if (v != null) p.centerline.x = v
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
    mutateProject(p => { p.origin = { x: 0, y: 0 } })
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
    <div class="settings-row update-status" data-status></div>
  `
  wireSettingInputs(root)
  root.querySelector('[data-action="check-updates"]').addEventListener('click', async () => {
    const status = root.querySelector('[data-status]')
    status.textContent = 'Checking…'
    const res = await checkForUpdates(currentVersion)
    if (!res.ok) {
      status.innerHTML = `<span class="warn">Couldn't reach GitHub: ${res.error}</span>`
      return
    }
    if (res.isNewer) {
      status.innerHTML = `<span class="accent">Update available: ${res.latest}</span>
        <button class="block-btn small" data-action="open-release">View release</button>`
      status.querySelector('[data-action="open-release"]').addEventListener('click', () => {
        if (window.plottwist?.openExternal) window.plottwist.openExternal(res.url)
        else window.open(res.url, '_blank')
      })
    } else {
      status.textContent = `You're on the latest release (${res.latest}).`
    }
  })
  return root
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
