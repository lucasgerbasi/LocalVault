// preload.js

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Lock/Create screen
  getVaultStatus: () => ipcRenderer.invoke('get-vault-status'), // NEW
  createVault: (masterPassword) => ipcRenderer.send('create-vault', masterPassword), // NEW
  unlockVault: (masterPassword) => ipcRenderer.send('unlock-vault', masterPassword),
  onUnlockFailed: (callback) => ipcRenderer.on('unlock-failed', callback),

  // Vault view
  getVaultData: () => ipcRenderer.invoke('get-vault-data'),
  addPassword: (newPassword) => ipcRenderer.send('add-password', newPassword),
  deletePassword: (passwordId) => ipcRenderer.send('delete-password', passwordId),
  updatePassword: (updatedPassword) => ipcRenderer.send('update-password', updatedPassword),
  onVaultDataUpdated: (callback) => ipcRenderer.on('vault-data-updated', (event, ...args) => callback(...args)),
  
  // Other
  lockVault: () => ipcRenderer.send('lock-vault'),
  copyToClipboard: (copyRequest) => ipcRenderer.send('copy-to-clipboard', copyRequest)
});