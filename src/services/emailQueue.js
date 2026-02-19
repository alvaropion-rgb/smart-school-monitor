const db = require('../database/db');

async function processEmailQueue() {
  try {
    const pending = db.query("SELECT * FROM email_queue WHERE status = 'pending' ORDER BY createdAt ASC");
    let sent = 0, failed = 0;

    const emailService = require('./email');

    for (const item of pending) {
      try {
        await emailService.sendEmail(item.to, item.subject, '', item.body);
        db.update('email_queue', item.id, { status: 'sent', sentAt: new Date().toISOString() });

        // Update incident status if linked
        if (item.incidentId) {
          const incident = db.getById('incidents', item.incidentId);
          if (incident) db.update('incidents', item.incidentId, { emailStatus: 'sent', emailSentAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        }
        sent++;
      } catch (e) {
        db.update('email_queue', item.id, { status: 'failed', error: e.message });
        failed++;
      }
    }

    return { success: true, sent, failed, total: pending.length };
  } catch (error) { return { success: false, error: error.message }; }
}

function getEmailQueue() {
  try { return db.query("SELECT * FROM email_queue ORDER BY createdAt DESC"); }
  catch (error) { return []; }
}

module.exports = { processEmailQueue, getEmailQueue };
