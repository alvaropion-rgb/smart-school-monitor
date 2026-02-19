const express = require('express');
const path = require('path');
const QRCode = require('qrcode');

const PORT = parseInt(process.env.PORT, 10) || 3847;

function createServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  // CORS headers for local resources (needed by Tesseract Web Worker)
  app.use('/tesseract', (_req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); });
  app.use('/tesseract-core', (_req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); });
  app.use('/tessdata', (_req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); });

  // Serve tesseract.js files for OCR (local instead of CDN to avoid hanging in Electron)
  app.use('/tesseract', express.static(path.join(__dirname, '..', '..', 'node_modules', 'tesseract.js', 'dist'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.wasm')) res.set('Content-Type', 'application/wasm');
    }
  }));
  app.use('/tesseract-core', express.static(path.join(__dirname, '..', '..', 'node_modules', 'tesseract.js-core'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.wasm')) res.set('Content-Type', 'application/wasm');
    }
  }));
  app.use('/tessdata', express.static(path.join(__dirname, '..', '..', 'data', 'tessdata')));

  // Root URL: serve the app to all browsers (no Electron gate)
  // In web mode, the full app is accessible from any browser.

  // --- QR Code Image Generation Endpoint ---
  // Generates QR code PNG images server-side (reliable in Node.js, unlike Electron main process)
  // Used by the renderer to display scannable QR codes and for printed labels
  app.get('/qr/image/:deviceId.png', async (req, res) => {
    try {
      const qrCodes = require('../services/qrCodes');
      const deviceId = req.params.deviceId.replace(/\.png$/, '');

      // For preview/sample, generate a QR code with a placeholder URL
      if (deviceId === 'preview-sample') {
        const buffer = await QRCode.toBuffer(qrCodes.getQRUrl('sample'), {
          width: 300, margin: 2, errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' }
        });
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'no-cache');
        return res.send(buffer);
      }

      // Look up the device's QR URL from the database
      const qr = qrCodes.getQRCodeForDevice(deviceId);
      let url;
      if (qr && qr.qrData) {
        url = qr.qrData;
      } else {
        // If no QR record exists yet, build the URL dynamically
        url = qrCodes.getQRUrl(deviceId);
      }

      const buffer = await QRCode.toBuffer(url, {
        width: 300, margin: 2, errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' }
      });
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'no-cache');
      res.send(buffer);
    } catch (error) {
      console.error('QR image generation error:', error);
      res.status(500).send('Error generating QR code: ' + error.message);
    }
  });

  // Serve the main app renderer files via HTTP (required so Web Workers can use importScripts)
  // The Electron BrowserWindow loads from http://localhost:PORT instead of file://
  app.use(express.static(path.join(__dirname, '..', '..', 'renderer')));

  // Serve the QR request page
  app.get('/request', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'renderer', 'request.html'));
  });

  // --- Lightweight ping endpoint for QR strategy connection testing ---
  // Returns a tiny response with permissive CORS so phones can test connectivity
  app.get('/api/ping', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Cache-Control', 'no-cache');
    res.json({ ok: true, t: Date.now() });
  });

  // --- Save QR URL strategy from the test-connection page ---
  app.post('/api/qr-strategy', (req, res) => {
    try {
      res.set('Access-Control-Allow-Origin', '*');
      const settings = require('../services/settings');
      const qrCodes = require('../services/qrCodes');
      const strategy = (req.body.strategy || '').trim();
      if (!strategy || !qrCodes.QR_STRATEGIES[strategy]) {
        return res.json({ success: false, error: 'Invalid strategy' });
      }
      const config = settings.getEmailConfig();
      config.qrUrlStrategy = strategy;
      settings.saveEmailConfig(config);
      const result = qrCodes.updateAllQRCodeUrls();
      res.json({ success: true, updated: result.updated });
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  });

  // CORS preflight for qr-strategy
  app.options('/api/qr-strategy', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(204);
  });

  // --- QR code image for test-connection page URL ---
  app.get('/qr/test-connection.png', async (_req, res) => {
    try {
      const qrCodes = require('../services/qrCodes');
      const settings = require('../services/settings');
      const config = settings.getEmailConfig();
      const tunnelUrl = (config.webAppUrl || '').trim();
      let url;
      if (tunnelUrl) {
        // Prefer tunnel URL (works on any phone, any network)
        url = tunnelUrl + '/test-connection';
      } else {
        const hostname = qrCodes.getLocalHostname();
        const ip = qrCodes.getLocalNetworkIP();
        const host = hostname || (ip + '.');
        url = 'http://' + host + ':' + PORT + '/test-connection';
      }
      const buffer = await QRCode.toBuffer(url, {
        width: 300, margin: 2, errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' }
      });
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'no-cache');
      res.send(buffer);
    } catch (error) {
      res.status(500).send('Error generating QR code');
    }
  });

  // --- Connection Test Page ---
  // A standalone mobile-friendly page where the admin can test which QR URL
  // strategies actually work from their phone on the school network.
  app.get('/test-connection', (_req, res) => {
    const qrCodes = require('../services/qrCodes');
    const settings = require('../services/settings');
    const ip = qrCodes.getLocalNetworkIP();
    const hostname = qrCodes.getLocalHostname() || '';
    const config = settings.getEmailConfig();
    const currentStrategy = config.qrUrlStrategy || 'direct-ip';

    // Build test URLs for each strategy
    const strategies = [];
    for (const [key, meta] of Object.entries(qrCodes.QR_STRATEGIES)) {
      const testUrl = qrCodes.getQRUrlForStrategy('TEST', key);
      strategies.push({
        key,
        name: meta.name,
        desc: meta.desc,
        testUrl,
        pingUrl: testUrl ? new URL('/api/ping', testUrl.split('/request')[0] || testUrl.split('?')[0]).href : null,
        available: !!testUrl,
        current: key === currentStrategy
      });
    }

    // For strategies that use the local server directly, we can test with ping
    const tunnelUrl = (config.webAppUrl || '').trim();
    const directPingUrls = {
      'direct-ip': 'http://' + ip + ':' + PORT + '/api/ping',
      'ip-trailing-dot': 'http://' + ip + '.:' + PORT + '/api/ping',
      'ip-userinfo': 'http://s@' + ip + ':' + PORT + '/api/ping',
      'mdns-local': hostname ? 'http://' + hostname + ':' + PORT + '/api/ping' : null,
      'cloudflare-tunnel': tunnelUrl ? tunnelUrl + '/api/ping' : null
    };

    res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta name="theme-color" content="#1e293b">
<title>QR Connection Test</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;padding:16px}
  .container{max-width:440px;margin:0 auto}
  h1{font-size:1.3rem;text-align:center;margin-bottom:4px;color:#fff}
  .subtitle{text-align:center;color:#64748b;font-size:0.8rem;margin-bottom:16px}
  .info-card{background:#1e293b;border-radius:12px;padding:14px;margin-bottom:12px}
  .info-card .label{font-size:0.7rem;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
  .info-card .value{font-size:0.95rem;font-weight:600;color:#38bdf8;word-break:break-all}
  .test-all-row{margin-bottom:14px;text-align:center}
  .btn-test-all{width:100%;padding:14px;border:none;border-radius:10px;font-size:0.95rem;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#38bdf8,#818cf8);color:#fff;transition:opacity 0.1s}
  .btn-test-all:active{opacity:0.7}
  .btn-test-all:disabled{opacity:0.5;cursor:not-allowed}
  #test-all-status{margin-top:8px;font-size:0.8rem;font-weight:600;min-height:20px}
  #test-all-status.ok{color:#22c55e}
  #test-all-status.testing{color:#fbbf24}
  .strategy{background:#1e293b;border-radius:12px;padding:14px;margin-bottom:10px;border:2px solid transparent;transition:border-color 0.2s}
  .strategy.current{border-color:#38bdf8}
  .strategy.success{border-color:#22c55e}
  .strategy.fail{border-color:#ef4444}
  .strategy.fastest{border-color:#22c55e;box-shadow:0 0 16px rgba(34,197,94,0.3)}
  .strategy .name{font-size:0.95rem;font-weight:700;color:#fff;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .strategy .name .badge{font-size:0.6rem;background:#38bdf8;color:#0f172a;padding:2px 6px;border-radius:4px;font-weight:700}
  .strategy .name .badge-fast{font-size:0.6rem;background:#22c55e;color:#fff;padding:2px 6px;border-radius:4px;font-weight:700}
  .strategy .desc{font-size:0.75rem;color:#94a3b8;margin:4px 0 8px}
  .strategy .url{font-size:0.65rem;color:#475569;word-break:break-all;background:#0f172a;padding:6px 8px;border-radius:6px;margin-bottom:8px;font-family:monospace}
  .strategy .unavailable{font-size:0.75rem;color:#64748b;font-style:italic}
  .btn-row{display:flex;gap:8px}
  .btn{flex:1;padding:10px;border:none;border-radius:8px;font-size:0.8rem;font-weight:600;cursor:pointer;transition:opacity 0.1s}
  .btn:active{opacity:0.7}
  .btn-test{background:#334155;color:#e2e8f0}
  .btn-use{background:#22c55e;color:#fff}
  .btn-use:disabled{background:#334155;color:#64748b;cursor:not-allowed}
  .result{margin-top:8px;font-size:0.8rem;font-weight:600;text-align:center;min-height:20px}
  .result.ok{color:#22c55e}
  .result.fail{color:#ef4444}
  .result.testing{color:#fbbf24}
  .footer{text-align:center;color:#475569;font-size:0.7rem;margin-top:16px;padding:8px}
</style>
</head><body>
<div class="container">
  <h1>QR Connection Test</h1>
  <p class="subtitle">Test which URL strategy works from this phone</p>

  <div class="info-card">
    <div class="label">Server IP</div>
    <div class="value">${ip}:${PORT}</div>
  </div>
  ${hostname ? `<div class="info-card"><div class="label">mDNS Hostname</div><div class="value">${hostname}</div></div>` : ''}

  <div class="test-all-row">
    <button class="btn-test-all" id="btn-test-all" onclick="testAll()">Test All Strategies</button>
    <div id="test-all-status"></div>
  </div>

  <div id="strategies">
    ${strategies.map(s => `
      <div class="strategy${s.current ? ' current' : ''}" id="s-${s.key}">
        <div class="name">${s.name}${s.current ? '<span class="badge">CURRENT</span>' : ''}</div>
        <div class="desc">${s.desc}</div>
        ${s.available
          ? `<div class="url">${s.key === 'gas-trampoline' ? 'GAS redirect \\u2192 http://${ip}:${PORT}/request?device=...' : (s.testUrl || '').replace('TEST', '...')}</div>
             <div class="btn-row">
               <button class="btn btn-test" onclick="testStrategy('${s.key}')">Test</button>
               <button class="btn btn-use" id="use-${s.key}" onclick="useStrategy('${s.key}')"${!s.current ? '' : ' disabled'}>Use This</button>
             </div>
             <div class="result" id="result-${s.key}"></div>`
          : `<div class="unavailable">${s.key === 'gas-trampoline' ? 'Configure QR Redirect URL in desktop Settings first' : (s.key === 'mdns-local' ? 'No .local hostname detected on server' : 'Not available')}</div>`
        }
      </div>
    `).join('')}
  </div>

  <div class="footer">
    Open this page from an iPhone on the same WiFi as the server.<br>
    Tap "Test All" to find the fastest working strategy.
  </div>
</div>

<script>
var pingUrls = ${JSON.stringify(directPingUrls)};
var serverBase = 'http://${ip}:${PORT}';
var availableKeys = ${JSON.stringify(strategies.filter(s => s.available).map(s => s.key))};

function testAll() {
  var btn = document.getElementById('btn-test-all');
  var statusEl = document.getElementById('test-all-status');
  btn.disabled = true;
  btn.textContent = 'Testing...';
  statusEl.textContent = 'Testing all strategies...';
  statusEl.className = 'testing';

  // Remove previous fastest badge
  document.querySelectorAll('.badge-fast').forEach(function(b) { b.remove(); });
  document.querySelectorAll('.strategy').forEach(function(s) { s.classList.remove('fastest'); });

  var results = {};
  var pending = availableKeys.length;

  availableKeys.forEach(function(key) {
    testStrategyAsync(key, function(ok, ms) {
      results[key] = { ok: ok, ms: ms };
      pending--;
      if (pending === 0) finishTestAll(results, btn, statusEl);
    });
  });

  if (pending === 0) {
    btn.disabled = false;
    btn.textContent = 'Test All Strategies';
    statusEl.textContent = 'No strategies available to test.';
  }
}

function finishTestAll(results, btn, statusEl) {
  btn.disabled = false;
  btn.textContent = 'Test All Strategies';

  // Find fastest passing strategy
  var fastest = null;
  var fastestMs = Infinity;
  for (var key in results) {
    if (results[key].ok && results[key].ms < fastestMs) {
      fastest = key;
      fastestMs = results[key].ms;
    }
  }

  if (fastest) {
    statusEl.innerHTML = 'Fastest: <strong>' + fastest + '</strong> (' + fastestMs + 'ms)';
    statusEl.className = 'ok';
    var card = document.getElementById('s-' + fastest);
    card.classList.add('fastest');
    var nameEl = card.querySelector('.name');
    var badge = document.createElement('span');
    badge.className = 'badge-fast';
    badge.textContent = 'FASTEST';
    nameEl.appendChild(badge);
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    statusEl.textContent = 'No strategies connected. Check WiFi.';
    statusEl.className = 'result fail';
  }
}

function testStrategyAsync(key, callback) {
  var el = document.getElementById('result-' + key);
  var card = document.getElementById('s-' + key);
  if (!el) { callback(false, 0); return; }
  el.textContent = 'Testing...';
  el.className = 'result testing';
  card.classList.remove('success', 'fail', 'fastest');

  if (key === 'gas-trampoline') {
    testPing(serverBase + '/api/ping', function(ok, ms) {
      if (ok) {
        el.textContent = 'Server reachable (' + ms + 'ms). GAS will add ~0.5-2s redirect time.';
        el.className = 'result ok';
        card.classList.add('success');
        callback(true, ms + 1000);
      } else {
        el.textContent = 'Server not reachable from this phone.';
        el.className = 'result fail';
        card.classList.add('fail');
        callback(false, 0);
      }
    });
    return;
  }

  var url = pingUrls[key];
  if (!url) {
    el.textContent = 'No test URL for this strategy';
    el.className = 'result fail';
    card.classList.add('fail');
    callback(false, 0);
    return;
  }

  testPing(url, function(ok, ms) {
    if (ok) {
      el.textContent = 'Connected in ' + ms + 'ms!';
      el.className = 'result ok';
      card.classList.add('success');
      document.getElementById('use-' + key).disabled = false;
      callback(true, ms);
    } else {
      el.textContent = 'Connection failed.';
      el.className = 'result fail';
      card.classList.add('fail');
      callback(false, 0);
    }
  });
}

function testStrategy(key) {
  testStrategyAsync(key, function() {});
}

function testPing(url, cb) {
  var start = Date.now();
  var timer = setTimeout(function() { cb(false, 0); }, 5000);

  fetch(url, { mode: 'cors', cache: 'no-cache' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      clearTimeout(timer);
      if (data && data.ok) cb(true, Date.now() - start);
      else cb(false, 0);
    })
    .catch(function() {
      clearTimeout(timer);
      cb(false, 0);
    });
}

function useStrategy(key) {
  fetch(serverBase + '/api/qr-strategy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy: key })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      document.querySelectorAll('.strategy').forEach(function(s) { s.classList.remove('current'); });
      document.querySelectorAll('.badge').forEach(function(b) { b.remove(); });
      document.querySelectorAll('.btn-use').forEach(function(b) { b.disabled = false; });

      var card = document.getElementById('s-' + key);
      card.classList.add('current');
      var nameEl = card.querySelector('.name');
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'CURRENT';
      nameEl.appendChild(badge);
      document.getElementById('use-' + key).disabled = true;

      var el = document.getElementById('result-' + key);
      el.textContent = 'Saved! ' + (data.updated || 0) + ' QR codes updated.';
      el.className = 'result ok';
    } else {
      alert('Error: ' + (data.error || 'Unknown'));
    }
  })
  .catch(function(err) { alert('Error: ' + err.message); });
}

// Auto-run test all on page load
setTimeout(testAll, 500);
</script>
</body></html>`);
  });

  // OAuth2 callback — exchanges the code for tokens (web mode)
  app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
      return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px;"><h2 style="color:#dc2626;">Sign-in failed</h2><p>No authorization code received.</p></body></html>');
    }

    try {
      const microsoftGraph = require('../services/microsoftGraph');
      const result = await microsoftGraph.handleAuthCallback(code);
      if (result.success) {
        res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;">
          <h2 style="color:#16a34a;">&#10003; Signed In!</h2>
          <p>Signed in as <strong>${result.account.email}</strong></p>
          <p>You can close this tab and return to the app.</p>
          <script>setTimeout(function(){ window.close(); }, 2000);</script>
        </body></html>`);
      } else {
        res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;">
          <h2 style="color:#dc2626;">Sign-in failed</h2>
          <p>${result.error || 'Unknown error'}</p>
        </body></html>`);
      }
    } catch (err) {
      res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;">
        <h2 style="color:#dc2626;">Sign-in error</h2>
        <p>${err.message}</p>
      </body></html>`);
    }
  });

  // --- Debug endpoint for QR verification ---
  app.get('/api/debug/qr/:deviceId', (req, res) => {
    try {
      const qrCodes = require('../services/qrCodes');
      const devices = require('../services/devices');
      const deviceTypes = require('../services/deviceTypes');

      const device = devices.getDeviceById(req.params.deviceId);
      const qr = qrCodes.getQRCodeForDevice(req.params.deviceId);
      const deviceType = device ? deviceTypes.getDeviceTypeForDevice(device) : null;
      const baseUrl = qrCodes.getBaseUrl();
      const lanIP = qrCodes.getLocalNetworkIP();

      res.json({
        deviceId: req.params.deviceId,
        device: device ? { name: device.name, type: device.type, location: device.location } : null,
        deviceType: deviceType ? { id: deviceType.id, name: deviceType.name } : null,
        qrCode: qr,
        baseUrl,
        lanIP,
        hostname: qrCodes.getLocalHostname() || 'N/A',
        expectedUrl: baseUrl + '/request?device=' + req.params.deviceId
      });
    } catch (error) {
      res.json({ error: error.message });
    }
  });

  // --- QR URL Verification Endpoint ---
  // Shows the exact URL encoded in the QR image for a given device (for debugging)
  app.get('/qr/verify/:deviceId', (req, res) => {
    try {
      const qrCodes = require('../services/qrCodes');
      const settingsService = require('../services/settings');
      const deviceId = req.params.deviceId;
      const qr = qrCodes.getQRCodeForDevice(deviceId);
      const baseUrl = qrCodes.getBaseUrl();
      const lanIP = qrCodes.getLocalNetworkIP();
      const hostname = qrCodes.getLocalHostname() || 'N/A';
      const config = settingsService.getEmailConfig();
      const redirectUrl = config.qrRedirectUrl || '';
      const encodedUrl = (qr && qr.qrData) ? qr.qrData : qrCodes.getQRUrl(deviceId);
      const hasRedirect = redirectUrl.length > 0;
      const isSafe = hasRedirect || (encodedUrl.includes('.') && !encodedUrl.match(/https?:\/\/\d+\.\d+\.\d+\.\d+/));
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QR Verification</title>
<style>body{font-family:-apple-system,sans-serif;padding:20px;max-width:500px;margin:0 auto}
.url{background:#e0f2f1;padding:16px;border-radius:8px;word-break:break-all;font-family:monospace;font-size:14px;margin:12px 0}
.info{color:#64748b;font-size:13px;margin:4px 0}
a{color:#0f766e;font-weight:600}
.ok{color:#16a34a;font-weight:600}
.warn{color:#dc2626;font-weight:600}</style></head>
<body>
<h2>QR Code Verification</h2>
<p class="info"><strong>Device ID:</strong> ${deviceId}</p>
<p class="info"><strong>LAN IP:</strong> ${lanIP}</p>
<p class="info"><strong>mDNS Hostname:</strong> ${hostname}</p>
<p class="info"><strong>Base URL:</strong> ${baseUrl}</p>
<p class="info"><strong>Redirect trampoline:</strong> ${hasRedirect ? '<span class="ok">Configured ✓</span>' : '<span class="warn">Not set</span>'}</p>
${hasRedirect ? '<p class="info"><strong>Redirect URL:</strong> ' + redirectUrl + '</p>' : ''}
<p class="info"><strong>DB record exists:</strong> ${qr ? 'Yes' : 'No'}</p>
<p class="info"><strong>iOS Safari safe:</strong> ${isSafe ? '<span class="ok">Yes ✓</span>' : '<span class="warn">No ✗ (bare IP — Safari may add www.)</span>'}</p>
<h3>URL encoded in QR image:</h3>
<div class="url">${encodedUrl}</div>
<p><a href="${encodedUrl}">Click here to test this URL</a></p>
</body></html>`);
    } catch (error) {
      res.status(500).send('Error: ' + error.message);
    }
  });

  // --- QR Request Page API ---

  app.get('/api/request/pageData', (req, res) => {
    try {
      const deviceId = req.query.device;
      if (!deviceId) return res.json({ success: false, error: 'No device ID' });

      const devices = require('../services/devices');
      const deviceTypes = require('../services/deviceTypes');
      const issueButtons = require('../services/issueButtons');
      const settings = require('../services/settings');

      const device = devices.getDeviceById(deviceId);
      if (!device) return res.json({ success: false, error: 'Device not found' });

      const deviceType = deviceTypes.getDeviceTypeForDevice(device);
      let buttons = [];
      if (deviceType) {
        buttons = issueButtons.getIssueButtonsByDeviceType(deviceType.id);
      }

      const branding = settings.getRequestPageBranding();

      res.json({ success: true, device, buttons, branding });
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  });

  app.post('/api/request/lookupEmployee', (req, res) => {
    try {
      const employees = require('../services/employees');
      const result = employees.lookupEmployee(req.body.searchTerm);
      res.json(result);
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  });

  app.post('/api/request/createServiceRequest', (req, res) => {
    try {
      const serviceRequests = require('../services/serviceRequests');
      const result = serviceRequests.createServiceRequest(req.body);
      res.json(result);
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  });

  app.get('/api/request/workingHours', (_req, res) => {
    try {
      const workingHours = require('../services/workingHours');
      const status = workingHours.getWorkingHoursStatus();
      res.json(status);
    } catch (error) {
      res.json({ isWorkingHours: true });
    }
  });

  // --- SNMP Gateway API ---

  app.post('/api/gateway/updateDeviceStatus', (req, res) => {
    try {
      const devices = require('../services/devices');
      const result = devices.updateDeviceStatus(req.body);
      res.json(result);
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  });

  app.post('/api/gateway/addTrap', (req, res) => {
    try {
      const traps = require('../services/traps');
      const result = traps.addTrap(req.body);
      res.json(result);
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  });

  app.post('/api/gateway/pushSupplyData', (req, res) => {
    try {
      const supplyHistory = require('../services/supplyHistory');
      const result = supplyHistory.pushSupplyData(req.body);
      res.json(result);
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  });

  app.get('/api/gateway/getDevices', (_req, res) => {
    try {
      const devices = require('../services/devices');
      res.json(devices.getDevices());
    } catch (error) {
      res.json([]);
    }
  });

  // --- Legacy doGet/doPost compatibility ---
  // The original Code.gs had doGet/doPost handlers that the gateway uses

  app.get('/api/devices', (_req, res) => {
    try {
      const devices = require('../services/devices');
      res.json(devices.getDevices());
    } catch (error) {
      res.json([]);
    }
  });

  app.post('/api/exec', (req, res) => {
    // Generic endpoint for backward compatibility with gateway
    try {
      const { action } = req.body;
      if (action === 'updateDeviceStatus') {
        const devices = require('../services/devices');
        res.json(devices.updateDeviceStatus(req.body));
      } else if (action === 'addTrap') {
        const traps = require('../services/traps');
        res.json(traps.addTrap(req.body));
      } else if (action === 'pushSupplyData') {
        const supplyHistory = require('../services/supplyHistory');
        res.json(supplyHistory.pushSupplyData(req.body));
      } else {
        res.json({ success: false, error: 'Unknown action: ' + action });
      }
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  });

  return { app, PORT };
}

// 404 catch-all — register LAST after all routes (including IPC bridge in web mode)
function add404Handler(app) {
  app.use((req, res) => {
    console.log(`404 Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).send(`<!DOCTYPE html><html><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Not Found - SharkQuick</title>
      <style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#f8fafc;color:#64748b;margin:0}
      code{background:#e2e8f0;padding:2px 8px;border-radius:4px;font-size:0.9rem}
      a{color:#0f766e;font-weight:600}</style>
      </head><body>
      <div style="font-size:2.5rem;margin-bottom:12px">🦈</div>
      <h2 style="color:#1e293b">Page Not Found</h2>
      <p>The path <code>${req.originalUrl}</code> doesn't exist on this server.</p>
      <p style="margin-top:20px"><a href="/">Home</a> · <a href="/test-connection">Connection Test</a></p>
      </body></html>`);
  });
}

function startServer() {
  const { app, PORT: port } = createServer();
  add404Handler(app); // Register 404 last (Electron mode)

  function tryListen(p, attempts) {
    return new Promise((resolve, reject) => {
      const server = app.listen(p, '0.0.0.0', () => {
        console.log(`Express API server running on http://0.0.0.0:${p}`);
        console.log(`QR Request page: http://localhost:${p}/request?device=<id>`);

        // Regenerate QR code URLs on startup in case the IP changed (DHCP)
        try {
          const qrCodes = require('../services/qrCodes');
          const result = qrCodes.updateAllQRCodeUrls();
          if (result.updated > 0) {
            console.log(`Updated ${result.updated} QR code URLs for current IP`);
          }
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

  return tryListen(port, 5);
}

module.exports = { createServer, startServer, add404Handler, PORT };
