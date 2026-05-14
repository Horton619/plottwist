// fireMarshalSheet.js — overlay panel that lists fire-code violations after
// the user runs Tools → Fire Marshal Check…. Each violation shows its
// citation; clicking a row pans/zooms the canvas to the violation anchor and
// flashes the matching magenta callout.

import { state, setState, subscribe } from '../state.js'
import { loadFireCodeData, runFireMarshal, getProjectJurisdictions } from '../fireMarshal.js'
import { openSettings } from './settingsModal.js'
import { escapeHtml as escape } from '../strings.js'

let sheetEl  = null
let dataRef  = null   // cached fire-code JSON

export async function initFireMarshalSheet() {
  ensureRoot()
  // Re-render on every state change. Two extra behaviors layered on top:
  //   • If the sheet is open and project mutations changed the jurisdictions
  //     since the last validator run, re-run the validator so toggling AHJs
  //     in Settings live-updates the open report.
  //   • render() handles both open and closed states (showing/hiding the
  //     panel + clearing innerHTML) — never gate on isOpen() here, otherwise
  //     close transitions don't paint.
  subscribe(() => {
    render()
    if (!isOpen() || !dataRef) return
    const active  = getProjectJurisdictions(state.project)
    const lastIds = state.fireMarshal?.result?.activeIds || []
    if (JSON.stringify(active) !== JSON.stringify(lastIds)) {
      const result = runFireMarshal(state.project, state.activeLayoutId, active, dataRef)
      setState({ fireMarshal: { ...state.fireMarshal, result } })
    }
  })
  // Esc closes the sheet — matches the Settings + Export modals.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen() && !state.pickMode) closeSheet()
  })
}

export async function runAndShow() {
  ensureRoot()
  if (!dataRef) {
    try { dataRef = await loadFireCodeData() }
    catch (err) {
      alert('Couldn\'t load fire-code data:\n' + err.message)
      return
    }
  }
  const active = getProjectJurisdictions(state.project)
  const result = runFireMarshal(state.project, state.activeLayoutId, active, dataRef)
  setState({ fireMarshal: { ...(state.fireMarshal || {}), result, open: true, focusedId: null } })
  // Land focus on the first violation row (or the Re-run button if none).
  setTimeout(() => sheetEl?.querySelector('.fm-row, [data-action="rerun"]')?.focus(), 0)
}

export function closeSheet() {
  setState({ fireMarshal: { ...(state.fireMarshal || {}), open: false, focusedId: null } })
  // Belt-and-suspenders: even though render() will be called by the subscribe,
  // pull the panel out of the DOM flow immediately so the close feels snappy.
  if (sheetEl) {
    sheetEl.classList.remove('open')
    sheetEl.innerHTML = ''
  }
}

export function isOpen() {
  return !!(state.fireMarshal && state.fireMarshal.open)
}

function ensureRoot() {
  if (sheetEl) return
  sheetEl = document.createElement('div')
  sheetEl.className = 'fire-marshal-sheet'
  document.body.appendChild(sheetEl)
}

