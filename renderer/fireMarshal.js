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
  wallClearanceMin:     'max',
  egressMaxDistance:    'min',
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
    summary:       {
      errors: 0, warnings: 0, info: 0,
      // Capacity numbers filled in below — shown prominently in the sheet header
      // so the user can answer "are we legal?" at a glance.
      occupancy:      0,    // total solver-placed seats across all visible seating zones
      egressRequired: 0,    // occupancy × aisleCapacityFactor (inches)
      egressPresent:  0,    // sum of door widths (inches)
      egressDeficit:  0,    // max(0, required - present)
    },
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
  const wallObjects  = (room?.objects || []).filter(o => o.type === 'walls' && o.kind === 'polygon')
  const doorObjects  = (room?.objects || []).filter(o => o.type === 'door'  && o.kind === 'rect')

  const totalOccupants = seatingZones.reduce((acc, z) => acc + (z.result?.totalSeats || 0), 0)

  const cite = (rule) => {
    const j = data.jurisdictions?.[rule.jurisdictionIds[0]]
    return { id: rule.jurisdictionIds[0], name: j?.name || rule.jurisdictionIds[0], code: rule.code }
  }

  // ── Aisle min width + occupancy factor ──────────────────────────────────
  const aRule = result.strictest.aisleMinWidth
  const fRule = result.strictest.aisleCapacityFactor
  if (aRule) {
    const required = Math.max(
      aRule.value,
      fRule ? Math.ceil(totalOccupants * fRule.value) : 0
    )
    const reasonFactor = fRule && totalOccupants * fRule.value > aRule.value
    const c = cite(aRule)
    const buildMsg = (narrow) => reasonFactor
      ? `Aisle is ${formatInches(narrow)}; ${totalOccupants} occupants × ${fRule.value} in/occ = ${formatInches(Math.ceil(totalOccupants * fRule.value))} required.`
      : `Aisle is ${formatInches(narrow)}; minimum is ${formatInches(required)}.`

    // User-drawn aisle rect objects in the layout.
    for (const a of aisleObjects) {
      const narrow = Math.min(Math.abs(a.w), Math.abs(a.h))
      if (narrow < required) {
        push({
          severity: 'error',
          ruleId:   reasonFactor ? 'aisleCapacityFactor' : 'aisleMinWidth',
          ruleLabel: 'Aisle width',
          jurisdictionId:   c.id,
          jurisdictionName: c.name,
          code:    c.code,
          message: buildMsg(narrow),
          anchor:   { x: a.x + a.w / 2, y: a.y + a.h / 2 },
          objectId: a.id,
        })
      }
    }

    // Auto-aisles configured per seating zone (zone.aisles.width). These
    // aren't standalone objects, so anchor on the zone's centroid.
    for (const z of seatingZones) {
      const auto = z.aisles?.count ?? (z.centerAisle?.enabled === false ? 0 : 1)
      const wAuto = Math.max(0, z.aisles?.width ?? z.centerAisle?.width ?? 144)
      if (auto > 0 && wAuto < required) {
        const cx = z.vertices.reduce((s, v) => s + v[0], 0) / z.vertices.length
        const cy = z.vertices.reduce((s, v) => s + v[1], 0) / z.vertices.length
        push({
          severity: 'error',
          ruleId:   reasonFactor ? 'aisleCapacityFactor' : 'aisleMinWidth',
          ruleLabel: 'Auto-aisle width',
          jurisdictionId:   c.id,
          jurisdictionName: c.name,
          code:    c.code,
          message: buildMsg(wAuto),
          anchor:   { x: cx, y: cy },
          objectId: z.id,
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
      // Skip the rule when the zone has no aisles at all (single section,
      // no internal aisle objects). The "max seats per row" rules govern
      // egress past an aisle — without one, this rule doesn't apply.
      const aisleCount = (z.aisles?.count != null) ? z.aisles.count
                       : (z.centerAisle?.enabled === false ? 0 : 1)
      const userAisleCount = (z.userAisles || []).length
      if (aisleCount + userAisleCount === 0) continue
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
        // Outer sections (first/last) only have an aisle at one end. Inner
        // sections have aisles at both ends.
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

  // ── Occupancy + egress-width totals ─────────────────────────────────────
  // Occupancy = total placed seats across visible seating zones. Egress width
  // required = occupancy × aisleCapacityFactor (level egress; stairs use 0.3).
  // Egress present = sum of door clear widths. Deficit (if any) becomes a
  // violation tied to the strictest jurisdiction's capacity factor.
  result.summary.occupancy = totalOccupants
  const capFactor = result.strictest.aisleCapacityFactor
  if (capFactor) {
    result.summary.egressRequired = Math.ceil(totalOccupants * capFactor.value)
  }
  result.summary.egressPresent = doorObjects.reduce(
    (sum, d) => sum + (d.width ?? Math.min(Math.abs(d.w), Math.abs(d.h))),
    0,
  )
  result.summary.egressDeficit = Math.max(
    0, result.summary.egressRequired - result.summary.egressPresent,
  )
  if (capFactor && result.summary.egressDeficit > 0 && totalOccupants > 0) {
    const c = cite(capFactor)
    push({
      severity: 'error',
      ruleId:   'aisleCapacityFactor',
      ruleLabel: 'Total egress width',
      jurisdictionId:   c.id,
      jurisdictionName: c.name,
      code:    c.code,
      message: `${totalOccupants} occupants need ${formatInches(result.summary.egressRequired)} of door egress; ` +
               `present is ${formatInches(result.summary.egressPresent)} (short by ${formatInches(result.summary.egressDeficit)}).`,
      anchor:   null,
      objectId: null,
    })
  }

  // ── Wall clearance (seat must clear nearest wall edge) ──────────────────
  const wcRule = result.strictest.wallClearanceMin
  if (wcRule && wallObjects.length) {
    for (const z of seatingZones) {
      const seats = z.result?.seats || []
      if (!seats.length) continue
      let nearest = Infinity, nx = 0, ny = 0
      for (const seat of seats) {
        for (const wall of wallObjects) {
          const verts = wall.vertices
          for (let i = 0; i < verts.length; i++) {
            const a = verts[i], b = verts[(i + 1) % verts.length]
            const d = distancePointToSegment(seat.x, seat.y, a[0], a[1], b[0], b[1])
            if (d < nearest) { nearest = d; nx = seat.x; ny = seat.y }
          }
        }
      }
      if (nearest < wcRule.value) {
        const c = cite(wcRule)
        push({
          severity: 'error',
          ruleId:   'wallClearanceMin',
          ruleLabel: 'Wall clearance',
          jurisdictionId:   c.id,
          jurisdictionName: c.name,
          code:    c.code,
          message: `Nearest seat is ${formatInches(Math.round(nearest))} from a wall; min is ${formatInches(wcRule.value)}.`,
          anchor:   { x: nx, y: ny },
          objectId: z.id,
        })
      }
    }
  }

  // ── Egress travel distance (any seat → nearest door) ────────────────────
  const emdRule = result.strictest.egressMaxDistance
  if (emdRule) {
    const limitInches = emdRule.value * 12   // rule.value is feet
    if (!doorObjects.length && seatingZones.some(z => z.result?.seats?.length)) {
      const c = cite(emdRule)
      push({
        severity: 'warn',
        ruleId:   'egressMaxDistance',
        ruleLabel: 'Egress doors',
        jurisdictionId:   c.id,
        jurisdictionName: c.name,
        code:    c.code,
        message: `No doors placed — egress travel distance can't be validated. Add door objects via the Door tool.`,
        anchor:   null,
        objectId: null,
      })
    }
    for (const z of seatingZones) {
      const seats = z.result?.seats || []
      if (!seats.length || !doorObjects.length) continue
      let worst = 0, wx = 0, wy = 0
      for (const seat of seats) {
        let nearest = Infinity
        for (const door of doorObjects) {
          const cx = door.x + door.w / 2, cy = door.y + door.h / 2
          const d = Math.hypot(seat.x - cx, seat.y - cy)
          if (d < nearest) nearest = d
        }
        if (nearest > worst) { worst = nearest; wx = seat.x; wy = seat.y }
      }
      if (worst > limitInches) {
        const c = cite(emdRule)
        push({
          severity: 'error',
          ruleId:   'egressMaxDistance',
          ruleLabel: 'Egress travel distance',
          jurisdictionId:   c.id,
          jurisdictionName: c.name,
          code:    c.code,
          message: `Furthest seat is ${(worst / 12).toFixed(0)}′ from the nearest door; max is ${emdRule.value}′.`,
          anchor:   { x: wx, y: wy },
          objectId: z.id,
        })
      }
    }
  }

  return result
}

function distancePointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function distanceFromPointToRect(px, py, r) {
  const dx = Math.max(r.x1 - px, 0, px - r.x2)
  const dy = Math.max(r.y1 - py, 0, py - r.y2)
  return Math.hypot(dx, dy)
}
