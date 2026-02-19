const db = require('../database/db');

function getIssueButtons() {
  try { return db.getAll('issue_buttons'); }
  catch (error) { console.error('Error getting issue buttons:', error); return []; }
}

function getIssueButtonsByDeviceType(deviceTypeId) {
  try {
    return db.query(
      "SELECT * FROM issue_buttons WHERE deviceTypeId = ? AND (active = 1 OR active = 'true') ORDER BY sortOrder ASC",
      [deviceTypeId]
    );
  } catch (error) { return []; }
}

function saveIssueButton(button) {
  try {
    const now = new Date().toISOString();
    const data = {
      id: button.id || db.generateId(),
      deviceTypeId: button.deviceTypeId || '',
      label: button.label || '',
      icon: button.icon || 'circle',
      color: button.color || '#6b7280',
      sortOrder: button.sortOrder || button.displayOrder || 0,
      active: button.active !== false ? 1 : 0,
      imageDataUrl: button.imageDataUrl || '',
      createdAt: button.createdAt || now,
      updatedAt: now
    };
    db.upsert('issue_buttons', data);
    return { success: true, button: data };
  } catch (error) { return { success: false, error: error.message }; }
}

function deleteIssueButton(buttonId) {
  try {
    const result = db.deleteById('issue_buttons', buttonId);
    if (result.changes > 0) return { success: true };
    return { success: false, error: 'Button not found' };
  } catch (error) { return { success: false, error: error.message }; }
}

module.exports = { getIssueButtons, getIssueButtonsByDeviceType, saveIssueButton, deleteIssueButton };
