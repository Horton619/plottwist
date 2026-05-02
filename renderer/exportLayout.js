// exportLayout.js — serialize the active layout to a clean, paper-sized SVG
// string suitable for raster (PNG) and vector (PDF) export.
//
// Coordinate system in the output SVG:
//   • Outer viewBox is in PAPER INCHES (svg width/height set with "in" units).
//   • A nested <g transform="translate ... scale ..."> places the world
//     content — internal coordinates remain world-inches, transform scales
//     them to paper-inches.
//   • Stroke widths inside the scaled group are in world-inches and scale
//     down with the transform — so e.g. a stroke-width of 1 world-inch on a
//     1:96 plan renders as 0.0104" on paper.
//
// V1 keeps it minimal — clean linework, simple title block, optional red
// fire-marshal callouts. Anything fancier (sheet borders, scale bar with
// ticks, north arrow, custom title-block templates) is for V2.

import { state, activeRoom, activeLayout, styleFor } from './state.js'
import { escapeAttr, escapeText } from './strings.js'
import { formatDimLength } from './units.js'
import { BRAND, ANNOT } from './colors.js'

// ── Public API ────────────────────────────────────────────────────────────

export const PAPER_PRESETS = {
  archD:   { name: 'Arch D (24 × 36)', w: 36, h: 24 },
  archC:   { name: 'Arch C (18 × 24)', w: 24, h: 18 },
  archB:   { name: 'Arch B (12 × 18)', w: 18, h: 12 },
  tabloid: { name: 'Tabloid (11 × 17)', w: 17, h: 11 },
  letter:  { name: 'Letter (8.5 × 11)', w: 11, h: 8.5 },
}

// Standard architectural scales — paper-inches per world-foot.
// e.g. ENG_SCALES['1/8'] = 1/8 means 1/8" on paper = 1' in world. Exported
// so the export dialog's scale picker stays in lockstep.
export const ENG_SCALES = [
  { label: '1/32" = 1\'', value: 1 / 32 },
  { label: '1/16" = 1\'', value: 1 / 16 },
  { label: '3/32" = 1\'', value: 3 / 32 },
  { label: '1/8" = 1\'',  value: 1 / 8  },
  { label: '3/16" = 1\'', value: 3 / 16 },
  { label: '1/4" = 1\'',  value: 1 / 4  },
  { label: '3/8" = 1\'',  value: 3 / 8  },
  { label: '1/2" = 1\'',  value: 1 / 2  },
  { label: '3/4" = 1\'',  value: 3 / 4  },
  { label: '1" = 1\'',    value: 1      },
]

export function buildExportSVG(opts = {}) {
  const room   = activeRoom()
  const layout = activeLayout()
  if (!room || !layout) return null

  const cfg = {
    paperW:               opts.paperW ?? 36,
    paperH:               opts.paperH ?? 24,
    margin:               opts.margin ?? 0.5,
    titleBlockH:          opts.titleBlockH ?? 1.25,
    scale:                opts.scale ?? 'auto',         // 'auto' or paper-inch/world-foot
    includeFireMarshal:   !!opts.includeFireMarshal,
    fireMarshalResult:    opts.fireMarshalResult || null,
  }

  // Layout extent in world-inches — pad by 2' so chairs at the edge breathe.
  const allObjects = [...room.objects, ...layout.objects].filter(o => !o.hidden)
  const wb = computeBounds(allObjects, /* pad */ 24)
  if (!wb) return null

  const drawW = cfg.paperW  - 2 * cfg.margin
  const drawH = cfg.paperH  - 2 * cfg.margin - cfg.titleBlockH

  // Pick scale (paper-inches per world-inch).
  const chosen = (cfg.scale === 'auto')
    ? pickStandardScale(wb.w, wb.h, drawW, drawH)
    : { value: cfg.scale, label: scaleLabelFor(cfg.scale) }
  const scale = chosen.value / 12   // user value is per-foot; convert to per-inch

  // Position the drawing area — centered horizontally, top-aligned vertically.
  const renderedW = wb.w * scale
  const renderedH = wb.h * scale
  const drawX = cfg.margin + (drawW - renderedW) / 2
  const drawY = cfg.margin + Math.max(0, (drawH - renderedH) / 2)

  // Build the SVG string.
  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cfg.paperW}in" height="${cfg.paperH}in" ` +
    `viewBox="0 0 ${cfg.paperW} ${cfg.paperH}" font-family="-apple-system, BlinkMacSystemFont, Inter, Segoe UI, system-ui, sans-serif">`
  )
  // White background.
  parts.push(`<rect x="0" y="0" width="${cfg.paperW}" height="${cfg.paperH}" fill="#fff"/>`)
  // Sheet outline + drawing area outline.
  parts.push(`<rect x="${cfg.margin}" y="${cfg.margin}" width="${drawW}" height="${drawH}" fill="none" stroke="#999" stroke-width="0.01"/>`)

  // Drawing — world coords inside this group.
  parts.push(`<g transform="translate(${drawX} ${drawY}) scale(${scale}) translate(${-wb.x} ${-wb.y})">`)
  // Draw room structural objects first, then layout objects.
  for (const o of room.objects)   { if (!o.hidden) parts.push(serializeObject(o)) }
  for (const o of layout.objects) { if (!o.hidden) parts.push(serializeObject(o)) }
  parts.push(`</g>`)

  // Fire marshal callouts — drawn in PAPER coords for fixed-size labels, but
  // anchored to world positions transformed through the same drawing matrix.
  if (cfg.includeFireMarshal && cfg.fireMarshalResult?.violations?.length) {
    parts.push(serializeFireMarshalCallouts(cfg.fireMarshalResult, drawX, drawY, scale, wb))
  }

  // Title block.
  parts.push(serializeTitleBlock(cfg, room, layout, chosen))

  parts.push(`</svg>`)
  return parts.join('')
}

