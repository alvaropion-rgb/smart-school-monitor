const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// Prevent EPIPE crashes when stdout/stderr pipe is broken
process.stdout.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
process.stderr.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });

let mainWindow = null;
let gatewayProcess = null;
let expressServer = null;
let tunnelProcess = null;
let tunnelUrl = null;

// ── Database init ──
function initDatabase() {
  const schema = require('./src/database/schema');
  schema.initialize();
  console.log('Database initialized');

  // Auto-import data from original CodeMAPCopier if database is empty
  importOriginalData();
}

function importOriginalData() {
  const fs = require('fs');
  const db = require('./src/database/db');
  const codeMAPImport = require('./src/services/codeMAPImport');

  const codeMAPDir = codeMAPImport.getCodeMAPDir();
  if (!fs.existsSync(codeMAPDir)) {
    console.log('CodeMAPCopier directory not found, skipping auto-import');
    return;
  }

  // Check each table independently so partial failures don't block others
  const deviceCount = db.getDb().prepare('SELECT COUNT(*) as cnt FROM devices').get().cnt;
  const teacherCount = db.getDb().prepare('SELECT COUNT(*) as cnt FROM teachers').get().cnt;

  if (deviceCount === 0) {
    const result = codeMAPImport.importDevices(codeMAPDir, false);
    if (result.error) console.error('Device import error:', result.error);
    else console.log(`Imported ${result.count} devices`);
  } else {
    console.log(`Database already has ${deviceCount} devices, skipping device import`);
  }

  if (teacherCount === 0) {
    const result = codeMAPImport.importTeachers(codeMAPDir, false);
    if (result.error) console.error('Teacher import error:', result.error);
    else console.log(`Imported ${result.count} teachers`);
  } else {
    console.log(`Database already has ${teacherCount} teachers, skipping teacher import`);
  }

  const cfgResult = codeMAPImport.importConfig(codeMAPDir);
  if (cfgResult.success) console.log('Imported gateway config');
}

// ── IPC handlers ──
function registerIPC() {
  const { registerHandlers } = require('./src/ipc/handlers');
  registerHandlers();
  console.log('IPC handlers registered');
}

// ── Express API server ──
async function startExpressServer() {
  const { startServer } = require('./src/server/api');
  expressServer = await startServer();
  console.log('Express API server started');
}

// ── SNMP Gateway child process ──
let gatewayRestarts = 0;
const MAX_GATEWAY_RESTARTS = 3;

function startGateway() {
  const gatewayPath = path.join(__dirname, 'src', 'snmp-gateway', 'index.js');

  try {
    gatewayProcess = spawn(process.execPath, [gatewayPath], {
      stdio: 'ignore',
      detached: false,
      env: { ...process.env, GATEWAY_PARENT: 'electron' }
    });

    gatewayProcess.on('exit', (code) => {
      gatewayProcess = null;
      if (code !== 0 && code !== null && gatewayRestarts < MAX_GATEWAY_RESTARTS) {
        gatewayRestarts++;
        setTimeout(startGateway, 5000);
      }
    });

    gatewayProcess.on('error', () => {
      // silently handle spawn errors
    });
  } catch (err) {
    // gateway start failed silently
  }
}

function stopGateway() {
  if (gatewayProcess) {
    gatewayProcess.kill('SIGTERM');
    gatewayProcess = null;
  }
}

// ── Cloudflare Tunnel (gives local server a public URL for QR code scanning) ──
// iOS Safari adds "www." to bare IP addresses in QR codes, breaking local URLs.
// Cloudflare Quick Tunnel creates a free public https://xxx.trycloudflare.com URL.

