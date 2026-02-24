const express = require('express');
const router = express.Router();
const { db, generateId, getAll, getById, getByColumn, insert, update, updateField, remove, clearTable, count } = require('../db/database');

// ============================================
// SHEET NAME TO TABLE NAME MAPPING
// ============================================

const SHEET_TABLE_MAP = {
  'Devices': 'devices',
  'SupplyHistory': 'supply_history',
  'SNMPTraps': 'snmp_traps',
  'EmailConfig': 'email_config',
  'EmailHistory': 'email_history',
  'Settings': 'settings',
  'Blueprints': 'blueprints',
  'Technicians': 'technicians',
  'Teachers': 'teachers',
  'DeviceTypes': 'device_types',
  'IssueButtons': 'issue_buttons',
  'ServiceRequests': 'service_requests',
  'QRCodes': 'qr_codes',
  'EmailTemplates': 'email_templates',
  'Incidents': 'incidents',
  'EmailQueue': 'email_queue',
  'AITraining': 'ai_training',
  'ComputerRepairs': 'computer_repairs',
  'CRTraining': 'cr_training',
  'RepairTemplates': 'repair_templates'
};

// All known table names
const ALL_TABLES = Object.values(SHEET_TABLE_MAP);

/**
 * Resolve a sheet name to its SQLite table name.
 * Returns null if the sheet name is not recognized.
 */
function resolveTable(sheetName) {
  // Direct map lookup
  if (SHEET_TABLE_MAP[sheetName]) return SHEET_TABLE_MAP[sheetName];
  // Try case-insensitive match on values (if caller passes table name directly)
  var lower = sheetName.toLowerCase();
  for (var key in SHEET_TABLE_MAP) {
    if (SHEET_TABLE_MAP[key] === lower) return lower;
  }
  // Check if it's already a valid table name
  if (ALL_TABLES.indexOf(sheetName) !== -1) return sheetName;
  return null;
}

// ============================================
// CSV HELPERS
// ============================================

/**
 * Parse a CSV string into a 2D array, handling quoted fields
 */
function parseCSV(csvString) {
  var rows = [];
  var currentRow = [];
  var currentField = '';
  var inQuotes = false;

  for (var i = 0; i < csvString.length; i++) {
    var ch = csvString[i];
    var next = i + 1 < csvString.length ? csvString[i + 1] : '';

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
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
        rows.push(currentRow);
        currentRow = [];
        if (ch === '\r') i++;
      } else if (ch === '\r') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
      } else {
        currentField += ch;
      }
    }
  }
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }
  return rows;
}

/**
 * Convert an array of objects to a CSV string
 */
function objectsToCSV(rows) {
  if (!rows || rows.length === 0) return '';

  // Collect all unique keys across all rows as headers
  var headerSet = {};
  rows.forEach(function(row) {
    Object.keys(row).forEach(function(k) { headerSet[k] = true; });
  });
  var headers = Object.keys(headerSet);

  var csvLines = [];

  // Header row
  csvLines.push(headers.map(function(h) {
    return escapeCSVField(h);
  }).join(','));

  // Data rows
  rows.forEach(function(row) {
    var line = headers.map(function(h) {
      var cell = row[h];
      if (cell === null || cell === undefined) cell = '';
      cell = String(cell);
      return escapeCSVField(cell);
    }).join(',');
    csvLines.push(line);
  });

  return csvLines.join('\n');
}

