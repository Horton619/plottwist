// Rectangle drawing tool — used for floor, aisle, obstruction, stage, tech,
// and (since seating zones are rectangular by default) seating.

import { state, mutateProject, setState, uid, activeRoom } from '../state.js'
import { rerenderTools } from '../canvas.js'
import { STYLE_DEFAULTS, getLabelDefaults } from './polygonTool.js'
import { getSetting } from '../settings.js'

// Object types that live in the active layout instead of the room.
const LAYOUT_TYPES = new Set(['seating', 'aisle'])

export function startRectDraw(type, [x, y]) {
  state.drawingRect = { type, startX: x, startY: y, x, y, w: 0, h: 0 }
  rerenderTools()
}

export function updateRectDraw([x, y]) {
  const dr = state.drawingRect
  if (!dr) return
  dr.w = x - dr.startX
  dr.h = y - dr.startY
  dr.x = dr.startX
  dr.y = dr.startY
  rerenderTools()
}

export function endRectDraw() {
  const dr = state.drawingRect
  state.drawingRect = null
  if (!dr) return rerenderTools()
  // Normalize negative dimensions
  let x = dr.x, y = dr.y, w = dr.w, h = dr.h
  if (w < 0) { x = x + w; w = -w }
  if (h < 0) { y = y + h; h = -h }
  if (w < 6 || h < 6) {                     // ignore micro-rects (< 6")
    rerenderTools()
    return
  }
  const id = uid('obj')
  mutateProject(p => {
    const room = p.rooms.find(r => r.id === state.activeRoomId)
    if (!room) return

    // Seating zones are stored as 4-vertex polygons so the solver code path
    // and vertex-edit handles work uniformly. The rect drag is just a faster
    // entry point — the user can right-click to add vertices later for an
    // L-shape or trapezoid.
    let obj
    if (dr.type === 'seating') {
      obj = {
        id, kind: 'polygon', type: 'seating',
        vertices: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
        ...defaultSeatingZoneFields(),
      }
    } else if (dr.type === 'door') {
      // Door is a rect; the long axis is the opening width, the short axis
      // is the swing radius. Override drag dimensions with the session
      // defaults: drag direction picks orientation, rest comes from the
      // last-set door spec.
      const spec = { ...getDoorDefaults() }
      const widthIn = spec.width
      const isHorizontal = w >= h
      const ww = isHorizontal ? widthIn : widthIn   // opening width
      const dd = widthIn                            // swing radius == width (90° quarter circle)
      // Position the door so the drag start point is at the door's threshold
      // midpoint when possible; for now keep the user's rect origin.
      const ox = isHorizontal ? x : x
      const oy = isHorizontal ? y : y
      obj = {
        id, kind: 'rect', type: 'door',
        x: ox, y: oy,
        w: isHorizontal ? ww : dd,
        h: isHorizontal ? dd : ww,
        width:  widthIn,
        swing:  spec.swing,
        opens:  spec.opens,
        hinge:  spec.hinge,
      }
    } else {
      obj = { id, kind: 'rect', type: dr.type, x, y, w, h }
    }

    if (LAYOUT_TYPES.has(dr.type)) {
      // Layout-type objects (seating, aisle) MUST live on a layout. Prefer
      // the active layout; fall back to the room's first layout if for any
      // reason activeLayoutId is stale. Pushing a seating zone to room.objects
      // was a previously-seen bug — never do it.
      const layouts = room.layouts || []
      const layout  = layouts.find(l => l.id === state.activeLayoutId) || layouts[0]
      if (!layout) { console.warn('rectTool: no layout available for', dr.type); return }
      layout.objects.push(obj)
    } else {
      room.objects.push(obj)
    }
  })
  setState({ selection: [id], activeTool: 'select' })
}

// Session defaults for new doors. Initial: dual swing, 6′ wide, opens out.
// When the user edits a door's width / swing in Object Info, those values
// become the new defaults for subsequent doors drawn this session.
let SESSION_DOOR_DEFAULTS = {
  width: 72,           // inches; 6′ dual default per user spec (3′ for single)
  swing: 'dual',
  opens: 'out',
  hinge: 'left',
}
export function getDoorDefaults()       { return { ...SESSION_DOOR_DEFAULTS } }
export function setDoorDefaults(patch)  {
  SESSION_DOOR_DEFAULTS = { ...SESSION_DOOR_DEFAULTS, ...patch }
  // Default width reflects current swing if width wasn't explicitly set.
  if (patch.swing && patch.width == null) {
    SESSION_DOOR_DEFAULTS.width = patch.swing === 'dual' ? 72 : 36
  }
}

// Defaults for a freshly-drawn theater seating zone. Mirrors the polygon-tool
// version; both call sites stay in sync because they pull from STYLE_DEFAULTS.
function defaultSeatingZoneFields() {
  return {
    style:        'theater',
    pattern:      'straight',
    rotation:     0,
    target:       null,        // null/undefined = no cap; user enables via "Goal"
    preference:   'max',       // 'max' = fill the zone; 'exact' = aim for target
    chairW:       18,
    chairD:       20,
    aisles:       { count: 1, width: getSetting('defaultAisleWidth') },
    result:       null,
    seatCountLabel:  { ...getLabelDefaults() },
    tableNumbering:  { show: false, corner: 'tl', direction: 'h' },
    ...STYLE_DEFAULTS.theater,
    // Settings overrides — pull live values from preferences when creating
    // a new zone so the user's defaults take effect immediately.
    rowSpacing:   getSetting('defaultTheaterRowSpacing'),
  }
}