// ── Bounds ────────────────────────────────────────────────────────────────

function computeBounds(objects, pad = 0) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let any = false
  const merge = (x, y) => {
    any = true
    if (x < minX) minX = x; if (y < minY) minY = y
    if (x > maxX) maxX = x; if (y > maxY) maxY = y
  }
  for (const o of objects) {
    if (o.kind === 'rect' || o.kind === 'image') {
      merge(o.x, o.y); merge(o.x + o.w, o.y + o.h)
    } else if (o.kind === 'polygon') {
      for (const [x, y] of (o.vertices || [])) merge(x, y)
      // Include solver chair/table positions for seating zones.
      for (const s of (o.result?.seats  || [])) merge(s.x, s.y)
      for (const t of (o.result?.tables || [])) merge(t.x, t.y)
    } else if (o.kind === 'dim') {
      merge(o.x1, o.y1); merge(o.x2, o.y2)
    }
  }
  if (!any) return null
  return { x: minX - pad, y: minY - pad, w: (maxX - minX) + 2 * pad, h: (maxY - minY) + 2 * pad }
}

// ── Scale picker ──────────────────────────────────────────────────────────
// Largest standard scale that fits the drawing.

function pickStandardScale(worldW, worldH, paperW, paperH) {
  const requiredScalePerInch_W = paperW / worldW
  const requiredScalePerInch_H = paperH / worldH
  const maxScalePerInch        = Math.min(requiredScalePerInch_W, requiredScalePerInch_H)
  // Convert to per-foot.
  const maxScalePerFoot = maxScalePerInch * 12
  // If the layout is too large for even the smallest standard scale, fall
  // back to a custom fit-to-content scale so the drawing doesn't silently
  // overflow the sheet. The label tags it so the title block reads honestly.
  if (maxScalePerFoot < ENG_SCALES[0].value) {
    return { value: maxScalePerFoot, label: `≈ Fit (${(1 / maxScalePerFoot).toFixed(0)}'/in)` }
  }
  let chosen = ENG_SCALES[0]
  for (const s of ENG_SCALES) {
    if (s.value <= maxScalePerFoot) chosen = s
    else break
  }
  return chosen
}

function scaleLabelFor(value) {
  const m = ENG_SCALES.find(s => Math.abs(s.value - value) < 1e-6)
  return m ? m.label : `${value}" = 1'`
}

// ── Object serialization ──────────────────────────────────────────────────
//
// All stroke-widths use WORLD-INCH units. With the parent group transformed
// at `scale` paper-inches per world-inch, a stroke-width of 1 world-inch
// renders as `scale` paper-inches thick.
//
// The standard line weight set:
//   sw('hair')   ≈ 0.5  world-inch  →  0.005 paper-inch at 1:96
//   sw('thin')   ≈ 1.0
//   sw('med')    ≈ 1.5
//   sw('heavy')  ≈ 2.5

const SW = { hair: 0.5, thin: 1.0, med: 1.5, heavy: 2.5 }

