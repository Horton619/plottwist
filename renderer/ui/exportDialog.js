// exportDialog.js — Page Setup + Export modal.
//
// One stop for paper size, orientation, scale, DPI, and the fire-marshal
// callout toggle. Two action buttons at the bottom: Export PNG and Export
// PDF. Last-used settings persist in localStorage so re-exports are quick.
//
// PNG: SVG → canvas at chosen DPI → PNG via canvas.toBlob → saved through
// the existing exportImageDialog IPC.
// PDF: hidden BrowserWindow + webContents.printToPDF() so we get true vector
// output that any sheet-printer can scale.

import { state, activeRoom, activeLayout } from '../state.js'
import { buildExportSVG, PAPER_PRESETS, ENG_SCALES } from '../exportLayout.js'
import { escapeHtml as escape } from '../strings.js'

const STORE_KEY = 'plottwist:export'

const DEFAULTS = {
  preset:        'archD',
  customW:       36,
  customH:       24,
  orientation:   'landscape',     // 'portrait' | 'landscape' — flips W/H of preset
  scale:         'auto',          // 'auto' | numeric (paper-inches per world-foot)
  dpi:           150,
  includeFireMarshal: true,
  theme:         'light',         // 'light' (white paper, navy strokes) or 'dark' (matches canvas)
}

// Scale picker options — Auto + every entry from ENG_SCALES so the dialog
// and the serializer can never disagree on which scales exist.
const SCALE_CHOICES = [{ label: 'Auto', value: 'auto' }, ...ENG_SCALES]

let modalEl = null
let cfg = null
let busy = false

export function initExportDialog() {
  ensureRoot()
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen() && !busy) closeDialog()
  })
}

export function openExportDialog() {
  ensureRoot()
  cfg = loadConfig()
  modalEl.classList.add('open')
  render()
  // Land focus on the first interactive element so the keyboard works
  // immediately without a click on the panel.
  modalEl.querySelector('select, input, button')?.focus()
}

export function closeDialog() {
  modalEl?.classList.remove('open')
}

function isOpen() { return !!modalEl?.classList.contains('open') }

function ensureRoot() {
  if (modalEl) return
  modalEl = document.createElement('div')
  modalEl.className = 'export-modal'
  modalEl.innerHTML = `<div class="export-overlay"></div><div class="export-panel"></div>`
  modalEl.querySelector('.export-overlay').addEventListener('click', () => { if (!busy) closeDialog() })
  document.body.appendChild(modalEl)
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const merged = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
    // Validate restored values against current presets — e.g. a previously
    // valid `cfg.scale` could be removed from SCALE_CHOICES later. Reset
    // to the default rather than leaving an unselectable stale value.
    if (merged.scale !== 'auto' && !SCALE_CHOICES.some(s => s.value === merged.scale)) {
      merged.scale = DEFAULTS.scale
    }
    if (merged.preset !== 'custom' && !PAPER_PRESETS[merged.preset]) {
      merged.preset = DEFAULTS.preset
    }
    if (![72, 150, 300, 600].includes(merged.dpi)) merged.dpi = DEFAULTS.dpi
    if (!['portrait', 'landscape'].includes(merged.orientation)) merged.orientation = DEFAULTS.orientation
    if (!['light', 'dark'].includes(merged.theme)) merged.theme = DEFAULTS.theme
    return merged
  } catch { return { ...DEFAULTS } }
}
function saveConfig() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)) } catch {}
}

function effectivePaper() {
  let w, h
  if (cfg.preset === 'custom') {
    w = parseFloat(cfg.customW) || DEFAULTS.customW
    h = parseFloat(cfg.customH) || DEFAULTS.customH
  } else {
    const p = PAPER_PRESETS[cfg.preset] || PAPER_PRESETS.archD
    w = p.w; h = p.h
  }
  // Apply orientation (presets are stored in landscape).
  if (cfg.orientation === 'portrait' && w > h) [w, h] = [h, w]
  if (cfg.orientation === 'landscape' && h > w) [w, h] = [h, w]
  return { w, h }
}

