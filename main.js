// main.js

const { app, BrowserWindow, ipcMain, clipboard, dialog, shell } = require('electron');
const path = require('path');
const fs =require('fs');
const crypto = require('crypto');
const argon2 = require('argon2');

let mainWindow;
let decryptedVault = null;
let encryptionKey = null;

const AUTO_LOCK_TIMEOUT = 5 * 60 * 1000;
let autoLockTimer = null;

const userDataPath = app.getPath('userData');
const vaultPath = path.join(userDataPath, 'vault.json');
const settingsPath = path.join(userDataPath, 'settings.json');

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

function startAutoLockTimer() {
    if (autoLockTimer) clearTimeout(autoLockTimer);
    autoLockTimer = setTimeout(() => {
        if (decryptedVault) {
            console.log('Auto-locking vault due to inactivity.');
            lockVault();
        }
    }, AUTO_LOCK_TIMEOUT);
}

function resetAutoLockTimer() {
    startAutoLockTimer();
}

function loadVaultView() {
    mainWindow.loadFile('vault.html');
    startAutoLockTimer();
}

function lockVault() {
    if (autoLockTimer) {
        clearTimeout(autoLockTimer);
        autoLockTimer = null;
    }
    decryptedVault = null;
    encryptionKey = null;
    console.log('Vault locked.');
    mainWindow.loadFile('index.html');
}

function savePasswords() {
    if (!decryptedVault || !encryptionKey) {
        return console.error("Vault is not unlocked. Cannot save.");
    }
    
    const vaultFileContent = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const encryptedPasswords = Buffer.concat([cipher.update(JSON.stringify(decryptedVault), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    vaultFileContent.passwords = {
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        data: encryptedPasswords.toString('hex')
    };
    
    fs.writeFileSync(vaultPath, JSON.stringify(vaultFileContent, null, 2));
    console.log('Passwords updated and vault re-saved.');
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-vault-status', () => {
    return { vaultExists: fs.existsSync(vaultPath) };
});

ipcMain.on('create-vault', async (event, masterPassword) => {
    try {
        const sessionEncryptionKey = crypto.randomBytes(32);
        const keyHash = await argon2.hash(masterPassword, { type: argon2.argon2id });
        const saltForMasterKey = crypto.randomBytes(16);
        const masterEncryptionKey = await argon2.hash(masterPassword, { type: argon2.argon2id, raw: true, salt: saltForMasterKey });

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', masterEncryptionKey, iv);
        const encryptedSessionKey = Buffer.concat([cipher.update(sessionEncryptionKey), cipher.final()]);
        const authTag = cipher.getAuthTag();

        encryptionKey = sessionEncryptionKey;
        decryptedVault = { passwords: [] };

        const emptyPasswordsBlob = { iv: '', authTag: '', data: '' };
        
        const dataToStore = {
            keyHash: keyHash,
            salt: saltForMasterKey.toString('hex'),
            encryptedKey: encryptedSessionKey.toString('hex'),
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
            passwords: emptyPasswordsBlob
        };

        fs.writeFileSync(vaultPath, JSON.stringify(dataToStore, null, 2));
        console.log('Vault created successfully with Argon2!');
        loadVaultView();
    } catch (err) {
        console.error("Error creating vault with Argon2:", err);
    }
});

ipcMain.on('unlock-vault', async (event, masterPassword) => {
    try {
        const vaultFileContent = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
        const { keyHash, salt, encryptedKey, iv, authTag, passwords } = vaultFileContent;

        if (await argon2.verify(keyHash, masterPassword)) {
            console.log("Argon2 hash verified.");
            
            const masterEncryptionKey = await argon2.hash(masterPassword, { type: argon2.argon2id, raw: true, salt: Buffer.from(salt, 'hex') });
            
            const decipher = crypto.createDecipheriv('aes-256-gcm', masterEncryptionKey, Buffer.from(iv, 'hex'));
            decipher.setAuthTag(Buffer.from(authTag, 'hex'));
            const sessionEncryptionKey = Buffer.concat([decipher.update(Buffer.from(encryptedKey, 'hex')), decipher.final()]);

            encryptionKey = sessionEncryptionKey;

            if (!passwords.data) {
                decryptedVault = { passwords: [] };
            } else {
                const passwordsDecipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(passwords.iv, 'hex'));
                passwordsDecipher.setAuthTag(Buffer.from(passwords.authTag, 'hex'));
                const decryptedJSON = Buffer.concat([passwordsDecipher.update(Buffer.from(passwords.data, 'hex')), passwordsDecipher.final()]).toString('utf8');
                decryptedVault = JSON.parse(decryptedJSON);
            }
            
            console.log('Vault unlocked successfully!');
            loadVaultView();
        } else {
            console.error('Unlock failed: Incorrect master password.');
            event.sender.send('unlock-failed');
        }
    } catch (err) {
        console.error("Error unlocking vault with Argon2:", err);
        event.sender.send('unlock-failed');
    }
});

function handleActiveEvent(handler) {
    return (event, ...args) => {
        resetAutoLockTimer();
        handler(event, ...args);
    };
}

ipcMain.handle('get-vault-data', () => {
    return decryptedVault.passwords;
});

ipcMain.on('lock-vault', lockVault);

ipcMain.on('add-password', handleActiveEvent((event, newPassword) => {
    newPassword.id = crypto.randomUUID();
    decryptedVault.passwords.push(newPassword);
    savePasswords();
    mainWindow.webContents.send('vault-data-updated', decryptedVault.passwords);
}));

ipcMain.on('delete-password', handleActiveEvent((event, passwordId) => {
    decryptedVault.passwords = decryptedVault.passwords.filter(p => p.id !== passwordId);
    savePasswords();
    mainWindow.webContents.send('vault-data-updated', decryptedVault.passwords);
}));

ipcMain.on('update-password', handleActiveEvent((event, updatedPassword) => {
    const index = decryptedVault.passwords.findIndex(p => p.id === updatedPassword.id);
    if (index !== -1) {
        decryptedVault.passwords[index] = updatedPassword;
        savePasswords();
        mainWindow.webContents.send('vault-data-updated', decryptedVault.passwords);
    }
}));

ipcMain.on('copy-to-clipboard', handleActiveEvent((event, { id, type }) => {
    if (!decryptedVault) return;
    const entry = decryptedVault.passwords.find(p => p.id === id);
    if (!entry) return;
    const textToCopy = type === 'password' ? entry.password : entry.username;
    clipboard.writeText(textToCopy);
    setTimeout(() => {
        if (clipboard.readText() === textToCopy) clipboard.clear();
    }, 30000);
}));

ipcMain.handle('generate-password', () => {
    const length = 16;
    const charset = {
        lower: 'abcdefghijklmnopqrstuvwxyz',
        upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        numbers: '0123456789',
        symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
    };
    let password = [
        charset.lower[Math.floor(Math.random() * charset.lower.length)],
        charset.upper[Math.floor(Math.random() * charset.upper.length)],
        charset.numbers[Math.floor(Math.random() * charset.numbers.length)],
        charset.symbols[Math.floor(Math.random() * charset.symbols.length)]
    ];
    const allChars = Object.values(charset).join('');
    for (let i = 4; i < length; i++) {
        password.push(allChars[Math.floor(Math.random() * allChars.length)]);
    }
    for (let i = password.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [password[i], password[j]] = [password[j], password[i]];
    }
    return password.join('');
});

ipcMain.handle('export-vault', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Vault',
        defaultPath: 'LocalVault-Backup.json',
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
    if (canceled || !filePath) { return { success: false, message: 'Export canceled.' }; }
    try {
        fs.copyFileSync(vaultPath, filePath);
        return { success: true, message: 'Vault exported successfully!' };
    } catch (error) {
        console.error('Failed to export vault:', error);
        return { success: false, message: `Error: ${error.message}` };
    }
});

