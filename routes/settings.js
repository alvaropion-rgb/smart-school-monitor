/**
 * Settings Routes - Ported from Code.gs
 * Handles app settings, after-hours config, security passwords, and issue buttons.
 */
const express = require('express');
const router = express.Router();
const { db, generateId, getAll, getById, getByColumn, insert, update, remove, getSetting, setSetting } = require('../db/database');
const config = require('../config');

// ============================================
// GENERAL SETTINGS
// ============================================

/**
 * getSettings - Get all settings as key-value object
 * Reads all rows from settings table, returns { key: value, ... }
 */
router.post('/getSettings', (req, res) => {
  try {
    const rows = getAll('settings');
    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  } catch (error) {
    console.error('Error getting settings:', error);
    res.json({});
  }
});

/**
 * saveSetting - Save a single key-value setting
 * Args: [key, value]
 */
router.post('/saveSetting', (req, res) => {
  try {
    const [key, value] = req.body.args || [];
    setSetting(key, value);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving setting:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * saveSettings - Save multiple key-value pairs
 * Args: [{ key1: value1, key2: value2, ... }]
 */
router.post('/saveSettings', (req, res) => {
  try {
    const [obj] = req.body.args || [];
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(key => {
        setSetting(key, obj[key]);
      });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// AFTER-HOURS SETTINGS
// ============================================

/**
 * Helper: get all settings as key-value object (internal use)
 */
function getAllSettings() {
  const rows = getAll('settings');
  const settings = {};
  rows.forEach(row => {
    settings[row.key] = row.value;
  });
  return settings;
}

/**
 * getAfterHoursSettings - Build after-hours settings object with defaults
 */
router.post('/getAfterHoursSettings', (req, res) => {
  try {
    res.json(buildAfterHoursSettings());
  } catch (error) {
    console.error('Error getting after-hours settings:', error);
    res.json({
      enabled: true,
      workStart: '06:30',
      workEnd: '16:00',
      workDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
      urgentEmail: 'itservicedesk@palmbeachschools.org',
      urgentPhone: '(561) 242-6100',
      afterHoursMessage: 'Your request has been submitted and will be addressed first thing during the next working hours.'
    });
  }
});

/**
 * Build after-hours settings (shared helper)
 */
function buildAfterHoursSettings() {
  const settings = getAllSettings();

  // Helper to convert Date or string to HH:mm format
  function formatTime(value, defaultTime) {
    if (!value) return defaultTime;
    if (typeof value === 'string') {
      // Handle ISO date strings like "1899-12-30T06:30:00.000Z"
      if (value.includes('T')) {
        const d = new Date(value);
        const hours = d.getUTCHours().toString().padStart(2, '0');
        const mins = d.getUTCMinutes().toString().padStart(2, '0');
        return hours + ':' + mins;
      }
      return value;
    }
    return defaultTime;
  }

  return {
    enabled: settings.afterHoursEnabled !== 'false' && settings.afterHoursEnabled !== false,
    workStart: formatTime(settings.afterHoursWorkStart, '06:30'),
    workEnd: formatTime(settings.afterHoursWorkEnd, '16:00'),
    workDays: settings.afterHoursWorkDays
      ? (typeof settings.afterHoursWorkDays === 'string' ? JSON.parse(settings.afterHoursWorkDays) : settings.afterHoursWorkDays)
      : { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
    urgentEmail: settings.afterHoursUrgentEmail || 'itservicedesk@palmbeachschools.org',
    urgentPhone: settings.afterHoursUrgentPhone || '(561) 242-6100',
    afterHoursMessage: settings.afterHoursMessage || 'Your request has been submitted and will be addressed first thing during the next working hours.'
  };
}

/**
 * saveAfterHoursSettings - Save multiple after-hours settings keys
 * Args: [settingsObj]
 */
router.post('/saveAfterHoursSettings', (req, res) => {
  try {
    const [settings] = req.body.args || [];

    setSetting('afterHoursEnabled', settings.enabled ? 'true' : 'false');
    setSetting('afterHoursWorkStart', settings.workStart || '06:30');
    setSetting('afterHoursWorkEnd', settings.workEnd || '16:00');

    // Handle workDays - can come as workDaysJson (string) or workDays (object)
    let workDaysValue;
    if (settings.workDaysJson) {
      workDaysValue = settings.workDaysJson;
    } else if (settings.workDays) {
      workDaysValue = JSON.stringify(settings.workDays);
    } else {
      workDaysValue = JSON.stringify({ mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false });
    }

    setSetting('afterHoursWorkDays', workDaysValue);
    setSetting('afterHoursUrgentEmail', settings.urgentEmail || '');
    setSetting('afterHoursUrgentPhone', settings.urgentPhone || '');
    setSetting('afterHoursMessage', settings.afterHoursMessage || '');

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving after-hours settings:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// WORKING HOURS CHECK
// ============================================

/**
 * isWithinWorkingHours - Check current time vs work hours/days
 * Uses config.TIMEZONE instead of Session.getScriptTimeZone()
 */
function checkWorkingHours() {
  const result = {
    isWorkingHours: true,
    reason: '',
    settings: {
      enabled: false,
      workStart: '06:30',
      workEnd: '16:00',
      urgentEmail: 'itservicedesk@palmbeachschools.org',
      urgentPhone: '(561) 242-6100',
      afterHoursMessage: 'Your request will be addressed during the next working hours.'
    }
  };

  try {
    const settings = buildAfterHoursSettings();
    result.settings = settings;

    // If feature is disabled, always return working hours
    if (!settings.enabled) {
      result.isWorkingHours = true;
      result.reason = 'disabled';
      return result;
    }

    // Get current time in the configured timezone
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', {
      timeZone: config.TIMEZONE,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
    const timeParts = timeStr.split(':');
    const currentHour = parseInt(timeParts[0], 10);
    const currentMin = parseInt(timeParts[1], 10);
    const currentTime = currentHour * 60 + currentMin;

    // Get day of week in configured timezone
    const dayStr = now.toLocaleString('en-US', {
      timeZone: config.TIMEZONE,
      weekday: 'short'
    }).toLowerCase().substring(0, 3);
    const currentDay = dayStr;

    // Check if today is a working day
    if (!settings.workDays || !settings.workDays[currentDay]) {
      result.isWorkingHours = false;
      result.reason = 'weekend';
      return result;
    }

    // Parse work hours
    const startParts = (settings.workStart || '06:30').split(':');
    const endParts = (settings.workEnd || '16:00').split(':');
    const startTime = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
    const endTime = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);

    // Check if current time is outside working hours
    if (currentTime < startTime || currentTime >= endTime) {
      result.isWorkingHours = false;
      result.reason = 'after-hours';
      return result;
    }

    result.isWorkingHours = true;
    result.reason = 'working-hours';
    return result;
  } catch (error) {
    console.error('Error in isWithinWorkingHours:', error);
    // On error, default to working hours (don't block users)
    result.isWorkingHours = true;
    result.reason = 'error';
    return result;
  }
}

/**
 * getWorkingHoursStatus - Return JSON string (matches Apps Script behavior)
 */
router.post('/getWorkingHoursStatus', (req, res) => {
  const result = checkWorkingHours();
  // Apps Script returned JSON.stringify(result); the shim already JSON-encodes,
  // so return the string to match client expectations
  res.json(JSON.stringify(result));
});

/**
 * isWithinWorkingHours - Return the object directly
 */
router.post('/isWithinWorkingHours', (req, res) => {
  res.json(checkWorkingHours());
});

// ============================================
// SECURITY PASSWORD
// ============================================

/**
 * verifySecurityPassword - Compare with stored password
 * Args: [password]
 */
router.post('/verifySecurityPassword', (req, res) => {
  try {
    const [password] = req.body.args || [];
    const storedPassword = getSetting('securityPassword') || '';
    const isProtected = getSetting('passwordProtected') === 'true';

    if (!isProtected || !storedPassword) {
      return res.json({ success: true, valid: true });
    }

    const valid = password === storedPassword;
    res.json({ success: true, valid: valid });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * setSecurityPassword - Verify old password, set new
 * Args: [newPassword, oldPassword]
 */
router.post('/setSecurityPassword', (req, res) => {
  try {
    const [newPassword, oldPassword] = req.body.args || [];
    const storedPassword = getSetting('securityPassword') || '';
    const isProtected = getSetting('passwordProtected') === 'true';

    // If password protection is enabled, verify old password
    if (isProtected && storedPassword) {
      if (oldPassword !== storedPassword) {
        return res.json({ success: false, error: 'Current password is incorrect' });
      }
    }

    // Save new password
    setSetting('securityPassword', newPassword);
    setSetting('passwordProtected', newPassword ? 'true' : 'false');

    res.json({ success: true, message: newPassword ? 'Password set successfully' : 'Password protection disabled' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * isPasswordProtected - Check if password protection is enabled
 */
router.post('/isPasswordProtected', (req, res) => {
  try {
    const storedPassword = getSetting('securityPassword') || '';
    const isProtected = getSetting('passwordProtected') === 'true';
    res.json({
      success: true,
      protected: isProtected && !!storedPassword
    });
  } catch (error) {
    res.json({ success: false, protected: false });
  }
});

// ============================================
// ISSUE BUTTONS
// ============================================

/**
 * getIssueButtons - Get all issue buttons
 */
router.post('/getIssueButtons', (req, res) => {
  try {
    const buttons = getAll('issue_buttons');
    res.json(buttons);
  } catch (error) {
    console.error('Error getting issue buttons:', error);
    res.json([]);
  }
});

/**
 * getIssueButtonsByDeviceType - Filter by deviceTypeId, active only, sorted
 * Args: [deviceTypeId]
 */
router.post('/getIssueButtonsByDeviceType', (req, res) => {
  try {
    const [deviceTypeId] = req.body.args || [];
    const buttons = getAll('issue_buttons');
    const filtered = buttons
      .filter(b => b.deviceTypeId === deviceTypeId && b.active !== 'false' && b.active !== false)
      .sort((a, b) => (parseInt(a.sortOrder) || 0) - (parseInt(b.sortOrder) || 0));
    res.json(filtered);
  } catch (error) {
    console.error('Error getting issue buttons by device type:', error);
    res.json([]);
  }
});

/**
 * saveIssueButton - Create or update an issue button
 * Args: [buttonObj]
 */
router.post('/saveIssueButton', (req, res) => {
  try {
    const [button] = req.body.args || [];
    const now = new Date().toISOString();

    const data = {
      id: button.id || generateId(),
      deviceTypeId: button.deviceTypeId || '',
      label: button.label || '',
      icon: button.icon || 'circle',
      color: button.color || '#6b7280',
      sortOrder: button.sortOrder || 0,
      active: button.active !== false && button.active !== 'false' ? 'true' : 'false',
      createdAt: button.createdAt || now,
      updatedAt: now
    };

    // Check if exists
    const existing = getById('issue_buttons', data.id);
    if (existing) {
      update('issue_buttons', data.id, data);
    } else {
      insert('issue_buttons', data);
    }

    res.json({ success: true, button: data });
  } catch (error) {
    console.error('Error saving issue button:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * deleteIssueButton - Delete an issue button
 * Args: [buttonId]
 */
router.post('/deleteIssueButton', (req, res) => {
  try {
    const [buttonId] = req.body.args || [];
    const existing = getById('issue_buttons', buttonId);

    if (existing) {
      remove('issue_buttons', buttonId);
      return res.json({ success: true });
    }

    res.json({ success: false, error: 'Button not found' });
  } catch (error) {
    console.error('Error deleting issue button:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// SERVICENOW CREDENTIALS
// ============================================

/**
 * setupSnCredentials - Save ServiceNow credentials to settings
 * Args: [username, password, instance]
 */
router.post('/setupSnCredentials', (req, res) => {
  try {
    const [username, password, instance] = req.body.args || [];

    if (!username || !password) {
      return res.json({ success: false, error: 'Username and password are required' });
    }

    setSetting('servicenowUser', username);
    setSetting('servicenowPassword', password);
    if (instance) {
      setSetting('servicenowInstance', instance);
    }

    res.json({ success: true, message: 'ServiceNow credentials saved successfully.' });
  } catch (error) {
    console.error('Error setting up SN credentials:', error);
    res.json({ success: false, error: error.message });
  }
});

// Export helper for use in other route files
module.exports = router;
module.exports.checkWorkingHours = checkWorkingHours;
module.exports.buildAfterHoursSettings = buildAfterHoursSettings;
module.exports.getAllSettings = getAllSettings;
