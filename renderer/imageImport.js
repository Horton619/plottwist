// Convert dropped/pasted/picked files into image data we can embed.
// PNG and JPEG are wrapped as base64 data URLs directly. PDFs are rasterized
// to PNG via pdfjs (lazy-loaded the first time a PDF is imported).

let pdfjsLib = null

async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib
  pdfjsLib = await import('./vendor/pdfjs/pdf.mjs')
  pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.mjs'
  return pdfjsLib
}

function bytesToBase64(bytes) {
  // Chunk to avoid blowing the call stack on large files.
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

async function imageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('Image failed to decode.'))
    img.src = dataUrl
  })
}

async function pdfFirstPageToDataUrl(arrayBuffer) {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const page = await doc.getPage(1)
  // 2x scale so text/lines stay crisp when the user zooms in.
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width  = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  return {
    dataUrl: canvas.toDataURL('image/png'),
    naturalWidth:  canvas.width  / 2,    // back to PDF-pt-equivalent
    naturalHeight: canvas.height / 2,
    pageCount: doc.numPages,
  }
}

// Accepts either a Blob/File or { arrayBuffer, mimeType, name }. Returns
// { dataUrl, naturalWidth, naturalHeight, name, sourceType }.
export async function importImageSource(input) {
  let arrayBuffer, mimeType, name

  if (input instanceof Blob) {
    arrayBuffer = await input.arrayBuffer()
    mimeType    = input.type
    name        = input.name || 'pasted-image'
  } else {
    arrayBuffer = input.arrayBuffer
    mimeType    = input.mimeType
    name        = input.name
  }

  // Sniff: PDF magic bytes are "%PDF" (0x25 0x50 0x44 0x46)
  const head = new Uint8Array(arrayBuffer, 0, 4)
  const isPdf = (mimeType && mimeType.includes('pdf'))
              || (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)

  if (isPdf) {
    const r = await pdfFirstPageToDataUrl(arrayBuffer)
    return { ...r, name: stripExt(name) || 'PDF', sourceType: 'pdf' }
  }

  // PNG/JPEG path
  const bytes = new Uint8Array(arrayBuffer)
  const mime  = mimeType && mimeType.startsWith('image/') ? mimeType : sniffImageMime(bytes) || 'image/png'
  const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`
  const dims = await imageDimensions(dataUrl)
  return { dataUrl, naturalWidth: dims.w, naturalHeight: dims.h, name: stripExt(name) || 'Image', sourceType: 'image' }
}

function sniffImageMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  return null
}

function stripExt(name) {
  if (!name) return ''
  return String(name).replace(/\.[^.]+$/, '')
}