function startTunnel(port) {
  const tunnelPort = port || 3847;
  try {
    // Kill any stale cloudflared processes from a previous crash
    try { require('child_process').execSync('pkill -f "cloudflared tunnel"', { stdio: 'ignore' }); } catch(e) {}

    tunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${tunnelPort}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // cloudflared logs to stdout too in some versions
    tunnelProcess.stdout.on('data', (data) => {
      console.log('cloudflared stdout:', data.toString().trim());
    });

    // cloudflared logs the tunnel URL to stderr
    tunnelProcess.stderr.on('data', (data) => {
      const output = data.toString();
      // Log all cloudflared output for debugging
      const trimmed = output.trim();
      if (trimmed) console.log('cloudflared:', trimmed);

      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !tunnelUrl) {
        tunnelUrl = match[0];
        console.log('✅ Cloudflare Tunnel URL:', tunnelUrl);

        // Save as webAppUrl — getBaseUrl() checks this first (priority 1)
        try {
          const settings = require('./src/services/settings');
          const config = settings.getEmailConfig();
          config.webAppUrl = tunnelUrl;
          config.qrUrlStrategy = 'cloudflare-tunnel';
          settings.saveEmailConfig(config);

          // Update all QR codes to use the tunnel URL
          const qrCodes = require('./src/services/qrCodes');
          const result = qrCodes.updateAllQRCodeUrls();
          console.log(`Updated ${result.updated} QR code URLs to tunnel: ${tunnelUrl}`);

          // Notify renderer window
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tunnel-url-changed', tunnelUrl);
          }
        } catch (err) {
          console.error('Error saving tunnel URL:', err.message);
        }
      }
    });

    tunnelProcess.on('exit', (code) => {
      console.log('Cloudflare tunnel exited with code:', code);
      tunnelProcess = null;
      tunnelUrl = null;
    });

    tunnelProcess.on('error', (err) => {
      console.error('Cloudflare tunnel error:', err.message);
      tunnelProcess = null;
    });

    console.log(`Cloudflare tunnel starting → http://localhost:${tunnelPort}`);
  } catch (err) {
    console.error('Failed to start Cloudflare tunnel:', err.message);
    console.error('Install with: brew install cloudflared');
  }
}

function stopTunnel() {
  if (tunnelProcess) {
    tunnelProcess.kill('SIGTERM');
    tunnelProcess = null;
    tunnelUrl = null;
  }
}

// ── Email queue processor ──
let emailQueueInterval = null;

function startEmailQueueProcessor() {
  const emailQueue = require('./src/services/emailQueue');

  // Process email queue every 60 seconds
  emailQueueInterval = setInterval(async () => {
    try {
      await emailQueue.processEmailQueue();
    } catch (err) {
      console.error('Email queue processing error:', err);
    }
  }, 60000);

  console.log('Email queue processor started (60s interval)');
}

// ── Cloud Relay Sync ──
// Pushes device/teacher/button data to the cloud relay and pulls back service requests
let cloudSyncInterval = null;

function startCloudSync() {
  const settingsService = require('./src/services/settings');

  async function doSync() {
    try {
      const config = settingsService.getEmailConfig();
      const relayUrl = (config.cloudRelayUrl || '').trim();
      const syncSecret = (config.cloudRelaySyncSecret || '').trim();

      if (!relayUrl) return; // Not configured, skip silently

      // ── Push reference data to relay ──
      const devices = require('./src/services/devices').getDevices();
      const deviceTypes = require('./src/services/deviceTypes').getDeviceTypes();
      const issueButtons = require('./src/services/issueButtons').getIssueButtons();
      const employees = require('./src/services/employees');
      const teachers = employees.getTeachers();
      const branding = settingsService.getRequestPageBranding();
      const afterHoursSettings = settingsService.getAfterHoursSettings();

      const pushRes = await fetch(relayUrl + '/api/sync/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sync-secret': syncSecret
        },
        body: JSON.stringify({
          devices, deviceTypes, issueButtons, teachers,
          branding, afterHoursSettings
        })
      });
      const pushData = await pushRes.json();

      // ── Pull pending service requests from relay ──
      const pullRes = await fetch(relayUrl + '/api/sync/pull', {
        headers: { 'x-sync-secret': syncSecret }
      });
      const pullData = await pullRes.json();

      if (pullData.requests && pullData.requests.length > 0) {
        const dbModule = require('./src/database/db');
        for (const sr of pullData.requests) {
          try {
            dbModule.insert('service_requests', sr);
          } catch (insertErr) {
            // Might fail if ID already exists — skip silently
            console.error('Error inserting synced service request:', insertErr.message);
          }
        }
        console.log(`Cloud sync: imported ${pullData.requests.length} service requests from relay`);

        // Send email notifications for each new request
        try {
          const serviceRequests = require('./src/services/serviceRequests');
          for (const sr of pullData.requests) {
            try { serviceRequests.sendServiceRequestNotification(sr); } catch (e) {}
          }
        } catch (e) {}

        // Notify the renderer to refresh service requests list
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('cloud-sync-new-requests', pullData.requests.length);
        }
      }

      // Notify renderer of sync status
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('cloud-sync-status', {
          ok: true,
          lastSyncAt: new Date().toISOString(),
          relayUrl: relayUrl,
          counts: pushData.counts || {}
        });
      }

    } catch (err) {
      console.error('Cloud sync error:', err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('cloud-sync-status', {
          ok: false,
          error: err.message
        });
      }
    }
  }

  // Initial sync after 5 seconds (let things settle)
  setTimeout(doSync, 5000);
  // Then every 60 seconds
  cloudSyncInterval = setInterval(doSync, 60000);
  console.log('Cloud relay sync started (60s interval)');
}