function serializeObject(o) {
  if (o.kind === 'image') return serializeImage(o)
  if (o.kind === 'dim')   return serializeDim(o)
  if (o.kind === 'rect') {
    if (o.type === 'aisle')   return serializeAisleRect(o)
    return serializeRect(o)
  }
  if (o.kind === 'polygon') {
    if (o.type === 'seating') return serializeSeatingZone(o)
    return serializePolygon(o)
  }
  return ''
}

function serializeImage(o) {
  const op = o.opacity ?? 0.6
  return `<image x="${o.x}" y="${o.y}" width="${Math.max(1, o.w)}" height="${Math.max(1, o.h)}" preserveAspectRatio="none" opacity="${op}" href="${escapeAttr(o.src)}"/>`
}

function serializeRect(o) {
  const s = styleFor(o)
  return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${s.fill}" fill-opacity="${s.fillOpacity}" stroke="${s.stroke}" stroke-width="${SW.thin * s.strokeWidth}"/>`
}

function serializePolygon(o) {
  const s = styleFor(o)
  const pts = (o.vertices || []).map(v => v.join(',')).join(' ')
  if (!pts) return ''
  const tag = o.vertices.length >= 3 ? 'polygon' : 'polyline'
  return `<${tag} points="${pts}" fill="${s.fill}" fill-opacity="${s.fillOpacity}" stroke="${s.stroke}" stroke-width="${SW.thin * s.strokeWidth}"/>`
}

function serializeAisleRect(o) {
  const s = styleFor(o)
  const out = []
  out.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${s.fill}" fill-opacity="${s.fillOpacity}" stroke="${s.stroke}" stroke-width="${SW.thin}"/>`)
  out.push(serializeAisleDimCallout(o.x, o.y, o.w, o.h))
  return out.join('')
}

function serializeSeatingZone(o) {
  const s = styleFor(o)
  const out = []
  // Zone outline — dashed.
  if (o.vertices && o.vertices.length >= 3) {
    const pts = o.vertices.map(v => v.join(',')).join(' ')
    out.push(`<polygon points="${pts}" fill="${s.fill}" fill-opacity="${s.fillOpacity}" stroke="${s.stroke}" stroke-width="${SW.thin}" stroke-dasharray="6 4"/>`)
  }
  // Tables first (under chairs).
  for (const t of (o.result?.tables || [])) out.push(serializeTable(t))
  for (const c of (o.result?.seats  || [])) out.push(serializeChair(c))
  return out.join('')
}

function serializeTable(table) {
  const out = []
  const isRound = table.kind === 'round'
  const w = table.w, d = table.d
  const transform = `translate(${table.x} ${table.y}) rotate(${table.rotation || 0})`
  if (isRound) {
    if (table.chairD) {
      out.push(`<g transform="${transform}"><circle cx="0" cy="0" r="${w / 2 + table.chairD}" fill="none" stroke="${BRAND.chair}" stroke-opacity="0.28" stroke-width="${SW.hair}" stroke-dasharray="3 3"/></g>`)
    }
    out.push(`<g transform="${transform}">
      <circle cx="0" cy="0" r="${w / 2}" fill="${BRAND.tableFill}" stroke="${BRAND.chair}" stroke-width="${SW.med}"/>
    </g>`)
  } else {
    out.push(`<g transform="${transform}">
      <rect x="${-w / 2}" y="${-d / 2}" width="${w}" height="${d}" rx="2" fill="${BRAND.tableFill}" stroke="${BRAND.chair}" stroke-width="${SW.med}"/>
    </g>`)
  }
  // Centered size label, in feet.
  const ft = w / 12
  const ftLabel = (Math.abs(ft - Math.round(ft)) < 0.05) ? `${Math.round(ft)}'` : `${ft.toFixed(1)}'`
  const fontSize = isRound ? Math.min(w * 0.18, 12) : Math.min(d * 0.55, 9)
  out.push(`<g transform="${transform}"><text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="${BRAND.chair}" opacity="0.55">${escapeText(ftLabel)}</text></g>`)
  return out.join('')
}

function serializeChair(seat) {
  const w = seat.w, d = seat.d
  const transform = `translate(${seat.x} ${seat.y}) rotate(${seat.rotation || 0})`
  return `<g transform="${transform}">
    <rect x="${-w / 2}" y="${-d / 2}" width="${w}" height="${d}" rx="1.5" fill="${BRAND.chair}" fill-opacity="0.32" stroke="${BRAND.chair}" stroke-width="${SW.hair}"/>
    <line x1="${-w / 2}" y1="${d / 2}" x2="${w / 2}" y2="${d / 2}" stroke="${BRAND.chair}" stroke-width="${SW.heavy}" stroke-linecap="round"/>
  </g>`
}

