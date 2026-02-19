const db = require('../database/db');
const os = require('os');
const { execSync } = require('child_process');
const QRCode = require('qrcode');
const settingsService = require('./settings');

const EXPRESS_PORT = 3847;

/**
 * Detect the machine's LAN IPv4 address (e.g. 192.168.x.x, 10.x.x.x)
 * so QR codes use an address reachable from phones on the same network.
 */
function getLocalNetworkIP() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal (loopback) and non-IPv4 addresses
        if (iface.internal || iface.family !== 'IPv4') continue;
        // Return the first non-internal IPv4 address found
        return iface.address;
      }
    }
  } catch (e) {
    console.error('Error detecting network IP:', e);
  }
  return 'localhost'; // Fallback if no network interface found
}

/**
 * Get the macOS mDNS/Bonjour hostname (e.g. "Alvaros-MacBook-Pro-2.local").
 * iPhones on the same WiFi can resolve this via mDNS — no DNS server needed.
 *
 * CRITICAL: We use this instead of raw IP addresses because iOS Safari
 * prepends "www." to bare IP addresses when opening QR code links,
 * which breaks the URL. Safari does NOT do this with .local hostnames.
 */
function getLocalHostname() {
  try {
    // scutil --get LocalHostName returns the Bonjour hostname (without .local)
    // os.hostname() returns the DNS hostname which is different on school networks
    const localName = execSync('scutil --get LocalHostName', { encoding: 'utf8' }).trim();
    if (localName) {
      return localName.toLowerCase() + '.local';
    }
  } catch (e) {
    console.error('Error detecting local hostname:', e);
  }
  return null;
}

function getBaseUrl() {
  // Priority: 1) manually configured webAppUrl, 2) .local mDNS hostname, 3) LAN IP, 4) localhost
  const config = settingsService.getEmailConfig();
  if (config.webAppUrl) return config.webAppUrl;

  // Prefer .local hostname — prevents iOS Safari from adding "www." to IP addresses
  const hostname = getLocalHostname();
  if (hostname) {
    return 'http://' + hostname + ':' + EXPRESS_PORT;
  }

  const ip = getLocalNetworkIP();
  return 'http://' + ip + ':' + EXPRESS_PORT;
}

/**
 * Available QR URL strategies. Each strategy generates a different URL format
 * in the QR code. Some bypass iOS Safari's "www." prepend bug, others use
 * a redirect trampoline. The admin can test which works on their network.
 */
var QR_STRATEGIES = {
  'gas-trampoline': {
    name: 'Google Apps Script Redirect',
    desc: 'Redirect via script.google.com (always works, 0.5–2s slower)',
    needsRedirectUrl: true
  },
  'direct-ip': {
    name: 'Direct IP Address',
    desc: 'Fastest, but iOS Safari may add "www." (test first)'
  },
  'ip-trailing-dot': {
    name: 'IP with Trailing Dot',
    desc: 'Trailing dot marks IP as fully-qualified (may bypass iOS www. bug)'
  },
  'ip-userinfo': {
    name: 'IP with Userinfo',
    desc: 'Adds s@ prefix to URL (may bypass iOS www. bug)'
  },
  'mdns-local': {
    name: 'mDNS .local Hostname',
    desc: 'Uses Bonjour hostname (needs mDNS — may not work on enterprise WiFi)'
  },
  'cloudflare-tunnel': {
    name: 'Cloudflare Tunnel (Public HTTPS)',
    desc: 'Public URL via trycloudflare.com — works on any network, no WiFi restrictions'
  },
  'cloud-relay': {
    name: 'Cloud Relay (Render)',
    desc: 'Public HTTPS via Render.com — works on any network, even if tunnels are blocked'
  }
};

/**
 * Build the URL for a given strategy and device.
 * Returns the URL string, or null if the strategy can't be used.
 */
function getQRUrlForStrategy(deviceId, strategy) {
  var ip = getLocalNetworkIP();
  var target = '/request?device=' + encodeURIComponent(deviceId);

  switch (strategy) {
    case 'gas-trampoline': {
      var config = settingsService.getEmailConfig();
      var redirectUrl = (config.qrRedirectUrl || '').trim();
      if (!redirectUrl) return null; // Not configured
      var serverParam = ip + ':' + EXPRESS_PORT;
      var sep = redirectUrl.includes('?') ? '&' : '?';
      return redirectUrl + sep + 'd=' + encodeURIComponent(deviceId) + '&s=' + encodeURIComponent(serverParam);
    }
    case 'ip-trailing-dot':
      return 'http://' + ip + '.:' + EXPRESS_PORT + target;
    case 'ip-userinfo':
      return 'http://s@' + ip + ':' + EXPRESS_PORT + target;
    case 'mdns-local': {
      var hostname = getLocalHostname();
      if (!hostname) return null;
      return 'http://' + hostname + ':' + EXPRESS_PORT + target;
    }
    case 'cloudflare-tunnel': {
      var cfg = settingsService.getEmailConfig();
      var webAppUrl = (cfg.webAppUrl || '').trim();
      if (!webAppUrl) return null;
      return webAppUrl + target;
    }
    case 'cloud-relay': {
      var relayConfig = settingsService.getEmailConfig();
      var relayUrl = (relayConfig.cloudRelayUrl || '').trim();
      if (!relayUrl) return null;
      return relayUrl + target;
    }
    case 'direct-ip':
    default:
      return 'http://' + ip + ':' + EXPRESS_PORT + target;
  }
}

