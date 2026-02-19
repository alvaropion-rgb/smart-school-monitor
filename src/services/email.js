const db = require('../database/db');
const nodemailer = require('nodemailer');
const settingsService = require('./settings');

function getTransporter() {
  const config = settingsService.getEmailConfig();
  if (!config.smtpHost) return null;
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: parseInt(config.smtpPort) || 587,
    secure: config.smtpSecure === 'true',
    auth: { user: config.smtpUser, pass: config.smtpPassword }
  });
}

/**
 * Send email — tries Microsoft Graph first, falls back to SMTP.
 */
async function sendEmail(to, subject, text, html, options = {}) {
  // Try Microsoft Graph first (works with Office 365 even without SMTP)
  try {
    const microsoftGraph = require('./microsoftGraph');
    if (microsoftGraph.isGraphAvailable()) {
      const result = await microsoftGraph.sendGraphEmail(to, subject, text, html, options);
      if (result.success) return result;
    }
  } catch (graphErr) {
    console.log('Graph email failed, trying SMTP:', graphErr.message);
  }

  // Fall back to SMTP
  const transporter = getTransporter();
  if (!transporter) throw new Error('Email not configured. Sign in with Microsoft 365 or set up SMTP in Settings > Email.');
  const mailOptions = { from: '"Smart School Monitor" <' + (options.from || settingsService.getEmailConfig().smtpUser || 'monitor@school.local') + '>', to, subject, text, html };
  if (options.cc) mailOptions.cc = options.cc;
  return transporter.sendMail(mailOptions);
}