function escapeCSVField(cell) {
  cell = String(cell);
  if (cell.indexOf(',') !== -1 || cell.indexOf('"') !== -1 || cell.indexOf('\n') !== -1) {
    cell = '"' + cell.replace(/"/g, '""') + '"';
  }
  return cell;
}

/**
 * Get column info for a table from SQLite pragma
 */
function getTableColumns(tableName) {
  try {
    return db.prepare("PRAGMA table_info(\"" + tableName + "\")").all();
  } catch (e) {
    return [];
  }
}

// ============================================
// ROUTES
// ============================================

/**
 * Export all data from all tables as a JSON object
 */
router.post('/exportAllData', (req, res) => {
  try {
    var backup = {};
    for (var sheetName in SHEET_TABLE_MAP) {
      var tableName = SHEET_TABLE_MAP[sheetName];
      try {
        var rows = getAll(tableName);
        var columns = getTableColumns(tableName);
        var headers = columns.map(function(c) { return c.name; });
        backup[sheetName] = {
          headers: headers,
          rowCount: rows.length,
          data: rows
        };
      } catch (e) {
        backup[sheetName] = { headers: [], rowCount: 0, data: [] };
      }
    }
    res.json(backup);
  } catch (error) {
    console.log('exportAllData error: ' + error);
    res.json({});
  }
});

/**
 * Create a full backup of all tables with metadata
 */
router.post('/createFullBackup', (req, res) => {
  try {
    var backup = {};
    for (var sheetName in SHEET_TABLE_MAP) {
      var tableName = SHEET_TABLE_MAP[sheetName];
      try {
        var rows = getAll(tableName);
        var columns = getTableColumns(tableName);
        var headers = columns.map(function(c) { return c.name; });
        backup[sheetName] = {
          headers: headers,
          rowCount: rows.length,
          data: rows
        };
      } catch (e) {
        backup[sheetName] = { headers: [], rowCount: 0, data: [] };
      }
    }
    res.json({ success: true, data: backup });
  } catch (error) {
    console.log('createFullBackup error: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Export a table as a CSV string
 */
router.post('/exportSheetAsCSV', (req, res) => {
  try {
    const [sheetName] = req.body.args || [];
    var tableName = resolveTable(sheetName);
    if (!tableName) {
      return res.json({ success: false, error: 'Sheet not recognized: ' + sheetName });
    }

    var rows = getAll(tableName);
    if (!rows || rows.length === 0) {
      return res.json({ success: true, csv: '', filename: sheetName + '.csv' });
    }

    var csv = objectsToCSV(rows);
    res.json({ success: true, csv: csv, filename: sheetName + '.csv' });
  } catch (error) {
    console.log('exportSheetAsCSV error: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Import CSV data into a table (appends rows)
 */
router.post('/importSheetFromCSV', (req, res) => {
  try {
    const [sheetName, csvData] = req.body.args || [];
    var tableName = resolveTable(sheetName);
    if (!tableName) {
      return res.json({ success: false, error: 'Sheet not recognized: ' + sheetName });
    }

    var rows = parseCSV(csvData);
    if (rows.length < 2) {
      return res.json({ success: false, error: 'CSV must have a header row and at least one data row.' });
    }

    // Get existing table columns
    var columns = getTableColumns(tableName);
    var existingHeaders = columns.map(function(c) { return c.name; });

    var csvHeaders = rows[0];

    // Validate headers match
    var headerMatch = true;
    if (csvHeaders.length !== existingHeaders.length) {
      headerMatch = false;
    } else {
      for (var h = 0; h < csvHeaders.length; h++) {
        if (String(csvHeaders[h]).trim().toLowerCase() !== String(existingHeaders[h]).trim().toLowerCase()) {
          headerMatch = false;
          break;
        }
      }
    }

    if (!headerMatch) {
      return res.json({ success: false, error: 'CSV headers do not match. Expected: ' + existingHeaders.join(', ') });
    }

    var dataRows = rows.slice(1);
    var imported = 0;

    dataRows.forEach(function(row) {
      // Skip empty rows
      var hasData = false;
      for (var c = 0; c < row.length; c++) {
        if (String(row[c]).trim()) { hasData = true; break; }
      }
      if (!hasData) return;

      // Build object from headers + row values
      var obj = {};
      for (var c = 0; c < csvHeaders.length; c++) {
        obj[csvHeaders[c].trim()] = c < row.length ? row[c] : '';
      }
      insert(tableName, obj);
      imported++;
    });

    res.json({ success: true, rowsImported: imported });
  } catch (error) {
    console.log('importSheetFromCSV error: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Clear all data from a table
 */
router.post('/clearSheet', (req, res) => {
  try {
    const [sheetName] = req.body.args || [];
    var tableName = resolveTable(sheetName);
    if (!tableName) {
      return res.json({ success: false, error: 'Sheet not recognized: ' + sheetName });
    }

    var rowsBefore = count(tableName);
    clearTable(tableName);
    res.json({ success: true, rowsDeleted: rowsBefore });
  } catch (error) {
    console.log('clearSheet error: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Clear all devices
 */
router.post('/clearAllDevices', (req, res) => {
  try {
    clearTable('devices');
    res.json({ success: true });
  } catch (error) {
    console.log('clearAllDevices error: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Get row counts for all tables (equivalent to getSheetStats)
 */
router.post('/getSheetStats', (req, res) => {
  try {
    var stats = [];
    var keys = Object.keys(SHEET_TABLE_MAP);
    for (var i = 0; i < keys.length; i++) {
      var sheetName = keys[i];
      var tableName = SHEET_TABLE_MAP[sheetName];
      var rowCount = 0;
      var columns = [];
      try {
        rowCount = count(tableName);
        columns = getTableColumns(tableName);
      } catch (e) {
        // Table may not exist
      }
      var colCount = columns.length;
      // In SQLite, maxRows/maxCols are conceptually unlimited,
      // but for compatibility we report actual data + columns
      stats.push({
        sheetKey: sheetName,
        sheetName: sheetName,
        rowCount: rowCount,
        maxRows: rowCount + 1, // +1 for conceptual header
        maxCols: colCount,
        cellCount: (rowCount + 1) * colCount
      });
    }
    var totalCells = stats.reduce(function(sum, s) { return sum + s.cellCount; }, 0);
    res.json({ success: true, stats: stats, totalCells: totalCells, cellLimit: 10000000 });
  } catch (error) {
    console.log('getSheetStats error: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Get info about a specific table (column count, row count)
 */
router.post('/getSpreadsheetInfo', (req, res) => {
  try {
    const [sheetName] = req.body.args || [];
    var tableName = sheetName ? resolveTable(sheetName) : null;
    var rowCount = 0;
    var colCount = 0;

    if (tableName) {
      try {
        rowCount = count(tableName);
        var columns = getTableColumns(tableName);
        colCount = columns.length;
      } catch (e) {
        // Table may not exist
      }
    }

    res.json({
      success: true,
      rowCount: rowCount,
      colCount: colCount,
      tableName: tableName || ''
    });
  } catch (error) {
    console.log('getSpreadsheetInfo error: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Compact database (run VACUUM on SQLite)
 */
router.post('/compactAllSheets', (req, res) => {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
    res.json({ success: true, reclaimed: 0, message: 'SQLite VACUUM completed successfully' });
  } catch (error) {
    console.log('compactAllSheets error: ' + error);
    res.json({ success: false, reclaimed: 0, error: error.message });
  }
});

/**
 * Get total row count across all tables
 */
router.post('/getWorkbookCellCount', (req, res) => {
  try {
    var total = 0;
    var details = [];
    for (var sheetName in SHEET_TABLE_MAP) {
      var tableName = SHEET_TABLE_MAP[sheetName];
      var rowCount = 0;
      var columns = [];
      try {
        rowCount = count(tableName);
        columns = getTableColumns(tableName);
      } catch (e) {}
      var colCount = columns.length;
      var cells = (rowCount + 1) * colCount;
      total += cells;
      details.push({ name: sheetName, rows: rowCount + 1, cols: colCount, cells: cells });
    }
    details.sort(function(a, b) { return b.cells - a.cells; });
    res.json({ total: total, limit: 10000000, sheets: details });
  } catch (error) {
    console.log('getWorkbookCellCount error: ' + error);
    res.json({ total: 0, limit: 10000000, sheets: [], error: error.message });
  }
});

module.exports = router;
