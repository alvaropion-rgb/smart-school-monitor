const db = require('../database/db');

function getServiceRequests(limit) {
  try {
    let requests = db.getAll('service_requests').map(r => ({ ...r, source: 'qr' }));

    // Also pull from incidents and normalize
    try {
      const incidents = db.getAll('incidents');
      incidents.forEach(inc => {
        let srStatus = 'pending';
        if (inc.status === 'closed' || inc.status === 'resolved') srStatus = 'completed';
        else if (inc.status === 'in-progress' || inc.status === 'assigned') srStatus = 'in-progress';
        else if (inc.status === 'open' || inc.status === 'new') srStatus = 'pending';
        else srStatus = inc.status || 'pending';

        requests.push({
          id: inc.id, deviceId: '', deviceName: inc.roomNumber || '', deviceType: '',
          location: inc.roomNumber || '', blueprintId: '', issueType: inc.category || '',
          issueLabel: inc.shortDescription || inc.subcategory || '',
          employeeId: inc.employeeId || '', employeeName: inc.employeeName || '',
          employeeEmail: inc.employeeEmail || '', technicianId: '', technicianName: '',
          status: srStatus, notes: inc.description || '',
          submittedAt: inc.createdAt || '', assignedAt: '',
          completedAt: (inc.status === 'closed' || inc.status === 'resolved') ? (inc.updatedAt || '') : '',
          createdAt: inc.createdAt || '', updatedAt: inc.updatedAt || '',
          source: 'helpdesk', channel: inc.channel || '',
          snowIncidentNumber: inc.snowIncidentNumber || '',
          category: inc.category || '', subcategory: inc.subcategory || ''
        });
      });
    } catch (e) {}

    requests.sort((a, b) => new Date(b.submittedAt || b.createdAt || 0) - new Date(a.submittedAt || a.createdAt || 0));
    if (limit) requests = requests.slice(0, limit);
    return requests;
  } catch (error) { console.error('Error getting service requests:', error); return []; }
}

function getServiceRequestsByStatus(status) {
  try { return getServiceRequests().filter(r => r.status === status); }
  catch (error) { return []; }
}

function getPendingServiceRequests() { return getServiceRequestsByStatus('pending'); }

function createServiceRequest(requestData) {
  try {
    const devicesService = require('./devices');
    const employeesService = require('./employees');
    const deviceTypesService = require('./deviceTypes');
    const now = new Date().toISOString();

    const device = devicesService.getDeviceById(requestData.deviceId);
    const types = deviceTypesService.getDeviceTypes();
    const deviceType = device ? types.find(t => t.id === device.type || t.name === device.type) : null;

    let employee = null;
    if (requestData.employeeId) {
      const teachers = employeesService.getTeachers();
      const searchId = String(requestData.employeeId).trim();
      employee = teachers.find(t => String(t.empId).trim() === searchId);
    }

    const finalEmail = requestData.employeeEmail || (employee ? employee.email : '');

    const data = {
      id: db.generateId(),
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
      technicianId: '', technicianName: '', status: 'pending',
      notes: requestData.notes || '',
      submittedAt: now, assignedAt: '', completedAt: '',
      createdAt: now, updatedAt: now
    };

    db.insert('service_requests', data);

    // Send notification (async, don't block)
    try { sendServiceRequestNotification(data); } catch (e) {}

    return { success: true, request: data };
  } catch (error) { return { success: false, error: error.message }; }
}

function sendServiceRequestNotification(request) {
  try {
    const settingsService = require('./settings');
    const config = settingsService.getEmailConfig();
    if (!config.companyEmail) return;

    const emailService = require('./email');
    const subject = 'New Service Request: ' + (request.issueLabel || request.issueType || 'Unknown Issue');
    const text = `New service request from ${request.employeeName || 'Unknown'}.\n\nDevice: ${request.deviceName}\nLocation: ${request.location}\nIssue: ${request.issueLabel || request.issueType}\nSubmitted: ${request.submittedAt}`;

    emailService.sendEmail(config.companyEmail, subject, text, null).catch(e => console.error('Notification email failed:', e));
  } catch (e) { console.error('Error sending notification:', e); }
}

