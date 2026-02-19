const db = require('../database/db');

function createComputerRepair(data) {
  try {
    const now = new Date().toISOString();
    const repair = {
      id: db.generateId(),
      employeeId: data.employeeId || '',
      employeeName: data.employeeName || '',
      employeeEmail: data.employeeEmail || '',
      roomNumber: data.roomNumber || '',
      serialNumber: data.serialNumber || '',
      computerModel: data.computerModel || '',
      manufacturer: data.manufacturer || '',
      warrantyDate: data.warrantyDate || '',
      warrantyStatus: data.warrantyStatus || 'unknown',
      assetTag: data.assetTag || '',
      shortDescription: data.shortDescription || '',
      description: data.description || '',
      category: data.category || '',
      subcategory: data.subcategory || '',
      channel: data.channel || '',
      impact: data.impact || '',
      userType: data.userType || '',
      snowIncidentNumber: data.snowIncidentNumber || '',
      snowUrl: data.snowUrl || '',
      repairStatus: data.repairStatus || 'pending',
      emailStatus: 'not-sent',
      emailSentAt: '',
      photoDataUrl: data.photoDataUrl || '',
      createdAt: now,
      updatedAt: now,
      isQuickTicket: data.isQuickTicket ? 1 : 0
    };
    db.insert('computer_repairs', repair);
    return { success: true, repair };
  } catch (error) { return { success: false, error: error.message }; }
}

function getComputerRepairs(limit) {
  try {
    let sql = 'SELECT * FROM computer_repairs ORDER BY createdAt DESC';
    if (limit) sql += ' LIMIT ' + parseInt(limit);
    return db.query(sql);
  } catch (error) { return []; }
}

function getComputerRepairById(repairId) {
  try { return db.getById('computer_repairs', repairId) || null; }
  catch (error) { return null; }
}

function updateComputerRepairField(repairId, fieldName, value) {
  try {
    const now = new Date().toISOString();
    const obj = {};
    obj[fieldName] = value;
    obj.updatedAt = now;
    db.update('computer_repairs', repairId, obj);
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

function buildComputerRepairEmailHtml(repair) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0">
<div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
<div style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);color:white;padding:30px 20px;text-align:center">
<h1 style="margin:0;font-size:24px">Computer Repair Request</h1></div>
<div style="padding:30px 20px">
<div style="background:#f8fafc;padding:20px;border-radius:8px;margin-bottom:20px">
<div style="margin-bottom:10px"><strong>Employee:</strong> ${repair.employeeName || 'N/A'} (${repair.employeeId || 'N/A'})</div>
<div style="margin-bottom:10px"><strong>Room:</strong> ${repair.roomNumber || 'N/A'}</div>
<div style="margin-bottom:10px"><strong>Computer:</strong> ${repair.manufacturer || ''} ${repair.computerModel || 'N/A'}</div>
<div style="margin-bottom:10px"><strong>Serial:</strong> ${repair.serialNumber || 'N/A'}</div>
<div style="margin-bottom:10px"><strong>Asset Tag:</strong> ${repair.assetTag || 'N/A'}</div>
<div style="margin-bottom:10px"><strong>Warranty:</strong> ${repair.warrantyStatus || 'N/A'} ${repair.warrantyDate ? '(' + repair.warrantyDate + ')' : ''}</div>
<div style="margin-bottom:10px"><strong>Category:</strong> ${repair.category || 'N/A'} / ${repair.subcategory || 'N/A'}</div>
</div>
<div style="margin-bottom:20px"><strong>Description:</strong><div style="background:#f1f5f9;padding:15px;border-radius:8px;margin-top:8px;white-space:pre-wrap">${repair.shortDescription || ''}\n\n${repair.description || ''}</div></div>
${repair.snowIncidentNumber ? '<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:15px;border-radius:0 8px 8px 0"><strong>ServiceNow:</strong> ' + repair.snowIncidentNumber + '</div>' : ''}
</div>
<div style="background:#f8fafc;padding:15px;text-align:center;font-size:12px;color:#64748b">
<p>Smart School Monitor - ${new Date().toLocaleString()}</p></div></div></body></html>`;
}

async function sendComputerRepairEmail(repairId) {
  try {
    const repair = db.getById('computer_repairs', repairId);
    if (!repair) return { success: false, error: 'Repair not found' };

    const settingsService = require('./settings');
    const emailService = require('./email');
    const config = settingsService.getEmailConfig();
    if (!config.companyEmail) return { success: false, error: 'Company email not configured' };

    const subject = 'Computer Repair: ' + (repair.shortDescription || 'New Repair Request');
    const html = buildComputerRepairEmailHtml(repair);
    await emailService.sendEmail(config.companyEmail, subject, repair.description || '', html);

    db.update('computer_repairs', repairId, { emailStatus: 'sent', emailSentAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

async function queueComputerRepairEmail(repairId) {
  try {
    const repair = db.getById('computer_repairs', repairId);
    if (!repair) return { success: false, error: 'Repair not found' };

    const settingsService = require('./settings');
    const config = settingsService.getEmailConfig();
    if (!config.companyEmail) return { success: false, error: 'Company email not configured' };

    const now = new Date().toISOString();
    db.insert('email_queue', {
      id: db.generateId(), incidentId: repairId, to: config.companyEmail,
      subject: 'Computer Repair: ' + (repair.shortDescription || 'New Repair Request'),
      body: buildComputerRepairEmailHtml(repair),
      status: 'pending', scheduledAt: now, sentAt: '', createdAt: now, error: ''
    });

    db.update('computer_repairs', repairId, { emailStatus: 'queued', updatedAt: now });
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

function getRepairTemplates() {
  try { return db.query("SELECT * FROM repair_templates WHERE active = 1 ORDER BY sortOrder ASC"); }
  catch (error) { return []; }
}

function saveRepairTemplate(template) {
  try {
    const now = new Date().toISOString();
    const data = {
      id: template.id || db.generateId(),
      name: template.name || '', icon: template.icon || '',
      shortDescription: template.shortDescription || '', description: template.description || '',
      channel: template.channel || '', category: template.category || '',
      subcategory: template.subcategory || '', serviceOffering: template.serviceOffering || '',
      manufacturer: template.manufacturer || '', model: template.model || '',
      assetLocation: template.assetLocation || '', impact: template.impact || '',
      userType: template.userType || '',
      requiresSerial: template.requiresSerial ? 1 : 0,
      requiresPhoto: template.requiresPhoto ? 1 : 0,
      sortOrder: template.sortOrder || 0,
      active: template.active !== false ? 1 : 0,
      createdAt: template.createdAt || now, updatedAt: now
    };
    db.upsert('repair_templates', data);
    return { success: true, template: data };
  } catch (error) { return { success: false, error: error.message }; }
}

function deleteRepairTemplate(templateId) {
  try {
    const result = db.deleteById('repair_templates', templateId);
    if (result.changes > 0) return { success: true };
    return { success: false, error: 'Template not found' };
  } catch (error) { return { success: false, error: error.message }; }
}

module.exports = {
  createComputerRepair, getComputerRepairs, getComputerRepairById,
  updateComputerRepairField, sendComputerRepairEmail, queueComputerRepairEmail,
  buildComputerRepairEmailHtml, getRepairTemplates, saveRepairTemplate, deleteRepairTemplate
};
