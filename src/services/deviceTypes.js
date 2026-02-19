const db = require('../database/db');

function getDeviceTypes() {
  try { return db.getAll('device_types'); }
  catch (error) { console.error('Error getting device types:', error); return []; }
}

function saveDeviceType(deviceType) {
  try {
    const now = new Date().toISOString();
    const data = {
      id: deviceType.id || db.generateId(),
      name: deviceType.name || '',
      icon: deviceType.icon || 'box',
      color: deviceType.color || '#6b7280',
      pageTitle: deviceType.pageTitle || 'Report Issue',
      description: deviceType.description || '',
      blueprintId: deviceType.blueprintId || '',
      active: deviceType.active !== false ? 1 : 0,
      createdAt: deviceType.createdAt || now,
      updatedAt: now
    };
    db.upsert('device_types', data);
    return { success: true, deviceType: data };
  } catch (error) { return { success: false, error: error.message }; }
}

function deleteDeviceType(deviceTypeId) {
  try {
    const result = db.deleteById('device_types', deviceTypeId);
    if (result.changes > 0) return { success: true };
    return { success: false, error: 'Device type not found' };
  } catch (error) { return { success: false, error: error.message }; }
}

function getDeviceTypeById(deviceTypeId) {
  try { return db.getById('device_types', deviceTypeId) || null; }
  catch (error) { return null; }
}

function getDeviceTypeForDevice(deviceOrId) {
  try {
    // Accept either a device object or a device ID string
    let device = deviceOrId;
    if (typeof deviceOrId === 'string') {
      device = db.getById('devices', deviceOrId);
    }
    if (!device || !device.type) return null;
    const types = getDeviceTypes();
    const deviceTypeLower = (device.type || '').toLowerCase();
    // Match by: exact ID, case-insensitive name, or matchPattern
    return types.find(t => {
      if (t.id === device.type) return true;
      if (t.name && t.name.toLowerCase() === deviceTypeLower) return true;
      // Fuzzy: check if device type contains the type name or vice versa
      if (t.name && (deviceTypeLower.includes(t.name.toLowerCase()) || t.name.toLowerCase().includes(deviceTypeLower))) return true;
      if (t.matchPattern) {
        try {
          return new RegExp(t.matchPattern, 'i').test(device.type) ||
                 new RegExp(t.matchPattern, 'i').test(device.name || '') ||
                 new RegExp(t.matchPattern, 'i').test(device.model || '');
        } catch (e) { return false; }
      }
      return false;
    }) || null;
  } catch (error) { return null; }
}

function updateDeviceTypeBlueprint(deviceTypeId, blueprintId) {
  try {
    const dt = getDeviceTypeById(deviceTypeId);
    if (!dt) return { success: false, error: 'Device type not found' };
    dt.blueprintId = blueprintId;
    return saveDeviceType(dt);
  } catch (error) { return { success: false, error: error.message }; }
}

module.exports = {
  getDeviceTypes, saveDeviceType, deleteDeviceType,
  getDeviceTypeById, getDeviceTypeForDevice, updateDeviceTypeBlueprint
};
