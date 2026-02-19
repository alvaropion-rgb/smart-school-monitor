#!/usr/bin/env node
/**
 * Import data from original CodeMAPCopier into the Electron app's SQLite database.
 * Run: node import-data.js
 */
const path = require('path');
const fs = require('fs');

// Set up data directory
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Initialize database
const schema = require('./src/database/schema');
schema.initialize();

const db = require('./src/database/db');

// ── Import Devices from devices.json ──
function importDevices() {
  const devicesPath = path.join(__dirname, '..', 'CodeMAPCopier', 'snmp-gateway', 'devices.json');
  if (!fs.existsSync(devicesPath)) {
    console.log('⚠️  devices.json not found at', devicesPath);
    return 0;
  }

  const devices = JSON.parse(fs.readFileSync(devicesPath, 'utf-8'));
  let imported = 0;

  // Map device types to the seeded device_types
  const typeMap = {};
  const deviceTypes = db.getAll('device_types');
  deviceTypes.forEach(dt => {
    typeMap[dt.name.toLowerCase()] = dt.id;
  });

  const stmt = db.getDb().prepare(`
    INSERT OR REPLACE INTO devices (id, name, ip, model, type, status, lastSeen, supplies, messages, inputTrays)
    VALUES (?, ?, ?, ?, ?, 'unknown', datetime('now'), '[]', '[]', '[]')
  `);

  const insertMany = db.getDb().transaction((devs) => {
    for (const d of devs) {
      const deviceType = d.type ? d.type.toLowerCase() : '';
      const typeId = typeMap[deviceType] || '';
      stmt.run(d.id, d.name, d.ip, d.model || '', typeId, );
      imported++;
    }
  });

  insertMany(devices);
  console.log(`✅ Imported ${imported} devices`);
  return imported;
}

// ── Import Employees from CSV ──
function importEmployees() {
  const csvPath = path.join(__dirname, '..', 'CodeMAPCopier', 'Employee Database - Employees.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('⚠️  Employee CSV not found at', csvPath);
    return 0;
  }

  const csvData = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvData.split('\n').filter(l => l.trim());

  if (lines.length < 2) {
    console.log('⚠️  CSV has no data rows');
    return 0;
  }

  // Parse header
  const header = lines[0].split(',').map(h => h.trim());
  const empIdIdx = header.findIndex(h => /emp\s*id/i.test(h));
  const nameIdx = header.findIndex(h => /name/i.test(h));
  const emailIdx = header.findIndex(h => /email/i.test(h));
  const roomIdx = header.findIndex(h => /room/i.test(h));

  if (empIdIdx === -1 || nameIdx === -1) {
    console.log('⚠️  Could not find Emp ID or Name columns');
    return 0;
  }

  const stmt = db.getDb().prepare(`
    INSERT OR REPLACE INTO teachers (id, empId, name, email, room)
    VALUES (?, ?, ?, ?, ?)
  `);

  let imported = 0;
  const insertMany = db.getDb().transaction((rows) => {
    for (const row of rows) {
      // Simple CSV parse (handles basic cases)
      const cols = row.split(',');
      const empId = cols[empIdIdx] ? cols[empIdIdx].trim() : '';
      const name = cols[nameIdx] ? cols[nameIdx].trim() : '';
      const email = cols[emailIdx] ? cols[emailIdx].trim() : '';
      const room = roomIdx >= 0 && cols[roomIdx] ? cols[roomIdx].trim() : '';

      if (!empId && !name) continue;

      const id = db.generateId();
      stmt.run(id, empId, name, email, room);
      imported++;
    }
  });

  insertMany(lines.slice(1));
  console.log(`✅ Imported ${imported} employees (teachers)`);
  return imported;
}

// ── Import SNMP gateway config ──
function importGatewayConfig() {
  const configPath = path.join(__dirname, '..', 'CodeMAPCopier', 'snmp-gateway', 'config.json');
  if (!fs.existsSync(configPath)) {
    console.log('⚠️  config.json not found');
    return;
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  if (config.trapPort) db.setKeyValue('settings', 'trapPort', String(config.trapPort));
  if (config.pollInterval) db.setKeyValue('settings', 'pollInterval', String(config.pollInterval));
  if (config.snmpCommunity) db.setKeyValue('settings', 'snmpCommunity', config.snmpCommunity);
  if (config.snmpPort) db.setKeyValue('settings', 'snmpPort', String(config.snmpPort));

  console.log('✅ Imported gateway configuration settings');
}

// ── Run all imports ──
console.log('');
console.log('═══════════════════════════════════════════');
console.log('  Smart School Monitor - Data Import');
console.log('═══════════════════════════════════════════');
console.log('');

try {
  const deviceCount = importDevices();
  const employeeCount = importEmployees();
  importGatewayConfig();

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log(`  Import complete!`);
  console.log(`  - ${deviceCount} devices`);
  console.log(`  - ${employeeCount} employees`);
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('You can now start the app with: npm start');
} catch (err) {
  console.error('Import error:', err);
  process.exit(1);
}
