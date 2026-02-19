/**
 * Smart School Monitor - SNMP Gateway
 *
 * Automated SNMP monitoring that:
 * 1. Listens for SNMP traps from devices
 * 2. Polls devices on a schedule for status/supplies
 * 3. Pushes all data to Google Apps Script
 *
 * Run: node index.js
 */

const snmp = require('net-snmp');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURATION - EDIT THESE VALUES
// ============================================

// Config file path
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Load config from file if exists
function loadConfigFile() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    console.log('Note: Could not load config.json, using defaults');
  }
  return {};
}

// Parse command line arguments
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--port=')) {
      args.trapPort = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--poll=')) {
      args.pollInterval = parseInt(arg.split('=')[1], 10) * 1000;
    } else if (arg.startsWith('--url=')) {
      args.appsScriptUrl = arg.split('=')[1];
    }
  });
  return args;
}

const fileConfig = loadConfigFile();
const argsConfig = parseArgs();

const CONFIG = {
  // Local Express API server URL (replaces Google Apps Script)
  APPS_SCRIPT_URL: argsConfig.appsScriptUrl || fileConfig.appsScriptUrl || 'http://localhost:3847',

  // SNMP Settings
  SNMP_COMMUNITY: fileConfig.snmpCommunity || 'public',
  SNMP_PORT: fileConfig.snmpPort || 161,
  SNMP_TIMEOUT: 8000,
  SNMP_RETRIES: 2,

  // Trap Listener Settings - Use 162 by default (standard port)
  TRAP_PORT: argsConfig.trapPort || fileConfig.trapPort || 162,

  // Polling Settings
  POLL_INTERVAL: argsConfig.pollInterval || fileConfig.pollInterval || 60000,
  POLL_ENABLED: fileConfig.pollEnabled !== false,

  // Devices to monitor (add your printer IPs here)
  DEVICES: [
    // { ip: '192.168.1.100', name: 'Library Copier' },
    // { ip: '192.168.1.101', name: 'Office Printer' },
  ],

  // Device config file (alternative to hardcoding)
  DEVICES_FILE: path.join(__dirname, 'devices.json'),

  // Logging
  LOG_LEVEL: fileConfig.logLevel || 'info',
  LOG_FILE: path.join(__dirname, 'snmp-gateway.log'),
  LOG_MAX_SIZE: fileConfig.logMaxSize || 5 * 1024 * 1024, // 5MB max before rotation
  LOG_BACKUP_COUNT: fileConfig.logBackupCount || 3          // Keep 3 rotated backups
};

// ============================================
// SNMP OIDs
// ============================================

const OIDs = {
  // System Info
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',

  // Printer MIB - Supplies
  prtMarkerSuppliesDescription: '1.3.6.1.2.1.43.11.1.1.6',
  prtMarkerSuppliesLevel: '1.3.6.1.2.1.43.11.1.1.9',
  prtMarkerSuppliesMaxCapacity: '1.3.6.1.2.1.43.11.1.1.8',

  // Printer MIB - Alerts
  prtAlertSeverityLevel: '1.3.6.1.2.1.43.18.1.1.2',
  prtAlertDescription: '1.3.6.1.2.1.43.18.1.1.8',

  // Printer Status
  hrPrinterStatus: '1.3.6.1.2.1.25.3.5.1.1.1',
  hrDeviceStatus: '1.3.6.1.2.1.25.3.2.1.5.1',

  // Printer Alert Codes
  prtAlertCode: '1.3.6.1.2.1.43.18.1.1.7',

  // Vendor-specific Alert Code (used by Ricoh, etc.)
  prtAlertCodeVendor: '1.3.6.1.2.1.43.18.1.1.6',

  // Alert Group (identifies which subsystem triggered the alert)
  prtAlertGroup: '1.3.6.1.2.1.43.18.1.1.4',

  // Input Tray (paper levels)
  prtInputDescription: '1.3.6.1.2.1.43.8.2.1.18',
  prtInputMediaName: '1.3.6.1.2.1.43.8.2.1.13',
  prtInputCurrentLevel: '1.3.6.1.2.1.43.8.2.1.10',
  prtInputMaxCapacity: '1.3.6.1.2.1.43.8.2.1.9',

  // Page Count
  prtMarkerLifeCount: '1.3.6.1.2.1.43.10.2.1.4'
};

// Standard Printer MIB Alert Codes (RFC 3805)
const PRINTER_ALERT_CODES = {
  1: 'Other',
  2: 'Unknown',
  3: 'Cover Open',
  4: 'Cover Closed',
  5: 'Interlock Open',
  6: 'Interlock Closed',
  7: 'Configuration Change',
  8: 'Paper Jam',
  9: 'Paper Jam Cleared',
  10: 'Toner Empty',
  11: 'Toner Low',
  12: 'Waste Toner Full',
  13: 'Paper Empty',
  14: 'Paper Low',
  15: 'Paper Added',
  16: 'Door Open',
  17: 'Door Closed',
  18: 'Power Up',
  19: 'Power Down',
  20: 'Printer Offline',
  21: 'Printer Online',
  22: 'Input Tray Missing',
  23: 'Output Tray Missing',
  24: 'Marker Supply Missing',
  25: 'Output Full',
  26: 'Output Almost Full',
  27: 'Marker Supply Empty',
  28: 'Marker Supply Low',
  29: 'OPC Drum Near End of Life',
  30: 'OPC Drum Life Over',
  31: 'Developer Low',
  32: 'Developer Empty',
  33: 'Interpreter Memory Increase',
  34: 'Interpreter Memory Decrease',
  35: 'Interpreter Cartridge Added',
  36: 'Interpreter Cartridge Deleted',
  37: 'Interpreter Resource Added',
  38: 'Interpreter Resource Deleted',
  39: 'Interpreter Resource Unavailable',
  40: 'Interpreter Complexpage Encountered',
  41: 'Service Requested',
  42: 'Multi-Feed Jam',
  43: 'Fuser Over Temperature',
  44: 'Fuser Under Temperature',
  45: 'Toner Low (Replace Soon)',
  46: 'Misfeed'
};

// Common Severity Levels (RFC 3805)
const PRINTER_SEVERITY = {
  1: { level: 'info', name: 'Other' },
  2: { level: 'critical', name: 'Critical' },
  3: { level: 'critical', name: 'Critical' },
  4: { level: 'warning', name: 'Warning' },
  5: { level: 'info', name: 'Warning Non-Critical' }
};

// Alert Group codes (RFC 3805 - prtAlertGroup)
const ALERT_GROUPS = {
  1: 'other',
  3: 'hostResourcesMIBStorageTable',
  4: 'hostResourcesMIBDeviceTable',
  5: 'generalPrinter',
  6: 'cover',
  7: 'localization',
  8: 'input',
  9: 'output',
  10: 'marker',
  11: 'markerSupplies',
  12: 'markerColorant',
  13: 'mediaPath',
  14: 'channel',
  15: 'interpreter',
  16: 'consoleDisplayBuffer',
  17: 'consoleLights',
  18: 'alert',
  30: 'finDevice',
  31: 'finSupply',
  32: 'finSupplyMediaInput',
  33: 'finAttribute'
};

