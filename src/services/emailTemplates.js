const db = require('../database/db');

function getEmailTemplates() {
  try { return db.getAll('email_templates'); }
  catch (error) { return []; }
}

function getEmailTemplateByType(templateType) {
  try {
    return db.queryOne("SELECT * FROM email_templates WHERE type = ? AND active = 1", [templateType]) || null;
  } catch (error) { return null; }
}

function saveEmailTemplate(template) {
  try {
    const now = new Date().toISOString();
    const data = {
      id: template.id || db.generateId(),
      name: template.name || '',
      type: template.type || '',
      subject: template.subject || '',
      htmlBody: template.htmlBody || '',
      active: template.active !== false ? 1 : 0,
      createdAt: template.createdAt || now,
      updatedAt: now
    };
    db.upsert('email_templates', data);
    return { success: true, template: data };
  } catch (error) { return { success: false, error: error.message }; }
}

function deleteEmailTemplate(templateId) {
  try {
    const result = db.deleteById('email_templates', templateId);
    if (result.changes > 0) return { success: true };
    return { success: false, error: 'Template not found' };
  } catch (error) { return { success: false, error: error.message }; }
}

function processEmailTemplate(template, variables) {
  try {
    let subject = template.subject || '';
    let body = template.htmlBody || '';
    for (const [key, value] of Object.entries(variables || {})) {
      const placeholder = '{{' + key + '}}';
      subject = subject.split(placeholder).join(value || '');
      body = body.split(placeholder).join(value || '');
    }
    return { subject, body };
  } catch (error) { return { subject: template.subject || '', body: template.htmlBody || '' }; }
}

module.exports = { getEmailTemplates, getEmailTemplateByType, saveEmailTemplate, deleteEmailTemplate, processEmailTemplate };
