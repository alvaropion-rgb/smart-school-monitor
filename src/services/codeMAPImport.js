/**
 * Import data from the original CodeMAPCopier project into the Electron app's SQLite database.
 * Handles devices, employees/teachers, gateway config, and device icon positions.
 */
const path = require('path');
const fs = require('fs');
const db = require('../database/db');

// Resolve the CodeMAPCopier directory (sibling to SmartSchoolMonitor-Electron)
function getCodeMAPDir() {
  return path.join(__dirname, '..', '..', '..', 'CodeMAPCopier');
}

/**
 * Import devices from devices.json
 */
function importDevices(codeMAPDir, forceOverwrite) {
  const devicesPath = path.join(codeMAPDir, 'snmp-gateway', 'devices.json');
  if (!fs.existsSync(devicesPath)) {
    return { count: 0, error: 'devices.json not found' };
  }

  try {
    if (forceOverwrite) {
      db.getDb().prepare('DELETE FROM devices').run();
    }

    const devices = JSON.parse(fs.readFileSync(devicesPath, 'utf-8'));
    const typeMap = {};
    db.getAll('device_types').forEach(dt => {
      typeMap[dt.name.toLowerCase()] = dt.id;
    });

    const stmt = db.getDb().prepare(
      `INSERT OR REPLACE INTO devices (id, name, ip, model, type, status, lastSeen, supplies, messages, inputTrays)
       VALUES (?, ?, ?, ?, ?, 'unknown', datetime('now'), '[]', '[]', '[]')`
    );
    const insertDevices = db.getDb().transaction((devs) => {
      for (const d of devs) {
        const typeId = typeMap[(d.type || '').toLowerCase()] || '';
        stmt.run(d.id, d.name, d.ip, d.model || '', typeId);
      }
    });
    insertDevices(devices);
    return { count: devices.length };
  } catch (e) {
    return { count: 0, error: e.message };
  }
}

/**
 * Import employees/teachers from CSV
 */
function importTeachers(codeMAPDir, forceOverwrite) {
  const csvPath = path.join(codeMAPDir, 'Employee Database - Employees.csv');
  if (!fs.existsSync(csvPath)) {
    return { count: 0, error: 'Employee CSV not found' };
  }

  try {
    if (forceOverwrite) {
      db.getDb().prepare('DELETE FROM teachers').run();
    }

    const lines = fs.readFileSync(csvPath, 'utf-8').replace(/\r/g, '').split('\n').filter(l => l.trim());
    const header = lines[0].split(',').map(h => h.trim());
    const empIdIdx = header.findIndex(h => /emp\s*id/i.test(h));
    const nameIdx = header.findIndex(h => /name/i.test(h));
    const emailIdx = header.findIndex(h => /email/i.test(h));
    const roomIdx = header.findIndex(h => /room/i.test(h));

    console.log(`CSV header: [${header.join(', ')}]`);
    console.log(`Column indices - empId:${empIdIdx} name:${nameIdx} email:${emailIdx} room:${roomIdx}`);

    const stmt = db.getDb().prepare(
      'INSERT OR REPLACE INTO teachers (id, empId, name, email, roomNumber) VALUES (?, ?, ?, ?, ?)'
    );
    let count = 0;
    const insertTeachers = db.getDb().transaction((rows) => {
      for (const row of rows) {
        const cols = row.split(',');
        const empId = (cols[empIdIdx] || '').trim();
        const name = (cols[nameIdx] || '').trim();
        const email = (cols[emailIdx] || '').trim();
        const room = roomIdx >= 0 ? (cols[roomIdx] || '').trim() : '';
        if (!empId && !name) continue;
        stmt.run(db.generateId(), empId, name, email, room);
        count++;
      }
    });
    insertTeachers(lines.slice(1));
    return { count };
  } catch (e) {
    console.error('Teacher import error:', e.stack);
    return { count: 0, error: e.message };
  }
}

/**
 * Import gateway config settings
 */
