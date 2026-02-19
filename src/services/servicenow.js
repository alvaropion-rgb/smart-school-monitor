const settingsService = require('./settings');

async function setupSnCredentials(username, password, instance) {
  settingsService.saveSetting('servicenowUser', username);
  settingsService.saveSetting('servicenowPassword', password);
  if (instance) settingsService.saveSetting('servicenowInstance', instance);
  return { success: true };
}

async function getLatestSnIncident(employeeNumber, shortDescription) {
  try {
    const settings = settingsService.getSettings();
    const user = settings.servicenowUser;
    const pass = settings.servicenowPassword;
    const instance = settings.servicenowInstance || 'pbcsd';

    if (!user || !pass) return { success: false, error: 'ServiceNow credentials not configured' };

    const fetch = require('node-fetch');
    const auth = Buffer.from(user + ':' + pass).toString('base64');

    // Query for recent incidents by employee
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    let query = 'sys_created_on>' + tenMinAgo;
    if (employeeNumber) query += '^caller_id.employee_number=' + employeeNumber;

    const url = 'https://' + instance + '.service-now.com/api/now/table/incident?sysparm_query=' + encodeURIComponent(query) + '&sysparm_limit=1&sysparm_display_value=true&sysparm_fields=number,sys_id,short_description';

    const response = await fetch(url, {
      headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });

    if (!response.ok) return { success: false, error: 'ServiceNow API error: ' + response.status };

    const data = await response.json();
    if (data.result && data.result.length > 0) {
      const inc = data.result[0];
      return {
        success: true,
        incident: {
          number: inc.number,
          sysId: inc.sys_id,
          shortDescription: inc.short_description,
          url: 'https://' + instance + '.service-now.com/nav_to.do?uri=incident.do?sysparm_query=number=' + inc.number
        }
      };
    }

    return { success: true, incident: null };
  } catch (error) { return { success: false, error: error.message }; }
}

module.exports = { setupSnCredentials, getLatestSnIncident };
