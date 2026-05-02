// fireMarshal.js — fire-code validator.
//
// On demand (Tools → Fire Marshal Check…) this evaluates the active layout
// against the strictest active jurisdiction(s) and returns a list of
// violations, each with a citation, a human message, and a world-coord
// anchor for the canvas overlay.
//
// V1 rules:
//   • aisleMinWidth         — narrow side of aisle ≥ jurisdiction min, AND
//   • aisleCapacityFactor   — narrow side ≥ occupants × factor (whichever larger)
//   • maxSeatsRowOneAisle   — outermost section's per-row count ≤ limit
//   • maxSeatsRowTwoAisles  — inner section's per-row count ≤ limit
//   • theaterRowClearMin    — (rowSpacing − chairD) ≥ min
//   • roundsBackToBackMin   — zone.tableSpacing ≥ min
//   • stageClearanceMin     — nearest seat to stage edge ≥ min
//
// Jurisdiction selection is stored in the project file (state.project.fireCode
// .jurisdictions[]) so a venue's governing AHJ travels with the file.

import { formatInches } from './units.js'

let cachedData = null

export async function loadFireCodeData() {
  if (cachedData) return cachedData
  if (!window.plottwist?.readBundledResource) {
    throw new Error('readBundledResource IPC unavailable')
  }
  const json = await window.plottwist.readBundledResource('data/fireCode.json')
  cachedData = JSON.parse(json)
  return cachedData
}

// Whether higher or lower values represent the stricter rule. Drives the
// "strictest active jurisdiction wins" merge.
const STRICTNESS = {
  aisleMinWidth:        'max',
  aisleCapacityFactor:  'max',
  theaterRowClearMin:   'max',
  maxSeatsRowOneAisle:  'min',
  maxSeatsRowTwoAisles: 'min',
  roundsBackToBackMin:  'max',
  stageClearanceMin:    'max',
}

export function getProjectJurisdictions(project) {
  return Array.isArray(project?.fireCode?.jurisdictions)
    ? project.fireCode.jurisdictions
    : []
}

export function strictestValues(activeIds, data) {
  const out = {}
  for (const ruleId of Object.keys(data.rules || {})) {
    const dir = STRICTNESS[ruleId] || 'max'
    let best = null
    for (const jid of activeIds) {
      const v = data.jurisdictions?.[jid]?.values?.[ruleId]
      if (!v) continue
      if (!best) {
        best = { value: v.value, jurisdictionIds: [jid], code: v.code, note: v.note }
        continue
      }
      if ((dir === 'max' && v.value > best.value) || (dir === 'min' && v.value < best.value)) {
        best = { value: v.value, jurisdictionIds: [jid], code: v.code, note: v.note }
      } else if (v.value === best.value) {
        best.jurisdictionIds.push(jid)
      }
    }
    if (best) out[ruleId] = best
  }
  return out
}