ipcMain.handle('import-vault', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Import Vault',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile']
    });
    if (canceled || filePaths.length === 0) { return { success: false, message: 'Import canceled.' }; }
    const backupPath = filePaths[0];
    const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Confirm Import',
        message: 'Are you sure you want to import this vault?',
        detail: 'This will overwrite your current vault and cannot be undone. The application will lock after importing.',
        buttons: ['Yes, Overwrite My Vault', 'Cancel'],
        defaultId: 1,
        cancelId: 1
    });
    if (confirmation.response === 1) { return { success: false, message: 'Import canceled by user.' }; }
    try {
        fs.copyFileSync(backupPath, vaultPath);
        lockVault();
        return { success: true, message: 'Vault imported successfully! Please unlock your imported vault.' };
    } catch (error) {
        console.error('Failed to import vault:', error);
        return { success: false, message: `Error: ${error.message}` };
    }
});

ipcMain.handle('get-settings', () => {
    try {
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            return settings;
        }
    } catch (error) { console.error("Error reading settings file:", error); }
    return { theme: 'dark' };
});

ipcMain.on('save-settings', (event, settings) => {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) { console.error("Error saving settings file:", error); }
});

ipcMain.on('open-url', (event, url) => {
    if (!url) return;
    
    // This is the new logic to automatically add https://
    let fullUrl = url;
    if (!/^https?:\/\//i.test(url)) {
        fullUrl = `https://${url}`;
    }
    
    shell.openExternal(fullUrl);
});