function stopCloudSync() {
  if (cloudSyncInterval) {
    clearInterval(cloudSyncInterval);
    cloudSyncInterval = null;
  }
}

// ── Main Window ──
function createWindow() {
  // Grant camera/microphone permissions for getUserMedia (webcam for OCR scanning, photo evidence)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'clipboard-read', 'clipboard-sanitized-write'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Also handle permission checks
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'clipboard-read', 'clipboard-sanitized-write'];
    return allowedPermissions.includes(permission);
  });

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Smart School Monitor',
    icon: path.join(__dirname, 'assets', 'icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Load from Express server (http://localhost) instead of file:// so that
  // Web Workers (Tesseract OCR) can use importScripts() without CORS issues
  const { PORT } = require('./src/server/api');
  mainWindow.loadURL(`http://localhost:${PORT}/index.html`);

  // Open external URLs (copier web pages, etc.) in the system browser
  // instead of navigating away from the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow localhost URLs to open in a new Electron window (QR page, etc.)
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
      return { action: 'allow' };
    }
    // Open all other URLs in the default system browser
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Also catch in-page navigation to external sites
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // If navigating away from localhost, open in system browser instead
    if (!url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Open DevTools for debugging (remove for production)
  mainWindow.webContents.openDevTools();

  // Build menu
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Navigate',
      submenu: [
        {
          label: 'Home',
          accelerator: 'CmdOrCtrl+H',
          click: () => {
            if (mainWindow) {
              const { PORT: p } = require('./src/server/api');
              mainWindow.loadURL(`http://localhost:${p}/index.html`);
            }
          }
        },
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+Left',
          click: () => {
            if (mainWindow && mainWindow.webContents.canGoBack()) {
              mainWindow.webContents.goBack();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Reload App',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            if (mainWindow) {
              const { PORT: p } = require('./src/server/api');
              mainWindow.loadURL(`http://localhost:${p}/index.html`);
            }
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ];

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App lifecycle ──
app.whenReady().then(async () => {
  try {
    // 1. Initialize database
    initDatabase();

    // 2. Register IPC handlers
    registerIPC();

    // 3. Start Express API server
    await startExpressServer();
    const actualPort = expressServer ? expressServer.address().port : 3847;
    console.log(`Express server bound to port: ${actualPort}`);

    // 3b. Update QR code URLs to use .local hostname (prevents iOS Safari www. prefix issue)
    try {
      const qrCodes = require('./src/services/qrCodes');
      const result = qrCodes.updateAllQRCodeUrls();
      if (result.updated > 0) {
        console.log(`Updated ${result.updated} QR code URLs to: ${qrCodes.getBaseUrl()}`);
      }
      console.log(`QR code base URL: ${qrCodes.getBaseUrl()}`);
      console.log(`  Hostname: ${qrCodes.getLocalHostname() || 'N/A'} | LAN IP: ${qrCodes.getLocalNetworkIP()}`);
    } catch (err) {
      console.error('QR URL update error:', err);
    }

    // 4. Start SNMP gateway
    startGateway();

    // 5. Start email queue processor
    startEmailQueueProcessor();

    // 6. Start Cloudflare tunnel for public HTTPS access to QR request pages
    //    (Required on school WiFi with AP isolation where phones can't reach local IPs)
    startTunnel(actualPort);

    // 6b. Start cloud relay sync (pushes data to Render.com relay for QR requests)
    startCloudSync();

    // 7. Create the main window
    createWindow();

    // macOS: re-create window when dock icon is clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });

    console.log('Smart School Monitor started successfully');
  } catch (err) {
    console.error('Startup error:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Clear tunnel URL so stale URL isn't used on next launch
  try {
    const settings = require('./src/services/settings');
    const config = settings.getEmailConfig();
    if (config.webAppUrl && config.webAppUrl.includes('trycloudflare.com')) {
      config.webAppUrl = '';
      settings.saveEmailConfig(config);
    }
  } catch (e) { /* ignore cleanup errors */ }

  // Clean up processes
  stopCloudSync();
  stopTunnel();
  stopGateway();
  if (emailQueueInterval) clearInterval(emailQueueInterval);
  if (expressServer) {
    expressServer.close();
  }
});
