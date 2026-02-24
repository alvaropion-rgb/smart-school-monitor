const express = require('express');
const router = express.Router();
const { db, generateId, getAll, getById, getByColumn, insert, update, updateField, remove, clearTable, count } = require('../db/database');

// ============================================
// DEVICES
// ============================================

/**
 * Get all devices with parsed JSON fields
 */
router.post('/getDevices', (req, res) => {
  try {
    const devices = getAll('devices');
    const parsed = devices.map(d => {
      let supplies = [];
      let messages = [];
      let inputTrays = [];
      try {
        supplies = d.supplies ? JSON.parse(d.supplies) : [];
      } catch (e) {
        console.log('Bad JSON in supplies for device ' + (d.id || d.name) + ': ' + e.message);
      }
      try {
        messages = d.messages ? JSON.parse(d.messages) : [];
      } catch (e) {
        console.log('Bad JSON in messages for device ' + (d.id || d.name) + ': ' + e.message);
      }
      try {
        inputTrays = d.inputTrays ? JSON.parse(d.inputTrays) : [];
      } catch (e) {}
      return { ...d, supplies, messages, inputTrays, pageCount: parseInt(d.pageCount) || 0 };
    });
    res.json(parsed);
  } catch (error) {
    console.log('Error getting devices: ' + error);
    res.json([]);
  }
});

/**
 * Save (create or update) a device
 */
