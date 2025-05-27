const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { authenticator } = require('otplib');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// Enable more detailed logging
require('electron').app.commandLine.appendSwitch('enable-logging');
process.env.ELECTRON_ENABLE_LOGGING = true;

// Initialize encrypted storage
const store = new Store({
  encryptionKey: 'your-secret-key' // TODO: Generate this securely on first run
});

let mainWindow;
let db;

function createWindow() {
  try {
    mainWindow = new BrowserWindow({
      width: 960,
      height: 720,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      show: false, // Don't show the window until it's ready
      backgroundColor: '#1E1E1E', // Match the dark theme background
      center: true, // Center the window on the screen
      minWidth: 480,
      minHeight: 360
    });

    // Load the index.html file
    mainWindow.loadFile('index.html')
      .then(() => {
        console.log('Window loaded successfully');
        mainWindow.show(); // Show window after content is loaded
        mainWindow.focus(); // Ensure window is focused
      })
      .catch((err) => {
        console.error('Error loading window:', err);
        dialog.showErrorBox('Loading Error', 'Failed to load application window: ' + err.message);
      });

    // Debug: Log when window is ready
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('Window finished loading');
    });

    // Debug: Log any window errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('Window failed to load:', errorCode, errorDescription);
      dialog.showErrorBox('Loading Error', `Failed to load: ${errorDescription} (${errorCode})`);
    });

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools();
    }

    // Handle window state
    mainWindow.on('ready-to-show', () => {
      console.log('Window ready to show');
      mainWindow.show();
      mainWindow.focus();
    });

    mainWindow.on('closed', () => {
      console.log('Window closed');
      mainWindow = null;
    });
  } catch (err) {
    console.error('Error creating window:', err);
    dialog.showErrorBox('Startup Error', 'Failed to create application window: ' + err.message);
  }
}

// Initialize database
function initializeDatabase() {
  try {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'authenticator.db');
    console.log('Database path:', dbPath);

    db = new Database(dbPath, { 
      verbose: console.log,
      fileMustExist: false
    });
    
    // Create accounts table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        issuer TEXT,
        secret TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err);
    dialog.showErrorBox('Database Error', 'Failed to initialize database: ' + err.message);
  }
}

// IPC Handlers
ipcMain.handle('add-account', async (event, { name, issuer, secret }) => {
  try {
    const stmt = db.prepare('INSERT INTO accounts (name, issuer, secret) VALUES (?, ?, ?)');
    const info = stmt.run(name, issuer, secret);
    return info.lastInsertRowid;
  } catch (err) {
    console.error('Error adding account:', err);
    throw err;
  }
});

ipcMain.handle('get-accounts', async () => {
  try {
    const stmt = db.prepare('SELECT * FROM accounts');
    return stmt.all();
  } catch (err) {
    console.error('Error getting accounts:', err);
    throw err;
  }
});

ipcMain.handle('delete-account', async (event, id) => {
  try {
    const stmt = db.prepare('DELETE FROM accounts WHERE id = ?');
    stmt.run(id);
  } catch (err) {
    console.error('Error deleting account:', err);
    throw err;
  }
});

ipcMain.handle('generate-totp', async (event, secret) => {
  try {
    const token = authenticator.generate(secret);
    return token;
  } catch (error) {
    console.error('TOTP generation error:', error);
    throw error;
  }
});

// Handle startup
app.whenReady().then(() => {
  try {
    console.log('App is ready, initializing...');
    initializeDatabase();
    createWindow();
  } catch (err) {
    console.error('Startup error:', err);
    dialog.showErrorBox('Startup Error', 'Failed to start application: ' + err.message);
  }
}).catch(err => {
  console.error('App ready error:', err);
  dialog.showErrorBox('Fatal Error', 'Failed to initialize application: ' + err.message);
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle activation
app.on('activate', () => {
  try {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  } catch (err) {
    console.error('Activation error:', err);
    dialog.showErrorBox('Activation Error', 'Failed to restore application window: ' + err.message);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  dialog.showErrorBox('Error', 'An unexpected error occurred: ' + err.message);
}); 