/**
 * ServiceNow REST API Integration
 * Replaces UrlFetchApp.fetch() from Code.gs
 */
const db = require('../db/database');

/**
 * Get the latest ServiceNow incident for an employee
 * Replaces getLatestSnIncident() from Code.gs
 */
async function getLatestSnIncident(employeeNumber, shortDescription) {
  try {
    var snUser = db.getSetting('servicenowUser');
    var snPassword = db.getSetting('servicenowPassword');
    var snInstance = db.getSetting('servicenowInstance');

    if (!snUser || !snPassword || !snInstance) {
      return { success: false, error: 'ServiceNow credentials not configured' };
    }

    // Build query - find incidents created in the last 5 minutes by this employee
    var fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    var query = 'caller_id.employee_number=' + employeeNumber +
      '^sys_created_on>=' + fiveMinAgo +
      '^ORDERBYDESCsys_created_on';

    var url = 'https://' + snInstance + '.service-now.com/api/now/table/incident' +
      '?sysparm_query=' + encodeURIComponent(query) +
      '&sysparm_limit=1' +
      '&sysparm_fields=number,sys_id,short_description,sys_created_on';

    var auth = Buffer.from(snUser + ':' + snPassword).toString('base64');

    var response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return { success: false, error: 'ServiceNow API error: ' + response.status };
    }

    var data = await response.json();

    if (data.result && data.result.length > 0) {
      var incident = data.result[0];
      return {
        success: true,
        incident: {
          number: incident.number,
          sysId: incident.sys_id,
          shortDescription: incident.short_description,
          createdOn: incident.sys_created_on,
          url: 'https://' + snInstance + '.service-now.com/nav_to.do?uri=incident.do?sys_id=' + incident.sys_id
        }
      };
    }

    return { success: true, incident: null };
  } catch (error) {
    console.error('ServiceNow API error:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { getLatestSnIncident };
