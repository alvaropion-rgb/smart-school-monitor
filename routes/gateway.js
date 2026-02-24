const express = require('express');
const router = express.Router();
const { db, generateId, getAll, getById, getByColumn, insert, update, updateField, remove } = require('../db/database');

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get all devices with parsed JSON fields (mirrors getDevices from Code.gs)
 */
function getDevicesParsed() {
  var devices = getAll('devices');
  return devices.map(function(d) {
    var supplies = [];
    var messages = [];
    var inputTrays = [];
    try { supplies = d.supplies ? JSON.parse(d.supplies) : []; } catch (e) {}
    try { messages = d.messages ? JSON.parse(d.messages) : []; } catch (e) {}
    try { inputTrays = d.inputTrays ? JSON.parse(d.inputTrays) : []; } catch (e) {}
    return {
      ...d,
      supplies: supplies,
      messages: messages,
      inputTrays: inputTrays,
      pageCount: parseInt(d.pageCount) || 0
    };
  });
}

/**
 * Update device status (mirrors updateDeviceStatus from Code.gs)
 */
function updateDeviceStatus(data) {
  try {
    var deviceId = data.deviceId;
    var ip = data.ip;
    var status = data.status;
    var supplies = data.supplies;
    var messages = data.messages;
    var inputTrays = data.inputTrays;
    var pageCount = data.pageCount;

    var devices = getDevicesParsed();
    var normalizedIp = ip ? ip.trim() : '';

    // Find device by ID first, then fall back to IP matching
    var device = null;
    if (deviceId) {
      device = devices.find(function(d) { return d.id === deviceId; });
    }
    if (!device && normalizedIp) {
      device = devices.find(function(d) { return (d.ip || '').trim() === normalizedIp; });
    }

    if (device) {
      device.status = status || device.status;
      // Update lastSeen for any device that responded to SNMP
      device.lastSeen = (status === 'online' || status === 'issue') ? new Date().toISOString() : device.lastSeen;

      // Only update supplies/messages if new data has actual content
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
      var now = new Date().toISOString();
      var deviceData = {
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
      return { success: true, device: deviceData };
    }

    // Device not found
    var deviceIps = devices.map(function(d) { return (d.id || '?') + ':' + (d.ip || '?'); }).join(', ');
    console.log('Device not found. Searched for deviceId=' + (deviceId || '') + ' ip=' + (ip || '') + '. Available: ' + deviceIps);
    return { success: false, error: 'Device not found: deviceId=' + (deviceId || '') + ' ip=' + (ip || '') };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Add a trap record (mirrors addTrap from Code.gs)
 */
function addTrap(data) {
  try {
    var now = new Date().toISOString();
    var trapId = generateId();

    // Use pre-parsed message and severity from gateway if provided
    var message = data.parsedMessage || 'SNMP Alert';
    var severity = data.severity || 'info';

    insert('snmp_traps', {
      id: trapId,
      sourceIp: data.sourceIp || 'unknown',
      trapData: JSON.stringify(data.trapData || {}),
      parsedMessage: message,
      severity: severity,
      receivedAt: now,
      processed: '0',
      resolvedAt: '',
      resolvedBy: '',
      assignedTo: '',
      assignedAt: ''
    });

    console.log('Added trap: ' + trapId + ' - ' + message + ' (' + severity + ')');
    return { success: true, trapId: trapId };
  } catch (error) {
    console.log('Error adding trap: ' + error);
    return { success: false, error: error.message };
  }
}

/**
 * Push supply data to supply_history table (mirrors pushSupplyData from Code.gs)
 */
function pushSupplyData(data) {
  try {
    var now = new Date().toISOString();

    if (data.supplies && Array.isArray(data.supplies)) {
      for (var i = 0; i < data.supplies.length; i++) {
        var supply = data.supplies[i];
        insert('supply_history', {
          id: generateId(),
          deviceId: data.deviceId || '',
          supplyName: supply.name || '',
          level: supply.level || 0,
          maxCapacity: supply.max || 0,
          percentage: supply.percentage || 0,
          timestamp: now
        });
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// GATEWAY POST ENDPOINT
// ============================================
// The SNMP gateway sends POST requests with { action: '...', ...data }
// This mirrors the doPost() dispatcher from Code.gs

router.post('/gateway', (req, res) => {
  try {
    var data = req.body;
    var action = data.action;

    switch (action) {
      case 'updateDeviceStatus':
        return res.json(updateDeviceStatus(data));

      case 'addTrap':
        return res.json(addTrap(data));

      case 'pushSupplyData':
        return res.json(pushSupplyData(data));

      case 'getDevices': {
        var devices = getDevicesParsed();
        var deviceList = devices.map(function(d) {
          return { ip: d.ip, name: d.name, id: d.id, type: d.type, model: d.model };
        });
        return res.json({ success: true, devices: deviceList });
      }

      default:
        return res.json({ error: 'Unknown action: ' + action });
    }
  } catch (error) {
    console.log('Gateway POST error: ' + error);
    res.json({ error: error.message });
  }
});

// ============================================
// GATEWAY GET ENDPOINT — Device Sync
// ============================================

router.get('/gateway/devices', (req, res) => {
  try {
    var devices = getDevicesParsed();
    var deviceList = devices.map(function(d) {
      return { ip: d.ip, name: d.name, id: d.id, type: d.type, model: d.model };
    });
    res.json({ success: true, devices: deviceList });
  } catch (error) {
    console.log('Gateway GET devices error: ' + error);
    res.json({ success: false, error: error.message, devices: [] });
  }
});

module.exports = router;
