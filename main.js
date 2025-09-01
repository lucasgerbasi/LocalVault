// main.js

const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow;
let decryptedVault = null;
let encryptionKey = null;

const AUTO_LOCK_TIMEOUT = 5 * 60 * 1000;
let autoLockTimer = null;

const vaultPath = path.join(app.getPath('userData'), 'vault.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: "LocalVault",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile('index.html');
  mainWindow.setMenu(null);
}

function startAutoLockTimer() { if (autoLockTimer) clearTimeout(autoLockTimer); autoLockTimer = setTimeout(() => { if (decryptedVault) { console.log('Auto-locking vault due to inactivity.'); lockVault(); } }, AUTO_LOCK_TIMEOUT); }
function resetAutoLockTimer() { startAutoLockTimer(); }

function loadVaultView() { mainWindow.loadFile('vault.html'); startAutoLockTimer(); }
function lockVault() { if (autoLockTimer) { clearTimeout(autoLockTimer); autoLockTimer = null; } decryptedVault = null; encryptionKey = null; console.log('Vault locked.'); mainWindow.loadFile('index.html'); }

function saveVault(saltHex) {
  if (!decryptedVault || !encryptionKey) return console.error("Vault is not unlocked. Cannot save.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encryptedData = Buffer.concat([cipher.update(JSON.stringify(decryptedVault), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const dataToStore = { encryptedData: encryptedData.toString('hex'), salt: saltHex, iv: iv.toString('hex'), authTag: authTag.toString('hex') };
  fs.writeFileSync(vaultPath, JSON.stringify(dataToStore, null, 2));
  console.log('Vault re-encrypted and saved.');
}

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// --- NEW: Handler to check if the vault exists ---
ipcMain.handle('get-vault-status', () => {
    return { vaultExists: fs.existsSync(vaultPath) };
});

// --- MODIFIED: This handler is now ONLY for creating a vault ---
ipcMain.on('create-vault', (event, masterPassword) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(masterPassword, salt, 32, (err, derivedKey) => {
        if (err) throw err;
        encryptionKey = derivedKey;
        decryptedVault = { passwords: [] };
        saveVault(salt.toString('hex'));
        console.log('Vault created successfully!');
        loadVaultView();
    });
});

// --- MODIFIED: This handler is now ONLY for unlocking a vault ---
ipcMain.on('unlock-vault', (event, masterPassword) => {
    const vaultFileContent = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    const { salt, iv, authTag, encryptedData } = vaultFileContent;
    crypto.scrypt(masterPassword, Buffer.from(salt, 'hex'), 32, (err, derivedKey) => {
        if (err) return event.sender.send('unlock-failed');
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, Buffer.from(iv, 'hex'));
            decipher.setAuthTag(Buffer.from(authTag, 'hex'));
            const decryptedJSON = Buffer.concat([decipher.update(Buffer.from(encryptedData, 'hex')), decipher.final()]).toString('utf8');
            encryptionKey = derivedKey;
            decryptedVault = JSON.parse(decryptedJSON);
            console.log('Vault unlocked successfully!');
            loadVaultView();
        } catch (error) {
            console.error('Decryption failed! Incorrect master password.');
            event.sender.send('unlock-failed');
        }
    });
});

function handleActiveEvent(handler) { return (event, ...args) => { resetAutoLockTimer(); handler(event, ...args); }; }
ipcMain.handle('get-vault-data', () => decryptedVault.passwords);
ipcMain.on('lock-vault', lockVault);
ipcMain.on('add-password', handleActiveEvent((event, newPassword) => { newPassword.id = crypto.randomUUID(); decryptedVault.passwords.push(newPassword); const { salt } = JSON.parse(fs.readFileSync(vaultPath, 'utf8')); saveVault(salt); mainWindow.webContents.send('vault-data-updated', decryptedVault.passwords); }));
ipcMain.on('delete-password', handleActiveEvent((event, passwordId) => { decryptedVault.passwords = decryptedVault.passwords.filter(p => p.id !== passwordId); const { salt } = JSON.parse(fs.readFileSync(vaultPath, 'utf8')); saveVault(salt); mainWindow.webContents.send('vault-data-updated', decryptedVault.passwords); }));
ipcMain.on('update-password', handleActiveEvent((event, updatedPassword) => { const index = decryptedVault.passwords.findIndex(p => p.id === updatedPassword.id); if (index !== -1) { decryptedVault.passwords[index] = updatedPassword; const { salt } = JSON.parse(fs.readFileSync(vaultPath, 'utf8')); saveVault(salt); mainWindow.webContents.send('vault-data-updated', decryptedVault.passwords); } }));
ipcMain.on('copy-to-clipboard', handleActiveEvent((event, { id, type }) => { if (!decryptedVault) return; const entry = decryptedVault.passwords.find(p => p.id === id); if (!entry) return; const textToCopy = type === 'password' ? entry.password : entry.username; clipboard.writeText(textToCopy); setTimeout(() => { if (clipboard.readText() === textToCopy) clipboard.clear(); }, 30000); }));