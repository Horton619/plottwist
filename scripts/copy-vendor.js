// Postinstall: copy third-party assets the renderer loads at runtime into
// renderer/vendor/. Lets us serve pdfjs under our existing 'self' CSP without
// reaching into node_modules from the browser side.

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

function copy(srcPath, dstPath) {
  fs.mkdirSync(path.dirname(dstPath), { recursive: true })
  fs.copyFileSync(srcPath, dstPath)
}

// pdfjs — module + worker, loaded lazily on first PDF import
const pdfjsSrc = path.join(root, 'node_modules', 'pdfjs-dist', 'build')
if (fs.existsSync(pdfjsSrc)) {
  for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
    copy(path.join(pdfjsSrc, f), path.join(root, 'renderer', 'vendor', 'pdfjs', f.replace('.min', '')))
  }
  console.log('[copy-vendor] pdfjs → renderer/vendor/pdfjs')
} else {
  console.warn('[copy-vendor] pdfjs-dist not installed — skipping.')
}

// polygon-clipping — UMD bundle, loaded synchronously as window.polygonClipping
const pcSrc = path.join(root, 'node_modules', 'polygon-clipping', 'dist', 'polygon-clipping.umd.min.js')
if (fs.existsSync(pcSrc)) {
  copy(pcSrc, path.join(root, 'renderer', 'vendor', 'polygon-clipping', 'polygon-clipping.min.js'))
  console.log('[copy-vendor] polygon-clipping → renderer/vendor/polygon-clipping')
} else {
  console.warn('[copy-vendor] polygon-clipping not installed — skipping.')
}