function importConfig(codeMAPDir) {
  const configPath = path.join(codeMAPDir, 'snmp-gateway', 'config.json');
  if (!fs.existsSync(configPath)) {
    return { success: false, error: 'config.json not found' };
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.trapPort) db.setKeyValue('settings', 'trapPort', String(config.trapPort));
    if (config.pollInterval) db.setKeyValue('settings', 'pollInterval', String(config.pollInterval));
    if (config.snmpCommunity) db.setKeyValue('settings', 'snmpCommunity', config.snmpCommunity);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Import device icon positions from device-positions.json (if it exists)
 */
function importIconPositions(codeMAPDir) {
  const iconDataPath = path.join(codeMAPDir, 'snmp-gateway', 'device-positions.json');
  if (!fs.existsSync(iconDataPath)) {
    return { count: 0, note: 'device-positions.json not found (icons can be placed manually on blueprints)' };
  }

  try {
    const positions = JSON.parse(fs.readFileSync(iconDataPath, 'utf-8'));
    const updateStmt = db.getDb().prepare(
      'UPDATE devices SET x = ?, y = ?, blueprintId = ? WHERE id = ?'
    );
    let posCount = 0;
    const updatePositions = db.getDb().transaction((items) => {
      for (const p of items) {
        const info = updateStmt.run(p.x || 0, p.y || 0, p.blueprintId || '', p.deviceId || p.id);
        if (info.changes > 0) posCount++;
      }
    });
    updatePositions(positions);
    return { count: posCount };
  } catch (e) {
    return { count: 0, error: e.message };
  }
}

/**
 * Main import function — callable via IPC
 */
function importFromCodeMAP(options = {}) {
  const codeMAPDir = getCodeMAPDir();
  if (!fs.existsSync(codeMAPDir)) {
    return { success: false, error: 'CodeMAPCopier directory not found at ' + codeMAPDir };
  }

  const forceOverwrite = options.forceOverwrite || false;
  const results = { errors: [] };

  // Import devices
  if (options.importDevices !== false) {
    const devResult = importDevices(codeMAPDir, forceOverwrite);
    results.devices = devResult.count;
    if (devResult.error) results.errors.push('Devices: ' + devResult.error);
  }

  // Import teachers
  if (options.importTeachers !== false) {
    const teachResult = importTeachers(codeMAPDir, forceOverwrite);
    results.teachers = teachResult.count;
    if (teachResult.error) results.errors.push('Teachers: ' + teachResult.error);
  }

  // Import config
  if (options.importConfig !== false) {
    const cfgResult = importConfig(codeMAPDir);
    results.config = cfgResult.success;
    if (cfgResult.error) results.errors.push('Config: ' + cfgResult.error);
  }

  // Import icon positions
  if (options.importIconPositions !== false) {
    const posResult = importIconPositions(codeMAPDir);
    results.iconPositions = posResult.count;
    if (posResult.note) results.notes = posResult.note;
    if (posResult.error) results.errors.push('Icon positions: ' + posResult.error);
  }

  results.success = results.errors.length === 0;
  console.log('Import results:', JSON.stringify(results));
  return results;
}

/**
 * Fetch device positions (x, y, blueprintId) from the original Google Spreadsheet
 * and update local SQLite devices. Also fetches blueprints if available.
 */
async function importPositionsFromGoogleSheet() {
  const SPREADSHEET_ID = '1oGq4PFMOAtSI1yCVkRNpJXPB0viC9KTDQWcWnr9kg2E';

  const results = { devicesUpdated: 0, blueprintsImported: 0, errors: [] };

  try {
    // Fetch Devices sheet as CSV
    const devicesUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Devices`;
    console.log('Fetching device positions from Google Sheet...');

    const fetch = require('node-fetch');
    const devResp = await fetch(devicesUrl);
    if (!devResp.ok) {
      return { success: false, error: `Failed to fetch Devices sheet: ${devResp.status} ${devResp.statusText}. Make sure the spreadsheet is publicly accessible (at least view-only).` };
    }

    const devCsv = await devResp.text();
    const devRows = parseCSVRows(devCsv);

    if (devRows.length < 2) {
      return { success: false, error: 'Devices sheet appears empty or could not be parsed' };
    }

    // Parse header
    const header = devRows[0].map(h => h.trim().toLowerCase());
    const idIdx = header.indexOf('id');
    const nameIdx = header.indexOf('name');
    const ipIdx = header.indexOf('ip');
    const xIdx = header.indexOf('x');
    const yIdx = header.indexOf('y');
    const bpIdx = header.indexOf('blueprintid');
    const locationIdx = header.indexOf('location');
    const machineIdIdx = header.indexOf('machineid');
    const serialIdx = header.indexOf('serialnumber');
    const modelIdx = header.indexOf('model');
    const typeIdx = header.indexOf('type');

    console.log(`Google Sheet header: [${header.join(', ')}]`);
    console.log(`Position columns - x:${xIdx} y:${yIdx} blueprintId:${bpIdx}`);

    if (xIdx === -1 || yIdx === -1) {
      return { success: false, error: 'Could not find x and y columns in Devices sheet' };
    }

    // Update device positions in SQLite
    const updateStmt = db.getDb().prepare(
      'UPDATE devices SET x = ?, y = ?, blueprintId = ?, location = CASE WHEN location = \'\' THEN ? ELSE location END WHERE id = ?'
    );

    // Also prepare an insert for devices that don't exist locally yet
    const insertStmt = db.getDb().prepare(
      `INSERT OR IGNORE INTO devices (id, name, ip, model, type, location, machineId, serialNumber, status, lastSeen, x, y, blueprintId, supplies, messages, inputTrays)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', datetime('now'), ?, ?, ?, '[]', '[]', '[]')`
    );

    const typeMap = {};
    db.getAll('device_types').forEach(dt => {
      typeMap[dt.name.toLowerCase()] = dt.id;
    });

    let updated = 0;
    let inserted = 0;

    const transaction = db.getDb().transaction((rows) => {
      for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        const id = (cols[idIdx] || '').trim();
        if (!id) continue;

        const x = parseFloat(cols[xIdx]) || 0;
        const y = parseFloat(cols[yIdx]) || 0;
        const blueprintId = bpIdx >= 0 ? (cols[bpIdx] || '').trim() : '';
        const location = locationIdx >= 0 ? (cols[locationIdx] || '').trim() : '';

        // Try to update existing device
        const info = updateStmt.run(x, y, blueprintId, location, id);
        if (info.changes > 0) {
          updated++;
        } else {
          // Device doesn't exist locally — insert it
          const name = nameIdx >= 0 ? (cols[nameIdx] || '').trim() : '';
          const ip = ipIdx >= 0 ? (cols[ipIdx] || '').trim() : '';
          const model = modelIdx >= 0 ? (cols[modelIdx] || '').trim() : '';
          const type = typeIdx >= 0 ? (cols[typeIdx] || '').trim() : '';
          const machineId = machineIdIdx >= 0 ? (cols[machineIdIdx] || '').trim() : '';
          const serial = serialIdx >= 0 ? (cols[serialIdx] || '').trim() : '';
          const typeId = typeMap[type.toLowerCase()] || '';

          insertStmt.run(id, name, ip, model, typeId, location, machineId, serial, x, y, blueprintId);
          inserted++;
        }
      }
    });

    transaction(devRows);
    results.devicesUpdated = updated;
    results.devicesInserted = inserted;
    console.log(`Updated ${updated} device positions, inserted ${inserted} new devices from Google Sheet`);

  } catch (e) {
    console.error('Google Sheet device fetch error:', e.stack);
    results.errors.push('Device positions: ' + e.message);
  }

  // Fetch Blueprints sheet and download Drive images
  try {
    const bpUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Blueprints`;
    console.log('Fetching blueprints from Google Sheet...');

    const fetch = require('node-fetch');
    const bpResp = await fetch(bpUrl);
    if (bpResp.ok) {
      const bpCsv = await bpResp.text();
      const bpRows = parseCSVRows(bpCsv);

      if (bpRows.length >= 2) {
        const header = bpRows[0].map(h => h.trim().toLowerCase());
        const idIdx = header.indexOf('id');
        const nameIdx = header.indexOf('name');
        const imgIdx = header.indexOf('imagedata');

        if (idIdx >= 0 && nameIdx >= 0) {
          // Get the blueprints dir for saving images locally
          const blueprints = require('./blueprints');
          const userDataPath = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
          const bpDir = path.join(userDataPath, 'blueprints');
          fs.mkdirSync(bpDir, { recursive: true });

          let bpCount = 0;
          let imgDownloaded = 0;

          for (let i = 1; i < bpRows.length; i++) {
            const cols = bpRows[i];
            const id = (cols[idIdx] || '').trim();
            const name = (cols[nameIdx] || '').trim();
            let imageData = imgIdx >= 0 ? (cols[imgIdx] || '').trim() : '';
            if (!id) continue;

            // If imageData references a Google Drive file, download it
            if (imageData && imageData.startsWith('drive:')) {
              const driveFileId = imageData.substring(6);
              const localFile = path.join(bpDir, id + '.jpg');

              // Skip download if we already have it locally
              if (!fs.existsSync(localFile) && !fs.existsSync(path.join(bpDir, id + '.png'))) {
                try {
                  console.log(`Downloading blueprint image for "${name}" from Google Drive (${driveFileId})...`);
                  const imgUrl = `https://drive.google.com/uc?export=download&id=${driveFileId}`;
                  const imgResp = await fetch(imgUrl, { redirect: 'follow' });
                  if (imgResp.ok) {
                    const imgBuffer = await imgResp.buffer();
                    const contentType = imgResp.headers.get('content-type') || '';
                    const ext = contentType.includes('png') ? '.png' : '.jpg';
                    fs.writeFileSync(path.join(bpDir, id + ext), imgBuffer);
                    imageData = 'local:' + id + ext;
                    imgDownloaded++;
                    console.log(`  Saved blueprint image: ${id}${ext} (${(imgBuffer.length / 1024).toFixed(0)} KB)`);
                  } else {
                    console.warn(`  Failed to download blueprint image: ${imgResp.status} ${imgResp.statusText}`);
                  }
                } catch (dlErr) {
                  console.warn(`  Error downloading blueprint image: ${dlErr.message}`);
                }
              } else {
                // Already have the file locally, update reference
                const ext = fs.existsSync(path.join(bpDir, id + '.png')) ? '.png' : '.jpg';
                imageData = 'local:' + id + ext;
              }
            }

            db.getDb().prepare(
              'INSERT OR REPLACE INTO blueprints (id, name, imageData, createdAt) VALUES (?, ?, ?, datetime(\'now\'))'
            ).run(id, name, imageData);
            bpCount++;
          }

          results.blueprintsImported = bpCount;
          results.blueprintImagesDownloaded = imgDownloaded;
          console.log(`Imported ${bpCount} blueprints, downloaded ${imgDownloaded} images from Google Drive`);
        }
      }
    }
  } catch (e) {
    console.error('Google Sheet blueprint fetch error:', e.stack);
    results.errors.push('Blueprints: ' + e.message);
  }

  results.success = results.errors.length === 0;
  return results;
}