function serializeDim(d) {
  const dx = d.x2 - d.x1, dy = d.y2 - d.y1
  const len = Math.hypot(dx, dy)
  if (len < 1) return ''
  const nx = -dy / len, ny = dx / len
  const tick = 8
  const stroke = ANNOT.dim.paper
  const out = []
  out.push(`<line x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}" stroke="${stroke}" stroke-width="${SW.thin}" stroke-dasharray="5 3" opacity="0.9"/>`)
  for (const [x, y] of [[d.x1, d.y1], [d.x2, d.y2]]) {
    out.push(`<line x1="${x - nx * tick}" y1="${y - ny * tick}" x2="${x + nx * tick}" y2="${y + ny * tick}" stroke="${stroke}" stroke-width="${SW.thin}" stroke-linecap="round"/>`)
  }
  // Label, parallel to the line.
  const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2
  const off = 9
  const lx = cx + nx * off, ly = cy + ny * off
  let angDeg = Math.atan2(dy, dx) * 180 / Math.PI
  if (angDeg > 90 || angDeg < -90) angDeg += 180
  out.push(`<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="central" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="${stroke}" transform="rotate(${angDeg} ${lx} ${ly})">${escapeText(formatDimLength(len))}</text>`)
  return out.join('')
}

function serializeAisleDimCallout(x, y, w, h) {
  const isWide = w > h
  const widthVal = Math.min(w, h)
  const label = formatDimLength(widthVal)
  const stroke = ANNOT.aisle.paper
  const arrow = 6
  const out = []
  if (!isWide) {
    const dimY = y + h / 2
    out.push(`<line x1="${x}" y1="${dimY}" x2="${x + w}" y2="${dimY}" stroke="${stroke}" stroke-width="${SW.thin}" opacity="0.8"/>`)
    out.push(arrowheadPath(x, dimY, 180, arrow, stroke))
    out.push(arrowheadPath(x + w, dimY, 0, arrow, stroke))
    const cx = x + w / 2, cy = dimY - arrow - 3
    out.push(`<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${Math.min(widthVal * 0.42, 10)}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="${stroke}">${escapeText(label)}</text>`)
  } else {
    const dimX = x + w / 2
    out.push(`<line x1="${dimX}" y1="${y}" x2="${dimX}" y2="${y + h}" stroke="${stroke}" stroke-width="${SW.thin}" opacity="0.8"/>`)
    out.push(arrowheadPath(dimX, y, 270, arrow, stroke))
    out.push(arrowheadPath(dimX, y + h, 90, arrow, stroke))
    const cx = dimX + arrow * 1.6, cy = y + h / 2
    out.push(`<text x="${cx}" y="${cy}" text-anchor="start" dominant-baseline="central" font-size="${Math.min(widthVal * 0.42, 10)}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="${stroke}">${escapeText(label)}</text>`)
  }
  return out.join('')
}

function arrowheadPath(x, y, angleDeg, size, color) {
  const rad = angleDeg * Math.PI / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const baseX = x - cos * size, baseY = y - sin * size
  const px = -sin, py = cos
  const halfW = size * 0.5
  const ax = baseX + px * halfW, ay = baseY + py * halfW
  const bx = baseX - px * halfW, by = baseY - py * halfW
  return `<path d="M ${x} ${y} L ${ax} ${ay} L ${bx} ${by} Z" fill="${color}"/>`
}

// ── Fire marshal callouts (red, paper-inch sized) ─────────────────────────

function serializeFireMarshalCallouts(result, drawX, drawY, scale, wb) {
  const out = []
  for (const v of result.violations) {
    if (!v.anchor || v.severity === 'info') continue
    // Convert world anchor to paper coord through the drawing transform.
    const px = drawX + (v.anchor.x - wb.x) * scale
    const py = drawY + (v.anchor.y - wb.y) * scale
    const r = 0.13     // paper inches — ~9pt circle
    out.push(`<g class="fm-callout">
      <circle cx="${px}" cy="${py}" r="${r}" fill="${BRAND.violation}" stroke="#fff" stroke-width="0.015"/>
      <text x="${px}" y="${py}" text-anchor="middle" dominant-baseline="central" font-size="${r * 1.5}" font-weight="700" fill="#fff">${v.id}</text>
    </g>`)
  }
  return out.join('')
}

