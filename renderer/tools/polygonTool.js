// Polygon drawing tool. Click to place vertices, shift to snap to
// 0/45/90° increments, double-click or Enter to close, Esc to cancel.
//
// The same gesture creates either a structural polygon in the venue
// (room.objects) or a seating zone in the active layout, depending on the
// `type` set by the caller.

import { state, mutateProject, setState, uid } from '../state.js'
import { rerenderTools } from '../canvas.js'

// Object types that live in the active layout instead of the room.
// Seating now defaults to rectangle drawing (see rectTool); polygon entry
// for seating is reserved for future "advanced" use.
const LAYOUT_TYPES = new Set(['aisle'])

export function startPolygonDraw(point) {
  state.drawingPolygon = { vertices: [point], cursor: point, shiftSnap: false }
  rerenderTools()
}

export function addPolygonVertex(point) {
  if (!state.drawingPolygon) return
  const verts = state.drawingPolygon.vertices
  const last = verts[verts.length - 1]
  if (last[0] === point[0] && last[1] === point[1]) return
  verts.push(point)
  rerenderTools()
}

export function cancelPolygonDraw() {
  state.drawingPolygon = null
  rerenderTools()
}

// `type` defaults to walls (venue) but the seating tool passes 'seating' so the
// new polygon lands in the active layout with seating-zone defaults.
export function finishPolygonDraw(type = 'walls') {
  const dp = state.drawingPolygon
  state.drawingPolygon = null
  if (!dp || dp.vertices.length < 3) {
    rerenderTools()
    return
  }
  const id = uid('obj')
  const goesToLayout = LAYOUT_TYPES.has(type)
  mutateProject(p => {
    const room = p.rooms.find(r => r.id === state.activeRoomId)
    if (!room) return
    const obj = { id, kind: 'polygon', type, vertices: dp.vertices.slice() }
    if (type === 'seating') {
      Object.assign(obj, defaultSeatingZone())
    }
    if (goesToLayout) {
      const layout = (room.layouts || []).find(l => l.id === state.activeLayoutId)
      if (!layout) return
      layout.objects.push(obj)
    } else {
      room.objects.push(obj)
    }
  })
  setState({ selection: [id], activeTool: 'select' })
}

// Defaults for a freshly-drawn theater seating zone. Style-specific fields
// (rowSpacing, table dims, etc.) come from STYLE_DEFAULTS so the user can
// change style later without losing zone geometry.
function defaultSeatingZone() {
  return {
    style:        'theater',
    pattern:      'straight',
    rotation:     0,         // 0=up, 90=right, 180=down, 270=left
    target:       null,
    preference:   'max',     // 'max' = fill the zone; 'exact' = cap at target
    chairW:       18,
    chairD:       20,
    aisles:       { count: 1, width: 144 },        // 1 = single center aisle (12' default)
    result:       null,
    ...STYLE_DEFAULTS.theater,
  }
}

// Style-specific defaults. Applied when the zone is first created and when
// the user picks a new style in the Object Info panel (only fields they
// haven't touched should change — see applyStyleDefaults in objectInfo.js).
export const STYLE_DEFAULTS = {
  theater: {
    // Front-to-front pitch. Default 40" = 20" chair + 20" behind-chair clearance
    // (one chair-depth of breathing room between rows). Tighten to 20" for a
    // packed lecture-hall feel; widen for ballroom-style rows.
    rowSpacing: 40,
    maxPerRow:  12,
    seatGap:    0,
    chevron:      false,
    chevronAngle: 15,    // degrees
  },
  classroom: {
    rowSpacing:     54,    // 4'-6" front-to-front
    tableW:         96,    // 8'×18" table — most common hotel banquet
    tableD:         18,
    chairsPerTable: 3,
    tableGap:       0,
    maxPerRow:      9999,  // gate is "tables fit", not seat count
    chevron:      false,
    chevronAngle: 15,
  },
  rounds: {
    // Rounds default to 72" with 10 chairs (full circle). Chair count drives
    // the layout: ≤ 6 chairs renders crescent (audience-facing), 7+ renders
    // full circle. The user can change diameter via the Table-size dropdown
    // (60 / 72 / Custom) and chair count freely.
    tableD:         72,
    chairsPerTable: 10,
    tableSpacing:   60,    // 5' edge-to-edge
    // Default true → tables distribute evenly across each section.
    // Uncheck to push tables flush against the aisle edge with slack
    // accumulating at the polygon's outer edges instead.
    fixedAisles:    true,
    // Offset rows: alternate rows shift x by half-pitch (proper hex packing).
    // Adjacent diagonal table centers stay the same distance apart as same-row
    // neighbors, just at a 60° angle instead of 90°.
    offsetRows:     false,
  },
  mixed: {
    // Mixed splits the zone front (classroom) / back (theater). The 50/50
    // default is set on style switch (objectInfo) based on polygon height,
    // accounting for the transition gap between sections.
    classroomDepth:     0,    // overwritten with (polyH - transitionGap)/2 on style switch
    transitionGap:      72,   // 6' walkway between classroom and theater
    rowSpacing:         40,   // theater section (chair + chair-depth gap)
    rowSpacingClassroom: 54,  // classroom section
    tableW:             72,   // 6' default
    tableD:             18,
    chairsPerTable:     2,    // 2 seats per 6' table
    maxPerRow:          12,
    seatGap:            0,
    chevron:           false,
    chevronAngle:      15,
  },
}

// Standard hotel-banquet table presets — drives the classroom dropdown.
// Seat counts are CLAUDE.md defaults (banquet standard, not max).
export const TABLE_PRESETS = [
  { id: '6x18', label: "6' × 18\"", w: 72, d: 18, seats: 2 },
  { id: '8x18', label: "8' × 18\"", w: 96, d: 18, seats: 3 },
  { id: '6x30', label: "6' × 30\"", w: 72, d: 30, seats: 3 },
  { id: '8x30', label: "8' × 30\"", w: 96, d: 30, seats: 4 },
]

// Round-table size presets — diameter only. Chair count is independent
// (the next field down), and crescent vs full circle is auto-derived from
// the chair count: ≤ 6 chairs → crescent, ≥ 7 → full.
export const ROUND_PRESETS = [
  { id: '60', label: '60"', d: 60 },
  { id: '72', label: '72"', d: 72 },
]

// Mixed-style table presets — narrower subset since mixed wants the
// classroom rows to share floor-space evenly with theater behind. The full
// 8'×30" preset is excluded because it eats too much depth for mixed layouts.
export const MIXED_TABLE_PRESETS = [
  { id: '6x18', label: "6' × 18\"", w: 72, d: 18 },
  { id: '8x18', label: "8' × 18\"", w: 96, d: 18 },
  { id: '6x30', label: "6' × 30\"", w: 72, d: 30 },
]
