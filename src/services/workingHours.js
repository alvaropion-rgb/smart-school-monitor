const settingsService = require('./settings');

function isWithinWorkingHours() {
  var result = {
    isWorkingHours: true,
    reason: '',
    settings: {
      enabled: false, workStart: '06:30', workEnd: '16:00',
      urgentEmail: 'itservicedesk@palmbeachschools.org',
      urgentPhone: '(561) 242-6100',
      afterHoursMessage: 'Your request will be addressed during the next working hours.'
    }
  };

  try {
    var settings = settingsService.getAfterHoursSettings();
    result.settings = settings;

    if (!settings.enabled) {
      result.isWorkingHours = true;
      result.reason = 'disabled';
      return result;
    }

    var now = new Date();
    // Use Intl for timezone-aware formatting (replaces Utilities.formatDate)
    var timeZone = 'America/New_York';
    var formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
    var timeParts = formatter.format(now).split(':');
    var currentHour = parseInt(timeParts[0], 10);
    var currentMin = parseInt(timeParts[1], 10);
    var currentTime = currentHour * 60 + currentMin;

    var dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
    var dayStr = dayFormatter.format(now).toLowerCase();
    var dayMap = { mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat', sun: 'sun' };
    var currentDay = dayMap[dayStr] || dayStr.substring(0, 3);

    if (!settings.workDays || !settings.workDays[currentDay]) {
      result.isWorkingHours = false;
      result.reason = 'weekend';
      return result;
    }

    var startParts = (settings.workStart || '06:30').split(':');
    var endParts = (settings.workEnd || '16:00').split(':');
    var startTime = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
    var endTime = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);

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

function getWorkingHoursStatus() {
  return JSON.stringify(isWithinWorkingHours());
}

module.exports = { isWithinWorkingHours, getWorkingHoursStatus };
