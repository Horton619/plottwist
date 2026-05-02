// settings.js — global app settings persisted in localStorage.
//
// All keys default to a sensible value via SETTINGS_DEFAULTS; getSetting()
// returns the user's override if any, else the default. setSetting() writes
// the override (and clears it if the new value matches the default to keep
// localStorage tidy). Subscribers are notified on every change.

const KEY_PREFIX = 'plottwist:settings'

export const SETTINGS_DEFAULTS = {
  // Workspace — affect live editing.
  showGrid:            true,
  gridSpacing:         'auto',         // 'auto' | inches (number)
  snapEnabled:         true,
  snapTolerance:       8,               // pixels
  centerlineEnabled:   false,
  centerlineColor:     '#5be7d4',
  centerlineThickness: 1.5,

  // Defaults — pre-fill values for new seating zones / interactions.
  nudgeSmall:                12,        // 1'-0"
  nudgeLarge:                72,        // 6'-0"
  defaultTheaterRowSpacing:  40,
  defaultClassroomRowSpacing: 54,
  defaultAisleWidth:         144,       // 12'-0"
  defaultMixedTransitionGap: 72,        // 6'-0"
  defaultRoundTableSize:     72,
  defaultRoundChairCount:    10,
  defaultRoundTableSpacing:  60,
  autoSaveInterval:          0,         // minutes (0 = off)
  undoDepth:                 80,

  // Updates.
  autoCheckUpdates:    true,
}

const listeners = new Set()

export function getSetting(key) {
  if (!(key in SETTINGS_DEFAULTS)) return undefined
  const stored = localStorage.getItem(`${KEY_PREFIX}:${key}`)
  if (stored === null) return SETTINGS_DEFAULTS[key]
  try { return JSON.parse(stored) } catch { return SETTINGS_DEFAULTS[key] }
}

export function setSetting(key, value) {
  if (!(key in SETTINGS_DEFAULTS)) return
  if (value == null || JSON.stringify(value) === JSON.stringify(SETTINGS_DEFAULTS[key])) {
    localStorage.removeItem(`${KEY_PREFIX}:${key}`)
  } else {
    localStorage.setItem(`${KEY_PREFIX}:${key}`, JSON.stringify(value))
  }
  notify()
}

export function resetAllSettings() {
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    localStorage.removeItem(`${KEY_PREFIX}:${key}`)
  }
  notify()
}

export function onSettingsChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify() {
  for (const fn of listeners) try { fn() } catch (e) { console.error(e) }
}