/**
 * Parse CSV text into array of arrays, handling quoted fields
 */
function parseCSVRows(csvText) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++; // skip next quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        currentRow.push(currentField);
        currentField = '';
        if (currentRow.some(f => f.trim())) {
          rows.push(currentRow);
        }
        currentRow = [];
        if (ch === '\r') i++; // skip \n
      } else {
        currentField += ch;
      }
    }
  }

  // Last field/row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some(f => f.trim())) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Fetch repair templates from Google Spreadsheet and import into SQLite
 */
async function importRepairTemplatesFromGoogleSheet() {
  const SPREADSHEET_ID = '1oGq4PFMOAtSI1yCVkRNpJXPB0viC9KTDQWcWnr9kg2E';
  const results = { templatesImported: 0, errors: [] };

  try {
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=RepairTemplates`;
    console.log('Fetching repair templates from Google Sheet...');

    const fetch = require('node-fetch');
    const resp = await fetch(sheetUrl);
    if (!resp.ok) {
      return { success: false, error: `Failed to fetch RepairTemplates sheet: ${resp.status} ${resp.statusText}. Make sure the spreadsheet is publicly accessible.` };
    }

    const csvText = await resp.text();
    const rows = parseCSVRows(csvText);

    if (rows.length < 2) {
      return { success: false, error: 'RepairTemplates sheet appears empty or could not be parsed' };
    }

    const header = rows[0].map(h => h.trim().toLowerCase());
    console.log(`RepairTemplates header: [${header.join(', ')}]`);

    // Map column indices
    const col = (name) => header.indexOf(name);
    const idIdx = col('id');
    const nameIdx = col('name');
    const iconIdx = col('icon');
    const shortDescIdx = col('shortdescription');
    const descIdx = col('description');
    const channelIdx = col('channel');
    const categoryIdx = col('category');
    const subcategoryIdx = col('subcategory');
    const serviceOfferingIdx = col('serviceoffering');
    const manufacturerIdx = col('manufacturer');
    const modelIdx = col('model');
    const assetLocationIdx = col('assetlocation');
    const impactIdx = col('impact');
    const userTypeIdx = col('usertype');
    const requiresSerialIdx = col('requiresserial');
    const requiresPhotoIdx = col('requiresphoto');
    const sortOrderIdx = col('sortorder');
    const activeIdx = col('active');

    if (idIdx === -1 || nameIdx === -1) {
      return { success: false, error: 'Could not find id and name columns in RepairTemplates sheet' };
    }

    const getVal = (cols, idx) => idx >= 0 ? (cols[idx] || '').trim() : '';
    const getBool = (cols, idx) => {
      const v = getVal(cols, idx).toUpperCase();
      return (v === 'TRUE' || v === '1') ? 1 : 0;
    };

    const stmt = db.getDb().prepare(
      `INSERT OR REPLACE INTO repair_templates
       (id, name, icon, shortDescription, description, channel, category, subcategory,
        serviceOffering, manufacturer, model, assetLocation, impact, userType,
        requiresSerial, requiresPhoto, sortOrder, active, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    );

    let count = 0;
    const transaction = db.getDb().transaction((dataRows) => {
      for (let i = 0; i < dataRows.length; i++) {
        const cols = dataRows[i];
        const id = getVal(cols, idIdx);
        if (!id) continue;

        stmt.run(
          id,
          getVal(cols, nameIdx),
          getVal(cols, iconIdx),
          getVal(cols, shortDescIdx),
          getVal(cols, descIdx),
          getVal(cols, channelIdx),
          getVal(cols, categoryIdx),
          getVal(cols, subcategoryIdx),
          getVal(cols, serviceOfferingIdx),
          getVal(cols, manufacturerIdx),
          getVal(cols, modelIdx),
          getVal(cols, assetLocationIdx),
          getVal(cols, impactIdx),
          getVal(cols, userTypeIdx),
          getBool(cols, requiresSerialIdx),
          getBool(cols, requiresPhotoIdx),
          parseInt(getVal(cols, sortOrderIdx)) || 0,
          getBool(cols, activeIdx)
        );
        count++;
      }
    });

    transaction(rows.slice(1));
    results.templatesImported = count;
    results.success = true;
    console.log(`Imported ${count} repair templates from Google Sheet`);
  } catch (e) {
    console.error('Repair templates import error:', e.stack);
    results.errors.push(e.message);
    results.success = false;
  }

  return results;
}

module.exports = {
  importFromCodeMAP, importDevices, importTeachers, importConfig,
  importIconPositions, importPositionsFromGoogleSheet,
  importRepairTemplatesFromGoogleSheet, getCodeMAPDir
};
