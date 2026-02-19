const db = require('../database/db');

function getEmailConfig() {
  try { return db.getKeyValue('email_config'); }
  catch (error) { console.error('Error getting email config:', error); return {}; }
}

function saveEmailConfig(config) {
  try { db.setKeyValues('email_config', config); return { success: true }; }
  catch (error) { return { success: false, error: error.message }; }
}

function getSettings() {
  try { return db.getKeyValue('settings'); }
  catch (error) { console.error('Error getting settings:', error); return {}; }
}

function saveSetting(key, value) {
  try { db.setKeyValue('settings', key, value); return { success: true }; }
  catch (error) { return { success: false, error: error.message }; }
}

function saveAfterHoursSettings(settings) {
  try {
    saveSetting('afterHoursEnabled', settings.enabled ? 'true' : 'false');
    saveSetting('afterHoursWorkStart', settings.workStart || '06:30');
    saveSetting('afterHoursWorkEnd', settings.workEnd || '16:00');

    var workDaysValue;
    if (settings.workDaysJson) workDaysValue = settings.workDaysJson;
    else if (settings.workDays) workDaysValue = JSON.stringify(settings.workDays);
    else workDaysValue = JSON.stringify({ mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false });

    saveSetting('afterHoursWorkDays', workDaysValue);
    saveSetting('afterHoursUrgentEmail', settings.urgentEmail || '');
    saveSetting('afterHoursUrgentPhone', settings.urgentPhone || '');
    saveSetting('afterHoursMessage', settings.afterHoursMessage || '');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getAfterHoursSettings() {
  try {
    var settings = getSettings();
    function formatTime(value, defaultTime) {
      if (!value) return defaultTime;
      if (typeof value === 'string') {
        if (value.includes('T')) {
          var d = new Date(value);
          return d.getUTCHours().toString().padStart(2, '0') + ':' + d.getUTCMinutes().toString().padStart(2, '0');
        }
        return value;
      }
      return defaultTime;
    }
    return {
      enabled: settings.afterHoursEnabled !== 'false' && settings.afterHoursEnabled !== false,
      workStart: formatTime(settings.afterHoursWorkStart, '06:30'),
      workEnd: formatTime(settings.afterHoursWorkEnd, '16:00'),
      workDays: settings.afterHoursWorkDays ? (typeof settings.afterHoursWorkDays === 'string' ? JSON.parse(settings.afterHoursWorkDays) : settings.afterHoursWorkDays) : { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
      urgentEmail: settings.afterHoursUrgentEmail || 'itservicedesk@palmbeachschools.org',
      urgentPhone: settings.afterHoursUrgentPhone || '(561) 242-6100',
      afterHoursMessage: settings.afterHoursMessage || 'Your request has been submitted and will be addressed first thing during the next working hours.'
    };
  } catch (error) {
    return {
      enabled: true, workStart: '06:30', workEnd: '16:00',
      workDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
      urgentEmail: 'itservicedesk@palmbeachschools.org', urgentPhone: '(561) 242-6100',
      afterHoursMessage: 'Your request has been submitted and will be addressed first thing during the next working hours.'
    };
  }
}

var BRANDING_DEFAULTS = {
  id: 1, logoDataUrl: '', headerTitle: 'SHARKQUICK', headerSubtitle: 'SERVICE REQUEST PORTAL',
  backgroundColor: '#7BA3C9', headerBackgroundColor: '#6B8FB8', cardBackgroundColor: '#F5F0E6',
  deviceInfoBackgroundColor: '#6B8FB8', buttonColor: '#5CB85C', titleColor: '#3D5A73',
  subtitleColor: '#C9524A', fontFamily: 'Inter', buttonBorderRadius: '20', buttonTextColor: '#FFFFFF',
  // New fields for redesigned layout
  headerLayout: 'horizontal', cardGradientStart: '#6B8FB8', cardGradientEnd: '#C8D8E8',
  buttonBackground: '#F2F2F2', employeeCardBackground: '#FFFFFF',
  welcomeText: 'Welcome, {name}!', showDeviceInfo: 'minimal',
  showRememberUsername: 'true', headerStripeColor: '#5B8DB8', logoSize: '140'
};

function getRequestPageBranding() {
  try {
    const row = db.getDb().prepare('SELECT * FROM request_page_branding WHERE id = 1').get();
    if (row) {
      // Merge with defaults so new fields get defaults if migration hasn't populated them
      var result = {};
      for (var key in BRANDING_DEFAULTS) {
        result[key] = (row[key] !== undefined && row[key] !== null && row[key] !== '') ? row[key] : BRANDING_DEFAULTS[key];
      }
      return result;
    }
    return Object.assign({}, BRANDING_DEFAULTS);
  } catch (error) {
    console.error('Error getting request page branding:', error);
    return Object.assign({}, BRANDING_DEFAULTS);
  }
}

function saveRequestPageBranding(data) {
  try {
    const d = db.getDb();
    d.prepare(`UPDATE request_page_branding SET
      logoDataUrl = ?, headerTitle = ?, headerSubtitle = ?,
      backgroundColor = ?, headerBackgroundColor = ?, cardBackgroundColor = ?,
      deviceInfoBackgroundColor = ?, buttonColor = ?, titleColor = ?,
      subtitleColor = ?, fontFamily = ?, buttonBorderRadius = ?, buttonTextColor = ?,
      headerLayout = ?, cardGradientStart = ?, cardGradientEnd = ?,
      buttonBackground = ?, employeeCardBackground = ?,
      welcomeText = ?, showDeviceInfo = ?,
      showRememberUsername = ?, headerStripeColor = ?, logoSize = ?
      WHERE id = 1`).run(
      data.logoDataUrl || '',
      data.headerTitle || BRANDING_DEFAULTS.headerTitle,
      data.headerSubtitle || BRANDING_DEFAULTS.headerSubtitle,
      data.backgroundColor || BRANDING_DEFAULTS.backgroundColor,
      data.headerBackgroundColor || BRANDING_DEFAULTS.headerBackgroundColor,
      data.cardBackgroundColor || BRANDING_DEFAULTS.cardBackgroundColor,
      data.deviceInfoBackgroundColor || BRANDING_DEFAULTS.deviceInfoBackgroundColor,
      data.buttonColor || BRANDING_DEFAULTS.buttonColor,
      data.titleColor || BRANDING_DEFAULTS.titleColor,
      data.subtitleColor || BRANDING_DEFAULTS.subtitleColor,
      data.fontFamily || BRANDING_DEFAULTS.fontFamily,
      data.buttonBorderRadius || BRANDING_DEFAULTS.buttonBorderRadius,
      data.buttonTextColor || BRANDING_DEFAULTS.buttonTextColor,
      data.headerLayout || BRANDING_DEFAULTS.headerLayout,
      data.cardGradientStart || BRANDING_DEFAULTS.cardGradientStart,
      data.cardGradientEnd || BRANDING_DEFAULTS.cardGradientEnd,
      data.buttonBackground || BRANDING_DEFAULTS.buttonBackground,
      data.employeeCardBackground || BRANDING_DEFAULTS.employeeCardBackground,
      data.welcomeText || BRANDING_DEFAULTS.welcomeText,
      data.showDeviceInfo || BRANDING_DEFAULTS.showDeviceInfo,
      data.showRememberUsername || BRANDING_DEFAULTS.showRememberUsername,
      data.headerStripeColor || BRANDING_DEFAULTS.headerStripeColor,
      data.logoSize || BRANDING_DEFAULTS.logoSize
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  getEmailConfig, saveEmailConfig, getSettings, saveSetting,
  saveAfterHoursSettings, getAfterHoursSettings,
  getRequestPageBranding, saveRequestPageBranding
};
