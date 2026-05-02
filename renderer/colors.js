// Color tokens for world-space rendering (canvas + export). Brand values are
// shared; some annotation colors have separate canvas/paper variants — the
// canvas runs on a dark navy background and the export runs on white paper,
// so dim and aisle annotations are tuned darker for paper legibility.
//
// CSS chrome colors (modal headers, etc.) live in styles.css as :root vars
// and intentionally mirror BRAND values. Update both in lockstep:
//   --accent     ↔ BRAND.chair
//   --violation  ↔ BRAND.violation

export const BRAND = {
  chair:     '#FF2D9D',         // magenta — chairs, table outline, brand accent
  violation: '#FF3B30',         // red — fire marshal callouts
  tableFill: '#1a1f2e',         // table inner fill — dark navy, reads on either bg
  centerline: '#5be7d4',        // teal — project centerline guide
}

// Annotation colors with deliberate canvas vs paper variants.
export const ANNOT = {
  dim:   { canvas: '#5be7d4', paper: '#0fa999' },   // dim-line teal
  aisle: { canvas: '#d4a72c', paper: '#a87a00' },   // aisle-callout gold
}
