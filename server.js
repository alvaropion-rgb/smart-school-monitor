#!/usr/bin/env node
// server.js — Web entry point for Smart School Monitor (replaces Electron's main.js)
// Run with: node server.js

const path = require('path');
const { spawn } = require('child_process');

// Prevent EPIPE crashes when stdout/stderr pipe is broken
process.stdout.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
process.stderr.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });

// ── Data directory ──
// On Render.com the persistent disk mounts at /data. Locally, use ./data
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

let expressServer = null;
let gatewayProcess = null;
let emailQueueInterval = null;
let cloudSyncInterval = null;

// ── SSE (Server-Sent Events) — replaces Electron's mainWindow.webContents.send() ──
const sseClients = [];

function broadcastSSE(channel, data) {
  const payload = `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(payload);
    } catch (e) {
      sseClients.splice(i, 1);
    }
  }
}

// ── Database init ──
function initDatabase() {
  const schema = require('./src/database/schema');
  schema.initialize();
  console.log('Database initialized');

  // Auto-import from CodeMAPCopier if database is empty
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

// ── Express API server (with IPC bridge + SSE) ──
async function startExpressServer() {
  const { createServer, add404Handler, PORT } = require('./src/server/api');
  const { app } = createServer();
  const { buildHandlerRegistry } = require('./src/ipc/handlerRegistry');

  // ── IPC-to-HTTP Bridge ──
  // Converts window.api.invoke(channel, ...args) into POST /api/ipc/:channel
  app.post('/api/ipc/:channel', async (req, res) => {
    try {
      const channel = req.params.channel;
      const handlers = buildHandlerRegistry();
      const handler = handlers[channel];

      if (!handler) {
        return res.status(404).json({ error: 'Unknown channel: ' + channel });
      }

      const args = req.body.args || [];
      const result = await handler(...args);
      res.json(result !== undefined ? result : { success: true });
    } catch (error) {
      console.error(`IPC bridge error [${req.params.channel}]:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ── SSE Endpoint — replaces Electron push notifications ──
  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(':\n\n'); // comment to keep connection alive

    sseClients.push(res);
    req.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx >= 0) sseClients.splice(idx, 1);
    });
  });

  // Register 404 handler LAST (after IPC bridge + SSE routes)
  add404Handler(app);

  // Start listening
  function tryListen(p, attempts) {
    return new Promise((resolve, reject) => {
      const server = app.listen(p, '0.0.0.0', () => {
        console.log(`Express API server running on http://0.0.0.0:${p}`);
        console.log(`Open http://localhost:${p} in your browser`);
        console.log(`QR Request page: http://localhost:${p}/request?device=<id>`);

        // Regenerate QR code URLs on startup
        try {
          const qrCodes = require('./src/services/qrCodes');
          const result = qrCodes.updateAllQRCodeUrls();
          if (result.updated > 0) {
            console.log(`Updated ${result.updated} QR code URLs for current IP`);
          }
          console.log(`QR code base URL: ${qrCodes.getBaseUrl()}`);
        } catch (e) {
          console.error('QR URL refresh on startup failed:', e.message);
        }

        resolve(server);
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempts > 0) {
          console.error(`Port ${p} in use, trying ${p + 1}...`);
          resolve(tryListen(p + 1, attempts - 1));
        } else {
          reject(err);
        }
      });
    });
  }

  expressServer = await tryListen(PORT, 5);
  return expressServer;
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
      env: { ...process.env, GATEWAY_PARENT: 'web' }
    });

    gatewayProcess.on('exit', (code) => {
      gatewayProcess = null;
      if (code !== 0 && code !== null && gatewayRestarts < MAX_GATEWAY_RESTARTS) {
        gatewayRestarts++;
        setTimeout(startGateway, 5000);
      }
    });

    gatewayProcess.on('error', () => {});
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

// ── Email queue processor ──
function startEmailQueueProcessor() {
  const emailQueue = require('./src/services/emailQueue');

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
function startCloudSync() {
  const settingsService = require('./src/services/settings');

  async function doSync() {
    try {
      const config = settingsService.getEmailConfig();
      const relayUrl = (config.cloudRelayUrl || '').trim();
      const syncSecret = (config.cloudRelaySyncSecret || '').trim();

      if (!relayUrl) return;

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
            console.error('Error inserting synced service request:', insertErr.message);
          }
        }
        console.log(`Cloud sync: imported ${pullData.requests.length} service requests from relay`);

        try {
          const serviceRequests = require('./src/services/serviceRequests');
          for (const sr of pullData.requests) {
            try { serviceRequests.sendServiceRequestNotification(sr); } catch (e) {}
          }
        } catch (e) {}

        broadcastSSE('cloud-sync-new-requests', pullData.requests.length);
      }

      broadcastSSE('cloud-sync-status', {
        ok: true,
        lastSyncAt: new Date().toISOString(),
        relayUrl: relayUrl,
        counts: pushData.counts || {}
      });

    } catch (err) {
      console.error('Cloud sync error:', err.message);
      broadcastSSE('cloud-sync-status', {
        ok: false,
        error: err.message
      });
    }
  }

  setTimeout(doSync, 5000);
  cloudSyncInterval = setInterval(doSync, 60000);
  console.log('Cloud relay sync started (60s interval)');
}

function stopCloudSync() {
  if (cloudSyncInterval) {
    clearInterval(cloudSyncInterval);
    cloudSyncInterval = null;
  }
}

// ── Startup ──
async function main() {
  try {
    console.log('Smart School Monitor — Web Mode');
    console.log('Data directory:', process.env.DATA_DIR);

    // 1. Initialize database
    initDatabase();

    // 2. Start Express API server (includes IPC bridge + SSE)
    await startExpressServer();

    // 3. Start SNMP gateway (skip on cloud — opens UDP ports that confuse Render's port detection)
    if (!process.env.RENDER) {
      startGateway();
    } else {
      console.log('Running on Render — skipping SNMP gateway (not needed in cloud)');
    }

    // 4. Start email queue processor
    startEmailQueueProcessor();

    // 5. Start cloud relay sync
    startCloudSync();

    console.log('Smart School Monitor started successfully (web mode)');
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

// ── Graceful shutdown ──
function shutdown() {
  console.log('Shutting down...');
  stopCloudSync();
  stopGateway();
  if (emailQueueInterval) clearInterval(emailQueueInterval);
  if (expressServer) expressServer.close();

  try {
    const db = require('./src/database/db');
    db.close();
  } catch (e) {}

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main();
