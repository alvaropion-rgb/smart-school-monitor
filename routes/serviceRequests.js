/**
 * Service Requests Routes - Ported from Code.gs
 * Handles QR-based service requests, assignment, completion, and the request page data.
 */
const express = require('express');
const router = express.Router();
const { db, generateId, getAll, getById, getByColumn, insert, update, updateField, remove, clearTable } = require('../db/database');
const { sendEmail } = require('../services/emailService');
const config = require('../config');

// Import shared helpers from settings route
let settingsHelpers = null;
function getSettingsHelpers() {
  if (!settingsHelpers) {
    settingsHelpers = require('./settings');
  }
  return settingsHelpers;
}

// ============================================
// GET / LIST
// ============================================

/**
 * getServiceRequests - Get all service requests, merge with incidents, sort by date DESC, optional limit
 * Args: [limit]
 */
router.post('/getServiceRequests', (req, res) => {
  try {
    const [limit] = req.body.args || [];

    // Pull from service_requests table (QR-based)
    let requests = getAll('service_requests').map(r => ({ ...r, source: 'qr' }));

    // Also pull from incidents table (Help Desk) and normalize
    try {
      const incidents = getAll('incidents');
      incidents.forEach(inc => {
        // Map incident status to service request status
        let srStatus = 'pending';
        if (inc.status === 'closed' || inc.status === 'resolved') srStatus = 'completed';
        else if (inc.status === 'in-progress' || inc.status === 'assigned') srStatus = 'in-progress';
        else if (inc.status === 'open' || inc.status === 'new') srStatus = 'pending';
        else srStatus = inc.status || 'pending';

        requests.push({
          id: inc.id,
          deviceId: '',
          deviceName: inc.roomNumber || '',
          deviceType: '',
          location: inc.roomNumber || '',
          blueprintId: '',
          issueType: inc.category || '',
          issueLabel: inc.shortDescription || inc.subcategory || '',
          employeeId: inc.employeeId || '',
          employeeName: inc.employeeName || '',
          employeeEmail: inc.employeeEmail || '',
          technicianId: '',
          technicianName: '',
          status: srStatus,
          notes: inc.description || '',
          submittedAt: inc.createdAt || '',
          assignedAt: '',
          completedAt: (inc.status === 'closed' || inc.status === 'resolved') ? (inc.updatedAt || '') : '',
          createdAt: inc.createdAt || '',
          updatedAt: inc.updatedAt || '',
          source: 'helpdesk',
          channel: inc.channel || '',
          snowIncidentNumber: inc.snowIncidentNumber || '',
          category: inc.category || '',
          subcategory: inc.subcategory || ''
        });
      });
    } catch (e) {
      console.error('Error loading incidents into service requests:', e);
    }

    // Sort by date descending
    requests.sort((a, b) => {
      return new Date(b.submittedAt || b.createdAt || 0) - new Date(a.submittedAt || a.createdAt || 0);
    });

    if (limit) {
      requests = requests.slice(0, parseInt(limit, 10));
    }

    res.json(requests);
  } catch (error) {
    console.error('Error getting service requests:', error);
    res.json([]);
  }
});

// ============================================
// CREATE
// ============================================

/**
 * createServiceRequest - Create new request, send notification email
 * Args: [requestDataObj]
 */
