// SharkQuick Cloud Relay Server
// A lightweight Express server that mirrors the phone-facing QR request page endpoints.
// The Electron app pushes device/teacher/button data here periodically.
// Phones scan QR codes that point to this server's public URL.

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const SYNC_SECRET = process.env.SYNC_SECRET || 'changeme';

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── In-memory data store ──
// Pushed by the Electron app every ~60 seconds
let syncData = {
  devices: [],
  deviceTypes: [],
  issueButtons: [],
  teachers: [],
  branding: {},
  afterHoursSettings: {
    enabled: false,
    workStart: '06:30',
    workEnd: '16:00',
    urgentEmail: '',
    urgentPhone: '',
    afterHoursMessage: 'Your request will be addressed during the next working hours.',
    workDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false }
  },
  lastSyncAt: null
};

// Service requests created on the relay, awaiting pickup by Electron
let pendingServiceRequests = [];

// ── Auth middleware for sync endpoints ──
function requireSyncAuth(req, res, next) {
  if (req.headers['x-sync-secret'] !== SYNC_SECRET) {
    return res.status(401).json({ error: 'Invalid sync secret' });
  }
  next();
}

// ══════════════════════════════════════════════
// PHONE-FACING ENDPOINTS (mirrors src/server/api.js)
// ══════════════════════════════════════════════

// Serve the request page
app.get('/request', (_req, res) => {
  res.sendFile(path.join(__dirname, 'request.html'));
});

// Health check / ping
app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, t: Date.now(), relay: true });
});

// ── Working Hours ──
app.get('/api/request/workingHours', (_req, res) => {
  try {
    var settings = syncData.afterHoursSettings;
    var result = {
      isWorkingHours: true,
      reason: '',
      settings: settings
    };

    if (!settings || !settings.enabled) {
      result.reason = 'disabled';
      return res.json(result);
    }

    var now = new Date();
    var timeZone = 'America/New_York';
    var formatter = new Intl.DateTimeFormat('en-US', { timeZone: timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
    var timeParts = formatter.format(now).split(':');
    var currentHour = parseInt(timeParts[0], 10);
    var currentMin = parseInt(timeParts[1], 10);
    var currentTime = currentHour * 60 + currentMin;

    var dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timeZone, weekday: 'short' });
    var dayStr = dayFormatter.format(now).toLowerCase();
    var dayMap = { mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat', sun: 'sun' };
    var currentDay = dayMap[dayStr] || dayStr.substring(0, 3);

    if (!settings.workDays || !settings.workDays[currentDay]) {
      result.isWorkingHours = false;
      result.reason = 'weekend';
      return res.json(result);
    }

    var startParts = (settings.workStart || '06:30').split(':');
    var endParts = (settings.workEnd || '16:00').split(':');
    var startTime = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
    var endTime = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);

    if (currentTime < startTime || currentTime >= endTime) {
      result.isWorkingHours = false;
      result.reason = 'after-hours';
      return res.json(result);
    }

    result.reason = 'working-hours';
    res.json(result);
  } catch (error) {
    res.json({ isWorkingHours: true, reason: 'error', settings: syncData.afterHoursSettings });
  }
});