router.post('/saveDevice', (req, res) => {
  try {
    const [device] = req.body.args || [];
    const now = new Date().toISOString();

    const deviceData = {
      id: device.id || generateId(),
      name: device.name || '',
      ip: device.ip || '',
      model: device.model || '',
      type: device.type || 'printer',
      location: device.location || '',
      machineId: device.machineId || '',
      serialNumber: device.serialNumber || '',
      status: device.status || 'unknown',
      lastSeen: device.lastSeen || '',
      x: device.x || 0,
      y: device.y || 0,
      blueprintId: device.blueprintId || 'blueprint1',
      supplies: JSON.stringify(device.supplies || []),
      messages: JSON.stringify(device.messages || []),
      inputTrays: JSON.stringify(device.inputTrays || []),
      pageCount: device.pageCount || 0,
      createdAt: device.createdAt || now,
      updatedAt: now
    };

    const existing = getById('devices', deviceData.id);

    if (existing) {
      update('devices', deviceData.id, deviceData);
    } else {
      insert('devices', deviceData);
    }

    res.json({ success: true, device: deviceData });
  } catch (error) {
    console.log('Error saving device: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Delete a device by ID
 */
router.post('/deleteDevice', (req, res) => {
  try {
    const [deviceId] = req.body.args || [];
    const existing = getById('devices', deviceId);

    if (existing) {
      remove('devices', deviceId);
      res.json({ success: true });
    } else {
      res.json({ success: false, error: 'Device not found' });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * Update device status (called by SNMP gateway)
 */
router.post('/updateDeviceStatus', (req, res) => {
  try {
    const [data] = req.body.args || [];
    const { deviceId, ip, status, supplies, messages, inputTrays, pageCount } = data;

    // Get all devices with parsed JSON fields
    const allDevices = getAll('devices');
    const devices = allDevices.map(d => {
      let parsedSupplies = [];
      let parsedMessages = [];
      let parsedInputTrays = [];
      try { parsedSupplies = d.supplies ? JSON.parse(d.supplies) : []; } catch (e) {}
      try { parsedMessages = d.messages ? JSON.parse(d.messages) : []; } catch (e) {}
      try { parsedInputTrays = d.inputTrays ? JSON.parse(d.inputTrays) : []; } catch (e) {}
      return { ...d, supplies: parsedSupplies, messages: parsedMessages, inputTrays: parsedInputTrays, pageCount: parseInt(d.pageCount) || 0 };
    });

    // Normalize IPs for comparison (trim whitespace)
    const normalizedIp = ip ? ip.trim() : '';

    // Find device by ID first (most reliable), then fall back to IP matching
    let device = null;
    if (deviceId) {
      device = devices.find(d => d.id === deviceId);
    }
    if (!device && normalizedIp) {
      device = devices.find(d => (d.ip || '').trim() === normalizedIp);
    }

    if (device) {
      device.status = status || device.status;
      // Update lastSeen for any device that responded to SNMP (online or issue — both mean the device is reachable)
      device.lastSeen = (status === 'online' || status === 'issue') ? new Date().toISOString() : device.lastSeen;

      // Only update supplies/messages if new data has actual content
      // Don't overwrite existing supply data with an empty array (e.g. when device is offline)
      if (Array.isArray(supplies) && supplies.length > 0) {
        device.supplies = supplies;
      }
      if (Array.isArray(messages) && messages.length > 0) {
        device.messages = messages;
      }
      if (Array.isArray(inputTrays) && inputTrays.length > 0) {
        device.inputTrays = inputTrays;
      }
      if (pageCount !== undefined && pageCount !== null) {
        device.pageCount = pageCount;
      }

      // Save the device (stringify JSON fields for storage)
      const now = new Date().toISOString();
      const deviceData = {
        id: device.id,
        name: device.name || '',
        ip: device.ip || '',
        model: device.model || '',
        type: device.type || 'printer',
        location: device.location || '',
        machineId: device.machineId || '',
        serialNumber: device.serialNumber || '',
        status: device.status || 'unknown',
        lastSeen: device.lastSeen || '',
        x: device.x || 0,
        y: device.y || 0,
        blueprintId: device.blueprintId || 'blueprint1',
        supplies: JSON.stringify(device.supplies || []),
        messages: JSON.stringify(device.messages || []),
        inputTrays: JSON.stringify(device.inputTrays || []),
        pageCount: device.pageCount || 0,
        createdAt: device.createdAt || now,
        updatedAt: now
      };

      update('devices', device.id, deviceData);
      res.json({ success: true, device: deviceData });
    } else {
      // Device not found — log all available devices for debugging
      const deviceIps = devices.map(d => (d.id || '?') + ':' + (d.ip || '?')).join(', ');
      console.log('Device not found. Searched for deviceId=' + (deviceId || '') + ' ip=' + (ip || '') + '. Available: ' + deviceIps);
      res.json({ success: false, error: 'Device not found: deviceId=' + (deviceId || '') + ' ip=' + (ip || '') });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * Get a single device by ID (with JSON parsing and flexible matching)
 */
router.post('/getDeviceById', (req, res) => {
  try {
    const [deviceId] = req.body.args || [];

    // Get all devices with parsed JSON to allow flexible matching
    const allDevices = getAll('devices');
    const devices = allDevices.map(d => {
      let supplies = [];
      let messages = [];
      let inputTrays = [];
      try { supplies = d.supplies ? JSON.parse(d.supplies) : []; } catch (e) {}
      try { messages = d.messages ? JSON.parse(d.messages) : []; } catch (e) {}
      try { inputTrays = d.inputTrays ? JSON.parse(d.inputTrays) : []; } catch (e) {}
      return { ...d, supplies, messages, inputTrays, pageCount: parseInt(d.pageCount) || 0 };
    });

    const searchId = String(deviceId).trim();

    // Try exact match first, then case-insensitive string match
    let device = devices.find(d => d.id === deviceId);
    if (!device) {
      device = devices.find(d => String(d.id).trim() === searchId);
    }
    // Also try matching by name (for QR codes that use device name as ID)
    if (!device) {
      device = devices.find(d => String(d.name).trim().toLowerCase() === searchId.toLowerCase());
    }
    if (!device) {
      console.log('getDeviceById: Device not found for id="' + deviceId + '". Available IDs: ' + devices.map(d => d.id).join(', '));
    }

    res.json(device || null);
  } catch (error) {
    console.log('Error getting device by ID: ' + error);
    res.json(null);
  }
});

// ============================================
// DEVICE TYPES
// ============================================

/**
 * Get all device types
 */
router.post('/getDeviceTypes', (req, res) => {
  try {
    const types = getAll('device_types');
    res.json(types);
  } catch (error) {
    console.log('Error getting device types: ' + error);
    res.json([]);
  }
});

/**
 * Save (create or update) a device type
 */
router.post('/saveDeviceType', (req, res) => {
  try {
    const [deviceType] = req.body.args || [];
    const now = new Date().toISOString();

    const data = {
      id: deviceType.id || generateId(),
      name: deviceType.name || '',
      icon: deviceType.icon || 'box',
      color: deviceType.color || '#6b7280',
      pageTitle: deviceType.pageTitle || 'Report Issue',
      description: deviceType.description || '',
      blueprintId: deviceType.blueprintId || '',
      active: deviceType.active !== false ? 'true' : 'false',
      createdAt: deviceType.createdAt || now,
      updatedAt: now
    };

    const existing = getById('device_types', data.id);

    if (existing) {
      update('device_types', data.id, data);
    } else {
      insert('device_types', data);
    }

    res.json({ success: true, deviceType: data });
  } catch (error) {
    console.log('Error saving device type: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Delete a device type by ID
 */
router.post('/deleteDeviceType', (req, res) => {
  try {
    const [deviceTypeId] = req.body.args || [];
    const existing = getById('device_types', deviceTypeId);

    if (existing) {
      remove('device_types', deviceTypeId);
      res.json({ success: true });
    } else {
      res.json({ success: false, error: 'Device type not found' });
    }
  } catch (error) {
    console.log('Error deleting device type: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Get a single device type by ID
 */
router.post('/getDeviceTypeById', (req, res) => {
  try {
    const [deviceTypeId] = req.body.args || [];
    const deviceType = getById('device_types', deviceTypeId);
    res.json(deviceType || null);
  } catch (error) {
    console.log('Error getting device type: ' + error);
    res.json(null);
  }
});

/**
 * Update a device type's blueprint ID
 */
router.post('/updateDeviceTypeBlueprint', (req, res) => {
  try {
    const [deviceTypeId, blueprintId] = req.body.args || [];
    const deviceType = getById('device_types', deviceTypeId);

    if (!deviceType) {
      res.json({ success: false, error: 'Device type not found' });
      return;
    }

    updateField('device_types', deviceTypeId, 'blueprintId', blueprintId);
    updateField('device_types', deviceTypeId, 'updatedAt', new Date().toISOString());

    res.json({ success: true, deviceType: { ...deviceType, blueprintId } });
  } catch (error) {
    console.log('Error updating device type blueprint: ' + error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// CSV IMPORT
// ============================================

/**
 * Parse a CSV string into a 2D array (handles quoted fields, embedded commas, newlines)
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
 * Import devices from a CSV string
 */
router.post('/importDevicesFromCSV', (req, res) => {
  try {
    const [csvData] = req.body.args || [];

    var rows = parseCSV(csvData);
    if (rows.length < 2) {
      res.json({ success: false, error: 'CSV must have a header row and at least one data row.' });
      return;
    }

    // Map CSV headers to internal field names (flexible matching)
    var csvHeaders = rows[0];
    var ALIASES = {
      'ip': ['ip', 'ip address', 'ipaddress', 'ip_address'],
      'model': ['model', 'model number', 'modelnumber', 'model_number'],
      'machineId': ['machineid', 'machine id', 'machine_id', 'asset', 'asset id', 'assetid', 'asset_id', 'asset tag', 'assettag'],
      'serialNumber': ['serialnumber', 'serial number', 'serial_number', 'serial', 'sn', 's/n'],
      'location': ['location', 'room', 'room number', 'building', 'site'],
      'name': ['name', 'device name', 'devicename', 'hostname', 'host']
    };

    var fieldMap = {}; // csvColIndex -> internalFieldName
    for (var c = 0; c < csvHeaders.length; c++) {
      var raw = String(csvHeaders[c]).trim().toLowerCase();
      var keys = Object.keys(ALIASES);
      for (var k = 0; k < keys.length; k++) {
        if (ALIASES[keys[k]].indexOf(raw) !== -1) {
          fieldMap[c] = keys[k];
          break;
        }
      }
    }

    // Require at least ip or name to be present
    var mappedFields = [];
    var fmKeys = Object.keys(fieldMap);
    for (var f = 0; f < fmKeys.length; f++) {
      mappedFields.push(fieldMap[fmKeys[f]]);
    }
    if (mappedFields.indexOf('ip') === -1 && mappedFields.indexOf('name') === -1) {
      res.json({ success: false, error: 'CSV must have at least an "IP Address" or "Name" column. Found headers: ' + csvHeaders.join(', ') });
      return;
    }

    var now = new Date().toISOString();
    var imported = 0;

    for (var r = 1; r < rows.length; r++) {
      var csvRow = rows[r];
      // Skip empty rows
      var hasData = false;
      for (var cc = 0; cc < csvRow.length; cc++) {
        if (String(csvRow[cc]).trim()) { hasData = true; break; }
      }
      if (!hasData) continue;

      // Build device data from mapped columns
      var dev = {};
      var fmk = Object.keys(fieldMap);
      for (var m = 0; m < fmk.length; m++) {
        var colIdx = parseInt(fmk[m]);
        var fieldName = fieldMap[fmk[m]];
        dev[fieldName] = colIdx < csvRow.length ? String(csvRow[colIdx]).trim() : '';
      }

      var deviceData = {
        id: generateId(),
        name: dev.name || dev.model || ('Device-' + (dev.ip || '').replace(/\./g, '-')),
        ip: dev.ip || '',
        model: dev.model || '',
        type: 'printer',
        location: dev.location || '',
        machineId: dev.machineId || '',
        serialNumber: dev.serialNumber || '',
        status: 'unknown',
        lastSeen: '',
        x: 0,
        y: 0,
        blueprintId: '',
        supplies: '[]',
        messages: '[]',
        inputTrays: '[]',
        pageCount: 0,
        createdAt: now,
        updatedAt: now
      };

      insert('devices', deviceData);
      imported++;
    }

    res.json({ success: true, devicesImported: imported });
  } catch (error) {
    console.log('importDevicesFromCSV error: ' + error);
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;
