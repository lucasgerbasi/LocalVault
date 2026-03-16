// preload.js

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Lock/Create screen
  getVaultStatus:  () => ipcRenderer.invoke('get-vault-status'),
  createVault:     (masterPassword) => ipcRenderer.send('create-vault', masterPassword),
  unlockVault:     (masterPassword) => ipcRenderer.send('unlock-vault', masterPassword),

  // Use 'on' but expose a cleanup so the renderer can remove old listeners on re-mount
  onUnlockFailed:  (callback) => {
    ipcRenderer.removeAllListeners('unlock-failed');
    ipcRenderer.on('unlock-failed', callback);
  },

  // Vault — passwords
  getVaultData:    () => ipcRenderer.invoke('get-vault-data'),
  generatePassword:() => ipcRenderer.invoke('generate-password'),
  addPassword:     (newPassword)     => ipcRenderer.send('add-password', newPassword),
  deletePassword:  (passwordId)      => ipcRenderer.send('delete-password', passwordId),
  updatePassword:  (updatedPassword) => ipcRenderer.send('update-password', updatedPassword),
  onVaultDataUpdated: (callback) => {
    ipcRenderer.removeAllListeners('vault-data-updated');
    ipcRenderer.on('vault-data-updated', (event, ...args) => callback(...args));
  },

  // Vault — notes
  getNotesData:    () => ipcRenderer.invoke('get-notes-data'),
  addNote:         (note)        => ipcRenderer.send('add-note', note),
  deleteNote:      (noteId)      => ipcRenderer.send('delete-note', noteId),
  updateNote:      (note)        => ipcRenderer.send('update-note', note),
  onNotesDataUpdated: (callback) => {
    ipcRenderer.removeAllListeners('notes-data-updated');
    ipcRenderer.on('notes-data-updated', (event, ...args) => callback(...args));
  },

  // Backups
  exportVault:     () => ipcRenderer.invoke('export-vault'),
  importVault:     () => ipcRenderer.invoke('import-vault'),

  // Settings
  getSettings:     () => ipcRenderer.invoke('get-settings'),
  saveSettings:    (settings) => ipcRenderer.send('save-settings', settings),

  // Other
  lockVault:       () => ipcRenderer.send('lock-vault'),
  copyToClipboard: (copyRequest) => ipcRenderer.send('copy-to-clipboard', copyRequest),
  openUrl:         (url) => ipcRenderer.send('open-url', url),
});