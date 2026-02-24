/**
 * Working Hours Service - Replaces Session.getScriptTimeZone() and Utilities.formatDate()
 */
const config = require('../config');

/**
 * Check if current time is within working hours
 * Replaces isWithinWorkingHours() from Code.gs
 */
function isWithinWorkingHours(afterHoursSettings) {
  var result = {
    isWorkingHours: true,
    reason: '',
    settings: afterHoursSettings || {
      enabled: false,
      workStart: '06:30',
      workEnd: '16:00',
      urgentEmail: 'itservicedesk@palmbeachschools.org',
      urgentPhone: '(561) 242-6100',
      afterHoursMessage: 'Your request will be addressed during the next working hours.'
    }
  };

  try {
    var settings = afterHoursSettings;
    result.settings = settings;

    // If feature is disabled, always return working hours
    if (!settings.enabled) {
      result.isWorkingHours = true;
      result.reason = 'disabled';
      return result;
    }

    // Get current time in configured timezone
    var now = new Date();
    var timeZone = config.TIMEZONE || 'America/New_York';

    // Format current time
    var timeStr = now.toLocaleString('en-US', { timeZone: timeZone, hour12: false, hour: '2-digit', minute: '2-digit' });
    var timeParts = timeStr.split(':');
    var currentHour = parseInt(timeParts[0], 10);
    var currentMin = parseInt(timeParts[1], 10);
    var currentTime = currentHour * 60 + currentMin;

    // Get day of week
    var dayStr = now.toLocaleString('en-US', { timeZone: timeZone, weekday: 'short' }).toLowerCase();
    var dayMap = { 'mon': 'mon', 'tue': 'tue', 'wed': 'wed', 'thu': 'thu', 'fri': 'fri', 'sat': 'sat', 'sun': 'sun' };
    var currentDay = dayMap[dayStr] || dayStr.substring(0, 3);

    // Check if today is a working day
    if (!settings.workDays || !settings.workDays[currentDay]) {
      result.isWorkingHours = false;
      result.reason = 'weekend';
      return result;
    }

    // Parse work hours
    var startParts = (settings.workStart || '06:30').split(':');
    var endParts = (settings.workEnd || '16:00').split(':');
    var startTime = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
    var endTime = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);

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
    result.isWorkingHours = true;
    result.reason = 'error';
    return result;
  }
}

module.exports = { isWithinWorkingHours };
