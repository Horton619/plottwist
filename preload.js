const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('plottwist', {
  // File dialogs
  openProjectDialog:  ()             => ipcRenderer.invoke('open-project-dialog'),
  saveProjectDialog:  (defaultName)  => ipcRenderer.invoke('save-project-dialog', defaultName),
  openImageDialog:    ()             => ipcRenderer.invoke('open-image-dialog'),
  exportImageDialog:  (defaultName, kind)  => ipcRenderer.invoke('export-image-dialog', defaultName, kind),

  // File system
  readFile:           (filePath)              => ipcRenderer.invoke('read-file', filePath),
  readBinaryFile:     (filePath)              => ipcRenderer.invoke('read-binary-file', filePath),
  writeFile:          (filePath, content)     => ipcRenderer.invoke('write-file', filePath, content),
  writeBinaryFile:    (filePath, base64)      => ipcRenderer.invoke('write-binary-file', filePath, base64),
  showItemInFolder:   (filePath)              => ipcRenderer.invoke('show-item-in-folder', filePath),

  // App menu events
  onMenuEvent: (cb) => {
    const events = ['menu-new-project', 'menu-open-project', 'menu-save-project', 'menu-save-project-as', 'menu-save-and-quit', 'menu-insert-image', 'menu-open-settings', 'menu-fire-marshal', 'menu-export-layout']
    events.forEach(ev => ipcRenderer.on(ev, () => cb(ev)))
  },

  // Bundled resources (data files shipped with the app).
  readBundledResource: (relPath) => ipcRenderer.invoke('read-bundled-resource', relPath),

  // Vector PDF export — main process renders the SVG via printToPDF.
  exportPdf: (args) => ipcRenderer.invoke('export-pdf', args),

  // Dirty-state tracking for unsaved-changes prompt
  setDirty: (dirty) => ipcRenderer.invoke('set-dirty', dirty),
  quitNow:  ()      => ipcRenderer.invoke('quit-now'),

  // App / updates
  getAppVersion:   () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate:  () => ipcRenderer.invoke('download-update'),
  installUpdate:   () => ipcRenderer.invoke('install-update'),
  // Streams every electron-updater state transition (checking / available /
  // progress / downloaded / error) on a single channel. Callback receives
  // a payload object with a `type` field plus event-specific fields.
  onUpdateStatus:  (cb) => ipcRenderer.on('update-status', (_e, payload) => cb(payload)),
  openExternal:    (url) => ipcRenderer.invoke('open-external', url),
})
