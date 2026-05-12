const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const { autoUpdater } = require('electron-updater')

let mainWindow
let projectDirty = false
let userConfirmedQuit = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#070910',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile('renderer/index.html')

  // Forward renderer console output to main stdout — handy in dev.
  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_e, level, msg, line, source) => {
      const tag = ['log', 'warn', 'error'][level] || 'info'
      console.log(`[renderer ${tag}] ${msg}${source ? ` (${source}:${line})` : ''}`)
    })
  }

  mainWindow.on('close', (e) => {
    if (userConfirmedQuit || !projectDirty) return
    e.preventDefault()
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type:      'warning',
      buttons:   ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId:  2,
      message:   'You have unsaved changes.',
      detail:    'Save them before quitting?'
    })
    if (choice === 0) {
      mainWindow.webContents.send('menu-save-and-quit')
    } else if (choice === 1) {
      userConfirmedQuit = true
      mainWindow.close()
    }
  })

  const template = [
    {
      label: 'PlotTwist',
      submenu: [
        { label: 'About PlotTwist', role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow.webContents.send('menu-open-settings') },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Project',       accelerator: 'CmdOrCtrl+Shift+N', click: () => mainWindow.webContents.send('menu-new-project') },
        { label: 'Open Project…',     accelerator: 'CmdOrCtrl+O',       click: () => mainWindow.webContents.send('menu-open-project') },
        { label: 'Save Project',      accelerator: 'CmdOrCtrl+S',       click: () => mainWindow.webContents.send('menu-save-project') },
        { label: 'Save Project As…',  accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('menu-save-project-as') },
        { type: 'separator' },
        { label: 'Insert Image…',     accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWindow.webContents.send('menu-insert-image') },
        { type: 'separator' },
        { label: 'Export Layout…',    accelerator: 'CmdOrCtrl+E',       click: () => mainWindow.webContents.send('menu-export-layout') }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', role: 'cut' },
        { label: 'Copy', role: 'copy' },
        { label: 'Paste', role: 'paste' },
        { label: 'Select All', role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Developer Tools', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() },
        { type: 'separator' },
        // TEMP — remove before ship. Quick "kill app + relaunch" for dev iteration.
        { label: 'Restart App', accelerator: 'CmdOrCtrl+Shift+R',
          click: () => { app.relaunch(); app.exit(0) } },
      ]
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Fire Marshal Check…', accelerator: 'CmdOrCtrl+Shift+F',
          click: () => mainWindow.webContents.send('menu-fire-marshal') },
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  createWindow()
  wireAutoUpdater()
})

// ── Auto-updater ──────────────────────────────────────────────────────────
// Forwards every electron-updater event to the renderer on a single channel
// ('update-status'). The renderer subscribes once and paints state from
// there — no per-event IPC sprawl. Pattern adopted from FlowCast v1.0.7
// after the silent-failure bug in 1.0.4 — make the state visible.

function sendUpdateStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', payload)
  }
}

function wireAutoUpdater() {
  autoUpdater.autoDownload         = false   // ask the user first
  autoUpdater.autoInstallOnAppQuit = true    // staged update applies on quit if user dismisses

  autoUpdater.on('checking-for-update',  ()    => sendUpdateStatus({ type: 'checking' }))
  autoUpdater.on('update-available',     (i)   => sendUpdateStatus({ type: 'available', version: i.version }))
  autoUpdater.on('update-not-available', ()    => sendUpdateStatus({ type: 'not-available', version: app.getVersion() }))
  autoUpdater.on('download-progress',    (p)   => sendUpdateStatus({
    type: 'progress',
    percent:         p.percent,
    bytesPerSecond:  p.bytesPerSecond,
    transferred:     p.transferred,
    total:           p.total,
  }))
  autoUpdater.on('update-downloaded',    (i)   => sendUpdateStatus({ type: 'downloaded', version: i.version }))
  autoUpdater.on('error',                (err) => sendUpdateStatus({ type: 'error', message: err?.message || String(err) }))

  // Launch-time check — packaged builds only. Delay 60s so the GitHub
  // releases atom feed has time to refresh (it caches several minutes).
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(err => {
      sendUpdateStatus({ type: 'error', message: err?.message || String(err) })
    }), 60_000)
  }
}

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('set-dirty', (_e, dirty) => { projectDirty = !!dirty })

ipcMain.handle('quit-now', () => {
  userConfirmedQuit = true
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
})

ipcMain.handle('get-app-version', () => app.getVersion())

// Opens an HTTPS URL in the user's default browser. Restricted to http/https
// to avoid letting the renderer launch arbitrary URI schemes.
ipcMain.handle('open-external', async (_event, url) => {
  if (typeof url !== 'string') return false
  if (!/^https?:\/\//i.test(url)) return false
  try { await shell.openExternal(url); return true } catch { return false }
})

// Manual "Check now" entry point. Returns a one-shot result for the UI to
// display immediately, but the renderer also receives the full event stream
// via 'update-status' so progress/downloaded/error states paint live.
ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result || !result.updateInfo) return { ok: true, available: false, version: app.getVersion() }
    const remote = result.updateInfo.version
    return { ok: true, available: remote && remote !== app.getVersion(), version: remote }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// User said yes to "download the update?" — kick off the download. Progress