function render() {
  if (!sheetEl) return
  if (!isOpen()) { sheetEl.classList.remove('open'); sheetEl.innerHTML = ''; return }
  sheetEl.classList.add('open')
  const result = state.fireMarshal?.result
  if (!result) return

  const focusedId = state.fireMarshal?.focusedId

  const header = `
    <div class="fm-header">
      <div class="fm-title">
        <span class="fm-stripe"></span>
        Fire Marshal Report
      </div>
      <button class="fm-close" data-action="close" title="Close">×</button>
    </div>
  `
  // Special case: no jurisdictions active. Don't show the green ✓ — that
  // reads as "you're good", but it's actually "we have no rules to apply."
  const noJurisdictions = !result.jurisdictions.length

  const jurisdictionsLine = !noJurisdictions
    ? `<div class="fm-jurisdictions">
         ${result.jurisdictions.map(j =>
           `<span class="fm-chip">${escape(j.name)}</span>`
         ).join('')}
       </div>`
    : ''

  const summary = result.summary
  const fmtIn = (n) => {
    const ft = Math.floor(n / 12)
    const inch = Math.round(n - ft * 12)
    if (!ft) return `${inch}″`
    return inch ? `${ft}′-${inch}″` : `${ft}′-0″`
  }
  const capacityLine = noJurisdictions ? '' : `
    <div class="fm-capacity">
      <div class="fm-capacity-cell">
        <span class="fm-capacity-key">Occupancy</span>
        <span class="fm-capacity-val">${summary.occupancy}</span>
      </div>
      <div class="fm-capacity-cell">
        <span class="fm-capacity-key">Egress required</span>
        <span class="fm-capacity-val">${summary.egressRequired ? fmtIn(summary.egressRequired) : '—'}</span>
      </div>
      <div class="fm-capacity-cell ${summary.egressDeficit ? 'fm-capacity-bad' : ''}">
        <span class="fm-capacity-key">Egress present</span>
        <span class="fm-capacity-val">${summary.egressPresent ? fmtIn(summary.egressPresent) : '—'}</span>
      </div>
      ${summary.egressDeficit ? `
        <div class="fm-capacity-cell fm-capacity-bad">
          <span class="fm-capacity-key">Shortfall</span>
          <span class="fm-capacity-val">${fmtIn(summary.egressDeficit)}</span>
        </div>
      ` : ''}
    </div>
  `
  const summaryLine = noJurisdictions ? '' : `
    <div class="fm-summary">
      <span class="fm-count fm-err">${summary.errors} ${summary.errors === 1 ? 'violation' : 'violations'}</span>
      ${summary.warnings ? `<span class="fm-count fm-warn">${summary.warnings} warning</span>` : ''}
      ${summary.info     ? `<span class="fm-count fm-info">${summary.info} note</span>`        : ''}
    </div>
  `

  const list = noJurisdictions
    ? `<div class="fm-empty-state">
         <div class="fm-empty-glyph">⚠</div>
         <div class="fm-empty-title">No jurisdictions selected</div>
         <div class="fm-empty-msg">Pick at least one AHJ before this check has anything to enforce.</div>
         <button class="block-btn" data-action="settings">Open Fire Code settings</button>
       </div>`
    : result.violations.length
      ? result.violations.map(v => violationRow(v, v.id === focusedId)).join('')
      : `<div class="fm-clean">
           <div class="fm-clean-glyph">✓</div>
           <div class="fm-clean-msg">No violations under the active jurisdiction${result.jurisdictions.length === 1 ? '' : 's'}.</div>
           <div class="fm-clean-disclaimer">Defaults are seeded from public code; verify with your AHJ before relying on this.</div>
         </div>`

  const footer = noJurisdictions ? '' : `
    <div class="fm-footer">
      <button class="ghost-btn small" data-action="settings">Jurisdictions…</button>
      <button class="block-btn small" data-action="rerun">Re-run check</button>
    </div>
  `

  sheetEl.innerHTML = `${header}${jurisdictionsLine}${capacityLine}${summaryLine}<div class="fm-list">${list}</div>${footer}`

  sheetEl.querySelector('[data-action="close"]')?.addEventListener('click', closeSheet)
  sheetEl.querySelector('[data-action="rerun"]')?.addEventListener('click', runAndShow)
  sheetEl.querySelector('[data-action="settings"]')?.addEventListener('click', () => {
    // Don't close — let Settings open on top so the user can watch the sheet
    // refresh in place as they toggle jurisdictions.
    openSettings('fireCode')
  })
  sheetEl.querySelectorAll('[data-violation-id]').forEach(row => {
    row.addEventListener('click', () => {
      const id = parseInt(row.dataset.violationId, 10)
      const v = result.violations.find(x => x.id === id)
      if (!v) return
      setState({ fireMarshal: { ...state.fireMarshal, focusedId: id } })
      if (v.anchor) zoomTo(v.anchor)
    })
  })
}

function violationRow(v, isFocused) {
  if (v.severity === 'info') {
    return `
      <div class="fm-row fm-row-info ${isFocused ? 'focused' : ''}" data-violation-id="${v.id}" tabindex="0">
        <span class="fm-num fm-info">i</span>
        <div class="fm-msg-block">
          <div class="fm-msg">${escape(v.message)}</div>
        </div>
      </div>
    `
  }
  return `
    <div class="fm-row ${isFocused ? 'focused' : ''}" data-violation-id="${v.id}" tabindex="0">
      <span class="fm-num">${v.id}</span>
      <div class="fm-msg-block">
        <div class="fm-rule-label">${escape(v.ruleLabel || v.ruleId)}</div>
        <div class="fm-msg">${escape(v.message)}</div>
        <div class="fm-cite">
          <span class="fm-cite-jurisdiction">${escape(v.jurisdictionName)}</span>
          ${v.code ? `<span class="fm-cite-code">${escape(v.code)}</span>` : ''}
        </div>
      </div>
    </div>
  `
}

function zoomTo(anchor) {
  // Pan/zoom the viewport so the anchor sits at the centre at a comfortable
  // scale. Keep the user's current zoom unless they're ridiculously far out;
  // 30' viewport width is a reasonable mid-range default.
  const v = state.viewport
  const targetW = Math.min(v.w, 360)
  const aspect  = v.w === 0 ? 1 : v.w / v.h
  const newW    = targetW
  const newH    = newW / aspect
  setState({
    viewport: {
      x: anchor.x - newW / 2,
      y: anchor.y - newH / 2,
      w: newW,
      h: newH,
    }
  })
}