// Vendor-specific alert codes (prtAlertCodeVendor)
// These are manufacturer-specific codes sent in OID .43.18.1.1.6
// when the standard prtAlertCode (.43.18.1.1.7) = 1 (Other)
const VENDOR_ALERT_CODES = {
  // Ricoh vendor codes (enterprise .1.3.6.1.4.1.367)
  // Codes in the 10000+ range
  10003: { message: 'Normal Operation', severity: 'info', ignore: true },
  10033: { message: 'Energy Saver Mode', severity: 'info', ignore: true },
  10034: { message: 'Sleep Mode', severity: 'info', ignore: true },

  // Ricoh "OK" status codes (13xxx range)
  13100: { message: 'Toner OK', severity: 'info', ignore: true },
  13200: { message: 'Drum OK', severity: 'info', ignore: true },
  13300: { message: 'Fuser OK', severity: 'info', ignore: true },
  13400: { message: 'Paper Feed OK', severity: 'info', ignore: true },
  13500: { message: 'Output OK', severity: 'info', ignore: true },

  // Sharp vendor codes (enterprise .1.3.6.1.4.1.2385)
  // BP-series (BP-70M55, BP-70M65, BP-70C65, etc.)
  800: { message: 'Normal Operation', severity: 'info', ignore: true },
  801: { message: 'Ready', severity: 'info', ignore: true },
  802: { message: 'Warming Up', severity: 'info', ignore: true },
  803: { message: 'Energy Saver Mode', severity: 'info', ignore: true },
  804: { message: 'Sleep Mode', severity: 'info', ignore: true },
  805: { message: 'Paper Jam', severity: 'critical', ignore: false },
  806: { message: 'Cover Open', severity: 'warning', ignore: false },
  807: { message: 'Paper Low', severity: 'warning', ignore: false },
  808: { message: 'Input Tray Empty', severity: 'warning', ignore: false },
  809: { message: 'Toner Low', severity: 'warning', ignore: false },
  810: { message: 'Toner Empty', severity: 'critical', ignore: false },
  811: { message: 'Waste Toner Almost Full', severity: 'warning', ignore: false },
  812: { message: 'Waste Toner Full', severity: 'critical', ignore: false },
  813: { message: 'Drum Near End', severity: 'warning', ignore: false },
  814: { message: 'Drum End of Life', severity: 'critical', ignore: false },
  815: { message: 'Developer Low', severity: 'warning', ignore: false },
  816: { message: 'Fuser Error', severity: 'critical', ignore: false },
  817: { message: 'Service Required', severity: 'critical', ignore: false },
  818: { message: 'Multi-Feed Jam', severity: 'critical', ignore: false },
  819: { message: 'Output Tray Full', severity: 'warning', ignore: false },
  820: { message: 'Staple Empty', severity: 'warning', ignore: false },
  821: { message: 'Staple Jam', severity: 'critical', ignore: false },
  822: { message: 'Punch Waste Full', severity: 'warning', ignore: false },
  823: { message: 'Door Open', severity: 'warning', ignore: false },
  824: { message: 'Misfeed', severity: 'critical', ignore: false },
  825: { message: 'Communication Error', severity: 'critical', ignore: false },

  // Common vendor codes across manufacturers
  40000: { message: 'Normal Status', severity: 'info', ignore: true }
};

// ============================================
// LOGGING
// ============================================

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Track recently reported traps to avoid duplicates
const recentTraps = new Map();

// Buffer of recent traps for the /traps/recent endpoint (real-time UI updates)
// Stores the last 50 traps with timestamps so the frontend can poll for new ones
const recentTrapBuffer = [];