function render() {
  const panel = modalEl.querySelector('.export-panel')
  const room = activeRoom(); const layout = activeLayout()
  const paper = effectivePaper()
  // Gate on result existence, not violations.length — a clean check is still
  // a result and the user might want a "no issues found" stamp on the export.
  const fmAvailable = !!state.fireMarshal?.result

  panel.innerHTML = `
    <div class="export-header">
      <span class="export-title">Export Layout</span>
      <button class="export-close" data-action="close" title="Close (Esc)">×</button>
    </div>
    <div class="export-body">
      <div class="export-context">
        <span class="export-ctx-key">Room</span><span class="export-ctx-val">${escape(room?.name || '—')}</span>
        <span class="export-ctx-key">Layout</span><span class="export-ctx-val">${escape(layout?.name || '—')}</span>
      </div>

      <h4>Page</h4>
      <div class="export-row">
        <span class="export-key">Paper size</span>
        <select class="select-input" data-cfg="preset">
          ${Object.entries(PAPER_PRESETS).map(([k, p]) =>
            `<option value="${k}" ${cfg.preset === k ? 'selected' : ''}>${p.name}</option>`
          ).join('')}
          <option value="custom" ${cfg.preset === 'custom' ? 'selected' : ''}>Custom…</option>
        </select>
      </div>
      <div class="export-row export-custom" ${cfg.preset === 'custom' ? '' : 'hidden'}>
        <span class="export-key">Custom (in)</span>
        <div class="export-custom-inputs">
          <input type="number" class="num-input" data-cfg="customW" min="4" max="120" step="0.25" value="${cfg.customW}"> ×
          <input type="number" class="num-input" data-cfg="customH" min="4" max="120" step="0.25" value="${cfg.customH}">
        </div>
      </div>
      <div class="export-row">
        <span class="export-key">Orientation</span>
        <div class="export-segmented">
          <button class="seg-btn ${cfg.orientation === 'landscape' ? 'active' : ''}" data-orient="landscape">Landscape</button>
          <button class="seg-btn ${cfg.orientation === 'portrait'  ? 'active' : ''}" data-orient="portrait">Portrait</button>
        </div>
      </div>
      <div class="export-row">
        <span class="export-key">Scale</span>
        <select class="select-input" data-cfg="scale">
          ${SCALE_CHOICES.map(s => `<option value="${s.value}" ${String(cfg.scale) === String(s.value) ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </div>
      <div class="export-row">
        <span class="export-key">PNG DPI</span>
        <select class="select-input" data-cfg="dpi">
          <option value="72"  ${cfg.dpi === 72  ? 'selected' : ''}>72 (screen)</option>
          <option value="150" ${cfg.dpi === 150 ? 'selected' : ''}>150 (draft print)</option>
          <option value="300" ${cfg.dpi === 300 ? 'selected' : ''}>300 (proposal)</option>
          <option value="600" ${cfg.dpi === 600 ? 'selected' : ''}>600 (archival)</option>
        </select>
      </div>

      <h4>Theme</h4>
      <div class="export-row">
        <span class="export-key">Color theme</span>
        <select class="select-input" data-cfg="theme">
          <option value="light" ${cfg.theme === 'light' ? 'selected' : ''}>Light (print — white paper, dark strokes)</option>
          <option value="dark"  ${cfg.theme === 'dark'  ? 'selected' : ''}>Dark (screen — navy paper, magenta strokes)</option>
        </select>
      </div>

      <h4>Annotations</h4>
      <label class="export-row export-check">
        <input type="checkbox" data-cfg="includeFireMarshal" ${cfg.includeFireMarshal ? 'checked' : ''} ${fmAvailable ? '' : 'disabled'}>
        <span class="export-key">Include fire marshal callouts</span>
        <span class="export-hint">${fmAvailable ? 'Will use the most recent run' : 'Run Tools → Fire Marshal Check first'}</span>
      </label>

      <div class="export-summary">
        <span class="export-summary-label">Will export</span>
        <span class="export-summary-val">${paper.w}″ × ${paper.h}″ ${cfg.orientation}</span>
      </div>
    </div>
    <div class="export-footer">
      <button class="ghost-btn small" data-action="close">Cancel</button>
      <div class="export-actions">
        <button class="block-btn small" data-action="png" ${busy ? 'disabled' : ''}>Export PNG…</button>
        <button class="block-btn small accent" data-action="pdf" ${busy ? 'disabled' : ''}>Export PDF…</button>
      </div>
    </div>
    <div class="export-status" data-status></div>
  `
  // Wire inputs.
  panel.querySelectorAll('[data-cfg]').forEach(inp => {
    inp.addEventListener('change', () => {
      const k = inp.dataset.cfg
      let v
      if (inp.type === 'checkbox')      v = inp.checked
      else if (inp.type === 'number')   v = parseFloat(inp.value)
      else if (inp.tagName === 'SELECT') {
        v = inp.value
        if (v !== 'auto' && v !== 'custom' && v !== 'portrait' && v !== 'landscape' && /^-?\d+(?:\.\d+)?$/.test(v)) v = parseFloat(v)
      } else v = inp.value
      cfg[k] = v
      saveConfig()
      render()
    })
  })
  panel.querySelectorAll('[data-orient]').forEach(b => b.addEventListener('click', () => {
    cfg.orientation = b.dataset.orient
    saveConfig()
    render()
  }))
  panel.querySelectorAll('[data-action="close"]').forEach(b => b.addEventListener('click', () => { if (!busy) closeDialog() }))
  panel.querySelector('[data-action="png"]')?.addEventListener('click', () => doExport('png'))
  panel.querySelector('[data-action="pdf"]')?.addEventListener('click', () => doExport('pdf'))
}

function setStatus(msg, isError) {
  const el = modalEl?.querySelector('[data-status]')
  if (!el) return
  el.textContent = msg || ''
  el.classList.toggle('error', !!isError)
}

async function doExport(kind) {
  if (busy) return
  busy = true
  render()
  setStatus(kind === 'pdf' ? 'Generating PDF…' : 'Rendering PNG…', false)
  try {
    const paper = effectivePaper()
    const room = activeRoom(); const layout = activeLayout()
    if (!room || !layout) throw new Error('No active layout to export.')

    const svg = buildExportSVG({
      paperW: paper.w,
      paperH: paper.h,
      scale:  cfg.scale,
      theme:  cfg.theme,
      includeFireMarshal: cfg.includeFireMarshal && !!state.fireMarshal?.result,
      fireMarshalResult:  state.fireMarshal?.result || null,
    })
    if (!svg) throw new Error('Layout is empty.')

    const baseName = (state.filePath ? state.filePath.split(/[/\\]/).pop().replace(/\.ptwist$/i, '') : 'layout')
                    + '_' + sanitize(layout.name || 'layout')

    if (kind === 'png') {
      const blob = await rasterize(svg, paper.w, paper.h, cfg.dpi)
      const dlg  = await window.plottwist.exportImageDialog(`${baseName}.png`, 'png')
      if (dlg.canceled) { setStatus(''); busy = false; render(); return }
      const buf = await blob.arrayBuffer()
      await window.plottwist.writeBinaryFile(dlg.filePath, arrayBufferToBase64(buf))
      setStatus('PNG saved.', false)
    } else {
      const dlg = await window.plottwist.exportImageDialog(`${baseName}.pdf`, 'pdf')
      if (dlg.canceled) { setStatus(''); busy = false; render(); return }
      const res = await window.plottwist.exportPdf({
        svg, paperW: paper.w, paperH: paper.h, savePath: dlg.filePath,
      })
      if (!res?.ok) throw new Error(res?.error || 'PDF export failed.')
      setStatus('PDF saved.', false)
    }
  } catch (err) {
    console.error('export error', err)
    setStatus(err.message || 'Export failed.', true)
  } finally {
    busy = false
    render()
  }
}

// SVG → PNG via off-screen canvas at the requested DPI.
async function rasterize(svgStr, paperW, paperH, dpi) {
  const widthPx  = Math.round(paperW * dpi)
  const heightPx = Math.round(paperH * dpi)
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = widthPx; canvas.height = heightPx
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, widthPx, heightPx)
    ctx.drawImage(img, 0, 0, widthPx, heightPx)
    return await new Promise(res => canvas.toBlob(res, 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load SVG for rasterization.'))
    img.src = src
  })
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '') || 'layout'
}

