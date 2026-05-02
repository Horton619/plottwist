// Shared HTML / SVG escaping. Used everywhere we interpolate user-controlled
// strings into innerHTML or SVG markup. Escapes the standard five characters
// (`& < > " '`) — safe for both attribute and text contexts.

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ESC_MAP[c])
}

// Alias for code that reads better when the surrounding context is an HTML
// attribute or an SVG-text body — the escaping is identical.
export const escapeAttr = escapeHtml
export const escapeText = escapeHtml