router.post('/createServiceRequest', async (req, res) => {
  try {
    const [requestData] = req.body.args || [];
    const now = new Date().toISOString();

    // Look up device info
    const device = requestData.deviceId ? getById('devices', requestData.deviceId) : null;

    // Look up device type
    let deviceType = null;
    if (device) {
      const deviceTypes = getAll('device_types');
      const deviceTypeStr = String(device.type || '').toLowerCase().trim();
      deviceType = deviceTypes.find(t =>
        t.id === device.type ||
        String(t.id).toLowerCase() === deviceTypeStr ||
        String(t.name).toLowerCase() === deviceTypeStr
      );
    }

    // Look up employee info from teachers table
    let employee = null;
    if (requestData.employeeId) {
      const teachers = getAll('teachers');
      const searchId = String(requestData.employeeId).trim();
      employee = teachers.find(t => String(t.empId).trim() === searchId);
    }

    // Determine the email - prefer from requestData, fallback to teacher lookup
    const finalEmail = requestData.employeeEmail || (employee ? employee.email : '');

    const data = {
      id: generateId(),
      deviceId: (requestData.deviceId && requestData.deviceId !== 'undefined') ? requestData.deviceId : '',
      deviceName: device ? device.name : (requestData.deviceName || ''),
      deviceType: deviceType ? deviceType.name : (device ? device.type : ''),
      location: device ? device.location : (requestData.location || ''),
      blueprintId: device ? device.blueprintId : '',
      issueType: requestData.issueType || '',
      issueLabel: requestData.issueLabel || '',
      employeeId: requestData.employeeId || '',
      employeeName: employee ? employee.name : (requestData.employeeName || ''),
      employeeEmail: finalEmail,
      technicianId: '',
      technicianName: '',
      status: 'pending',
      notes: requestData.notes || '',
      submittedAt: now,
      assignedAt: '',
      completedAt: '',
      createdAt: now,
      updatedAt: now
    };

    insert('service_requests', data);

    // Send email notification (async, don't block response)
    sendServiceRequestNotification(data).catch(err => {
      console.error('Error sending service request notification:', err);
    });

    res.json({ success: true, request: data });
  } catch (error) {
    console.error('Error creating service request:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// ASSIGN / UNASSIGN / COMPLETE
// ============================================

/**
 * assignServiceRequest - Set technician, status='in-progress', assignedAt
 * Args: [requestId, technicianNameOrId]
 */
router.post('/assignServiceRequest', (req, res) => {
  try {
    const [requestId, technicianNameOrId] = req.body.args || [];
    const now = new Date().toISOString();

    // Look up technician info
    const technicians = getAll('technicians');
    let technician = technicians.find(t => t.id === technicianNameOrId);
    if (!technician) {
      technician = technicians.find(t => t.name === technicianNameOrId);
    }
    const techId = technician ? technician.id : '';
    const techName = technician ? technician.name : technicianNameOrId;

    // Try service_requests table first
    const srRow = getById('service_requests', requestId);
    if (srRow) {
      update('service_requests', requestId, {
        technicianId: techId,
        technicianName: techName,
        status: 'in-progress',
        assignedAt: now,
        updatedAt: now
      });
      return res.json({
        success: true,
        updatedRequest: { id: requestId, status: 'in-progress', technicianId: techId, technicianName: techName, assignedAt: now, updatedAt: now }
      });
    }

    // Fall back to incidents table
    const incRow = getById('incidents', requestId);
    if (incRow) {
      update('incidents', requestId, {
        status: 'in-progress',
        updatedAt: now
      });
      return res.json({
        success: true,
        updatedRequest: { id: requestId, status: 'in-progress', technicianId: techId, technicianName: techName, assignedAt: now, updatedAt: now }
      });
    }

    res.json({ success: false, error: 'Request not found' });
  } catch (error) {
    console.error('Error assigning service request:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * unassignServiceRequest - Clear assignment, set status='pending'
 * Args: [requestId]
 */
router.post('/unassignServiceRequest', (req, res) => {
  try {
    const [requestId] = req.body.args || [];
    const now = new Date().toISOString();

    const srRow = getById('service_requests', requestId);
    if (!srRow) {
      return res.json({ success: false, error: 'Request not found' });
    }

    update('service_requests', requestId, {
      technicianId: '',
      technicianName: '',
      status: 'pending',
      assignedAt: '',
      updatedAt: now
    });

    res.json({
      success: true,
      updatedRequest: { id: requestId, status: 'pending', technicianId: '', technicianName: '', assignedAt: '', updatedAt: now }
    });
  } catch (error) {
    console.error('Error unassigning service request:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * completeServiceRequest - Set status='completed', completedAt, notes
 * Args: [requestId, notes]
 */
router.post('/completeServiceRequest', (req, res) => {
  try {
    const [requestId, notes] = req.body.args || [];
    const now = new Date().toISOString();

    // Try service_requests table first
    const srRow = getById('service_requests', requestId);
    if (srRow) {
      const updates = {
        status: 'completed',
        completedAt: now,
        updatedAt: now
      };
      if (notes) updates.notes = notes;

      update('service_requests', requestId, updates);
      return res.json({
        success: true,
        updatedRequest: { id: requestId, status: 'completed', completedAt: now, updatedAt: now }
      });
    }

    // Fall back to incidents table
    const incRow = getById('incidents', requestId);
    if (incRow) {
      update('incidents', requestId, {
        status: 'closed',
        updatedAt: now
      });
      return res.json({
        success: true,
        updatedRequest: { id: requestId, status: 'completed', completedAt: now, updatedAt: now }
      });
    }

    res.json({ success: false, error: 'Request not found' });
  } catch (error) {
    console.error('Error completing service request:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// DELETE
// ============================================

/**
 * deleteServiceRequest - Delete a single service request
 * Args: [requestId]
 */
router.post('/deleteServiceRequest', (req, res) => {
  try {
    const [requestId] = req.body.args || [];

    // Try service_requests first
    const srRow = getById('service_requests', requestId);
    if (srRow) {
      remove('service_requests', requestId);
      return res.json({ success: true });
    }

    // Fall back to incidents
    const incRow = getById('incidents', requestId);
    if (incRow) {
      remove('incidents', requestId);
      return res.json({ success: true });
    }

    res.json({ success: false, error: 'Record not found' });
  } catch (error) {
    console.error('Error deleting service request:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * deleteAllServiceRequests - Clear both service_requests and incidents tables
 */
router.post('/deleteAllServiceRequests', (req, res) => {
  try {
    let deleted = 0;

    // Count before clearing
    const srCount = getAll('service_requests').length;
    const incCount = getAll('incidents').length;

    clearTable('service_requests');
    clearTable('incidents');

    deleted = srCount + incCount;

    res.json({ success: true, deleted: deleted });
  } catch (error) {
    console.error('Error deleting all service requests:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// EXPORT
// ============================================

/**
 * exportServiceRequests - Return all as formatted array
 */
router.post('/exportServiceRequests', (req, res) => {
  try {
    // Reuse the same logic as getServiceRequests (merge + sort)
    let requests = getAll('service_requests').map(r => ({ ...r, source: 'qr' }));

    try {
      const incidents = getAll('incidents');
      incidents.forEach(inc => {
        let srStatus = 'pending';
        if (inc.status === 'closed' || inc.status === 'resolved') srStatus = 'completed';
        else if (inc.status === 'in-progress' || inc.status === 'assigned') srStatus = 'in-progress';
        else if (inc.status === 'open' || inc.status === 'new') srStatus = 'pending';
        else srStatus = inc.status || 'pending';

        requests.push({
          id: inc.id,
          source: 'helpdesk',
          deviceName: inc.roomNumber || '',
          location: inc.roomNumber || '',
          issueLabel: inc.shortDescription || inc.subcategory || '',
          issueType: inc.category || '',
          category: inc.category || '',
          subcategory: inc.subcategory || '',
          employeeId: inc.employeeId || '',
          employeeName: inc.employeeName || '',
          technicianName: '',
          status: srStatus,
          submittedAt: inc.createdAt || '',
          createdAt: inc.createdAt || '',
          completedAt: (inc.status === 'closed' || inc.status === 'resolved') ? (inc.updatedAt || '') : ''
        });
      });
    } catch (e) {
      console.error('Error loading incidents for export:', e);
    }

    requests.sort((a, b) => {
      return new Date(b.submittedAt || b.createdAt || 0) - new Date(a.submittedAt || a.createdAt || 0);
    });

    res.json({
      success: true,
      data: requests.map(r => ({
        id: r.id,
        source: r.source || 'qr',
        device: r.deviceName || '',
        location: r.location || '',
        issue: r.issueLabel || r.issueType || '',
        category: r.category || '',
        employeeId: r.employeeId || '',
        employeeName: r.employeeName || '',
        technician: r.technicianName || '',
        status: r.status || '',
        submittedAt: r.submittedAt || r.createdAt || '',
        completedAt: r.completedAt || ''
      }))
    });
  } catch (error) {
    console.error('Error exporting service requests:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// REQUEST PAGE DATA (QR scan landing page)
// ============================================

/**
 * getRequestPageData - Aggregate data for QR scan page
 * Args: [deviceId]
 * Returns device info, device type, issue buttons, technicians
 */
router.post('/getRequestPageData', (req, res) => {
  try {
    const [deviceId] = req.body.args || [];

    const device = getById('devices', deviceId);
    if (!device) {
      return res.json({ success: false, error: 'Device not found. Searched for: ' + deviceId });
    }

    // Get device type - try multiple matching strategies
    const deviceTypes = getAll('device_types');
    const deviceTypeStr = String(device.type || '').toLowerCase().trim();

    const deviceType = deviceTypes.find(t =>
      t.id === device.type ||
      String(t.id).toLowerCase() === deviceTypeStr ||
      String(t.name).toLowerCase() === deviceTypeStr
    );

    // Get issue buttons for this device type
    let buttons = [];
    if (deviceType) {
      const allButtons = getAll('issue_buttons');
      buttons = allButtons
        .filter(b => b.deviceTypeId === deviceType.id && b.active !== 'false' && b.active !== false)
        .sort((a, b) => (parseInt(a.sortOrder) || 0) - (parseInt(b.sortOrder) || 0));
    }

    res.json({
      success: true,
      device: device,
      deviceType: deviceType || null,
      buttons: buttons,
      pageTitle: deviceType ? deviceType.pageTitle : 'Report Issue'
    });
  } catch (error) {
    console.error('Error getting request page data:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// EMAIL NOTIFICATION (internal helper)
// ============================================

/**
 * Send email notification for new service request
 * Mirrors sendServiceRequestNotification from Code.gs
 */
async function sendServiceRequestNotification(request) {
  if (!request) return;

  try {
    // Get email config for technician notification address
    const { getEmailConfigValue } = require('../db/database');
    const technicianEmail = getEmailConfigValue('companyEmail');

    // Check if we're in after-hours
    const helpers = getSettingsHelpers();
    const workingHoursInfo = helpers.checkWorkingHours();
    const isAfterHours = workingHoursInfo && !workingHoursInfo.isWorkingHours;
    const afterHoursSettings = workingHoursInfo ? workingHoursInfo.settings : null;

    // Send notification to technicians
    if (technicianEmail) {
      const afterHoursNote = isAfterHours
        ? '\nAFTER-HOURS SUBMISSION - This request was submitted outside of working hours.\n'
        : '';

      const techSubject = `Service Request: ${request.issueLabel} - ${request.deviceName}`;
      const techBody = `New Service Request Submitted
${afterHoursNote}
Device: ${request.deviceName}
Location: ${request.location}
Issue: ${request.issueLabel}

Submitted by: ${request.employeeName || 'Unknown'} (${request.employeeId || 'N/A'})
Email: ${request.employeeEmail || 'N/A'}

Time: ${new Date(request.submittedAt).toLocaleString()}

Notes: ${request.notes || 'None'}

---
Smart School Monitor`.trim();

      await sendEmail({
        to: technicianEmail,
        subject: techSubject,
        text: techBody
      });
    }

    // Send confirmation email to the employee who submitted the request
    if (request.employeeEmail) {
      await sendEmployeeConfirmationEmail(request, isAfterHours, afterHoursSettings);
    }
  } catch (error) {
    console.error('Error sending service request notification:', error);
  }
}

/**
 * Send confirmation email to the employee
 */
async function sendEmployeeConfirmationEmail(requestData, isAfterHours, afterHoursSettings) {
  if (!requestData || !requestData.employeeEmail) return;

  try {
    // Try to get HTML template
    const allTemplates = getAll('email_templates');
    const template = allTemplates.find(t => t.type === 'confirmation' && t.active !== 'false');

    const urgentEmail = (afterHoursSettings && afterHoursSettings.urgentEmail) || 'itservicedesk@palmbeachschools.org';
    const urgentPhone = (afterHoursSettings && afterHoursSettings.urgentPhone) || '(561) 242-6100';
    const afterHoursMsg = (afterHoursSettings && afterHoursSettings.afterHoursMessage) || 'Your request will be addressed first thing during the next working hours.';

    if (template && template.htmlBody) {
      // Process HTML template - replace variables
      let htmlBody = template.htmlBody;
      let subject = template.subject || 'Service Request Received';

      const variables = {
        employeeName: requestData.employeeName || 'Team Member',
        issueLabel: requestData.issueLabel || 'Service Request',
        deviceName: requestData.deviceName || 'Unknown Device',
        location: requestData.location || 'Unknown Location',
        submittedAt: new Date(requestData.submittedAt).toLocaleString(),
        requestId: requestData.id || ''
      };

      // Replace {{variable}} placeholders
      Object.keys(variables).forEach(key => {
        const regex = new RegExp('\\{\\{' + key + '\\}\\}', 'g');
        htmlBody = htmlBody.replace(regex, variables[key]);
        subject = subject.replace(regex, variables[key]);
      });

      await sendEmail({
        to: requestData.employeeEmail,
        subject: subject,
        html: htmlBody
      });
    } else {
      // Fallback to plain text
      const subject = 'Service Request Received - ' + (requestData.issueLabel || 'Service Request');
      let afterHoursMessage = '';

      if (isAfterHours && afterHoursSettings) {
        afterHoursMessage = `

NOTE: This request was submitted outside of working hours.
${afterHoursMsg}

For urgent issues, contact:
Email: ${urgentEmail}
Phone: ${urgentPhone}`;
      }

      const body = `Hello ${requestData.employeeName || 'Team Member'},

Your service request has been received and will be addressed by our technical team.

Request Details:
- Issue: ${requestData.issueLabel || 'N/A'}
- Device: ${requestData.deviceName || 'N/A'}
- Location: ${requestData.location || 'N/A'}
- Submitted: ${new Date(requestData.submittedAt).toLocaleString()}
- Request ID: ${requestData.id || 'N/A'}
${afterHoursMessage}

Thank you,
Smart School Monitor`.trim();

      await sendEmail({
        to: requestData.employeeEmail,
        subject: subject,
        text: body
      });
    }
  } catch (error) {
    console.error('Error sending employee confirmation email:', error);
  }
}

module.exports = router;
