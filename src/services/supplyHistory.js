const db = require('../database/db');

function pushSupplyData(data) {
  try {
    const now = new Date().toISOString();
    if (data.supplies && Array.isArray(data.supplies)) {
      for (const supply of data.supplies) {
        db.insert('supply_history', {
          id: db.generateId(),
          deviceId: data.deviceId,
          supplyName: supply.name,
          level: supply.level,
          maxCapacity: supply.max,
          percentage: supply.percentage,
          timestamp: now
        });
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { pushSupplyData };
