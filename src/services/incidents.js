const db = require('../database/db');

function createIncident(data) {
  try {
    const now = new Date().toISOString();
    const incident = {
      id: db.generateId(),
      employeeId: data.employeeId || '',
      employeeName: data.employeeName || '',
      employeeEmail: data.employeeEmail || '',
      roomNumber: data.roomNumber || '',
      shortDescription: data.shortDescription || '',
      description: data.description || '',
      category: data.category || '',
      subcategory: data.subcategory || '',
      channel: data.channel || '',
      impact: data.impact || '',
      userType: data.userType || '',
      snowIncidentNumber: data.snowIncidentNumber || '',
      snowUrl: data.snowUrl || '',
      emailStatus: 'not-sent',
      emailSentAt: '',
      status: 'open',
      createdAt: now,
      updatedAt: now
    };
    db.insert('incidents', incident);
    return { success: true, incident };
  } catch (error) { return { success: false, error: error.message }; }
}

function getIncidents(limit) {
  try {
    let sql = 'SELECT * FROM incidents ORDER BY createdAt DESC';
    if (limit) sql += ' LIMIT ' + parseInt(limit);
    return db.query(sql);
  } catch (error) { return []; }
}

function getIncidentsByEmployee(empId) {
  try { return db.query('SELECT * FROM incidents WHERE employeeId = ? ORDER BY createdAt DESC', [empId]); }
  catch (error) { return []; }
}

function updateIncidentField(incidentId, fieldName, value) {
  try {
    const now = new Date().toISOString();
    const obj = {};
    obj[fieldName] = value;
    obj.updatedAt = now;
    db.update('incidents', incidentId, obj);
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

function buildIncidentEmailHtml(incident) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0">
<div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
<div style="background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%);color:white;padding:30px 20px;text-align:center">
<h1 style="margin:0;font-size:24px">Help Desk Incident</h1></div>
<div style="padding:30px 20px">
<div style="background:#f8fafc;padding:20px;border-radius:8px;margin-bottom:20px">
<div style="margin-bottom:10px"><strong>Employee:</strong> ${incident.employeeName || 'N/A'} (${incident.employeeId || 'N/A'})</div>
<div style="margin-bottom:10px"><strong>Email:</strong> ${incident.employeeEmail || 'N/A'}</div>
<div style="margin-bottom:10px"><strong>Room:</strong> ${incident.roomNumber || 'N/A'}</div>
<div style="margin-bottom:10px"><strong>Category:</strong> ${incident.category || 'N/A'} / ${incident.subcategory || 'N/A'}</div>
<div style="margin-bottom:10px"><strong>Impact:</strong> ${incident.impact || 'N/A'}</div>
</div>
<div style="margin-bottom:20px"><strong>Description:</strong><div style="background:#f1f5f9;padding:15px;border-radius:8px;margin-top:8px;white-space:pre-wrap">${incident.shortDescription || ''}\n\n${incident.description || ''}</div></div>
${incident.snowIncidentNumber ? '<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:15px;border-radius:0 8px 8px 0"><strong>ServiceNow:</strong> ' + incident.snowIncidentNumber + '</div>' : ''}
</div>
<div style="background:#f8fafc;padding:15px;text-align:center;font-size:12px;color:#64748b">
<p>Smart School Monitor - ${new Date().toLocaleString()}</p></div></div></body></html>`;
}

async function sendIncidentEmail(incidentId) {
  try {
    const incident = db.getById('incidents', incidentId);
    if (!incident) return { success: false, error: 'Incident not found' };

    const settingsService = require('./settings');
    const emailService = require('./email');
    const config = settingsService.getEmailConfig();
    if (!config.companyEmail) return { success: false, error: 'Company email not configured' };

    const subject = 'Help Desk Incident: ' + (incident.shortDescription || 'New Incident');
    const html = buildIncidentEmailHtml(incident);
    await emailService.sendEmail(config.companyEmail, subject, incident.description || '', html);

    db.update('incidents', incidentId, { emailStatus: 'sent', emailSentAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

async function queueIncidentEmail(incidentId) {
  try {
    const incident = db.getById('incidents', incidentId);
    if (!incident) return { success: false, error: 'Incident not found' };

    const settingsService = require('./settings');
    const config = settingsService.getEmailConfig();
    if (!config.companyEmail) return { success: false, error: 'Company email not configured' };

    const now = new Date().toISOString();
    db.insert('email_queue', {
      id: db.generateId(), incidentId, to: config.companyEmail,
      subject: 'Help Desk Incident: ' + (incident.shortDescription || 'New Incident'),
      body: buildIncidentEmailHtml(incident),
      status: 'pending', scheduledAt: now, sentAt: '', createdAt: now, error: ''
    });

    db.update('incidents', incidentId, { emailStatus: 'queued', updatedAt: now });
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

module.exports = {
  createIncident, getIncidents, getIncidentsByEmployee,
  updateIncidentField, sendIncidentEmail, queueIncidentEmail,
  buildIncidentEmailHtml
};
