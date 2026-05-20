# Export pipeline (PNG / PDF)

> Load this doc when touching `renderer/exportLayout.js`,
> `renderer/ui/exportDialog.js`, the title block, theme palette, paper /
> scale picker, or anything about PDF / PNG output.

## TL;DR

`buildExportSVG(opts)` returns a self-contained SVG string sized in
**paper inches** (outer viewBox), with world-coord content nested under
a `<g transform="translate ... scale ...">`. PNG export = SVG → canvas →
`toBlob`. PDF export = open a hidden BrowserWindow with the SVG inline
in HTML, then `webContents.printToPDF()` for true vector output. Theme
(light / dark) is picked in the dialog and threaded through a
module-level `PAL` object that every serializer reads from.

## The decisions / invariants (locked in)

- **Outer viewBox is PAPER inches.** Width/height set with `"in"` unit
  suffix. The nested transform group maps world inches → paper inches at
  the chosen scale.
- **Stroke widths inside the scaled group are in WORLD inches and scale
  DOWN with the transform.** A `stroke-width="1"` at 1:96 renders as
  ~0.01 paper inch. The `SW` table in exportLayout.js (`hair`/`thin`/
  `med`/`heavy`) keys off this convention.
- **`PAL` is a module-level variable, set at the top of every
  `buildExportSVG` call** based on `cfg.theme`. Every `serialize*`
  function reads from `PAL` (no parameter threading). This is the cost
  of avoiding a 300-line refactor; the price is: tests that call
  serializers directly without `buildExportSVG` first will see stale
  palette.
- **Two palettes: `LIGHT_PAL` (default) and `DARK_PAL`.** Light = white
  paper, dark-navy strokes (`#1a2942` replaces brand magenta for print
  legibility). Dark = navy paper, magenta strokes, mirrors the canvas.
- **Title block has three columns** and an accent-colored TOTAL SEATS
  headline in the right column. The accent flips with the theme (navy on
  light paper, magenta on dark paper) so the headline always has the
  brand color.
- **Scale picker:** `cfg.scale === 'auto'` finds the largest standard
  architectural scale (from `ENG_SCALES`) that fits the layout.
  Fallback: a custom fit-to-content scale labeled `"≈ Fit (N'/in)"` when
  nothing standard fits.
- **Fire marshal callouts render in PAPER coords** for fixed-size
  labels, but ANCHOR positions get transformed through the same
  drawing matrix.
- **Hidden layers are excluded from export** (`o.hidden` filter applied
  to room.objects + active layout.objects + dim labels). Locked layers
  are NOT filtered — they're hidden separately.
- **Seat-count labels are serialized too.** Same proximity clustering
  as the canvas (`clusterSeatsByProximity` from `solver/geom.js`).
  Round-tables-numbered mode uses the same serpentine ordering helper,
  intentionally duplicated in `exportLayout.js` rather than imported
  from `canvas.js` (canvas.js is renderer-only).
- **Last-used dialog settings persist in localStorage** (`STORE_KEY =
  'plottwist:export'`). `loadConfig` validates each field against
  current option sets so a stale-removed preset / scale falls back to
  defaults instead of selecting an invisible option.
- **PNG renders at user-picked DPI** (72/150/300/600). 150 is the
  default; 300 is "proposal-quality"; 600 is "archival." 72 is "for
  email."

## Code references

| File | What it owns |
|---|---|
| `renderer/exportLayout.js` | `buildExportSVG`, `LIGHT_PAL`/`DARK_PAL`, paper preset list, scale picker, all `serialize*` helpers, title block, fire-marshal callouts, seat-count labels in export. |
| `renderer/ui/exportDialog.js` | Page-setup modal, paper picker, scale picker, DPI picker, theme picker, fire-marshal toggle, localStorage persist, Export PNG / PDF triggers. |
| `main.js` (`export-pdf` IPC handler) | Hidden BrowserWindow with strict CSP, awaits image decode, calls `printToPDF` with paper size in microns. |

## What NOT to do

- ❌ **Don't call a `serialize*` function from outside `buildExportSVG`
  without setting `PAL` first.** They'll read whatever palette was last
  used (or the default).
- ❌ **Don't multiply stroke widths by `scale` when serializing.** The
  transform handles it. Stroke widths are in WORLD inches.
- ❌ **Don't pull color tokens straight from `colors.js` (BRAND/ANNOT)
  inside a serializer.** Route through `PAL`. Otherwise dark mode shows
  the wrong color.
- ❌ **Don't change the paper-inch unit on the outer SVG.** The PDF
  pipeline depends on paper-inch dimensions (`width="36in"`) plus the
  `printToPDF` pageSize in microns matching.
- ❌ **Don't skip the image-decode wait in `main.js` `export-pdf`.**
  The hidden BrowserWindow's `Promise.all(... .decode())` is the only
  thing that guarantees underlay images make it into the PDF.
- ❌ **Don't change the title-block layout without checking that the
  `cfg.titleBlockH` height accommodates 4 rows.** The middle column packs
  the per-style breakdown into rows 0.55–3.55 — adding rows means
  resizing.
- ❌ **Don't widen the CSP in the hidden PDF BrowserWindow.** It's
  intentionally strict (`default-src 'none'; img-src data:; style-src
  'unsafe-inline'`) as defense-in-depth — even though `buildExportSVG`
  escapes user-controlled strings, the CSP is the last-line guard.