/**
 * Build the URL that should be encoded into a QR code for a given device.
 *
 * Uses the configured qrUrlStrategy from settings. Falls back through:
 * 1. Selected strategy (if configured and available)
 * 2. GAS trampoline (if redirect URL is configured)
 * 3. Direct base URL (webAppUrl / .local / IP)
 */
function getQRUrl(deviceId) {
  var config = settingsService.getEmailConfig();
  var strategy = (config.qrUrlStrategy || '').trim() || 'direct-ip';

  // If a strategy is explicitly selected, try it
  if (strategy && QR_STRATEGIES[strategy]) {
    var url = getQRUrlForStrategy(deviceId, strategy);
    if (url) return url;
    // Strategy unavailable (e.g. no redirect URL, no hostname) — fall through
  }

  // Legacy fallback: if qrRedirectUrl is set but no strategy chosen, use trampoline
  var redirectUrl = (config.qrRedirectUrl || '').trim();
  if (redirectUrl) {
    var ip = getLocalNetworkIP();
    var serverParam = ip + ':' + EXPRESS_PORT;
    var sep = redirectUrl.includes('?') ? '&' : '?';
    return redirectUrl + sep + 'd=' + encodeURIComponent(deviceId) + '&s=' + encodeURIComponent(serverParam);
  }

  // Direct mode: use the base URL (webAppUrl / .local / IP)
  return getBaseUrl() + '/request?device=' + deviceId;
}

function getQRCodes() {
  try { return db.getAll('qr_codes'); }
  catch (error) { return []; }
}

function generateQRCode(deviceId) {
  try {
    const url = getQRUrl(deviceId);
    const existing = db.queryOne('SELECT * FROM qr_codes WHERE deviceId = ?', [deviceId]);
    if (existing) {
      db.update('qr_codes', existing.id, { qrData: url, generatedAt: new Date().toISOString() });
      return { success: true, qrCode: { ...existing, qrData: url } };
    }
    const data = { id: db.generateId(), deviceId, qrData: url, generatedAt: new Date().toISOString(), printedAt: '', active: 1 };
    db.insert('qr_codes', data);
    return { success: true, qrCode: data };
  } catch (error) { return { success: false, error: error.message }; }
}

/**
 * Generate QR code with a locally-rendered PNG image (no external API).
 * Returns { success, qrCode, qrImageDataUrl } where qrImageDataUrl is a
 * data:image/png;base64,... string ready to use as an <img> src.
 */
async function generateQRCodeWithImage(deviceId) {
  try {
    const result = generateQRCode(deviceId);
    if (!result.success) return result;

    const url = result.qrCode.qrData;
    const qrImageDataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    });

    return { ...result, qrImageDataUrl };
  } catch (error) { return { success: false, error: error.message }; }
}

function generateQRCodesForDevices(deviceIds) {
  try {
    const results = [];
    for (const id of deviceIds) {
      results.push(generateQRCode(id));
    }
    return { success: true, results };
  } catch (error) { return { success: false, error: error.message }; }
}

function updateAllQRCodeUrls() {
  try {
    const codes = getQRCodes();
    let updated = 0;
    for (const qr of codes) {
      const newUrl = getQRUrl(qr.deviceId);
      if (qr.qrData !== newUrl) {
        db.update('qr_codes', qr.id, { qrData: newUrl });
        updated++;
      }
    }
    return { success: true, updated };
  } catch (error) { return { success: false, error: error.message }; }
}

function getQRCodeForDevice(deviceId) {
  try { return db.queryOne('SELECT * FROM qr_codes WHERE deviceId = ? AND active = 1', [deviceId]) || null; }
  catch (error) { return null; }
}

function markQRCodePrinted(qrCodeId) {
  try {
    db.update('qr_codes', qrCodeId, { printedAt: new Date().toISOString() });
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

function getLabelLayout() {
  try {
    const settings = settingsService.getSettings();
    return settings.qrLabelLayout || '';
  } catch (error) { return ''; }
}

function saveLabelLayout(layoutJson) {
  try {
    settingsService.saveSetting('qrLabelLayout', layoutJson);
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

module.exports = {
  getQRCodes, generateQRCode, generateQRCodeWithImage, generateQRCodesForDevices,
  updateAllQRCodeUrls, getQRCodeForDevice, markQRCodePrinted,
  getLabelLayout, saveLabelLayout, getLocalNetworkIP, getLocalHostname, getBaseUrl, getQRUrl,
  getQRUrlForStrategy, QR_STRATEGIES
};
