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
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Project',       accelerator: 'CmdOrCtrl+Shift+N', click: () => mainWindow.webContents.send('menu-new-project') },
        { label: 'Open Project…',     accelerator: 'CmdOrCtrl+O',       click: () => mainWindow.webContents.send('menu-open-project') },
        { label: 'Save Project',      accelerator: 'CmdOrCtrl+S',       click: () => mainWindow.webContents.send('menu-save-project') },
        { label: 'Save Project As…',  accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('menu-save-project-as') }
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
        { label: 'Toggle Developer Tools', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  createWindow()
  autoUpdater.checkForUpdatesAndNotify().catch(() => {})
})

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

ipcMain.handle('export-image-dialog', async (_e, defaultName) => {
  return dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'layout.png',
    filters: [
      { name: 'PNG Image', extensions: ['png'] },
      { name: 'PDF Document', extensions: ['pdf'] }
    ]
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