function assignServiceRequest(requestId, technicianNameOrId) {
  try {
    const employeesService = require('./employees');
    const now = new Date().toISOString();
    const technicians = employeesService.getTechnicians();
    let tech = technicians.find(t => t.id === technicianNameOrId) || technicians.find(t => t.name === technicianNameOrId);
    const techId = tech ? tech.id : '';
    const techName = tech ? tech.name : technicianNameOrId;

    let result = db.run('UPDATE service_requests SET technicianId=?, technicianName=?, status=?, assignedAt=?, updatedAt=? WHERE id=?',
      [techId, techName, 'in-progress', now, now, requestId]);
    if (result.changes > 0) return { success: true, updatedRequest: { id: requestId, status: 'in-progress', technicianId: techId, technicianName: techName, assignedAt: now, updatedAt: now } };

    // Try incidents
    result = db.run('UPDATE incidents SET status=?, updatedAt=? WHERE id=?', ['in-progress', now, requestId]);
    if (result.changes > 0) return { success: true, updatedRequest: { id: requestId, status: 'in-progress', technicianId: techId, technicianName: techName, assignedAt: now, updatedAt: now } };

    return { success: false, error: 'Request not found' };
  } catch (error) { return { success: false, error: error.message }; }
}

function unassignServiceRequest(requestId) {
  try {
    const now = new Date().toISOString();
    const result = db.run('UPDATE service_requests SET technicianId=?, technicianName=?, status=?, assignedAt=?, updatedAt=? WHERE id=?',
      ['', '', 'pending', '', now, requestId]);
    if (result.changes > 0) return { success: true, updatedRequest: { id: requestId, status: 'pending', technicianId: '', technicianName: '', assignedAt: '', updatedAt: now } };
    return { success: false, error: 'Request not found' };
  } catch (error) { return { success: false, error: error.message }; }
}

function completeServiceRequest(requestId, notes) {
  try {
    const now = new Date().toISOString();
    let result = db.run('UPDATE service_requests SET status=?, completedAt=?, updatedAt=?' + (notes ? ', notes=?' : '') + ' WHERE id=?',
      notes ? ['completed', now, now, notes, requestId] : ['completed', now, now, requestId]);
    if (result.changes > 0) return { success: true, updatedRequest: { id: requestId, status: 'completed', completedAt: now, updatedAt: now } };

    result = db.run('UPDATE incidents SET status=?, updatedAt=? WHERE id=?', ['closed', now, requestId]);
    if (result.changes > 0) return { success: true, updatedRequest: { id: requestId, status: 'completed', completedAt: now, updatedAt: now } };

    return { success: false, error: 'Request not found' };
  } catch (error) { return { success: false, error: error.message }; }
}

function updateServiceRequest(requestId, updates) {
  try {
    const now = new Date().toISOString();
    updates.updatedAt = now;
    db.update('service_requests', requestId, updates);
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

function deleteServiceRequest(requestId) {
  try {
    let result = db.deleteById('service_requests', requestId);
    if (result.changes > 0) return { success: true };
    result = db.deleteById('incidents', requestId);
    if (result.changes > 0) return { success: true };
    return { success: false, error: 'Record not found' };
  } catch (error) { return { success: false, error: error.message }; }
}

function deleteAllServiceRequests() {
  try {
    db.deleteAll('service_requests');
    db.deleteAll('incidents');
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

function exportServiceRequests() {
  try {
    const requests = getServiceRequests();
    return {
      success: true,
      data: requests.map(r => ({
        id: r.id, source: r.source || 'qr', device: r.deviceName || '',
        location: r.location || '', issue: r.issueLabel || r.issueType || '',
        category: r.category || '', employeeId: r.employeeId || '',
        employeeName: r.employeeName || '', technician: r.technicianName || '',
        status: r.status || '', submittedAt: r.submittedAt || r.createdAt || '',
        completedAt: r.completedAt || ''
      }))
    };
  } catch (error) { return { success: false, error: error.message }; }
}

module.exports = {
  getServiceRequests, getServiceRequestsByStatus, getPendingServiceRequests,
  createServiceRequest, assignServiceRequest, unassignServiceRequest,
  completeServiceRequest, updateServiceRequest, deleteServiceRequest,
  deleteAllServiceRequests, exportServiceRequests, sendServiceRequestNotification
};