// ── Title block ───────────────────────────────────────────────────────────

function serializeTitleBlock(cfg, room, layout, scaleChosen) {
  const x  = cfg.margin
  const y  = cfg.paperH - cfg.margin - cfg.titleBlockH
  const w  = cfg.paperW - 2 * cfg.margin
  const h  = cfg.titleBlockH
  const projectName = state.filePath
    ? state.filePath.split(/[/\\]/).pop().replace(/\.ptwist$/i, '')
    : 'Untitled'
  const totals = summarizeSeats(layout)
  const today  = new Date().toISOString().slice(0, 10)

  const out = []
  out.push(`<g class="title-block">`)
  out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#222" stroke-width="0.012"/>`)

  // Vertical separator after the project / room / layout column.
  const colDivider = x + w * 0.55
  out.push(`<line x1="${colDivider}" y1="${y}" x2="${colDivider}" y2="${y + h}" stroke="#222" stroke-width="0.008"/>`)

  // Left column — project / room / layout, stacked.
  const leftPad = 0.18
  const lx = x + leftPad
  const lineH = h / 4
  out.push(tbLabel(lx, y + lineH * 0.55, 'PROJECT', '#666'))
  out.push(tbValue(lx + 0.55, y + lineH * 0.55, projectName))
  out.push(tbLabel(lx, y + lineH * 1.55, 'ROOM',     '#666'))
  out.push(tbValue(lx + 0.55, y + lineH * 1.55, room.name || 'Room'))
  out.push(tbLabel(lx, y + lineH * 2.55, 'LAYOUT',   '#666'))
  out.push(tbValue(lx + 0.55, y + lineH * 2.55, layout.name || 'Layout'))
  out.push(tbLabel(lx, y + lineH * 3.55, 'DATE',     '#666'))
  out.push(tbValue(lx + 0.55, y + lineH * 3.55, today))

  // Right column — totals + scale + credit.
  const rx = colDivider + leftPad
  out.push(tbLabel(rx, y + lineH * 0.55, 'TOTAL SEATS', '#666'))
  out.push(tbValue(rx + 1.0, y + lineH * 0.55, String(totals.total), '700', 0.16))
  let row = 1.55
  if (totals.theater)   { out.push(tbLabel(rx, y + lineH * row, 'THEATER',   '#666')); out.push(tbValue(rx + 1.0, y + lineH * row, String(totals.theater)));   row++ }
  if (totals.classroom) { out.push(tbLabel(rx, y + lineH * row, 'CLASSROOM', '#666')); out.push(tbValue(rx + 1.0, y + lineH * row, String(totals.classroom))); row++ }
  if (totals.rounds)    { out.push(tbLabel(rx, y + lineH * row, 'ROUNDS',    '#666')); out.push(tbValue(rx + 1.0, y + lineH * row, String(totals.rounds)));    row++ }
  if (totals.mixed)     { out.push(tbLabel(rx, y + lineH * row, 'MIXED',     '#666')); out.push(tbValue(rx + 1.0, y + lineH * row, String(totals.mixed)));     row++ }
  // Always include scale + credit at the bottom of the right column.
  out.push(tbLabel(rx, y + lineH * 3.55, 'SCALE',  '#666'))
  out.push(tbValue(rx + 1.0, y + lineH * 3.55, scaleChosen.label))

  // Credit, far right.
  const creditX = x + w - leftPad
  out.push(`<text x="${creditX}" y="${y + h - 0.18}" text-anchor="end" font-size="0.12" fill="#999">PlotTwist · veproductions.net</text>`)

  out.push(`</g>`)
  return out.join('')
}

function tbLabel(x, y, text, color) {
  return `<text x="${x}" y="${y}" font-size="0.085" font-weight="600" fill="${color}" letter-spacing="0.04em">${escapeText(text)}</text>`
}
function tbValue(x, y, text, weight = '500', size = 0.13) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="#111">${escapeText(text)}</text>`
}

function summarizeSeats(layout) {
  const counts = { theater: 0, classroom: 0, rounds: 0, mixed: 0, total: 0 }
  for (const o of (layout.objects || [])) {
    if (o.type !== 'seating' || !o.result) continue
    const n = o.result.totalSeats || 0
    counts.total += n
    if (counts[o.style] != null) counts[o.style] += n
  }
  return counts
}
