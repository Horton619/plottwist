// Inline SVG icons. currentColor lets the parent .layer-toggle / button
// control them via CSS, matching Photoshop's monochrome style.

export const ICON = {
  eyeOpen: `
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M2 8 Q 8 3 14 8 Q 8 13 2 8 Z" fill="none" stroke="currentColor" stroke-width="1.3"/>
      <circle cx="8" cy="8" r="2" fill="currentColor"/>
    </svg>
  `,
  eyeClosed: `
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M2 8 Q 8 3 14 8 Q 8 13 2 8 Z" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.45"/>
      <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.45"/>
      <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  `,
  lockClosed: `
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M5.4 7.5 V 5 Q 5.4 2 8 2 Q 10.6 2 10.6 5 V 7.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <rect x="3.5" y="7.3" width="9" height="6.7" rx="1.2" fill="currentColor"/>
    </svg>
  `,
  lockOpen: `
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M5.4 7.5 V 5 Q 5.4 2 8 2 Q 10.6 2 10.6 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <rect x="3.5" y="7.3" width="9" height="6.7" rx="1.2" fill="currentColor"/>
    </svg>
  `,
}
