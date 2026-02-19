const db = require('../database/db');
const fs = require('fs');

const TABLES = [
  'devices', 'supply_history', 'snmp_traps', 'technicians', 'email_config',
  'email_history', 'settings', 'blueprints', 'teachers', 'device_types',
  'issue_buttons', 'service_requests', 'qr_codes', 'email_templates',
  'incidents', 'email_queue', 'ai_training', 'computer_repairs',
  'cr_training', 'repair_templates'
];

function getSheetStats() {
  try {
    const stats = {};
    for (const table of TABLES) {
      try {
        const count = db.queryOne(`SELECT COUNT(*) as count FROM "${table}"`);
        stats[table] = { rows: count ? count.count : 0 };
      } catch (e) { stats[table] = { rows: 0 }; }
    }
    return stats;
  } catch (error) { return {}; }
}

function getSpreadsheetInfo(sheetName) {
  try {
    const table = sheetName || TABLES[0];
    const count = db.queryOne(`SELECT COUNT(*) as count FROM "${table}"`);
    const pragma = db.query(`PRAGMA table_info("${table}")`);
    return { name: table, rows: count ? count.count : 0, columns: pragma.map(c => c.name) };
  } catch (error) { return { name: sheetName, rows: 0, columns: [] }; }
}

function createFullBackup() {
  try {
    const backup = {};
    for (const table of TABLES) {
      try { backup[table] = db.getAll(table); } catch (e) { backup[table] = []; }
    }
    return { success: true, data: backup, timestamp: new Date().toISOString() };
  } catch (error) { return { success: false, error: error.message }; }
}

function exportSheetAsCSV(sheetName) {
  try {
    const rows = db.getAll(sheetName);
    if (rows.length === 0) return { success: true, csv: '' };
    const headers = Object.keys(rows[0]);
    const csvRows = [headers.join(',')];
    for (const row of rows) {
      csvRows.push(headers.map(h => {
        let val = String(row[h] != null ? row[h] : '');
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      }).join(','));
    }
    return { success: true, csv: csvRows.join('\n') };
  } catch (error) { return { success: false, error: error.message }; }
}

function importSheetFromCSV(sheetName, csvData) {
  try {
    const rows = parseCSV(csvData);
    if (rows.length < 2) return { success: false, error: 'No data rows found' };
    const headers = rows[0];
    let imported = 0;
    for (let i = 1; i < rows.length; i++) {
      const obj = {};
      headers.forEach((h, j) => { obj[h] = rows[i][j] || ''; });
      if (!obj.id) obj.id = db.generateId();
      try { db.insert(sheetName, obj); imported++; } catch (e) {}
    }
    return { success: true, imported };
  } catch (error) { return { success: false, error: error.message }; }
}

function parseCSV(csvString) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csvString.length; i++) {
    const ch = csvString[i];
    if (inQuotes) {
      if (ch === '"' && csvString[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { current.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && csvString[i + 1] === '\n')) {
        current.push(field); field = '';
        if (current.some(c => c.trim())) rows.push(current);
        current = [];
        if (ch === '\r') i++;
      } else { field += ch; }
    }
  }
  if (field || current.length) { current.push(field); if (current.some(c => c.trim())) rows.push(current); }
  return rows;
}

function importDevicesFromCSV(csvData) {
  try {
    const rows = parseCSV(csvData);
    if (rows.length < 2) return { success: false, error: 'No data rows' };
    const headers = rows[0].map(h => h.trim().toLowerCase());
    let imported = 0;
    const now = new Date().toISOString();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const get = (names) => {
        for (const n of names) {
          const idx = headers.indexOf(n.toLowerCase());
          if (idx >= 0 && row[idx]) return row[idx].trim();
        }
        return '';
      };
      const device = {
        id: get(['id']) || db.generateId(),
        name: get(['name', 'device name', 'devicename']),
        ip: get(['ip', 'ip address', 'ipaddress']),
        model: get(['model']),
        type: get(['type', 'device type', 'devicetype']) || 'printer',
        location: get(['location']),
        machineId: get(['machineid', 'machine id']),
        serialNumber: get(['serialnumber', 'serial number', 'serial']),
        status: 'offline', lastSeen: '', x: 0, y: 0, blueprintId: '',
        supplies: '[]', messages: '[]', inputTrays: '[]', pageCount: 0,
        createdAt: now, updatedAt: now
      };
      if (device.name || device.ip) {
        db.upsert('devices', device);
        imported++;
      }
    }
    return { success: true, imported };
  } catch (error) { return { success: false, error: error.message }; }
}

function clearSheet(sheetName) {
  try { db.deleteAll(sheetName); return { success: true }; }
  catch (error) { return { success: false, error: error.message }; }
}

function getAnalyticsData() {
  try {
    const devices = db.getAll('devices');
    const traps = db.query('SELECT * FROM snmp_traps ORDER BY receivedAt DESC LIMIT 500');
    const requests = db.getAll('service_requests');
    const incidents = db.getAll('incidents');
    const repairs = db.getAll('computer_repairs');

    return {
      deviceCount: devices.length,
      onlineCount: devices.filter(d => d.status === 'online').length,
      offlineCount: devices.filter(d => d.status === 'offline').length,
      trapCount: traps.length,
      unresolvedTraps: traps.filter(t => !t.processed).length,
      requestCount: requests.length,
      pendingRequests: requests.filter(r => r.status === 'pending').length,
      incidentCount: incidents.length,
      repairCount: repairs.length,
      recentTraps: traps.slice(0, 20),
      devicesByType: {}
    };
  } catch (error) { return {}; }
}

function exportAllData() {
  const devicesService = require('./devices');
  const trapsService = require('./traps');
  const settingsService = require('./settings');
  const blueprintsService = require('./blueprints');
  return {
    devices: devicesService.getDevices(),
    traps: trapsService.getTraps(1000),
    emailConfig: settingsService.getEmailConfig(),
    settings: settingsService.getSettings(),
    blueprints: blueprintsService.getBlueprints()
  };
}

function compactAllSheets() {
  try { db.run('VACUUM'); return { success: true, message: 'Database compacted' }; }
  catch (error) { return { success: false, error: error.message }; }
}

function getWorkbookCellCount() {
  try {
    const dbPath = db.getDbPath();
    const stat = fs.statSync(dbPath);
    return { success: true, size: stat.size, sizeFormatted: (stat.size / 1024 / 1024).toFixed(2) + ' MB' };
  } catch (error) { return { success: false, size: 0 }; }
}

module.exports = {
  getSheetStats, getSpreadsheetInfo, createFullBackup,
  exportSheetAsCSV, importSheetFromCSV, importDevicesFromCSV,
  clearSheet, getAnalyticsData, exportAllData,
  compactAllSheets, getWorkbookCellCount, parseCSV
};
