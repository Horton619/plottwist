// Postinstall: copy third-party assets the renderer loads at runtime into
// renderer/vendor/. Lets us serve pdfjs under our existing 'self' CSP without
// reaching into node_modules from the browser side.

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

const PDFJS_FILES = ['pdf.min.mjs', 'pdf.worker.min.mjs']
const pdfjsSrc = path.join(root, 'node_modules', 'pdfjs-dist', 'build')
const pdfjsDst = path.join(root, 'renderer', 'vendor', 'pdfjs')

if (!fs.existsSync(pdfjsSrc)) {
  console.warn('[copy-vendor] pdfjs-dist not installed yet — skipping.')
  process.exit(0)
}

fs.mkdirSync(pdfjsDst, { recursive: true })
for (const f of PDFJS_FILES) {
  const from = path.join(pdfjsSrc, f)
  const to   = path.join(pdfjsDst, f.replace('.min', ''))   // drop the .min suffix in the dest
  fs.copyFileSync(from, to)
}
console.log(`[copy-vendor] pdfjs → ${path.relative(root, pdfjsDst)}`)