// + completion arrive via the 'update-status' event stream.
ipcMain.handle('download-update', async () => {
  try { await autoUpdater.downloadUpdate(); return { ok: true } }
  catch (err) { return { ok: false, error: err?.message || String(err) } }
})

// User clicked "Restart now" in the banner. Squirrel.Mac swaps the .app
// and relaunches as the new version.
ipcMain.handle('install-update', () => {
  // setImmediate gives the IPC ack time to flush before we quit.
  setImmediate(() => autoUpdater.quitAndInstall())
})

ipcMain.handle('open-project-dialog', async () => {
  return dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'PlotTwist Project', extensions: ['ptwist'] }]
  })
})

ipcMain.handle('save-project-dialog', async (_e, defaultName) => {
  return dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'Untitled.ptwist',
    filters: [{ name: 'PlotTwist Project', extensions: ['ptwist'] }]
  })
})

ipcMain.handle('open-image-dialog', async () => {
  return dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images and PDFs', extensions: ['png', 'jpg', 'jpeg', 'pdf'] },
      { name: 'PNG',              extensions: ['png'] },
      { name: 'JPEG',             extensions: ['jpg', 'jpeg'] },
      { name: 'PDF',              extensions: ['pdf'] }
    ]
  })
})

ipcMain.handle('read-binary-file', (_e, filePath) => {
  return fs.readFileSync(filePath)
})

ipcMain.handle('export-image-dialog', async (_e, defaultName, kind) => {
  // Order matters — first filter is the dropdown's default selection.
  const png = { name: 'PNG Image',   extensions: ['png'] }
  const pdf = { name: 'PDF Document', extensions: ['pdf'] }
  const filters = kind === 'pdf' ? [pdf, png] : [png, pdf]
  return dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || (kind === 'pdf' ? 'layout.pdf' : 'layout.png'),
    filters,
  })
})

ipcMain.handle('read-file', (_e, filePath) => {
  return fs.readFileSync(filePath, 'utf8')
})

ipcMain.handle('write-file', (_e, filePath, content) => {
  fs.writeFileSync(filePath, content, 'utf8')
})

ipcMain.handle('write-binary-file', (_e, filePath, base64) => {
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
})

ipcMain.handle('show-item-in-folder', (_e, filePath) => {
  shell.showItemInFolder(filePath)
})

// Bundled-resource read — resolves a path relative to the app root so the
// renderer can pull data files that ship with the app (e.g. data/fireCode.json)
// without knowing the absolute install path.
ipcMain.handle('read-bundled-resource', (_e, relPath) => {
  const safe = String(relPath || '').replace(/^[/\\]+/, '')
  const abs = path.join(app.getAppPath(), safe)
  if (!abs.startsWith(app.getAppPath())) throw new Error('path outside app root')
  return fs.readFileSync(abs, 'utf8')
})

// Vector PDF export — wraps the renderer-provided SVG in a print-friendly
// HTML page sized to the paper, loads it into a hidden BrowserWindow, and
// uses webContents.printToPDF() to produce a true-vector PDF.
ipcMain.handle('export-pdf', async (_e, { svg, paperW, paperH, savePath }) => {
  let win
  try {
    if (!svg || !paperW || !paperH || !savePath) throw new Error('missing args')
    // Defense-in-depth: even though exportLayout escapes user-controlled
    // strings before they reach the SVG, the print window enforces a strict
    // CSP that blocks scripts and external loads. Only inline images
    // (data URLs) and the inline @page style are permitted.
    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;">
<style>
  @page { size: ${paperW}in ${paperH}in; margin: 0; }
  html, body { margin: 0; padding: 0; width: ${paperW}in; height: ${paperH}in; background: #fff; }
  svg { display: block; width: 100%; height: 100%; }
</style></head><body>${svg}</body></html>`

    win = new BrowserWindow({
      show: false,
      width:  Math.max(400, Math.round(paperW * 96)),
      height: Math.max(400, Math.round(paperH * 96)),
      webPreferences: {
        offscreen: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf-8').toString('base64'))
    // SVG <image href="data:..."> tags inside the PDF page may not have
    // finished decoding by the time did-finish-load resolves. Wait for every
    // image to decode (or fail) before printing — otherwise PDFs can land
    // missing the underlay raster entirely.
    await win.webContents.executeJavaScript(`
      Promise.all(
        Array.from(document.querySelectorAll('image, img'))
          .map(el => {
            if (typeof el.decode === 'function') return el.decode().catch(() => null)
            return new Promise(res => { if (el.complete) res(); else { el.onload = res; el.onerror = res } })
          })
      ).then(() => true)
    `, true)
    // 1 inch = 25,400 microns. Pass page size in microns so Chromium honors
    // the exact paper dimensions regardless of DPI.
    const pdf = await win.webContents.printToPDF({
      pageSize: { width: paperW * 25400, height: paperH * 25400 },
      margins:  { marginType: 'none' },
      printBackground:    true,
      preferCSSPageSize:  true,
    })
    fs.writeFileSync(savePath, pdf)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    if (win && !win.isDestroyed()) win.close()
  }
})