// Rotate log file if it exceeds max size
function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(CONFIG.LOG_FILE)) return;
    const stats = fs.statSync(CONFIG.LOG_FILE);
    if (stats.size < CONFIG.LOG_MAX_SIZE) return;

    // Rotate: .log.3 → deleted, .log.2 → .log.3, .log.1 → .log.2, .log → .log.1
    for (let i = CONFIG.LOG_BACKUP_COUNT; i >= 1; i--) {
      const older = `${CONFIG.LOG_FILE}.${i}`;
      const newer = i === 1 ? CONFIG.LOG_FILE : `${CONFIG.LOG_FILE}.${i - 1}`;
      if (i === CONFIG.LOG_BACKUP_COUNT && fs.existsSync(older)) {
        fs.unlinkSync(older);
      }
      if (fs.existsSync(newer)) {
        fs.renameSync(newer, older);
      }
    }
    console.log(`[LOG ROTATION] Rotated ${CONFIG.LOG_FILE} (was ${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
  } catch (e) {
    console.error('[LOG ROTATION] Error:', e.message);
  }
}

// Check for rotation every 100 log writes to avoid stat() on every call
let logWriteCount = 0;

function log(level, message, data = null) {
  if (LOG_LEVELS[level] < LOG_LEVELS[CONFIG.LOG_LEVEL]) return;

  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  console.log(logMessage);
  if (data) console.log(JSON.stringify(data, null, 2));

  // Write to log file
  try {
    // Check rotation periodically (every 100 writes)
    if (++logWriteCount % 100 === 0) {
      rotateLogIfNeeded();
    }
    fs.appendFileSync(CONFIG.LOG_FILE, logMessage + (data ? '\n' + JSON.stringify(data) : '') + '\n');
  } catch (e) {
    // Ignore file write errors
  }
}

// ============================================
// PUSH TO GOOGLE APPS SCRIPT
// ============================================

async function pushToAppsScript(action, data) {
  const baseUrl = CONFIG.APPS_SCRIPT_URL;
  if (!baseUrl) {
    log('warn', 'API URL not configured. Data not pushed.');
    return null;
  }

  try {
    const url = `${baseUrl}/api/gateway/${action}`;
    const payload = JSON.stringify({ action, ...data });
    log('debug', `Pushing to local API: ${action}`, { action, ...data });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: payload
    });

    const result = await response.json();
    log('info', `Pushed to API: ${action} - success`);
    return result;
  } catch (error) {
    log('error', `Failed to push to API: ${error.message}`);
    return null;
  }
}

// ============================================
// DEVICE SYNC FROM APPS SCRIPT
// ============================================

/**
 * Fetch the device list from the local Express API and update devices.json.
 */
async function syncDevicesFromAppsScript() {
  const baseUrl = CONFIG.APPS_SCRIPT_URL;
  if (!baseUrl) {
    log('info', 'API URL not configured — using local devices.json');
    return false;
  }

  try {
    log('info', 'Syncing device list from local API...');

    const response = await fetch(`${baseUrl}/api/gateway/getDevices`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    const result = await response.json();

    let deviceArray = null;
    if (Array.isArray(result)) {
      deviceArray = result;
    } else if (result && result.devices && Array.isArray(result.devices)) {
      deviceArray = result.devices;
    }

    if (!deviceArray) {
      log('warn', 'Could not parse device list from API');
      return false;
    }

    const validDevices = deviceArray.filter(d => d.ip && d.ip.trim());
    if (validDevices.length === 0) {
      log('warn', 'API returned 0 devices with IP addresses');
      return false;
    }

    const deviceList = validDevices.map(d => ({
      ip: d.ip.trim(),
      name: d.name || d.ip,
      id: d.id || '',
      type: d.type || '',
      model: d.model || ''
    }));

    saveDevices(deviceList);
    log('info', `Synced ${deviceList.length} devices from local API`);
    return true;
  } catch (error) {
    log('error', `Device sync failed: ${error.message}`);
    return false;
  }
}

// ============================================
// SNMP DEVICE POLLING
// ============================================

function createSession(ip) {
  return snmp.createSession(ip, CONFIG.SNMP_COMMUNITY, {
    port: CONFIG.SNMP_PORT,
    timeout: CONFIG.SNMP_TIMEOUT,
    retries: CONFIG.SNMP_RETRIES,
    version: snmp.Version2c
  });
}

async function getDeviceInfo(ip) {
  return new Promise((resolve) => {
    const session = createSession(ip);
    const oids = [OIDs.sysDescr, OIDs.sysUpTime, OIDs.sysName];

    session.get(oids, (error, varbinds) => {
      session.close();

      if (error) {
        log('debug', `Failed to get device info for ${ip}: ${error.message}`);
        resolve(null);
        return;
      }

      const info = {};
      varbinds.forEach(vb => {
        if (snmp.isVarbindError(vb)) return;

        if (vb.oid === OIDs.sysDescr) info.description = vb.value.toString();
        if (vb.oid === OIDs.sysUpTime) info.uptime = vb.value;
        if (vb.oid === OIDs.sysName) info.name = vb.value.toString();
      });

      resolve(info);
    });
  });
}

async function getSupplyLevels(ip) {
  return new Promise((resolve) => {
    const session = createSession(ip);
    const supplies = [];

    // Walk the supply tables
    const supplyNames = {};
    const supplyLevels = {};
    const supplyMax = {};

    let completed = 0;
    const checkComplete = () => {
      completed++;
      if (completed >= 3) {
        session.close();

        // Combine the data
        Object.keys(supplyNames).forEach(index => {
          const name = supplyNames[index];
          const level = supplyLevels[index];
          const max = supplyMax[index];
          let percentage;

          // Handle special SNMP supply level values:
          // -1 = "other" (unknown)
          // -2 = "unknown" (device doesn't report level)
          // -3 = "10%+ remaining" (Ricoh: some supply left, > 10%)
          // -100 = "10%-1% remaining" (Ricoh: supply low, between 1-10%)
          if (level === -3 || level === '-3') {
            // Ricoh: more than 10% remaining, estimate 50%
            percentage = 50;
          } else if (level === -100 || level === '-100') {
            // Ricoh: between 1-10% remaining, estimate 5%
            percentage = 5;
          } else if (level === -2 || level === '-2' || level === -1 || level === '-1') {
            // Unknown level — report as -1 so the UI can show "N/A"
            percentage = -1;
          } else {
            // Standard calculation
            const numLevel = parseInt(level) || 0;
            const numMax = parseInt(max) || 100;
            // max of -2 means "unknown capacity" — assume 100 for percentage calc
            const effectiveMax = numMax > 0 ? numMax : 100;
            percentage = Math.round((numLevel / effectiveMax) * 100);
          }

          supplies.push({
            name: name,
            level: parseInt(level) || 0,
            max: parseInt(max) || 100,
            percentage: percentage === -1 ? -1 : Math.max(0, Math.min(100, percentage))
          });
        });

        resolve(supplies);
      }
    };

    // Get supply names
    session.subtree(OIDs.prtMarkerSuppliesDescription, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          supplyNames[index] = vb.value.toString();
        }
      });
    }, (error) => {
      if (error) log('debug', `Supply names walk error: ${error.message}`);
      checkComplete();
    });

    // Get supply levels
    session.subtree(OIDs.prtMarkerSuppliesLevel, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          supplyLevels[index] = parseInt(vb.value) || 0;
        }
      });
    }, (error) => {
      if (error) log('debug', `Supply levels walk error: ${error.message}`);
      checkComplete();
    });

    // Get supply max capacity
    session.subtree(OIDs.prtMarkerSuppliesMaxCapacity, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          supplyMax[index] = parseInt(vb.value) || 100;
        }
      });
    }, (error) => {
      if (error) log('debug', `Supply max walk error: ${error.message}`);
      checkComplete();
    });

    // Timeout fallback — if SNMP walks are slow, build supplies from whatever data we have so far
    setTimeout(() => {
      if (completed < 3) {
        log('warn', `Supply walk timeout for ${ip} (${completed}/3 walks completed). Building partial results...`);
        session.close();

        // Build supplies from whatever data was collected before timeout
        // (uses same special-value handling as the main checkComplete block)
        const buildSupplyEntry = (name, level, max) => {
          let percentage;
          if (level === -3) percentage = 50;
          else if (level === -100) percentage = 5;
          else if (level === -2 || level === -1) percentage = -1;
          else {
            const effectiveMax = (max && max > 0) ? max : 100;
            percentage = Math.round(((level || 0) / effectiveMax) * 100);
          }
          return {
            name: name,
            level: level || 0,
            max: max || 100,
            percentage: percentage === -1 ? -1 : Math.max(0, Math.min(100, percentage))
          };
        };

        Object.keys(supplyNames).forEach(index => {
          supplies.push(buildSupplyEntry(
            supplyNames[index],
            supplyLevels[index],
            supplyMax[index]
          ));
        });

        // If we got levels but no names, build entries with generic names
        if (Object.keys(supplyNames).length === 0 && Object.keys(supplyLevels).length > 0) {
          Object.keys(supplyLevels).forEach(index => {
            supplies.push(buildSupplyEntry(
              `Supply ${index}`,
              supplyLevels[index],
              supplyMax[index]
            ));
          });
        }

        resolve(supplies);
      }
    }, CONFIG.SNMP_TIMEOUT + 2000);
  });
}

async function getInputTrays(ip) {
  return new Promise((resolve) => {
    const session = createSession(ip);
    const trays = [];

    const trayNames = {};
    const trayMedia = {};
    const trayLevels = {};
    const trayMax = {};

    let completed = 0;
    const TOTAL_WALKS = 4;
    const checkComplete = () => {
      completed++;
      if (completed >= TOTAL_WALKS) {
        try { session.close(); } catch (e) {}

        // Build tray entries from whichever indexes we found
        const allIndexes = new Set([
          ...Object.keys(trayNames),
          ...Object.keys(trayMedia),
          ...Object.keys(trayLevels)
        ]);

        allIndexes.forEach(index => {
          const name = trayNames[index] || trayMedia[index] || `Tray ${index}`;
          const level = parseInt(trayLevels[index]);
          const max = parseInt(trayMax[index]) || 0;

          let percentage;
          if (isNaN(level) || level < 0) {
            // -1 = other, -2 = unknown, -3 = >10% remaining
            if (level === -3) percentage = 50;
            else if (level === -2 || level === -1) percentage = -1;
            else percentage = -1;
          } else if (max > 0) {
            percentage = Math.round((level / max) * 100);
          } else {
            // No max reported — level might be 0 (empty) or non-zero (has paper)
            percentage = level > 0 ? 100 : 0;
          }

          trays.push({
            name: name,
            level: isNaN(level) ? 0 : level,
            max: max,
            percentage: percentage === -1 ? -1 : Math.max(0, Math.min(100, percentage))
          });
        });

        resolve(trays);
      }
    };

    // Get tray descriptions
    session.subtree(OIDs.prtInputDescription, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          trayNames[index] = vb.value.toString();
        }
      });
    }, () => checkComplete());

    // Get tray media names
    session.subtree(OIDs.prtInputMediaName, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          trayMedia[index] = vb.value.toString();
        }
      });
    }, () => checkComplete());

    // Get current levels
    session.subtree(OIDs.prtInputCurrentLevel, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          trayLevels[index] = parseInt(vb.value) || 0;
        }
      });
    }, () => checkComplete());

    // Get max capacity
    session.subtree(OIDs.prtInputMaxCapacity, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          trayMax[index] = parseInt(vb.value) || 0;
        }
      });
    }, () => checkComplete());

    // Timeout fallback
    setTimeout(() => {
      if (completed < TOTAL_WALKS) {
        try { session.close(); } catch (e) {}
        resolve(trays);
      }
    }, CONFIG.SNMP_TIMEOUT + 2000);
  });
}

async function getPageCount(ip) {
  return new Promise((resolve) => {
    const session = createSession(ip);
    let resolved = false;
    let pageCount = 0;

    session.subtree(OIDs.prtMarkerLifeCount, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          pageCount = parseInt(vb.value) || 0;
        }
      });
    }, (error) => {
      if (resolved) return;
      resolved = true;
      if (error) log('debug', `Page count error for ${ip}: ${error.message}`);
      try { session.close(); } catch (e) {}
      resolve(pageCount);
    });

    // Timeout
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { session.close(); } catch (e) {}
      resolve(pageCount);
    }, CONFIG.SNMP_TIMEOUT + 1000);
  });
}

async function getAlerts(ip) {
  return new Promise((resolve) => {
    const session = createSession(ip);
    const alerts = [];

    const severities = {};
    const descriptions = {};
    const alertCodes = {};
    const vendorCodes = {};
    const alertGroups = {};

    // Walk 5 OID trees: severity, description, alertCode, vendorCode, alertGroup
    const TOTAL_WALKS = 5;
    let completed = 0;
    const checkComplete = () => {
      completed++;
      if (completed >= TOTAL_WALKS) {
        session.close();

        Object.keys(severities).forEach(index => {
          const severity = severities[index];
          const description = descriptions[index] || '';
          const stdCode = alertCodes[index] || 0;
          const vendorCode = vendorCodes[index] || 0;
          const alertGroup = alertGroups[index] || 0;

          // Determine severity text from SNMP severity value
          let severityText = 'info';
          if (severity === 2 || severity === 3) severityText = 'error';
          else if (severity === 4 || severity === 5) severityText = 'warning';

          // Build alert text from multiple sources:
          let text = description || 'Unknown alert';

          // 1. If standard alert code is known (2-46), use it
          if (stdCode >= 2 && stdCode <= 46 && PRINTER_ALERT_CODES[stdCode]) {
            text = PRINTER_ALERT_CODES[stdCode];
            // Override severity for known critical/warning codes
            if ([8, 10, 12, 13, 20, 27, 30, 32, 42, 43, 44, 46].includes(stdCode)) {
              severityText = 'error';
            } else if ([11, 14, 25, 26, 28, 29, 31, 41, 45].includes(stdCode)) {
              severityText = 'warning';
            }
          }

          // 2. If vendor code is present (Ricoh: 10000+, Sharp: 800+), check our mapping
          if (vendorCode > 0 && VENDOR_ALERT_CODES[vendorCode]) {
            const vendorInfo = VENDOR_ALERT_CODES[vendorCode];
            // Use vendor message but prefer the description if it's more detailed
            if (description && description.length > 3) {
              // Clean Ricoh-style "{code}" suffix from description
              text = description.replace(/\s*\{\d+\}\s*$/, '').trim() || vendorInfo.message;
            } else {
              text = vendorInfo.message;
            }
            // Only override severity if vendor info says it's more severe
            if (vendorInfo.severity === 'critical') severityText = 'error';
            else if (vendorInfo.severity === 'warning' && severityText === 'info') severityText = 'warning';
          } else if (vendorCode > 0 && !VENDOR_ALERT_CODES[vendorCode]) {
            // Unknown vendor code — use description and note the vendor code
            if (description && description.length > 3) {
              text = description.replace(/\s*\{\d+\}\s*$/, '').trim();
            }
            log('debug', `Unknown vendor alert code ${vendorCode} from ${ip} (group: ${ALERT_GROUPS[alertGroup] || alertGroup})`);
          }

          // 3. If description has useful text but we used a generic code, prefer description
          if (description && description.length > 3 && (text === 'Other' || text === 'Unknown' || text === 'Unknown alert')) {
            text = description.replace(/\s*\{\d+\}\s*$/, '').trim();
          }

          // Add alert group context if available
          const groupName = ALERT_GROUPS[alertGroup] || '';

          alerts.push({
            severity: severityText,
            text: text,
            code: vendorCode > 0 ? `VENDOR-${vendorCode}` : `ALERT-${stdCode || index}`,
            group: groupName,
            timestamp: Date.now()
          });
        });

        resolve(alerts);
      }
    };

    // Get alert severities
    session.subtree(OIDs.prtAlertSeverityLevel, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          severities[index] = parseInt(vb.value) || 0;
        }
      });
    }, (error) => {
      checkComplete();
    });

    // Get alert descriptions
    session.subtree(OIDs.prtAlertDescription, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          descriptions[index] = vb.value.toString();
        }
      });
    }, (error) => {
      checkComplete();
    });

    // Get standard alert codes (.43.18.1.1.7)
    session.subtree(OIDs.prtAlertCode, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          alertCodes[index] = parseInt(vb.value) || 0;
        }
      });
    }, (error) => {
      checkComplete();
    });

    // Get vendor-specific alert codes (.43.18.1.1.6) — Ricoh uses 10000+ range
    session.subtree(OIDs.prtAlertCodeVendor, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          vendorCodes[index] = parseInt(vb.value) || 0;
        }
      });
    }, (error) => {
      checkComplete();
    });

    // Get alert groups (.43.18.1.1.4) — identifies which subsystem triggered alert
    session.subtree(OIDs.prtAlertGroup, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          alertGroups[index] = parseInt(vb.value) || 0;
        }
      });
    }, (error) => {
      checkComplete();
    });

    // Timeout fallback
    setTimeout(() => {
      if (completed < TOTAL_WALKS) {
        session.close();
        resolve(alerts);
      }
    }, CONFIG.SNMP_TIMEOUT + 1000);
  });
}

async function pollDevice(device) {
  const { ip, name, id } = device;
  log('info', `Polling device: ${name} (${ip})`);

  try {
    // Check if device is reachable
    const info = await getDeviceInfo(ip);

    if (!info) {
      log('warn', `Device ${name} (${ip}) is offline`);
      await pushToAppsScript('updateDeviceStatus', {
        deviceId: id || '',
        ip: ip,
        status: 'offline',
        supplies: [],
        messages: []
      });
      return;
    }

    // Get supply levels
    const supplies = await getSupplyLevels(ip);
    log('debug', `${name} supplies:`, supplies);

    // Get alerts
    const alerts = await getAlerts(ip);
    log('debug', `${name} alerts:`, alerts);

    // Get input tray (paper) levels
    const inputTrays = await getInputTrays(ip);
    log('debug', `${name} input trays:`, inputTrays);

    // Get page count
    const pageCount = await getPageCount(ip);
    log('debug', `${name} page count: ${pageCount}`);

    // Determine status
    let status = 'online';
    if (alerts.some(a => a.severity === 'error')) {
      status = 'issue';
    } else if (supplies.some(s => s.percentage >= 0 && s.percentage <= 5)) {
      // Only flag as issue for known low levels (skip -1 = unknown)
      status = 'issue';
    }

    // Push to Apps Script — send both deviceId AND ip for reliable matching
    const updateResult = await pushToAppsScript('updateDeviceStatus', {
      deviceId: id || '',
      ip: ip,
      status: status,
      supplies: supplies,
      messages: alerts,
      inputTrays: inputTrays,
      pageCount: pageCount
    });

    // Log if device was not found in the sheet (matching failure)
    if (updateResult && updateResult.error) {
      log('warn', `Device update failed for ${name} (${ip}): ${updateResult.error}`);
    }
    if (supplies.length > 0) {
      log('info', `${name} (${ip}): ${supplies.length} supply entries pushed (${supplies.map(s => s.name + ':' + s.percentage + '%').join(', ')})`);
    } else {
      log('warn', `${name} (${ip}): No supply data collected from SNMP`);
    }

    // Push supply history
    if (supplies.length > 0) {
      await pushToAppsScript('pushSupplyData', {
        deviceId: id || ip,
        supplies: supplies
      });
    }

    // NOTE: Alerts/traps are NOT created from polled data.
    // Only real SNMP traps (received on the trap listener) should generate alert records.
    // Polled supply data is pushed silently to update device status and supply history.

    log('info', `Polled ${name}: ${status}, ${supplies.length} supplies, ${alerts.length} alerts, ${inputTrays.length} trays, ${pageCount} pages`);

  } catch (error) {
    log('error', `Error polling ${name}: ${error.message}`);
  }
}

async function pollAllDevices() {
  const devices = loadDevices();

  if (devices.length === 0) {
    log('warn', 'No devices configured. Add devices to devices.json or CONFIG.DEVICES');
    return;
  }

  log('info', `Polling ${devices.length} devices...`);

  for (const device of devices) {
    await pollDevice(device);
    // Small delay between devices
    await new Promise(r => setTimeout(r, 500));
  }

  log('info', 'Polling complete');
}

// ============================================
// SNMP TRAP LISTENER
// ============================================

function parseTrapVarbinds(varbinds) {
  const data = {};

  varbinds.forEach(vb => {
    const oid = vb.oid.join('.');
    let value = vb.value;

    // Convert Buffer to string if needed
    if (Buffer.isBuffer(value)) {
      value = value.toString();
    }

    data[oid] = value;
  });

  return data;
}

// Alert Group context mapping — used when stdAlertCode=1 ("Other") and vendor code is unmapped
const ALERT_GROUP_CONTEXT = {
  5:  { msg: 'General Printer Alert', sev: 'warning' },
  6:  { msg: 'Cover/Door Alert', sev: 'warning' },
  8:  { msg: 'Input/Paper Tray Alert', sev: 'warning' },
  9:  { msg: 'Output Tray Alert', sev: 'warning' },
  10: { msg: 'Marker Alert', sev: 'warning' },
  11: { msg: 'Toner/Supply Alert', sev: 'warning' },
  12: { msg: 'Colorant Alert', sev: 'warning' },
  13: { msg: 'Paper Path Alert', sev: 'warning' },
  14: { msg: 'Channel Alert', sev: 'info' },
  15: { msg: 'Interpreter Alert', sev: 'info' },
  30: { msg: 'Finisher Alert', sev: 'warning' },
  31: { msg: 'Finisher Supply Alert', sev: 'warning' },
  32: { msg: 'Finisher Media Input Alert', sev: 'warning' }
};

// Severity ranking for comparing alert entries
const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };

/**
 * Parse a single alert table entry (one set of alert fields).
 * Returns { message, severity } for this entry.
 */
function parseAlertEntry(entry, sourceIp) {
  // entry fields: 2=severity, 4=group, 6=vendorCode, 7=stdCode, 8=description
  let message = 'Device Alert';
  let severity = 'info';

  const stdAlertCode = parseInt(entry['7']) || 0;
  const vendorCode = parseInt(entry['6']) || 0;
  const alertGroup = parseInt(entry['4']) || 0;
  const alertDesc = entry['8'] ? String(entry['8']).trim() : '';
  const sevLevel = parseInt(entry['2']) || 0;

  // Set severity from SNMP severity value
  if (PRINTER_SEVERITY[sevLevel]) {
    severity = PRINTER_SEVERITY[sevLevel].level;
  }

  // 1. Check standard alert code (RFC 3805, codes 2-46)
  if (stdAlertCode >= 2 && stdAlertCode <= 46 && PRINTER_ALERT_CODES[stdAlertCode]) {
    message = PRINTER_ALERT_CODES[stdAlertCode];
    if ([8, 10, 12, 13, 20, 27, 30, 32, 42, 43, 44, 46].includes(stdAlertCode)) {
      severity = 'critical';
    } else if ([11, 14, 25, 26, 28, 29, 31, 41, 45].includes(stdAlertCode)) {
      severity = 'warning';
    }
  }

  // 2. Check vendor-specific alert code
  if (vendorCode > 0) {
    if (VENDOR_ALERT_CODES[vendorCode]) {
      const vendorInfo = VENDOR_ALERT_CODES[vendorCode];
      message = vendorInfo.message;
      if (vendorInfo.severity === 'critical') severity = 'critical';
      else if (vendorInfo.severity === 'warning') severity = 'warning';
      else severity = vendorInfo.severity || 'info';
    } else {
      log('info', `Unknown vendor alert code ${vendorCode} from ${sourceIp} (group: ${ALERT_GROUPS[alertGroup] || alertGroup})`);
    }
  }

  // 3. Use manufacturer's alert description if still generic
  if (alertDesc && alertDesc.length > 3) {
    if (message === 'Device Alert' || message === 'Other' || message === 'Other Alert') {
      message = alertDesc.replace(/\s*\{\d+\}\s*$/, '').trim() || alertDesc;
    }
  }

  // 4. Use alert group context when stdAlertCode=1 ("Other") and no specific message found
  if ((message === 'Device Alert' || message === 'Other' || message === 'Other Alert') && alertGroup > 0) {
    const ctx = ALERT_GROUP_CONTEXT[alertGroup];
    if (ctx) {
      message = ctx.msg;
      if (severity === 'info') severity = ctx.sev;
    }
  }

  return { message, severity, vendorCode, stdAlertCode, alertGroup };
}

function parseTrapMessage(trapData, sourceIp) {
  let message = 'Device Alert';
  let severity = 'info';

  const varbinds = trapData.varbinds || {};

  // Group varbinds by alert table index
  // Alert OIDs end with .43.18.1.1.FIELD.INDEX (e.g. .43.18.1.1.7.1, .43.18.1.1.7.2)
  const alertEntries = {};
  let supplyLevel = null;
  let supplyName = '';

  for (const [oid, value] of Object.entries(varbinds)) {
    // Check if this is an alert table OID (.43.18.1.1.FIELD.INDEX)
    const alertMatch = oid.match(/43\.18\.1\.1\.(\d+)(?:\.(\d+))?$/);
    if (alertMatch) {
      const field = alertMatch[1];
      const index = alertMatch[2] || '0';
      if (!alertEntries[index]) alertEntries[index] = {};
      alertEntries[index][field] = value;
    }

    // Also collect supply OIDs (not part of alert table)
    if (oid.includes('1.3.6.1.2.1.43.11.1.1.9')) {
      supplyLevel = parseInt(value) || 0;
    }
    if (oid.includes('1.3.6.1.2.1.43.11.1.1.6') && value) {
      supplyName = value.toString().trim();
    }
  }

  // If we found structured alert entries, parse each and pick the most critical
  const entryKeys = Object.keys(alertEntries);
  if (entryKeys.length > 0) {
    let bestAlert = null;

    for (const index of entryKeys) {
      const parsed = parseAlertEntry(alertEntries[index], sourceIp);

      // Skip "ignore" vendor codes (status messages like Normal Operation, Sleep Mode)
      if (parsed.vendorCode > 0 && VENDOR_ALERT_CODES[parsed.vendorCode] && VENDOR_ALERT_CODES[parsed.vendorCode].ignore) {
        continue;
      }

      // Pick the most critical alert
      if (!bestAlert || (SEVERITY_RANK[parsed.severity] || 0) > (SEVERITY_RANK[bestAlert.severity] || 0)) {
        bestAlert = parsed;
      }
      // If same severity, prefer specific messages over generic
      if (bestAlert && (SEVERITY_RANK[parsed.severity] || 0) === (SEVERITY_RANK[bestAlert.severity] || 0)) {
        if (bestAlert.message === 'Device Alert' && parsed.message !== 'Device Alert') {
          bestAlert = parsed;
        }
      }
    }

    if (bestAlert && bestAlert.message !== 'Device Alert') {
      message = bestAlert.message;
      severity = bestAlert.severity;
    }

    // If all entries were ignored status codes, note it
    if (!bestAlert && entryKeys.length > 0) {
      // All entries were ignorable status codes
      const firstEntry = alertEntries[entryKeys[0]];
      const vc = parseInt(firstEntry['6']) || 0;
      if (vc > 0 && VENDOR_ALERT_CODES[vc]) {
        message = VENDOR_ALERT_CODES[vc].message;
        severity = 'info';
      }
    }
  } else {
    // No structured alert entries found — try flat varbind parsing (legacy format)
    let stdAlertCode = 0;
    let vendorCode = 0;
    let alertGroup = 0;
    let alertDesc = '';

    for (const [oid, value] of Object.entries(varbinds)) {
      if (oid.includes('1.3.6.1.2.1.43.18.1.1.7')) stdAlertCode = parseInt(value) || 0;
      if (oid.includes('1.3.6.1.2.1.43.18.1.1.6')) vendorCode = parseInt(value) || 0;
      if (oid.includes('1.3.6.1.2.1.43.18.1.1.4')) alertGroup = parseInt(value) || 0;
      if (oid.includes('1.3.6.1.2.1.43.18.1.1.8') && value) alertDesc = value.toString().trim();
      if (oid.includes('1.3.6.1.2.1.43.18.1.1.2')) {
        const sev = parseInt(value) || 0;
        if (PRINTER_SEVERITY[sev]) severity = PRINTER_SEVERITY[sev].level;
      }
    }

    const parsed = parseAlertEntry({ '7': stdAlertCode, '6': vendorCode, '4': alertGroup, '8': alertDesc, '2': 0 }, sourceIp);
    if (parsed.message !== 'Device Alert') {
      message = parsed.message;
      severity = parsed.severity;
    }
  }

  // Check supply levels (applies regardless of alert entries)
  if (supplyLevel !== null && supplyLevel >= 0) {
    const displayName = supplyName || 'Toner/Supply';
    if (supplyLevel <= 5) {
      message = `${displayName} Empty (${supplyLevel}%)`;
      severity = 'critical';
    } else if (supplyLevel <= 20) {
      message = `${displayName} Low (${supplyLevel}%)`;
      severity = 'warning';
    }
  }

  // If severity is set but message is still generic, use severity context
  if (message === 'Device Alert' && severity !== 'info') {
    message = (severity === 'critical' ? 'Critical' : 'Warning') + ' Alert';
  }

  return { message, severity };
}

// ============================================
// BER/ASN.1 DECODER FOR RAW SNMP TRAP PACKETS
// ============================================

/**
 * Decode a BER-encoded SNMP trap packet from raw bytes.
 * Returns an object with { varbinds: { oid: value, ... } } or null on failure.
 * This enables parsing trap packets when the net-snmp library isn't used.
 */
function decodeSNMPTrap(buf) {
  try {
    let pos = 0;

    // Read a BER tag+length and return { tag, length, contentStart }
    function readTL() {
      if (pos >= buf.length) return null;
      const tag = buf[pos++];
      let len = buf[pos++];
      if (len & 0x80) {
        const numBytes = len & 0x7f;
        len = 0;
        for (let i = 0; i < numBytes; i++) {
          len = (len << 8) | buf[pos++];
        }
      }
      return { tag, length: len, contentStart: pos };
    }

    // Read an OID from BER bytes
    function readOID(start, len) {
      const oidParts = [];
      // First byte encodes two components: X.Y where byte = X*40+Y
      const first = buf[start];
      oidParts.push(Math.floor(first / 40));
      oidParts.push(first % 40);
      let val = 0;
      for (let i = start + 1; i < start + len; i++) {
        val = (val << 7) | (buf[i] & 0x7f);
        if (!(buf[i] & 0x80)) {
          oidParts.push(val);
          val = 0;
        }
      }
      return oidParts.join('.');
    }

    // Read an integer value from BER bytes
    function readInteger(start, len) {
      let val = 0;
      // Handle signed integers
      if (len > 0 && (buf[start] & 0x80)) {
        val = -1; // Start with all 1s for negative
      }
      for (let i = start; i < start + len; i++) {
        val = (val << 8) | buf[i];
      }
      return val;
    }

    // Recursively find all varbind sequences in the packet
    // VarBind is: SEQUENCE { OID, value }
    // SNMP packet structure:
    //   SNMPv1:  SEQUENCE { version, community, Trap-PDU(0xA4) { enterprise, agentAddr, genericTrap, specificTrap, timestamp, VarBindList(SEQUENCE) } }
    //   SNMPv2c: SEQUENCE { version, community, SNMPv2-Trap(0xA7) { request-id, error-status, error-index, VarBindList(SEQUENCE) } }
    const varbinds = {};

    // Check if a tag is a constructed type that may contain varbinds
    function isConstructed(tag) {
      // 0x30 = SEQUENCE
      // 0xA0-0xA7 = context-specific constructed (PDU types: GetRequest, GetNextRequest, GetResponse, SetRequest, Trap-PDU, GetBulk, Inform, SNMPv2-Trap)
      return tag === 0x30 || (tag >= 0xA0 && tag <= 0xA7);
    }

    function readLength(p) {
      if (p >= buf.length) return { len: 0, next: p };
      let len = buf[p++];
      if (len & 0x80) {
        const numBytes = len & 0x7f;
        len = 0;
        for (let i = 0; i < numBytes; i++) {
          if (p >= buf.length) return { len: 0, next: p };
          len = (len << 8) | buf[p++];
        }
      }
      return { len, next: p };
    }

    function readValue(p, valTag, valLen) {
      if (valTag === 0x02 || valTag === 0x41 || valTag === 0x42 || valTag === 0x43 || valTag === 0x46) {
        // INTEGER, Counter32, Gauge32, TimeTicks, Counter64
        return readInteger(p, valLen);
      } else if (valTag === 0x04) {
        // OCTET STRING — clean non-printable chars (Sharp sends Shift-JIS sometimes)
        const raw = buf.slice(p, p + valLen);
        const isPrintable = raw.every(b => (b >= 0x20 && b <= 0x7E) || b === 0x0A || b === 0x0D || b === 0x09);
        if (isPrintable) {
          return raw.toString('ascii').trim();
        }
        // Try UTF-8, filter out non-printable chars
        const cleaned = raw.toString('utf8').replace(/[^\x20-\x7E]/g, '').trim();
        if (cleaned.length > 2) {
          return cleaned;
        }
        // Fall back to hex representation
        return '0x' + raw.toString('hex');
      } else if (valTag === 0x06) {
        // OID
        return readOID(p, valLen);
      } else if (valTag === 0x40) {
        // IP Address
        if (valLen === 4) {
          return `${buf[p]}.${buf[p+1]}.${buf[p+2]}.${buf[p+3]}`;
        }
        return buf.slice(p, p + valLen).toString('hex');
      } else if (valTag === 0x05) {
        // NULL
        return null;
      } else {
        // Unknown type — try as string
        return buf.slice(p, p + valLen).toString('utf8');
      }
    }

    function findVarbinds(start, end) {
      let p = start;
      while (p < end && p < buf.length) {
        const tag = buf[p++];
        if (p >= buf.length) break;
        const { len, next } = readLength(p);
        p = next;
        const contentStart = p;
        const contentEnd = Math.min(p + len, buf.length);

        if (isConstructed(tag)) {
          // For SEQUENCE (0x30): try to parse as VarBind { OID, value }
          if (tag === 0x30 && p < contentEnd && buf[p] === 0x06) {
            // This looks like a VarBind SEQUENCE
            const savedP = p;
            try {
              p++; // skip OID tag (0x06)
              const oidLenInfo = readLength(p);
              p = oidLenInfo.next;
              const oid = readOID(p, oidLenInfo.len);
              p += oidLenInfo.len;

              // Read value
              if (p < contentEnd) {
                const valTag = buf[p++];
                const valLenInfo = readLength(p);
                p = valLenInfo.next;
                const value = readValue(p, valTag, valLenInfo.len);
                varbinds[oid] = value;
              }
            } catch (e) {
              // If varbind parsing fails, fall through to recurse
            }
            // Also recurse to find more varbinds
            p = savedP;
          }
          // Recurse into all constructed types (SEQUENCE, Trap-PDU, SNMPv2-Trap, etc.)
          findVarbinds(contentStart, contentEnd);
          p = contentEnd;
        } else {
          // Skip primitive elements
          p = contentEnd;
        }
      }
    }

    findVarbinds(0, buf.length);

    if (Object.keys(varbinds).length > 0) {
      return { varbinds };
    }
    return null;
  } catch (e) {
    log('debug', `BER decode error: ${e.message}`);
    return null;
  }
}

function startTrapListener(port) {
  log('info', `Starting SNMP Trap listener on port ${port}...`);

  // Use raw UDP listener - more reliable than net-snmp receiver
  // which can crash on malformed packets
  return startRawTrapListener(port);
}

// Raw UDP trap listener - more reliable than net-snmp receiver
function startRawTrapListener(port) {
  const server = dgram.createSocket('udp4');

  server.on('error', (err) => {
    if (err.code === 'EACCES' && port < 1024) {
      // Port < 1024 requires root — automatically fall back to port + 9000
      const fallbackPort = port + 9000;
      log('warn', `Cannot bind to port ${port} (requires sudo). Falling back to port ${fallbackPort}...`);
      server.close();
      startRawTrapListener(fallbackPort);
      return;
    } else if (err.code === 'EADDRINUSE') {
      log('error', `Port ${port} is already in use!`);
      log('info', `To find it, run: sudo lsof -i :${port}`);
    } else {
      log('error', `UDP server error: ${err.message}`);
    }
    process.exit(1);
  });

  server.on('message', (msg, rinfo) => {
    log('info', `*** TRAP RECEIVED from ${rinfo.address}:${rinfo.port} (${msg.length} bytes) ***`);

    let message = 'Device Alert';
    let severity = 'warning';
    let trapData = {
      raw: msg.toString('hex').substring(0, 2000),
      rinfo: rinfo,
      timestamp: Date.now()
    };

    // OID-to-friendly-name map for varbind summary
    const OID_FRIENDLY_NAMES = {
      '1.3.6.1.2.1.43.18.1.1.2': 'alertSeverity',
      '1.3.6.1.2.1.43.18.1.1.4': 'alertGroup',
      '1.3.6.1.2.1.43.18.1.1.6': 'vendorCode',
      '1.3.6.1.2.1.43.18.1.1.7': 'alertCode',
      '1.3.6.1.2.1.43.18.1.1.8': 'alertDesc',
      '1.3.6.1.2.1.43.11.1.1.6': 'supplyName',
      '1.3.6.1.2.1.43.11.1.1.8': 'supplyMax',
      '1.3.6.1.2.1.43.11.1.1.9': 'supplyLevel',
      '1.3.6.1.2.1.43.8.2.1.18': 'inputDesc',
      '1.3.6.1.2.1.43.8.2.1.10': 'inputLevel',
      '1.3.6.1.2.1.43.8.2.1.9': 'inputMax',
      '1.3.6.1.2.1.1.1.0': 'sysDescr',
      '1.3.6.1.2.1.1.3.0': 'sysUpTime',
      '1.3.6.1.2.1.1.5.0': 'sysName',
      '1.3.6.1.6.3.1.1.4.1.0': 'snmpTrapOID'
    };

    try {
      // === METHOD 1: BER decode the SNMP packet (most reliable) ===
      const decoded = decodeSNMPTrap(msg);
      if (decoded && decoded.varbinds && Object.keys(decoded.varbinds).length > 0) {
        log('info', `BER decoded ${Object.keys(decoded.varbinds).length} varbinds from trap`);

        // Store decoded varbinds in trapData for Code.gs to also use
        trapData.decodedVarbinds = decoded.varbinds;

        // Create human-readable varbind summary for debugging
        trapData.varbindSummary = Object.entries(decoded.varbinds).map(([oid, value]) => {
          const nameEntry = Object.entries(OID_FRIENDLY_NAMES).find(([k]) => oid.includes(k));
          const name = nameEntry ? nameEntry[1] : oid;
          return `${name}=${value}`;
        }).join('; ');
        log('info', `Varbind summary: ${trapData.varbindSummary}`);

        // Parse the decoded varbinds
        const parsed = parseTrapMessage({ varbinds: decoded.varbinds }, rinfo.address);
        if (parsed.message && parsed.message !== 'Device Alert') {
          message = parsed.message;
          severity = parsed.severity;
        }
      }

      // === METHOD 2: Text pattern matching (fallback for non-standard packets) ===
      if (message === 'Device Alert') {
        const msgStr = msg.toString('utf8', 0, Math.min(msg.length, 500)).toLowerCase();

        const problemPatterns = [
          { pattern: /paper\s*jam/i, message: 'Paper Jam', severity: 'critical' },
          { pattern: /misfeed/i, message: 'Misfeed', severity: 'critical' },
          { pattern: /toner\s*(empty|out)/i, message: 'Toner Empty', severity: 'critical' },
          { pattern: /toner\s*low/i, message: 'Toner Low', severity: 'warning' },
          { pattern: /ink\s*(empty|out)/i, message: 'Ink Empty', severity: 'critical' },
          { pattern: /ink\s*low/i, message: 'Ink Low', severity: 'warning' },
          { pattern: /paper\s*(empty|out)/i, message: 'Paper Empty', severity: 'critical' },
          { pattern: /paper\s*low/i, message: 'Paper Low', severity: 'warning' },
          { pattern: /cover\s*open/i, message: 'Cover Open', severity: 'warning' },
          { pattern: /door\s*open/i, message: 'Door Open', severity: 'warning' },
          { pattern: /drum\s*(empty|end)/i, message: 'Drum End of Life', severity: 'critical' },
          { pattern: /drum\s*low/i, message: 'Drum Near End of Life', severity: 'warning' },
          { pattern: /waste\s*toner\s*full/i, message: 'Waste Toner Full', severity: 'critical' },
          { pattern: /fuser\s*(error|over|under)/i, message: 'Fuser Error', severity: 'critical' },
          { pattern: /offline/i, message: 'Device Offline', severity: 'critical' },
          { pattern: /service\s*(call|required|request)/i, message: 'Service Required', severity: 'critical' },
          { pattern: /staple/i, message: 'Staples Low/Empty', severity: 'warning' },
          { pattern: /output\s*full/i, message: 'Output Tray Full', severity: 'warning' },
          { pattern: /energy\s*saver/i, message: 'Energy Saver Mode', severity: 'info' },
          { pattern: /sleep\s*mode/i, message: 'Sleep Mode', severity: 'info' },
          { pattern: /warming/i, message: 'Warming Up', severity: 'info' },
          { pattern: /ready/i, message: 'Ready', severity: 'info' }
        ];

        for (const prob of problemPatterns) {
          if (prob.pattern.test(msgStr)) {
            message = prob.message;
            severity = prob.severity;
            break;
          }
        }
      }

      // === METHOD 3: Extract readable text (last resort) ===
      if (message === 'Device Alert') {
        const readableMatches = msg.toString('utf8', 0, Math.min(msg.length, 500)).match(/[\x20-\x7E]{4,}/g);
        if (readableMatches && readableMatches.length > 0) {
          const meaningfulText = readableMatches.filter(s =>
            !s.match(/^[\d\.]+$/) &&
            s.length > 4 &&
            !s.includes('public') &&
            !s.match(/^[0-9a-f]+$/i)
          ).map(s =>
            s.replace(/\s*\{\d+\}\s*$/, '').trim()
          ).filter(s => s.length > 3);
          if (meaningfulText.length > 0) {
            message = meaningfulText.slice(0, 2).join(' - ').substring(0, 80);
          }
        }
      }

      // === LOG: Unidentified trap — output full details for debugging ===
      if (message === 'Device Alert') {
        const readableText = msg.toString('utf8', 0, Math.min(msg.length, 300)).replace(/[^\x20-\x7E]/g, '.');
        log('warn', `UNIDENTIFIED TRAP from ${rinfo.address} (${msg.length} bytes)`);
        log('warn', `  Decoded varbinds: ${trapData.varbindSummary || 'BER decode failed'}`);
        log('warn', `  Readable text: ${readableText}`);
        log('warn', `  Raw hex (first 200): ${msg.toString('hex').substring(0, 200)}`);
      }

    } catch (e) {
      log('debug', `Error parsing trap packet: ${e.message}`);
    }

    // Find device name if known
    const devices = loadDevices();
    const device = devices.find(d => d.ip === rinfo.address);
    const deviceName = device ? device.name : rinfo.address;

    log('info', `Trap from ${deviceName}: ${severity} - ${message}`);

    // Add to recent trap buffer for real-time UI updates via /traps/recent
    const trapEntry = {
      sourceIp: rinfo.address,
      deviceName: deviceName,
      parsedMessage: message,
      severity: severity,
      timestamp: new Date().toISOString()
    };
    recentTrapBuffer.push(trapEntry);
    // Keep only last 50 traps in buffer
    if (recentTrapBuffer.length > 50) recentTrapBuffer.shift();

    // Push to Apps Script immediately
    pushToAppsScript('addTrap', {
      sourceIp: rinfo.address,
      trapData: trapData,
      parsedMessage: `${message}`,
      severity: severity
    });
  });

  server.on('listening', () => {
    const address = server.address();
    log('info', `===========================================`);
    log('info', `SNMP Trap listener ACTIVE on UDP port ${address.port}`);
    log('info', `Waiting for traps from devices...`);
    log('info', `===========================================`);
  });

  server.bind(port);
  return server;
}

// ============================================
// DEVICE MANAGEMENT
// ============================================

function loadDevices() {
  // First try to load from file
  try {
    if (fs.existsSync(CONFIG.DEVICES_FILE)) {
      const data = fs.readFileSync(CONFIG.DEVICES_FILE, 'utf8');
      const devices = JSON.parse(data);
      log('info', `Loaded ${devices.length} devices from ${CONFIG.DEVICES_FILE}`);
      return devices;
    }
  } catch (error) {
    log('warn', `Could not load devices file: ${error.message}`);
  }

  // Fall back to config
  return CONFIG.DEVICES;
}

function saveDevices(devices) {
  try {
    fs.writeFileSync(CONFIG.DEVICES_FILE, JSON.stringify(devices, null, 2));
    log('info', `Saved ${devices.length} devices to ${CONFIG.DEVICES_FILE}`);
  } catch (error) {
    log('error', `Could not save devices: ${error.message}`);
  }
}

function addDevice(ip, name) {
  const devices = loadDevices();

  if (devices.find(d => d.ip === ip)) {
    log('warn', `Device ${ip} already exists`);
    return false;
  }

  devices.push({ ip, name });
  saveDevices(devices);
  return true;
}

function removeDevice(ip) {
  const devices = loadDevices();
  const filtered = devices.filter(d => d.ip !== ip);

  if (filtered.length === devices.length) {
    log('warn', `Device ${ip} not found`);
    return false;
  }

  saveDevices(filtered);
  return true;
}

// ============================================
// HTTP HEALTH SERVER
// ============================================

const http = require('http');
const HEALTH_PORT = 5017;

function startHealthServer() {
  const server = http.createServer((req, res) => {
    // Enable CORS for the web app
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        trapPort: CONFIG.TRAP_PORT,
        pollInterval: CONFIG.POLL_INTERVAL,
        devicesCount: loadDevices().length,
        uptime: process.uptime(),
        pid: process.pid
      }));
    } else if (req.url === '/devices') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(loadDevices()));
    } else if (req.url === '/stop' && req.method === 'POST') {
      // Graceful shutdown endpoint
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, message: 'Gateway stopping...' }));
      log('info', 'Received stop command, shutting down...');
      setTimeout(() => {
        process.exit(0);
      }, 500);
    } else if (req.url === '/restart' && req.method === 'POST') {
      // Restart is handled by the launcher script
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, message: 'Gateway restarting...', pid: process.pid }));
      log('info', 'Received restart command...');
      // The launcher script will restart us
      setTimeout(() => {
        process.exit(0);
      }, 500);
    } else if (req.url.startsWith('/traps/recent')) {
      // Return recent traps since a given timestamp for real-time UI updates
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      const url = new URL(req.url, `http://localhost:${HEALTH_PORT}`);
      const since = url.searchParams.get('since') || '';
      const sinceDate = since ? new Date(since) : new Date(0);

      // Filter traps newer than 'since'
      const newTraps = recentTrapBuffer.filter(t => new Date(t.timestamp) > sinceDate);

      res.end(JSON.stringify({
        success: true,
        traps: newTraps,
        serverTime: new Date().toISOString(),
        totalBuffered: recentTrapBuffer.length
      }));
    } else if (req.url === '/logs') {
      // Return recent logs as JSON array
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      try {
        const logs = fs.readFileSync(CONFIG.LOG_FILE, 'utf8');
        const lines = logs.split('\n').filter(l => l.trim()).slice(-100);
        res.end(JSON.stringify({ success: true, logs: lines }));
      } catch (e) {
        res.end(JSON.stringify({ success: true, logs: [] }));
      }
    } else if (req.url.match(/^\/device\/[^/]+\/status/)) {
      // Live device status endpoint — queries the device via SNMP in real-time
      const urlParts = req.url.split('/');
      const deviceIp = decodeURIComponent(urlParts[2]);

      if (!deviceIp || !/^[\d.]+$/.test(deviceIp)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid IP address' }));
        return;
      }

      const startTime = Date.now();

      // Query printer status via SNMP
      try {
        const session = createSession(deviceIp);
        const oids = [OIDs.hrPrinterStatus, OIDs.hrDeviceStatus, OIDs.sysName];

        session.get(oids, (error, varbinds) => {
          session.close();
          const responseTime = Date.now() - startTime;

          if (error) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ip: deviceIp,
              online: false,
              printerStatus: null,
              statusMessage: 'Device unreachable',
              responseTime: responseTime
            }));
            return;
          }

          let printerStatus = null;
          let deviceStatus = null;
          let sysName = '';

          varbinds.forEach(vb => {
            if (snmp.isVarbindError(vb)) return;
            if (vb.oid === OIDs.hrPrinterStatus) printerStatus = parseInt(vb.value) || null;
            if (vb.oid === OIDs.hrDeviceStatus) deviceStatus = parseInt(vb.value) || null;
            if (vb.oid === OIDs.sysName) sysName = vb.value.toString();
          });

          // Build status message
          let statusMessage = '';
          const statusMap = { 1: 'Other', 2: 'Unknown', 3: 'Idle', 4: 'Printing', 5: 'Warmup' };
          if (printerStatus && statusMap[printerStatus]) {
            statusMessage = statusMap[printerStatus];
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ip: deviceIp,
            online: true,
            printerStatus: printerStatus,
            deviceStatus: deviceStatus,
            statusMessage: statusMessage,
            sysName: sysName,
            responseTime: responseTime
          }));
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(HEALTH_PORT, () => {
    log('info', `Health server running on http://localhost:${HEALTH_PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log('warn', `Health server port ${HEALTH_PORT} in use, skipping health endpoint`);
    } else {
      log('error', `Health server error: ${err.message}`);
    }
  });

  return server;
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║         Smart School Monitor - SNMP Gateway               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Check configuration
  console.log(`📡 API URL: ${CONFIG.APPS_SCRIPT_URL}`);

  // Create devices.json if it doesn't exist
  if (!fs.existsSync(CONFIG.DEVICES_FILE)) {
    const exampleDevices = [
      { ip: '192.168.1.100', name: 'Example Printer 1' },
      { ip: '192.168.1.101', name: 'Example Printer 2' }
    ];
    fs.writeFileSync(CONFIG.DEVICES_FILE, JSON.stringify(exampleDevices, null, 2));
    console.log('📄 Created devices.json - edit this file to add your printers');
    console.log('');
  }

  // Start health server (for app status detection)
  startHealthServer();

  // Start trap listener
  console.log('🎯 Starting SNMP trap listener...');
  startTrapListener(CONFIG.TRAP_PORT);

  // Sync device list from Apps Script (so we poll ALL registered devices)
  console.log('🔄 Syncing device list from Apps Script...');
  const synced = await syncDevicesFromAppsScript();
  if (synced) {
    const deviceCount = loadDevices().length;
    console.log(`✅ Synced ${deviceCount} devices from Apps Script`);
  } else {
    const deviceCount = loadDevices().length;
    console.log(`📄 Using local devices.json (${deviceCount} devices)`);
  }
  console.log('');

  // Start polling
  if (CONFIG.POLL_ENABLED) {
    console.log(`📊 Starting device polling (every ${CONFIG.POLL_INTERVAL / 1000} seconds)...`);
    console.log('');

    // Initial poll
    await pollAllDevices();

    // Schedule polling
    setInterval(pollAllDevices, CONFIG.POLL_INTERVAL);

    // Re-sync devices from Apps Script every 5 minutes (pick up new devices)
    setInterval(async () => {
      await syncDevicesFromAppsScript();
    }, 5 * 60 * 1000);
  }

  console.log('');
  console.log('✅ Gateway is running!');
  console.log('');
  console.log('📋 Quick commands:');
  console.log('   - Edit devices.json to add/remove printers');
  console.log('   - Configure trap destination on your copiers to this machine\'s IP');
  console.log('   - Press Ctrl+C to stop');
  console.log('');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gateway...');
  process.exit(0);
});

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
