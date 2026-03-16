// main.js

const { app, BrowserWindow, ipcMain, clipboard, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const argon2 = require('argon2');

let mainWindow;
let decryptedVault = null;   // { passwords: [], notes: [] }
let encryptionKey  = null;

const AUTO_LOCK_TIMEOUT = 5 * 60 * 1000;
let autoLockTimer = null;

const userDataPath  = app.getPath('userData');
const vaultPath     = path.join(userDataPath, 'vault.json');
const settingsPath  = path.join(userDataPath, 'settings.json');

// ─── Window ──────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 720,
    minHeight: 500,
    title: 'LocalVault',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
  mainWindow.setMenu(null);
}

// ─── Auto-lock ────────────────────────────────────────────────────────────────

function startAutoLockTimer() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(() => {
    if (decryptedVault) {
      console.log('Auto-locking vault due to inactivity.');
      lockVault();
    }
  }, AUTO_LOCK_TIMEOUT);
}

function resetAutoLockTimer() { startAutoLockTimer(); }

// ─── Navigation ───────────────────────────────────────────────────────────────

function loadVaultView() {
  mainWindow.loadFile('vault.html');
  startAutoLockTimer();
}

function lockVault() {
  if (autoLockTimer) { clearTimeout(autoLockTimer); autoLockTimer = null; }
  decryptedVault = null;
  encryptionKey  = null;
  console.log('Vault locked.');
  mainWindow.loadFile('index.html');
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function saveVault() {
  if (!decryptedVault || !encryptionKey) {
    return console.error('Vault is not unlocked. Cannot save.');
  }

  const vaultFileContent = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));

  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const enc    = Buffer.concat([
    cipher.update(JSON.stringify(decryptedVault), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  vaultFileContent.passwords = {
    iv:      iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data:    enc.toString('hex'),
  };

  fs.writeFileSync(vaultPath, JSON.stringify(vaultFileContent, null, 2));
  console.log('Vault saved.');
}

// Keep old name as alias so nothing breaks
const savePasswords = saveVault;

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: status / create / unlock ───────────────────────────────────────────

ipcMain.handle('get-vault-status', () => ({
  vaultExists: fs.existsSync(vaultPath),
}));

ipcMain.on('create-vault', async (event, masterPassword) => {
  try {
    const sessionEncryptionKey = crypto.randomBytes(32);
    const keyHash              = await argon2.hash(masterPassword, { type: argon2.argon2id });
    const saltForMasterKey     = crypto.randomBytes(16);
    const masterEncryptionKey  = await argon2.hash(masterPassword, {
      type: argon2.argon2id, raw: true, salt: saltForMasterKey,
    });

    const iv     = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterEncryptionKey, iv);
    const encSK  = Buffer.concat([cipher.update(sessionEncryptionKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    encryptionKey  = sessionEncryptionKey;
    decryptedVault = { passwords: [], notes: [] };

    const emptyBlob = { iv: '', authTag: '', data: '' };

    fs.writeFileSync(vaultPath, JSON.stringify({
      keyHash,
      salt:         saltForMasterKey.toString('hex'),
      encryptedKey: encSK.toString('hex'),
      iv:           iv.toString('hex'),
      authTag:      authTag.toString('hex'),
      passwords:    emptyBlob,
    }, null, 2));

    console.log('Vault created.');
    loadVaultView();
  } catch (err) {
    console.error('Error creating vault:', err);
  }
});

ipcMain.on('unlock-vault', async (event, masterPassword) => {
  try {
    const vaultFileContent = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    const { keyHash, salt, encryptedKey, iv, authTag, passwords } = vaultFileContent;

    if (await argon2.verify(keyHash, masterPassword)) {
      const masterEncryptionKey = await argon2.hash(masterPassword, {
        type: argon2.argon2id, raw: true, salt: Buffer.from(salt, 'hex'),
      });

      const decipher = crypto.createDecipheriv('aes-256-gcm', masterEncryptionKey, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
      const sessionEncryptionKey = Buffer.concat([
        decipher.update(Buffer.from(encryptedKey, 'hex')),
        decipher.final(),
      ]);

      encryptionKey = sessionEncryptionKey;

      if (!passwords.data) {
        decryptedVault = { passwords: [], notes: [] };
      } else {
        const pd = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(passwords.iv, 'hex'));
        pd.setAuthTag(Buffer.from(passwords.authTag, 'hex'));
        const json = Buffer.concat([
          pd.update(Buffer.from(passwords.data, 'hex')),
          pd.final(),
        ]).toString('utf8');
        const parsed = JSON.parse(json);
        // Migrate old vaults that don't have notes array yet
        if (!parsed.notes) parsed.notes = [];
        decryptedVault = parsed;
      }

      console.log('Vault unlocked.');
      loadVaultView();
    } else {
      console.error('Incorrect master password.');
      event.sender.send('unlock-failed');
    }
  } catch (err) {
    console.error('Error unlocking vault:', err);
    event.sender.send('unlock-failed');
  }
});

// ─── Active-event wrapper (resets auto-lock timer) ───────────────────────────

function handleActiveEvent(handler) {
  return (event, ...args) => {
    resetAutoLockTimer();
    handler(event, ...args);
  };
}

// ─── IPC: vault data ─────────────────────────────────────────────────────────

ipcMain.handle('get-vault-data', () => decryptedVault.passwords);
ipcMain.handle('get-notes-data', () => decryptedVault.notes || []);

ipcMain.on('lock-vault', lockVault);

// ─── IPC: passwords ───────────────────────────────────────────────────────────

ipcMain.on('add-password', handleActiveEvent((event, newPassword) => {
  newPassword.id = crypto.randomUUID();
  decryptedVault.passwords.push(newPassword);
  saveVault();
  mainWindow.webContents.send('vault-data-updated', decryptedVault.passwords);
}));

ipcMain.on('delete-password', handleActiveEvent((event, passwordId) => {
  decryptedVault.passwords = decryptedVault.passwords.filter(p => p.id !== passwordId);
  saveVault();
  mainWindow.webContents.send('vault-data-updated', decryptedVault.passwords);
}));

ipcMain.on('update-password', handleActiveEvent((event, updatedPassword) => {
  const idx = decryptedVault.passwords.findIndex(p => p.id === updatedPassword.id);
  if (idx !== -1) {
    decryptedVault.passwords[idx] = updatedPassword;
    saveVault();
    mainWindow.webContents.send('vault-data-updated', decryptedVault.passwords);
  }
}));

// ─── IPC: notes ───────────────────────────────────────────────────────────────

ipcMain.on('add-note', handleActiveEvent((event, note) => {
  note.id        = crypto.randomUUID();
  note.createdAt = new Date().toISOString();
  note.updatedAt = note.createdAt;
  if (!decryptedVault.notes) decryptedVault.notes = [];
  decryptedVault.notes.push(note);
  saveVault();
  mainWindow.webContents.send('notes-data-updated', decryptedVault.notes);
}));

ipcMain.on('delete-note', handleActiveEvent((event, noteId) => {
  decryptedVault.notes = (decryptedVault.notes || []).filter(n => n.id !== noteId);
  saveVault();
  mainWindow.webContents.send('notes-data-updated', decryptedVault.notes);
}));

ipcMain.on('update-note', handleActiveEvent((event, updatedNote) => {
  const idx = (decryptedVault.notes || []).findIndex(n => n.id === updatedNote.id);
  if (idx !== -1) {
    updatedNote.updatedAt = new Date().toISOString();
    decryptedVault.notes[idx] = updatedNote;
    saveVault();
    mainWindow.webContents.send('notes-data-updated', decryptedVault.notes);
  }
}));

// ─── IPC: clipboard ──────────────────────────────────────────────────────────

ipcMain.on('copy-to-clipboard', handleActiveEvent((event, { id, type }) => {
  if (!decryptedVault) return;
  const entry = decryptedVault.passwords.find(p => p.id === id);
  if (!entry) return;
  const text = type === 'password' ? entry.password : entry.username;
  clipboard.writeText(text);
  setTimeout(() => { if (clipboard.readText() === text) clipboard.clear(); }, 30000);
}));

// ─── IPC: password generator ─────────────────────────────────────────────────

ipcMain.handle('generate-password', () => {
  const charset = {
    lower:   'abcdefghijklmnopqrstuvwxyz',
    upper:   'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    numbers: '0123456789',
    symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
  };
  const rand = (max) => crypto.randomInt(0, max);
  let pw = [
    charset.lower[rand(charset.lower.length)],
    charset.upper[rand(charset.upper.length)],
    charset.numbers[rand(charset.numbers.length)],
    charset.symbols[rand(charset.symbols.length)],
  ];
  const all = Object.values(charset).join('');
  for (let i = 4; i < 16; i++) pw.push(all[rand(all.length)]);
  for (let i = pw.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [pw[i], pw[j]] = [pw[j], pw[i]];
  }
  return pw.join('');
});

// ─── IPC: export / import ────────────────────────────────────────────────────

ipcMain.handle('export-vault', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Vault',
    defaultPath: 'LocalVault-Backup.json',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { success: false, message: 'Export canceled.' };
  try {
    fs.copyFileSync(vaultPath, filePath);
    return { success: true, message: 'Vault exported successfully!' };
  } catch (error) {
    return { success: false, message: `Error: ${error.message}` };
  }
});

ipcMain.handle('import-vault', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Vault',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return { success: false, message: 'Import canceled.' };

  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Confirm Import',
    message: 'Overwrite your current vault?',
    detail: 'This will replace your current vault and cannot be undone. The app will lock after importing.',
    buttons: ['Yes, Overwrite', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (confirmation.response === 1) return { success: false, message: 'Import canceled.' };

  try {
    fs.copyFileSync(filePaths[0], vaultPath);
    lockVault();
    return { success: true, message: 'Vault imported! Please unlock with your imported vault password.' };
  } catch (error) {
    return { success: false, message: `Error: ${error.message}` };
  }
});

// ─── IPC: settings ───────────────────────────────────────────────────────────

ipcMain.handle('get-settings', () => {
  try {
    if (fs.existsSync(settingsPath))
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) { console.error('Error reading settings:', e); }
  return { theme: 'dark' };
});

ipcMain.on('save-settings', (event, settings) => {
  try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)); }
  catch (e) { console.error('Error saving settings:', e); }
});

// ─── IPC: open URL ───────────────────────────────────────────────────────────

ipcMain.on('open-url', (event, url) => {
  if (!url) return;
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  shell.openExternal(full);
});