function generateHtmlEmail(device, customMessage) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0}
.container{max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)}
.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:30px 20px;text-align:center}
.header h1{margin:0;font-size:24px}.content{padding:30px 20px}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px;background:#f8fafc;padding:15px;border-radius:8px;margin-bottom:20px}
.info-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px}
.info-value{font-size:14px;font-weight:600;color:#1e293b}
.supply-item{margin-bottom:12px}.supply-header{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px}
.supply-bar{height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden}
.supply-fill{height:100%;border-radius:4px}
.footer{background:#f8fafc;padding:15px;text-align:center;font-size:12px;color:#64748b}</style></head><body>
<div class="container"><div class="header"><h1>Device Alert</h1><p style="margin:5px 0 0;opacity:0.9">Smart School Monitor</p></div>
<div class="content">${customMessage ? '<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:15px;margin-bottom:20px;border-radius:4px">' + customMessage + '</div>' : ''}
<div class="info-grid">
<div><div class="info-label">Device Name</div><div class="info-value">${device.name}</div></div>
<div><div class="info-label">IP Address</div><div class="info-value" style="font-family:monospace">${device.ip}</div></div>
<div><div class="info-label">Model</div><div class="info-value">${device.model || 'N/A'}</div></div>
<div><div class="info-label">Location</div><div class="info-value">${device.location || 'N/A'}</div></div>
<div><div class="info-label">Status</div><div class="info-value" style="text-transform:capitalize">${device.status}</div></div>
<div><div class="info-label">Last Seen</div><div class="info-value">${device.lastSeen ? new Date(device.lastSeen).toLocaleString() : 'N/A'}</div></div>
</div>
${device.supplies && device.supplies.length > 0 ? '<h3 style="margin-bottom:15px;font-size:16px">Supply Levels</h3>' + device.supplies.map(s => '<div class="supply-item"><div class="supply-header"><span>' + s.name + '</span><span style="font-weight:600;color:' + (s.percentage > 50 ? '#16a34a' : s.percentage > 20 ? '#d97706' : '#dc2626') + '">' + s.percentage + '%</span></div><div class="supply-bar"><div class="supply-fill" style="width:' + s.percentage + '%;background:' + (s.percentage > 50 ? '#22c55e' : s.percentage > 20 ? '#f59e0b' : '#ef4444') + '"></div></div></div>').join('') : ''}
</div><div class="footer"><p>Automated notification from Smart School Monitor</p><p>Generated on ${new Date().toLocaleString()}</p></div></div></body></html>`;
}

async function sendDeviceEmail(deviceId, customMessage) {
  try {
    const devicesService = require('./devices');
    const device = devicesService.getDeviceById(deviceId);
    if (!device) return { success: false, error: 'Device not found' };

    const config = settingsService.getEmailConfig();
    if (!config.companyEmail) return { success: false, error: 'Company email not configured' };

    const printerInfo = `Device Name: ${device.name}\nIP Address: ${device.ip}\nModel: ${device.model || 'N/A'}\nLocation: ${device.location || 'N/A'}\nStatus: ${device.status}`;
    let emailBody = (config.emailTemplate || '').replace(/{PRINTER_INFO}/g, printerInfo).replace(/{DEVICE_NAME}/g, device.name).replace(/{DEVICE_IP}/g, device.ip).replace(/{DEVICE_LOCATION}/g, device.location || 'N/A').replace(/{TIMESTAMP}/g, new Date().toLocaleString());
    if (customMessage) emailBody = customMessage + '\n\n' + emailBody;

    await sendEmail(config.companyEmail, config.emailSubject || 'Printer Issue Report', emailBody, generateHtmlEmail(device, customMessage));

    db.insert('email_history', {
      id: db.generateId(), deviceId, recipient: config.companyEmail, cc: '',
      subject: config.emailSubject, body: emailBody, htmlBody: '', sentAt: new Date().toISOString(), status: 'sent', errorMessage: ''
    });

    return { success: true, message: 'Email sent successfully' };
  } catch (error) { return { success: false, error: error.message }; }
}

function buildManufacturerVariables(device, message) {
  var supplies = '';
  if (device.supplies && device.supplies.length > 0) {
    supplies = device.supplies.map(s => {
      var color = s.percentage > 50 ? '#16a34a' : s.percentage > 20 ? '#d97706' : '#dc2626';
      return '<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>' + s.name + '</span><span style="font-weight:600;color:' + color + '">' + s.percentage + '%</span></div><div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden"><div style="height:100%;border-radius:4px;width:' + s.percentage + '%;background:' + color + '"></div></div></div>';
    }).join('');
  }
  return {
    deviceName: device.name || '', model: device.model || 'N/A', ip: device.ip || '', location: device.location || 'N/A',
    deviceType: device.type || 'printer', status: device.status || 'unknown',
    statusColor: device.status === 'online' ? '#16a34a' : device.status === 'offline' ? '#dc2626' : '#d97706',
    machineId: device.machineId || 'N/A', serialNumber: device.serialNumber || 'N/A',
    message: (message || '').replace(/\n/g, '<br>'),
    supplyLevels: supplies || '<p style="color:#94a3b8">No supply data available.</p>',
    dateTime: new Date().toLocaleString(), schoolName: 'Smart School Monitor'
  };
}

function getDefaultManufacturerTemplate() {
  return '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n</head>\n<body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; margin: 0; padding: 0;">\n  <div style="max-width: 600px; margin: 20px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">\n    <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 30px 20px; text-align: center;">\n      <h1 style="margin: 0; font-size: 24px;">&#128295; Repair Request</h1>\n      <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 14px;">Service Required for Device</p>\n    </div>\n    <div style="padding: 30px 20px;">\n      <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin-bottom: 20px; border-radius: 0 8px 8px 0; white-space: pre-wrap; font-size: 14px;">{{message}}</div>\n      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px;">\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Device Name</div><div style="font-size: 14px; font-weight: 600; color: #1e293b;">{{deviceName}}</div></div>\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Model</div><div style="font-size: 14px; font-weight: 600; color: #1e293b;">{{model}}</div></div>\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">IP Address</div><div style="font-size: 14px; font-weight: 600; color: #1e293b; font-family: monospace;">{{ip}}</div></div>\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Location</div><div style="font-size: 14px; font-weight: 600; color: #1e293b;">{{location}}</div></div>\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Machine ID</div><div style="font-size: 14px; font-weight: 600; color: #1e293b; font-family: monospace;">{{machineId}}</div></div>\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Serial Number</div><div style="font-size: 14px; font-weight: 600; color: #1e293b; font-family: monospace;">{{serialNumber}}</div></div>\n      </div>\n      <div style="margin-top: 20px;"><h3 style="margin-bottom: 15px; font-size: 16px; color: #374151;">Current Supply Levels</h3>{{supplyLevels}}</div>\n    </div>\n    <div style="background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">\n      <p style="margin: 5px 0;"><strong>{{schoolName}}</strong></p>\n      <p style="margin: 5px 0;">Automated repair request generated on {{dateTime}}</p>\n    </div>\n  </div>\n</body>\n</html>';
}

function generateManufacturerHtmlEmail(device, message) {
  try {
    const emailTemplatesService = require('./emailTemplates');
    var template = emailTemplatesService.getEmailTemplateByType('manufacturer');
    if (template && template.htmlBody) {
      var variables = buildManufacturerVariables(device, message);
      var processed = emailTemplatesService.processEmailTemplate(template, variables);
      return processed.body;
    }
  } catch (e) {}
  var vars = buildManufacturerVariables(device, message);
  var html = getDefaultManufacturerTemplate();
  for (var k in vars) html = html.split('{{' + k + '}}').join(vars[k]);
  return html;
}

async function sendManufacturerEmail(deviceId, manufacturerEmail, message, cc, customSubject) {
  try {
    const devicesService = require('./devices');
    const device = devicesService.getDeviceById(deviceId);
    if (!device) return { success: false, error: 'Device not found' };
    if (!manufacturerEmail) return { success: false, error: 'Manufacturer email is required' };

    var htmlBody = generateManufacturerHtmlEmail(device, message);
    var subject = customSubject || 'Repair Request: ' + device.name + ' - ' + (device.model || 'Device');

    await sendEmail(manufacturerEmail, subject, message, htmlBody, { cc });

    db.insert('email_history', {
      id: db.generateId(), deviceId, recipient: manufacturerEmail, cc: cc || '',
      subject, body: message, htmlBody, sentAt: new Date().toISOString(), status: 'sent', errorMessage: ''
    });

    return { success: true, message: 'Repair request sent successfully' };
  } catch (error) { return { success: false, error: error.message }; }
}

function previewManufacturerEmail(deviceId, message) {
  try {
    const devicesService = require('./devices');
    var device = devicesService.getDeviceById(deviceId);
    if (!device) return { success: false, error: 'Device not found' };
    return { success: true, html: generateManufacturerHtmlEmail(device, message || '') };
  } catch (error) { return { success: false, error: error.message }; }
}

function getEmailHistory(deviceId) {
  try {
    let all = db.getAll('email_history');
    if (deviceId) all = all.filter(e => e.deviceId === deviceId);
    all.sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));
    return { success: true, emails: all.map(e => ({ id: e.id, deviceId: e.deviceId, recipient: e.recipient, cc: e.cc || '', subject: e.subject, body: e.body, sentAt: e.sentAt, status: e.status })) };
  } catch (error) { return { success: false, error: error.message }; }
}

function getEmailById(emailId) {
  try {
    const email = db.getById('email_history', emailId);
    if (!email) return { success: false, error: 'Email not found' };
    return { success: true, email };
  } catch (error) { return { success: false, error: error.message }; }
}

function deleteEmailHistoryRecord(emailId) {
  try {
    const result = db.deleteById('email_history', emailId);
    if (result.changes > 0) return { success: true };
    return { success: false, error: 'Email record not found' };
  } catch (error) { return { success: false, error: error.message }; }
}

function deleteAllEmailHistory() {
  try { db.deleteAll('email_history'); return { success: true }; }
  catch (error) { return { success: false, error: error.message }; }
}

function testEmailAuthorization() {
  try {
    const transporter = getTransporter();
    if (!transporter) return { success: false, error: 'SMTP not configured' };
    return { success: true, message: 'SMTP transporter configured' };
  } catch (error) { return { success: false, error: error.message }; }
}

async function testSmtpConnection() {
  try {
    const transporter = getTransporter();
    if (!transporter) return { success: false, error: 'SMTP not configured. Enter SMTP Host, Username, and Password.' };
    await transporter.verify();
    return { success: true, message: 'SMTP connection verified successfully' };
  } catch (error) {
    let msg = error.message || 'Unknown error';
    if (msg.includes('ENOTFOUND')) msg = 'SMTP host not found. Check the hostname.';
    else if (msg.includes('ECONNREFUSED')) msg = 'Connection refused. Check host and port.';
    else if (msg.includes('Invalid login') || msg.includes('535') || msg.includes('Authentication')) msg = 'Authentication failed. Check username and password.';
    else if (msg.includes('ETIMEDOUT')) msg = 'Connection timed out. Check host and port, or try a different network.';
    return { success: false, error: msg };
  }
}

module.exports = {
  sendDeviceEmail, sendManufacturerEmail, previewManufacturerEmail,
  getEmailHistory, getEmailById, deleteEmailHistoryRecord, deleteAllEmailHistory,
  generateHtmlEmail, sendEmail, testEmailAuthorization, testSmtpConnection, generateManufacturerHtmlEmail,
  buildManufacturerVariables, getDefaultManufacturerTemplate
};
