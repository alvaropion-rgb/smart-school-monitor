const db = require('../database/db');

function getDevices() {
  try {
    const devices = db.getAll('devices');
    return devices.map(d => {
      let supplies = [], messages = [], inputTrays = [];
      try { supplies = d.supplies ? JSON.parse(d.supplies) : []; } catch (e) {}
      try { messages = d.messages ? JSON.parse(d.messages) : []; } catch (e) {}
      try { inputTrays = d.inputTrays ? JSON.parse(d.inputTrays) : []; } catch (e) {}
      return { ...d, supplies, messages, inputTrays, pageCount: parseInt(d.pageCount) || 0 };
    });
  } catch (error) {
    console.error('Error getting devices:', error);
    return [];
  }
}

function saveDevice(device) {
  try {
    const now = new Date().toISOString();
    const deviceData = {
      id: device.id || db.generateId(),
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
    db.upsert('devices', deviceData);
    return { success: true, device: deviceData };
  } catch (error) {
    console.error('Error saving device:', error);
    return { success: false, error: error.message };
  }
}

function deleteDevice(deviceId) {
  try {
    const result = db.deleteById('devices', deviceId);
    if (result.changes > 0) return { success: true };
    return { success: false, error: 'Device not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function updateDeviceStatus(data) {
  try {
    const { deviceId, ip, status, supplies, messages, inputTrays, pageCount } = data;
    const devices = getDevices();
    const normalizedIp = ip ? ip.trim() : '';

    let device = null;
    if (deviceId) device = devices.find(d => d.id === deviceId);
    if (!device && normalizedIp) device = devices.find(d => (d.ip || '').trim() === normalizedIp);

    if (device) {
      device.status = status || device.status;
      device.lastSeen = (status === 'online' || status === 'issue') ? new Date().toISOString() : device.lastSeen;
      if (Array.isArray(supplies) && supplies.length > 0) device.supplies = supplies;
      if (Array.isArray(messages) && messages.length > 0) device.messages = messages;
      if (Array.isArray(inputTrays) && inputTrays.length > 0) device.inputTrays = inputTrays;
      if (pageCount !== undefined && pageCount !== null) device.pageCount = pageCount;
      return saveDevice(device);
    }

    return { success: false, error: 'Device not found: deviceId=' + (deviceId || '') + ' ip=' + (ip || '') };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getDeviceById(deviceId) {
  try {
    const devices = getDevices();
    let device = devices.find(d => d.id === deviceId);
    if (!device) {
      const searchId = String(deviceId).trim().toLowerCase();
      device = devices.find(d => String(d.name || '').trim().toLowerCase() === searchId);
    }
    return device || null;
  } catch (error) {
    console.error('Error getting device by ID:', error);
    return null;
  }
}

function clearAllDevices() {
  try {
    db.deleteAll('devices');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  getDevices, saveDevice, deleteDevice, updateDeviceStatus,
  getDeviceById, clearAllDevices
};