export function runFireMarshal(project, layoutId, activeIds, data) {
  const result = {
    activeIds:     activeIds.slice(),
    jurisdictions: activeIds.map(id => ({ id, name: data.jurisdictions?.[id]?.name || id })),
    strictest:     {},
    violations:    [],
    summary:       { errors: 0, warnings: 0, info: 0 },
  }
  if (!activeIds.length) {
    result.violations.push({
      id: 1,
      severity: 'info',
      ruleId:   '_noJurisdictions',
      ruleLabel:'No jurisdiction selected',
      code:     '',
      jurisdictionId:   '',
      jurisdictionName: '',
      message:  'No jurisdictions active. Enable at least one in Settings → Fire Code.',
      anchor:   null,
      objectId: null,
    })
    result.summary.info = 1
    return result
  }
  result.strictest = strictestValues(activeIds, data)

  // Locate room + layout.
  let room = null, layout = null
  for (const r of project.rooms || []) {
    for (const l of r.layouts || []) {
      if (l.id === layoutId) { room = r; layout = l; break }
    }
    if (layout) break
  }
  if (!layout) return result

  let nextId = 1
  const push = (v) => {
    v.id = nextId++
    result.violations.push(v)
    result.summary[v.severity === 'error' ? 'errors' : v.severity === 'warn' ? 'warnings' : 'info']++
  }

  const seatingZones = layout.objects.filter(o => o.type === 'seating' && o.kind === 'polygon')
  const aisleObjects = layout.objects.filter(o => o.type === 'aisle'   && o.kind === 'rect')
  const stageObjects = (room?.objects || []).filter(o => o.type === 'stage' && o.kind === 'rect')

  const totalOccupants = seatingZones.reduce((acc, z) => acc + (z.result?.totalSeats || 0), 0)

  const cite = (rule) => {
    const j = data.jurisdictions?.[rule.jurisdictionIds[0]]
    return { id: rule.jurisdictionIds[0], name: j?.name || rule.jurisdictionIds[0], code: rule.code }
  }

  // ── Aisle min width + occupancy factor ──────────────────────────────────
  const aRule = result.strictest.aisleMinWidth
  const fRule = result.strictest.aisleCapacityFactor
  if (aRule && aisleObjects.length) {
    for (const a of aisleObjects) {
      const narrow = Math.min(Math.abs(a.w), Math.abs(a.h))
      const required = Math.max(
        aRule ? aRule.value : 0,
        fRule ? Math.ceil(totalOccupants * fRule.value) : 0
      )
      if (narrow < required) {
        const c = cite(aRule)
        const reasonFactor = fRule && totalOccupants * fRule.value > aRule.value
        push({
          severity: 'error',
          ruleId:   reasonFactor ? 'aisleCapacityFactor' : 'aisleMinWidth',
          ruleLabel: 'Aisle width',
          jurisdictionId:   c.id,
          jurisdictionName: c.name,
          code:    c.code,
          message: reasonFactor
            ? `Aisle is ${formatInches(narrow)}; ${totalOccupants} occupants × ${fRule.value} in/occ = ${formatInches(Math.ceil(totalOccupants * fRule.value))} required.`
            : `Aisle is ${formatInches(narrow)}; minimum is ${formatInches(required)}.`,
          anchor:   { x: a.x + a.w / 2, y: a.y + a.h / 2 },
          objectId: a.id,
        })
      }
    }
  }

  // ── Max seats per row (per section) ─────────────────────────────────────
  const oneAisleR = result.strictest.maxSeatsRowOneAisle
  const twoAisleR = result.strictest.maxSeatsRowTwoAisles
  if (oneAisleR || twoAisleR) {
    for (const z of seatingZones) {
      if (!z.result?.seats?.length) continue
      if (!['theater', 'classroom', 'mixed'].includes(z.style)) continue
      const bySection      = new Map()
      const sectionsPerRow = new Map()
      for (const s of z.result.seats) {
        const sec = s.sectionIdx ?? 0
        const key = `${s.row}_${sec}`
        if (!bySection.has(key)) bySection.set(key, [])
        bySection.get(key).push(s)
        if (!sectionsPerRow.has(s.row)) sectionsPerRow.set(s.row, new Set())
        sectionsPerRow.get(s.row).add(sec)
      }
      for (const [, seats] of bySection) {
        const row    = seats[0].row
        const secIdx = seats[0].sectionIdx ?? 0
        const total  = sectionsPerRow.get(row)?.size || 1
        const isOuter = secIdx === 0 || secIdx === total - 1
        const rule   = isOuter ? oneAisleR : twoAisleR
        if (!rule) continue
        if (seats.length > rule.value) {
          const cx = seats.reduce((a, s) => a + s.x, 0) / seats.length
          const cy = seats.reduce((a, s) => a + s.y, 0) / seats.length
          const c  = cite(rule)
          push({
            severity: 'error',
            ruleId:   isOuter ? 'maxSeatsRowOneAisle' : 'maxSeatsRowTwoAisles',
            ruleLabel: isOuter ? 'Max seats per row (1-aisle)' : 'Max seats per row (2-aisle)',
            jurisdictionId:   c.id,
            jurisdictionName: c.name,
            code:    c.code,
            message: `Row ${row + 1} ${total > 1 ? `section ${secIdx + 1} ` : ''}has ${seats.length} seats; max is ${rule.value}.`,
            anchor:   { x: cx, y: cy },
            objectId: z.id,
          })
        }
      }
    }
  }

  // ── Theater row clear (back-to-front) ───────────────────────────────────
  const trc = result.strictest.theaterRowClearMin
  if (trc) {
    for (const z of seatingZones) {
      if (!['theater', 'mixed'].includes(z.style)) continue
      if (!z.result?.seats?.length) continue
      const rowH   = Math.max(0, z.rowSpacing || 20)
      const chairD = Math.max(0, z.chairD || 20)
      const clear  = rowH - chairD
      if (clear < trc.value) {
        const cx = z.result.seats.reduce((a, s) => a + s.x, 0) / z.result.seats.length
        const cy = z.result.seats.reduce((a, s) => a + s.y, 0) / z.result.seats.length
        const c  = cite(trc)
        push({
          severity: 'error',
          ruleId:   'theaterRowClearMin',
          ruleLabel: 'Row clear',
          jurisdictionId:   c.id,
          jurisdictionName: c.name,
          code:    c.code,
          message: `Row pitch − chair depth = ${formatInches(clear)}; min is ${formatInches(trc.value)}.`,
          anchor:   { x: cx, y: cy },
          objectId: z.id,
        })
      }
    }
  }

  // ── Rounds back-to-back ─────────────────────────────────────────────────
  const rbb = result.strictest.roundsBackToBackMin
  if (rbb) {
    for (const z of seatingZones) {
      if (z.style !== 'rounds') continue
      const reported = z.tableSpacing || 60
      if (reported < rbb.value) {
        const cx = z.vertices.reduce((a, v) => a + v[0], 0) / z.vertices.length
        const cy = z.vertices.reduce((a, v) => a + v[1], 0) / z.vertices.length
        const c  = cite(rbb)
        push({
          severity: 'error',
          ruleId:   'roundsBackToBackMin',
          ruleLabel: 'Round-to-round spacing',
          jurisdictionId:   c.id,
          jurisdictionName: c.name,
          code:    c.code,
          message: `Configured spacing ${formatInches(reported)}; min is ${formatInches(rbb.value)}.`,
          anchor:   { x: cx, y: cy },
          objectId: z.id,
        })
      }
    }
  }

  // ── Stage clearance ─────────────────────────────────────────────────────
  const stg = result.strictest.stageClearanceMin
  if (stg && stageObjects.length) {
    for (const z of seatingZones) {
      const seats  = z.result?.seats || []
      const tables = z.result?.tables || []
      const items  = [...seats, ...tables]
      if (!items.length) continue
      for (const stage of stageObjects) {
        const r = { x1: stage.x, y1: stage.y, x2: stage.x + stage.w, y2: stage.y + stage.h }
        let nearest = Infinity, nx = 0, ny = 0
        for (const it of items) {
          const d = distanceFromPointToRect(it.x, it.y, r)
          if (d < nearest) { nearest = d; nx = it.x; ny = it.y }
        }
        if (nearest < stg.value) {
          const c = cite(stg)
          push({
            severity: 'error',
            ruleId:   'stageClearanceMin',
            ruleLabel: 'Stage clearance',
            jurisdictionId:   c.id,
            jurisdictionName: c.name,
            code:    c.code,
            message: `Nearest seat is ${formatInches(Math.round(nearest))} from stage; min is ${formatInches(stg.value)}.`,
            anchor:   { x: nx, y: ny },
            objectId: z.id,
          })
        }
      }
    }
  }

  return result
}

function distanceFromPointToRect(px, py, r) {
  const dx = Math.max(r.x1 - px, 0, px - r.x2)
  const dy = Math.max(r.y1 - py, 0, py - r.y2)
  return Math.hypot(dx, dy)
}
