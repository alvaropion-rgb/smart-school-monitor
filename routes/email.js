const express = require('express');
const router = express.Router();
const db = require('../db/database');

// Try to load email service (may not be configured)
let emailService;
try { emailService = require('../services/emailService'); } catch (e) {}

// ============================================
// EMAIL CONFIGURATION
// ============================================

router.post('/getEmailConfig', (req, res) => {
  try {
    const rows = db.getAll('email_config');
    const config = {};
    rows.forEach(row => {
      config[row.key] = row.value;
    });
    res.json(config);
  } catch (error) {
    console.error('Error getting email config:', error);
    res.json({});
  }
});

router.post('/saveEmailConfig', (req, res) => {
  try {
    const [config] = req.body.args || [];
    for (const [key, value] of Object.entries(config)) {
      db.setEmailConfigValue(key, value);
    }
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// DEVICE EMAIL
// ============================================

router.post('/sendDeviceEmail', (req, res) => {
  try {
    const [deviceId, customMessage] = req.body.args || [];

    const device = db.getById('devices', deviceId);
    if (!device) {
      return res.json({ success: false, error: 'Device not found' });
    }

    // Parse supplies JSON if stored as string
    if (typeof device.supplies === 'string') {
      try { device.supplies = JSON.parse(device.supplies); } catch (e) { device.supplies = []; }
    }

    const config = {};
    db.getAll('email_config').forEach(r => { config[r.key] = r.value; });

    if (!config.companyEmail) {
      return res.json({ success: false, error: 'Company email not configured' });
    }

    const subject = config.emailSubject || 'Printer Issue Report';
    const htmlBody = generateHtmlEmail(device, customMessage);

    // Build plain text body
    const supplyText = (device.supplies || []).map(s => `  - ${s.name}: ${s.percentage}%`).join('\n') || '  No supply data';
    let emailBody = (config.emailTemplate || '')
      .replace(/{PRINTER_INFO}/g, `Device Name: ${device.name}\nIP Address: ${device.ip}\nModel: ${device.model || 'N/A'}\nLocation: ${device.location || 'N/A'}\nStatus: ${device.status}\nLast Seen: ${device.lastSeen || 'N/A'}\n\nSupply Levels:\n${supplyText}`)
      .replace(/{DEVICE_NAME}/g, device.name)
      .replace(/{DEVICE_IP}/g, device.ip)
      .replace(/{DEVICE_LOCATION}/g, device.location || 'N/A')
      .replace(/{TIMESTAMP}/g, new Date().toLocaleString());

    if (customMessage) {
      emailBody = customMessage + '\n\n' + emailBody;
    }

    // Send via emailService if configured
    if (emailService && emailService.sendEmail) {
      try {
        emailService.sendEmail({
          to: config.companyEmail,
          subject: subject,
          text: emailBody,
          html: htmlBody
        });
      } catch (sendErr) {
        console.warn('Email sending not configured or failed:', sendErr.message);
      }
    } else {
      console.warn('Email service not configured - email not actually sent');
    }

    // Log to email_history
    const historyRecord = {
      id: db.generateId(),
      deviceId: deviceId,
      recipient: config.companyEmail,
      cc: '',
      subject: subject,
      body: emailBody,
      htmlBody: '',
      sentAt: new Date().toISOString(),
      status: 'sent',
      errorMessage: ''
    };
    db.insert('email_history', historyRecord);

    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error('Error sending device email:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// MANUFACTURER EMAIL
// ============================================

router.post('/sendManufacturerEmail', (req, res) => {
  try {
    const [deviceId, manufacturerEmail, message, cc, customSubject] = req.body.args || [];

    const device = db.getById('devices', deviceId);
    if (!device) {
      return res.json({ success: false, error: 'Device not found' });
    }

    if (!manufacturerEmail) {
      return res.json({ success: false, error: 'Manufacturer email is required' });
    }

    // Parse supplies JSON if stored as string
    if (typeof device.supplies === 'string') {
      try { device.supplies = JSON.parse(device.supplies); } catch (e) { device.supplies = []; }
    }

    const htmlBody = generateManufacturerHtmlEmail(device, message);

    // Build subject: use custom if provided, then try template, then fallback
    let subject = customSubject;
    if (!subject) {
      try {
        const tpl = getEmailTemplateByType('manufacturer');
        if (tpl && tpl.subject) {
          const vars = buildManufacturerVariables(device, message);
          subject = tpl.subject;
          for (const vk in vars) {
            subject = subject.split('{{' + vk + '}}').join(vars[vk]);
          }
        }
      } catch (e) { /* ignore */ }
    }
    if (!subject) {
      subject = 'Repair Request: ' + device.name + ' - ' + (device.model || 'Device');
    }

    // Send via emailService if configured
    if (emailService && emailService.sendEmail) {
      try {
        emailService.sendEmail({
          to: manufacturerEmail,
          cc: cc || undefined,
          subject: subject,
          text: message,
          html: htmlBody
        });
      } catch (sendErr) {
        console.warn('Email sending not configured or failed:', sendErr.message);
      }
    } else {
      console.warn('Email service not configured - email not actually sent');
    }

    // Log to email_history
    const now = new Date().toISOString();
    const historyRecord = {
      id: db.generateId(),
      deviceId: deviceId,
      recipient: manufacturerEmail,
      cc: cc || '',
      subject: subject,
      body: message,
      htmlBody: htmlBody,
      sentAt: now,
      status: 'sent',
      errorMessage: ''
    };
    db.insert('email_history', historyRecord);

    // Update device with manufacturer email for future reference
    db.updateField('devices', deviceId, 'manufacturerEmail', manufacturerEmail);

    res.json({ success: true, message: 'Repair request sent successfully' });
  } catch (error) {
    console.error('Error sending manufacturer email:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/previewManufacturerEmail', (req, res) => {
  try {
    const [deviceId, message] = req.body.args || [];

    const device = db.getById('devices', deviceId);
    if (!device) {
      return res.json({ success: false, error: 'Device not found' });
    }

    // Parse supplies JSON if stored as string
    if (typeof device.supplies === 'string') {
      try { device.supplies = JSON.parse(device.supplies); } catch (e) { device.supplies = []; }
    }

    const html = generateManufacturerHtmlEmail(device, message || '');
    res.json({ success: true, html: html });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// EMAIL HISTORY
// ============================================

router.post('/getEmailHistory', (req, res) => {
  try {
    const [deviceId] = req.body.args || [];
    let all = db.getAll('email_history');

    if (deviceId) {
      all = all.filter(e => e.deviceId === deviceId);
    }

    // Sort newest first
    all.sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));

    // Strip htmlBody to reduce payload
    all = all.map(e => ({
      id: e.id,
      deviceId: e.deviceId,
      recipient: e.recipient,
      cc: e.cc || '',
      subject: e.subject,
      body: e.body,
      sentAt: e.sentAt,
      status: e.status
    }));

    res.json({ success: true, emails: all });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

router.post('/getEmailById', (req, res) => {
  try {
    const [emailId] = req.body.args || [];
    const email = db.getById('email_history', emailId);
    if (!email) {
      return res.json({ success: false, error: 'Email not found' });
    }
    res.json({ success: true, email: email });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

router.post('/deleteEmailHistoryRecord', (req, res) => {
  try {
    const [emailId] = req.body.args || [];
    const existing = db.getById('email_history', emailId);
    if (!existing) {
      return res.json({ success: false, error: 'Email record not found' });
    }
    db.remove('email_history', emailId);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

router.post('/deleteAllEmailHistory', (req, res) => {
  try {
    const countBefore = db.count('email_history');
    db.clearTable('email_history');
    res.json({ success: true, deleted: countBefore });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// EMAIL TEMPLATES
// ============================================

router.post('/getEmailTemplates', (req, res) => {
  try {
    const templates = db.getAll('email_templates');
    res.json(templates);
  } catch (error) {
    console.error('Error getting email templates:', error);
    res.json([]);
  }
});

router.post('/saveEmailTemplate', (req, res) => {
  try {
    const [template] = req.body.args || [];
    const now = new Date().toISOString();

    if (template.id) {
      // Check if exists
      const existing = db.getById('email_templates', template.id);
      if (existing) {
        db.update('email_templates', template.id, {
          name: template.name,
          type: template.type,
          subject: template.subject,
          htmlBody: template.htmlBody,
          active: template.active !== false ? 'true' : 'false',
          updatedAt: now
        });
        return res.json({ success: true, template: { ...template, updatedAt: now } });
      }
    }

    // Create new
    const newTemplate = {
      id: db.generateId(),
      name: template.name,
      type: template.type,
      subject: template.subject,
      htmlBody: template.htmlBody,
      active: template.active !== false ? 'true' : 'false',
      createdAt: now,
      updatedAt: now
    };
    db.insert('email_templates', newTemplate);
    res.json({ success: true, template: newTemplate });
  } catch (error) {
    console.error('Error saving email template:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/deleteEmailTemplate', (req, res) => {
  try {
    const [templateId] = req.body.args || [];
    const existing = db.getById('email_templates', templateId);
    if (!existing) {
      return res.json({ success: false, error: 'Template not found' });
    }
    db.remove('email_templates', templateId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting email template:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/processEmailTemplate', (req, res) => {
  try {
    const [template, variables] = req.body.args || [];

    let subject = template.subject;
    let body = template.htmlBody;

    // Replace all {{variable}} placeholders
    for (const key in variables) {
      const placeholder = '{{' + key + '}}';
      const value = variables[key] || '';
      subject = subject.split(placeholder).join(value);
      body = body.split(placeholder).join(value);
    }

    // Handle conditional sections like {{#afterHoursSection}}...{{/afterHoursSection}}
    if (variables.showAfterHours) {
      body = body.replace(/\{\{#afterHoursSection\}\}/g, '');
      body = body.replace(/\{\{\/afterHoursSection\}\}/g, '');
    } else {
      // Remove the entire after-hours section
      body = body.replace(/\{\{#afterHoursSection\}\}[\s\S]*?\{\{\/afterHoursSection\}\}/g, '');
    }

    res.json({ subject: subject, body: body });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// ============================================
// EMAIL QUEUE
// ============================================

router.post('/getEmailQueue', (req, res) => {
  try {
    let items = db.getAll('email_queue');
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, items: items });
  } catch (error) {
    console.error('Error getting email queue:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/processEmailQueue', (req, res) => {
  try {
    const items = db.getAll('email_queue');
    const pending = items.filter(item => item.status === 'pending');

    if (pending.length === 0) {
      return res.json({ success: true, processed: 0, message: 'Queue is empty' });
    }

    let processed = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        if (emailService && emailService.sendEmail) {
          emailService.sendEmail({
            to: item.toAddr,
            subject: item.subject,
            html: item.body
          });
        } else {
          console.warn('Email service not configured - email not actually sent');
        }

        db.update('email_queue', item.id, {
          sentAt: new Date().toISOString(),
          status: 'sent'
        });

        // Update associated incident if exists
        if (item.incidentId) {
          try {
            db.updateField('incidents', item.incidentId, 'emailStatus', 'sent');
            db.updateField('incidents', item.incidentId, 'emailSentAt', new Date().toISOString());
          } catch (e) { /* ignore if incident doesn't exist */ }
        }

        processed++;
      } catch (sendError) {
        db.update('email_queue', item.id, {
          status: 'failed',
          error: sendError.message
        });
        failed++;
      }
    }

    res.json({
      success: true,
      processed: processed,
      failed: failed,
      message: processed + ' emails sent, ' + failed + ' failed'
    });
  } catch (error) {
    console.error('Error processing email queue:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// HTML EMAIL GENERATION HELPERS
// ============================================

function generateHtmlEmail(device, customMessage) {
  const supplies = device.supplies || [];
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { padding: 30px 20px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .info-item { }
    .info-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .info-value { font-size: 14px; font-weight: 600; color: #1e293b; }
    .supply-item { margin-bottom: 12px; }
    .supply-header { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
    .supply-bar { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
    .supply-fill { height: 100%; border-radius: 4px; }
    .supply-high { background: linear-gradient(90deg, #22c55e, #16a34a); }
    .supply-medium { background: linear-gradient(90deg, #f59e0b, #d97706); }
    .supply-low { background: linear-gradient(90deg, #ef4444, #dc2626); }
    .footer { background: #f8fafc; padding: 15px; text-align: center; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Device Alert</h1>
      <p style="margin: 5px 0 0 0; opacity: 0.9;">Smart School Monitor</p>
    </div>
    <div class="content">
      ${customMessage ? `<div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin-bottom: 20px; border-radius: 4px;">${customMessage}</div>` : ''}

      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Device Name</div>
          <div class="info-value">${device.name}</div>
        </div>
        <div class="info-item">
          <div class="info-label">IP Address</div>
          <div class="info-value" style="font-family: monospace;">${device.ip}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Model</div>
          <div class="info-value">${device.model || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Location</div>
          <div class="info-value">${device.location || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Status</div>
          <div class="info-value" style="text-transform: capitalize;">${device.status}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Last Seen</div>
          <div class="info-value">${device.lastSeen ? new Date(device.lastSeen).toLocaleString() : 'N/A'}</div>
        </div>
      </div>

      ${supplies.length > 0 ? `
        <h3 style="margin-bottom: 15px; font-size: 16px;">Supply Levels</h3>
        ${supplies.map(s => `
          <div class="supply-item">
            <div class="supply-header">
              <span>${s.name}</span>
              <span style="font-weight: 600; color: ${s.percentage > 50 ? '#16a34a' : s.percentage > 20 ? '#d97706' : '#dc2626'};">${s.percentage}%</span>
            </div>
            <div class="supply-bar">
              <div class="supply-fill ${s.percentage > 50 ? 'supply-high' : s.percentage > 20 ? 'supply-medium' : 'supply-low'}" style="width: ${s.percentage}%;"></div>
            </div>
          </div>
        `).join('')}
      ` : ''}
    </div>
    <div class="footer">
      <p>Automated notification from Smart School Monitor</p>
      <p>Generated on ${new Date().toLocaleString()}</p>
    </div>
  </div>
</body>
</html>`;
}

function buildManufacturerVariables(device, message) {
  let supplies = '';
  if (device.supplies && device.supplies.length > 0) {
    supplies = device.supplies.map(s => {
      const color = s.percentage > 50 ? '#16a34a' : s.percentage > 20 ? '#d97706' : '#dc2626';
      return '<div style="margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">' +
        '<span>' + s.name + '</span>' +
        '<span style="font-weight:600;color:' + color + ';">' + s.percentage + '%</span>' +
        '</div>' +
        '<div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;">' +
        '<div style="height:100%;border-radius:4px;width:' + s.percentage + '%;background:' + color + ';"></div>' +
        '</div></div>';
    }).join('');
  }

  const statusColor = device.status === 'online' ? '#16a34a' : device.status === 'offline' ? '#dc2626' : '#d97706';

  return {
    deviceName: device.name || '',
    model: device.model || 'N/A',
    ip: device.ip || '',
    location: device.location || 'N/A',
    deviceType: device.type || 'printer',
    status: device.status || 'unknown',
    statusColor: statusColor,
    machineId: device.machineId || 'N/A',
    serialNumber: device.serialNumber || 'N/A',
    message: (message || '').replace(/\n/g, '<br>'),
    supplyLevels: supplies || '<p style="color:#94a3b8;">No supply data available.</p>',
    dateTime: new Date().toLocaleString(),
    schoolName: 'Smart School Monitor'
  };
}

function getDefaultManufacturerTemplate() {
  return '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n</head>\n<body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; margin: 0; padding: 0;">\n  <div style="max-width: 600px; margin: 20px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">\n    <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 30px 20px; text-align: center;">\n      <h1 style="margin: 0; font-size: 24px;">&#128295; Repair Request</h1>\n      <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 14px;">Service Required for Device</p>\n      <span style="display: inline-block; background: #fef2f2; color: #dc2626; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-top: 10px;">&#9888;&#65039; REQUIRES ATTENTION</span>\n    </div>\n    <div style="padding: 30px 20px;">\n      <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin-bottom: 20px; border-radius: 0 8px 8px 0; white-space: pre-wrap; font-size: 14px;">{{message}}</div>\n\n      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px;">\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Device Name</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b;">{{deviceName}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Model</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b;">{{model}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">IP Address</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b; font-family: monospace;">{{ip}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Location</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b;">{{location}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Machine ID</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b; font-family: monospace;">{{machineId}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Serial Number</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b; font-family: monospace;">{{serialNumber}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Device Type</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b; text-transform: capitalize;">{{deviceType}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Current Status</div>\n          <div style="font-size: 14px; font-weight: 600; color: {{statusColor}}; text-transform: capitalize;">{{status}}</div>\n        </div>\n      </div>\n\n      <div style="margin-top: 20px;">\n        <h3 style="margin-bottom: 15px; font-size: 16px; color: #374151;">&#128202; Current Supply Levels</h3>\n        {{supplyLevels}}\n      </div>\n\n      <div style="background: #f0f9ff; border: 1px solid #bae6fd; padding: 15px; border-radius: 8px; margin-top: 20px;">\n        <h4 style="margin: 0 0 10px 0; color: #0369a1; font-size: 14px;">&#128231; Contact Information</h4>\n        <p style="margin: 0; font-size: 13px; color: #475569;">Please respond to this email to coordinate repair/service scheduling.</p>\n      </div>\n    </div>\n    <div style="background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">\n      <p style="margin: 5px 0;"><strong>{{schoolName}}</strong></p>\n      <p style="margin: 5px 0;">Automated repair request generated on {{dateTime}}</p>\n      <p style="font-size: 11px; color: #94a3b8; margin: 5px 0;">This is an automated message from the school\'s network monitoring system.</p>\n    </div>\n  </div>\n</body>\n</html>';
}

function getEmailTemplateByType(templateType) {
  try {
    const templates = db.getAll('email_templates');
    return templates.find(t => t.type === templateType && t.active !== false && t.active !== 'false') || null;
  } catch (error) {
    console.error('Error getting email template by type:', error);
    return null;
  }
}

function generateManufacturerHtmlEmail(device, message) {
  // Try to use a saved manufacturer template first
  try {
    const template = getEmailTemplateByType('manufacturer');
    if (template && template.htmlBody) {
      const variables = buildManufacturerVariables(device, message);
      const processed = processTemplate(template, variables);
      return processed.body;
    }
  } catch (e) {
    console.error('Error loading manufacturer template, using default:', e);
  }
  // Fallback to built-in template
  return generateDefaultManufacturerHtml(device, message);
}

function generateDefaultManufacturerHtml(device, message) {
  const vars = buildManufacturerVariables(device, message);
  return getDefaultManufacturerTemplate()
    .split('{{message}}').join(vars.message)
    .split('{{deviceName}}').join(vars.deviceName)
    .split('{{model}}').join(vars.model)
    .split('{{ip}}').join(vars.ip)
    .split('{{location}}').join(vars.location)
    .split('{{deviceType}}').join(vars.deviceType)
    .split('{{status}}').join(vars.status)
    .split('{{statusColor}}').join(vars.statusColor)
    .split('{{machineId}}').join(vars.machineId)
    .split('{{serialNumber}}').join(vars.serialNumber)
    .split('{{supplyLevels}}').join(vars.supplyLevels)
    .split('{{dateTime}}').join(vars.dateTime)
    .split('{{schoolName}}').join(vars.schoolName);
}

function processTemplate(template, variables) {
  let subject = template.subject;
  let body = template.htmlBody;

  for (const key in variables) {
    const placeholder = '{{' + key + '}}';
    const value = variables[key] || '';
    subject = subject.split(placeholder).join(value);
    body = body.split(placeholder).join(value);
  }

  if (variables.showAfterHours) {
    body = body.replace(/\{\{#afterHoursSection\}\}/g, '');
    body = body.replace(/\{\{\/afterHoursSection\}\}/g, '');
  } else {
    body = body.replace(/\{\{#afterHoursSection\}\}[\s\S]*?\{\{\/afterHoursSection\}\}/g, '');
  }

  return { subject, body };
}

module.exports = router;