// ── Page Data ──
app.get('/api/request/pageData', (req, res) => {
  try {
    var deviceId = req.query.device;
    if (!deviceId) return res.json({ success: false, error: 'No device ID' });

    // Find device by ID or name
    var device = syncData.devices.find(function(d) { return d.id === deviceId; });
    if (!device) {
      var searchId = String(deviceId).trim().toLowerCase();
      device = syncData.devices.find(function(d) {
        return String(d.name || '').trim().toLowerCase() === searchId;
      });
    }
    if (!device) return res.json({ success: false, error: 'Device not found' });

    // Find device type
    var deviceType = syncData.deviceTypes.find(function(t) {
      return t.id === device.type || (t.name && t.name.toLowerCase() === (device.type || '').toLowerCase());
    });

    // Get active issue buttons for this device type
    var buttons = [];
    if (deviceType) {
      buttons = syncData.issueButtons
        .filter(function(b) {
          return b.deviceTypeId === deviceType.id && (b.active === 1 || b.active === true || b.active === '1');
        })
        .sort(function(a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
    }

    res.json({ success: true, device: device, buttons: buttons, branding: syncData.branding });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ── Employee Lookup ──
app.post('/api/request/lookupEmployee', (req, res) => {
  try {
    var searchTerm = req.body.searchTerm;
    if (!searchTerm || searchTerm.length < 2) {
      return res.json({ success: false, error: 'Search term too short' });
    }

    var term = String(searchTerm).trim();
    var teachers = syncData.teachers;

    // Exact empId match first
    var match = teachers.find(function(t) { return String(t.empId).trim() === term; });
    if (match) {
      return res.json({ success: true, employee: { empId: match.empId, name: match.name, email: match.email, roomNumber: match.roomNumber || '' } });
    }

    // Partial name match (case-insensitive)
    var lower = term.toLowerCase();
    match = teachers.find(function(t) { return (t.name || '').toLowerCase().includes(lower); });
    if (match) {
      return res.json({ success: true, employee: { empId: match.empId, name: match.name, email: match.email, roomNumber: match.roomNumber || '' } });
    }

    res.json({ success: false, error: 'Employee not found' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ── Create Service Request ──
app.post('/api/request/createServiceRequest', (req, res) => {
  try {
    var data = req.body;
    var now = new Date().toISOString();

    var device = syncData.devices.find(function(d) { return d.id === data.deviceId; });
    var deviceType = device ? syncData.deviceTypes.find(function(t) {
      return t.id === device.type || t.name === device.type;
    }) : null;

    // Look up employee if provided
    var employee = null;
    if (data.employeeId) {
      var searchId = String(data.employeeId).trim();
      employee = syncData.teachers.find(function(t) { return String(t.empId).trim() === searchId; });
    }
    var finalEmail = data.employeeEmail || (employee ? employee.email : '');

    var sr = {
      id: crypto.randomUUID().substring(0, 8),
      deviceId: (data.deviceId && data.deviceId !== 'undefined') ? data.deviceId : '',
      deviceName: device ? device.name : (data.deviceName || ''),
      deviceType: deviceType ? deviceType.name : (device ? device.type : ''),
      location: device ? device.location : (data.location || ''),
      blueprintId: device ? (device.blueprintId || '') : '',
      issueType: data.issueType || '',
      issueLabel: data.issueLabel || '',
      employeeId: data.employeeId || '',
      employeeName: employee ? employee.name : (data.employeeName || ''),
      employeeEmail: finalEmail,
      technicianId: '',
      technicianName: '',
      status: 'pending',
      notes: data.notes || '',
      submittedAt: now,
      assignedAt: '',
      completedAt: '',
      createdAt: now,
      updatedAt: now,
      source: 'cloud-relay'
    };

    pendingServiceRequests.push(sr);
    console.log('Service request created:', sr.id, '- Device:', sr.deviceName, '- Issue:', sr.issueLabel);
    res.json({ success: true, request: sr });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ══════════════════════════════════════════════
// SYNC ENDPOINTS (Electron ↔ Relay)
// ══════════════════════════════════════════════

// Electron pushes all reference data
app.post('/api/sync/push', requireSyncAuth, (req, res) => {
  try {
    var body = req.body;
    if (body.devices) syncData.devices = body.devices;
    if (body.deviceTypes) syncData.deviceTypes = body.deviceTypes;
    if (body.issueButtons) syncData.issueButtons = body.issueButtons;
    if (body.teachers) syncData.teachers = body.teachers;
    if (body.branding) syncData.branding = body.branding;
    if (body.afterHoursSettings) syncData.afterHoursSettings = body.afterHoursSettings;
    syncData.lastSyncAt = new Date().toISOString();

    console.log('Sync push received:', syncData.devices.length, 'devices,',
      syncData.teachers.length, 'teachers,',
      syncData.issueButtons.length, 'buttons');

    res.json({
      success: true,
      counts: {
        devices: syncData.devices.length,
        deviceTypes: syncData.deviceTypes.length,
        issueButtons: syncData.issueButtons.length,
        teachers: syncData.teachers.length
      }
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Electron pulls pending service requests
app.get('/api/sync/pull', requireSyncAuth, (req, res) => {
  var requests = pendingServiceRequests.slice();
  pendingServiceRequests = [];
  console.log('Sync pull: returning', requests.length, 'pending service requests');
  res.json({ success: true, requests: requests });
});

// Status check (no auth required — useful for Electron UI)
app.get('/api/sync/status', (_req, res) => {
  res.json({
    online: true,
    lastSyncAt: syncData.lastSyncAt,
    deviceCount: syncData.devices.length,
    teacherCount: syncData.teachers.length,
    buttonCount: syncData.issueButtons.length,
    pendingRequestCount: pendingServiceRequests.length
  });
});

// ── Root page (helpful landing) ──
app.get('/', (_req, res) => {
  var synced = syncData.lastSyncAt ? 'Last sync: ' + syncData.lastSyncAt : 'Not yet synced with Electron app';
  res.send('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>SharkQuick Cloud Relay</title>' +
    '<style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#f8fafc;color:#334155;margin:0}' +
    'h1{color:#0f172a;font-size:1.8rem}code{background:#e2e8f0;padding:2px 8px;border-radius:4px;font-size:0.85rem}' +
    '.status{margin:20px auto;padding:16px;max-width:400px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}' +
    '.stat{display:flex;justify-content:space-between;padding:4px 0;font-size:0.9rem}' +
    '.label{color:#64748b}.value{font-weight:600;color:#0f172a}</style></head><body>' +
    '<div style="font-size:3rem;margin-bottom:8px">&#x1F988;</div>' +
    '<h1>SharkQuick Cloud Relay</h1>' +
    '<p style="color:#64748b">This server relays QR service requests from phones to the SharkQuick desktop app.</p>' +
    '<div class="status">' +
    '<div class="stat"><span class="label">Devices</span><span class="value">' + syncData.devices.length + '</span></div>' +
    '<div class="stat"><span class="label">Teachers</span><span class="value">' + syncData.teachers.length + '</span></div>' +
    '<div class="stat"><span class="label">Issue Buttons</span><span class="value">' + syncData.issueButtons.length + '</span></div>' +
    '<div class="stat"><span class="label">Pending Requests</span><span class="value">' + pendingServiceRequests.length + '</span></div>' +
    '<div class="stat"><span class="label">Sync Status</span><span class="value">' + synced + '</span></div>' +
    '</div>' +
    '<p style="margin-top:30px;font-size:0.8rem;color:#94a3b8">To use: scan a QR code or visit <code>/request?device=DEVICE_ID</code></p>' +
    '</body></html>');
});

// ── 404 catch-all ──
app.use((req, res) => {
  res.status(404).send('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Not Found</title>' +
    '<style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#f8fafc;color:#64748b;margin:0}' +
    'code{background:#e2e8f0;padding:2px 8px;border-radius:4px}</style></head><body>' +
    '<div style="font-size:2.5rem;margin-bottom:12px">&#x1F988;</div>' +
    '<h2 style="color:#1e293b">Page Not Found</h2>' +
    '<p>The path <code>' + req.originalUrl + '</code> does not exist.</p>' +
    '<p><a href="/" style="color:#0f766e;font-weight:600">Home</a></p>' +
    '</body></html>');
});

// ── Start server ──
app.listen(PORT, () => {
  console.log('SharkQuick Cloud Relay running on port ' + PORT);
  console.log('  Sync secret: ' + (SYNC_SECRET === 'changeme' ? 'WARNING: using default secret!' : 'configured'));
  console.log('  Endpoints:');
  console.log('    GET  /request?device=ID   - Phone request page');
  console.log('    POST /api/sync/push       - Electron pushes data');
  console.log('    GET  /api/sync/pull       - Electron pulls service requests');
  console.log('    GET  /api/sync/status     - Relay status');
});
