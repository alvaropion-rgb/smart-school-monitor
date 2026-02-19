const { ipcMain } = require('electron');

function registerHandlers() {
  const devices = require('../services/devices');
  const traps = require('../services/traps');
  const supplyHistory = require('../services/supplyHistory');
  const settings = require('../services/settings');
  const workingHours = require('../services/workingHours');
  const blueprints = require('../services/blueprints');
  const employees = require('../services/employees');
  const deviceTypes = require('../services/deviceTypes');
  const issueButtons = require('../services/issueButtons');
  const email = require('../services/email');
  const serviceRequests = require('../services/serviceRequests');
  const qrCodes = require('../services/qrCodes');
  const emailTemplates = require('../services/emailTemplates');
  const incidents = require('../services/incidents');
  const emailQueue = require('../services/emailQueue');
  const security = require('../services/security');
  const servicenow = require('../services/servicenow');
  const classification = require('../services/classification');
  const computerRepairs = require('../services/computerRepairs');
  const dataManagement = require('../services/dataManagement');
  const microsoftGraph = require('../services/microsoftGraph');

  // --- Devices ---
  ipcMain.handle('getDevices', () => devices.getDevices());
  ipcMain.handle('saveDevice', (_e, device) => devices.saveDevice(device));
  ipcMain.handle('deleteDevice', (_e, deviceId) => devices.deleteDevice(deviceId));
  ipcMain.handle('updateDeviceStatus', (_e, data) => devices.updateDeviceStatus(data));
  ipcMain.handle('getDeviceById', (_e, deviceId) => devices.getDeviceById(deviceId));
  ipcMain.handle('clearAllDevices', () => devices.clearAllDevices());

  // --- SNMP Traps ---
  ipcMain.handle('getTraps', (_e, limit) => traps.getTraps(limit));
  ipcMain.handle('addTrap', (_e, trapData) => traps.addTrap(trapData));
  ipcMain.handle('resolveTrap', (_e, trapId) => traps.resolveTrap(trapId));
  ipcMain.handle('resolveTrapsByIp', (_e, ip) => traps.resolveTrapsByIp(ip));
  ipcMain.handle('reprocessAllTraps', () => traps.reprocessAllTraps());
  ipcMain.handle('assignTrap', (_e, trapId, techId) => traps.assignTrap(trapId, techId));
  ipcMain.handle('assignTrapsByIp', (_e, ip, techId) => traps.assignTrapsByIp(ip, techId));
  ipcMain.handle('unassignTrap', (_e, trapId) => traps.unassignTrap(trapId));
  ipcMain.handle('getTrapsWithAssignments', () => traps.getTrapsWithAssignments());
  ipcMain.handle('clearAllTraps', () => traps.clearAllTraps());

  // --- Supply History ---
  ipcMain.handle('pushSupplyData', (_e, data) => supplyHistory.pushSupplyData(data));

  // --- Settings ---
  ipcMain.handle('getEmailConfig', () => settings.getEmailConfig());
  ipcMain.handle('saveEmailConfig', (_e, config) => settings.saveEmailConfig(config));
  ipcMain.handle('getSettings', () => settings.getSettings());
  ipcMain.handle('saveSetting', (_e, key, value) => settings.saveSetting(key, value));
  ipcMain.handle('saveSettings', (_e, settingsObj) => {
    // Frontend sometimes calls saveSettings with an object of key-value pairs
    if (settingsObj && typeof settingsObj === 'object') {
      for (const [key, value] of Object.entries(settingsObj)) {
        settings.saveSetting(key, value);
      }
    }
    return { success: true };
  });
  ipcMain.handle('saveAfterHoursSettings', (_e, data) => settings.saveAfterHoursSettings(data));
  ipcMain.handle('getAfterHoursSettings', () => settings.getAfterHoursSettings());
  ipcMain.handle('getRequestPageBranding', () => settings.getRequestPageBranding());
  ipcMain.handle('saveRequestPageBranding', (_e, data) => settings.saveRequestPageBranding(data));

  // --- Working Hours ---
  ipcMain.handle('isWithinWorkingHours', () => workingHours.isWithinWorkingHours());
  ipcMain.handle('getWorkingHoursStatus', () => workingHours.getWorkingHoursStatus());

  // --- Blueprints ---
  ipcMain.handle('getBlueprints', () => blueprints.getBlueprints());
  ipcMain.handle('saveBlueprint', (_e, blueprint) => blueprints.saveBlueprint(blueprint));
  ipcMain.handle('deleteBlueprint', (_e, blueprintId) => blueprints.deleteBlueprint(blueprintId));
  ipcMain.handle('saveBlueprintImage', (_e, blueprintId, base64Data) => blueprints.saveBlueprintImage(blueprintId, base64Data));
  ipcMain.handle('getBlueprintImage', (_e, blueprintId) => blueprints.getBlueprintImage(blueprintId));

  // --- Employees (Teachers + Technicians) ---
  ipcMain.handle('getTechnicians', () => employees.getTechnicians());
  ipcMain.handle('saveTechnician', (_e, tech) => employees.saveTechnician(tech));
  ipcMain.handle('deleteTechnician', (_e, techId) => employees.deleteTechnician(techId));
  ipcMain.handle('getTeachers', () => employees.getTeachers());
  ipcMain.handle('saveTeacher', (_e, teacher) => employees.saveTeacher(teacher));
  ipcMain.handle('deleteTeacher', (_e, teacherId) => employees.deleteTeacher(teacherId));
  ipcMain.handle('deleteAllTeachers', () => employees.deleteAllTeachers());
  ipcMain.handle('importTeachers', (_e, csvData) => employees.importTeachers(csvData));
  ipcMain.handle('exportTeachers', () => employees.exportTeachers());
  ipcMain.handle('lookupEmployee', (_e, searchTerm) => employees.lookupEmployee(searchTerm));

  // --- Device Types ---
  ipcMain.handle('getDeviceTypes', () => deviceTypes.getDeviceTypes());
  ipcMain.handle('saveDeviceType', (_e, deviceType) => deviceTypes.saveDeviceType(deviceType));
  ipcMain.handle('deleteDeviceType', (_e, deviceTypeId) => deviceTypes.deleteDeviceType(deviceTypeId));
  ipcMain.handle('getDeviceTypeById', (_e, deviceTypeId) => deviceTypes.getDeviceTypeById(deviceTypeId));

  // --- Issue Buttons ---
  ipcMain.handle('getIssueButtons', () => issueButtons.getIssueButtons());
  ipcMain.handle('getIssueButtonsByDeviceType', (_e, deviceTypeId) => issueButtons.getIssueButtonsByDeviceType(deviceTypeId));
  ipcMain.handle('saveIssueButton', (_e, button) => issueButtons.saveIssueButton(button));
  ipcMain.handle('deleteIssueButton', (_e, buttonId) => issueButtons.deleteIssueButton(buttonId));

  // --- Email ---
  ipcMain.handle('sendDeviceEmail', (_e, deviceId, emailType) => email.sendDeviceEmail(deviceId, emailType));
  ipcMain.handle('sendManufacturerEmail', (_e, data) => email.sendManufacturerEmail(data));
  ipcMain.handle('previewManufacturerEmail', (_e, data) => email.previewManufacturerEmail(data));
  ipcMain.handle('getEmailHistory', (_e, limit) => email.getEmailHistory(limit));
  ipcMain.handle('getEmailById', (_e, emailId) => email.getEmailById(emailId));
  ipcMain.handle('deleteEmailHistoryRecord', (_e, emailId) => email.deleteEmailHistoryRecord(emailId));
  ipcMain.handle('deleteAllEmailHistory', () => email.deleteAllEmailHistory());
  ipcMain.handle('testEmailAuthorization', () => email.testEmailAuthorization());
  ipcMain.handle('testSmtpConnection', async () => email.testSmtpConnection());

  // --- Service Requests ---
  ipcMain.handle('getServiceRequests', () => serviceRequests.getServiceRequests());
  ipcMain.handle('getPendingServiceRequests', () => serviceRequests.getPendingServiceRequests());
  ipcMain.handle('createServiceRequest', (_e, data) => serviceRequests.createServiceRequest(data));
  ipcMain.handle('assignServiceRequest', (_e, requestId, techId) => serviceRequests.assignServiceRequest(requestId, techId));
  ipcMain.handle('unassignServiceRequest', (_e, requestId) => serviceRequests.unassignServiceRequest(requestId));
  ipcMain.handle('completeServiceRequest', (_e, requestId) => serviceRequests.completeServiceRequest(requestId));
  ipcMain.handle('deleteServiceRequest', (_e, requestId) => serviceRequests.deleteServiceRequest(requestId));
  ipcMain.handle('deleteAllServiceRequests', () => serviceRequests.deleteAllServiceRequests());
  ipcMain.handle('exportServiceRequests', () => serviceRequests.exportServiceRequests());

  // --- QR Codes ---
  ipcMain.handle('getQRCodes', () => qrCodes.getQRCodes());
  ipcMain.handle('generateQRCode', async (_e, deviceId) => qrCodes.generateQRCodeWithImage(deviceId));
  ipcMain.handle('updateAllQRCodeUrls', () => qrCodes.updateAllQRCodeUrls());
  ipcMain.handle('getLabelLayout', () => qrCodes.getLabelLayout());
  ipcMain.handle('saveLabelLayout', (_e, layout) => qrCodes.saveLabelLayout(layout));

  // --- Email Templates ---
  ipcMain.handle('getEmailTemplates', () => emailTemplates.getEmailTemplates());
  ipcMain.handle('saveEmailTemplate', (_e, template) => emailTemplates.saveEmailTemplate(template));
  ipcMain.handle('deleteEmailTemplate', (_e, templateId) => emailTemplates.deleteEmailTemplate(templateId));

  // --- Incidents ---
  ipcMain.handle('createIncident', (_e, data) => incidents.createIncident(data));
  ipcMain.handle('getIncidents', (_e, limit) => incidents.getIncidents(limit));
  ipcMain.handle('getIncidentsByEmployee', (_e, empId) => incidents.getIncidentsByEmployee(empId));
  ipcMain.handle('updateIncidentField', (_e, incidentId, fieldName, value) => incidents.updateIncidentField(incidentId, fieldName, value));
  ipcMain.handle('sendIncidentEmail', (_e, incidentId) => incidents.sendIncidentEmail(incidentId));
  ipcMain.handle('queueIncidentEmail', (_e, incidentId) => incidents.queueIncidentEmail(incidentId));

  // --- Email Queue ---
  ipcMain.handle('processEmailQueue', () => emailQueue.processEmailQueue());
  ipcMain.handle('getEmailQueue', () => emailQueue.getEmailQueue());

  // --- Security ---
  ipcMain.handle('verifySecurityPassword', (_e, password) => security.verifySecurityPassword(password));
  ipcMain.handle('setSecurityPassword', (_e, password) => security.setSecurityPassword(password));
  ipcMain.handle('isPasswordProtected', () => security.isPasswordProtected());

  // --- ServiceNow ---
  ipcMain.handle('getLatestSnIncident', (_e, empId) => servicenow.getLatestSnIncident(empId));
  ipcMain.handle('setupSnCredentials', (_e, instance, user, password) => servicenow.setupSnCredentials(instance, user, password));

  // --- Classification ---
  ipcMain.handle('classifyIncident', (_e, rawText, employeeName, roomNumber) => classification.classifyIncident(rawText, employeeName, roomNumber));
  ipcMain.handle('classifyComputerRepair', (_e, rawText) => classification.classifyComputerRepair(rawText));
  ipcMain.handle('saveTrainingEntry', (_e, data) => classification.saveTrainingEntry(data));
  ipcMain.handle('saveCrTrainingEntry', (_e, data) => classification.saveCrTrainingEntry(data));
  ipcMain.handle('getTrainingData', () => classification.getTrainingData());
  ipcMain.handle('findSimilarComputerRepairs', (_e, searchText) => classification.findSimilarComputerRepairs(searchText));

  // --- Computer Repairs ---
  ipcMain.handle('createComputerRepair', (_e, data) => computerRepairs.createComputerRepair(data));
  ipcMain.handle('getComputerRepairs', (_e, limit) => computerRepairs.getComputerRepairs(limit));
  ipcMain.handle('getComputerRepairById', (_e, repairId) => computerRepairs.getComputerRepairById(repairId));
  ipcMain.handle('updateComputerRepairField', (_e, repairId, fieldName, value) => computerRepairs.updateComputerRepairField(repairId, fieldName, value));
  ipcMain.handle('sendComputerRepairEmail', (_e, repairId) => computerRepairs.sendComputerRepairEmail(repairId));
  ipcMain.handle('queueComputerRepairEmail', (_e, repairId) => computerRepairs.queueComputerRepairEmail(repairId));
  ipcMain.handle('getRepairTemplates', () => computerRepairs.getRepairTemplates());
  ipcMain.handle('saveRepairTemplate', (_e, template) => computerRepairs.saveRepairTemplate(template));
  ipcMain.handle('deleteRepairTemplate', (_e, templateId) => computerRepairs.deleteRepairTemplate(templateId));

  // --- Data Management ---
  ipcMain.handle('getSheetStats', () => dataManagement.getSheetStats());
  ipcMain.handle('getSpreadsheetInfo', (_e, sheetName) => dataManagement.getSpreadsheetInfo(sheetName));
  ipcMain.handle('createFullBackup', () => dataManagement.createFullBackup());
  ipcMain.handle('exportSheetAsCSV', (_e, sheetName) => dataManagement.exportSheetAsCSV(sheetName));
  ipcMain.handle('importSheetFromCSV', (_e, sheetName, csvData) => dataManagement.importSheetFromCSV(sheetName, csvData));
  ipcMain.handle('importDevicesFromCSV', (_e, csvData) => dataManagement.importDevicesFromCSV(csvData));
  ipcMain.handle('clearSheet', (_e, sheetName) => dataManagement.clearSheet(sheetName));
  ipcMain.handle('getAnalyticsData', () => dataManagement.getAnalyticsData());
  ipcMain.handle('exportAllData', () => dataManagement.exportAllData());
  ipcMain.handle('compactAllSheets', () => dataManagement.compactAllSheets());
  ipcMain.handle('getWorkbookCellCount', () => dataManagement.getWorkbookCellCount());

  // --- Utility (no Google equivalent needed) ---
  ipcMain.handle('getWebAppUrl', () => {
    // Returns the LAN-accessible server URL so QR codes work from phones
    return qrCodes.getBaseUrl();
  });
  ipcMain.handle('getServerNetworkInfo', () => {
    const ip = qrCodes.getLocalNetworkIP();
    return {
      ip: ip,
      port: 3847,
      url: qrCodes.getBaseUrl(),
      hostname: qrCodes.getLocalHostname() || '',
      isLocalhost: ip === 'localhost'
    };
  });

  // --- Open External URL in system browser ---
  ipcMain.handle('openExternal', (_e, url) => {
    const { shell } = require('electron');
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url);
    }
  });

  // --- Manual Data Import from CodeMAPCopier ---
  ipcMain.handle('importFromCodeMAP', (_e, options) => {
    const codeMAPImport = require('../services/codeMAPImport');
    return codeMAPImport.importFromCodeMAP(options);
  });

  ipcMain.handle('getImportStatus', () => {
    const db = require('../database/db');
    const fs = require('fs');
    const path = require('path');

    const deviceCount = db.getDb().prepare('SELECT COUNT(*) as cnt FROM devices').get().cnt;
    const teacherCount = db.getDb().prepare('SELECT COUNT(*) as cnt FROM teachers').get().cnt;

    const codeMAPDir = path.join(__dirname, '..', '..', '..', 'CodeMAPCopier');
    const codeMAPExists = fs.existsSync(codeMAPDir);

    let sourceDevices = 0;
    let sourceTeachers = 0;

    if (codeMAPExists) {
      const devicesPath = path.join(codeMAPDir, 'snmp-gateway', 'devices.json');
      if (fs.existsSync(devicesPath)) {
        try {
          sourceDevices = JSON.parse(fs.readFileSync(devicesPath, 'utf-8')).length;
        } catch (e) { /* ignore */ }
      }
      const csvPath = path.join(codeMAPDir, 'Employee Database - Employees.csv');
      if (fs.existsSync(csvPath)) {
        try {
          const lines = fs.readFileSync(csvPath, 'utf-8').replace(/\r/g, '').split('\n').filter(l => l.trim());
          sourceTeachers = Math.max(0, lines.length - 1); // minus header
        } catch (e) { /* ignore */ }
      }
    }

    return {
      codeMAPExists,
      currentDevices: deviceCount,
      currentTeachers: teacherCount,
      sourceDevices,
      sourceTeachers
    };
  });

  // --- Import device positions from Google Sheet ---
  ipcMain.handle('importPositionsFromGoogleSheet', async () => {
    const codeMAPImport = require('../services/codeMAPImport');
    return codeMAPImport.importPositionsFromGoogleSheet();
  });

  // --- Import repair templates from Google Sheet ---
  ipcMain.handle('importRepairTemplatesFromGoogleSheet', async () => {
    const codeMAPImport = require('../services/codeMAPImport');
    return codeMAPImport.importRepairTemplatesFromGoogleSheet();
  });

  // --- Google OAuth2 / Gmail API Email ---
  ipcMain.handle('msGraphSignIn', async (_e, clientId, clientSecret) => microsoftGraph.signIn(clientId, clientSecret));
  ipcMain.handle('msGraphSignOut', () => microsoftGraph.signOut());
  ipcMain.handle('msGraphGetStatus', () => microsoftGraph.getSignInStatus());
  ipcMain.handle('msGraphSendEmail', async (_e, to, subject, text, html, options) => microsoftGraph.sendGraphEmail(to, subject, text, html, options));
  ipcMain.handle('msGraphGetConfig', () => microsoftGraph.getGraphConfig());
  ipcMain.handle('msGraphSaveConfig', (_e, config) => microsoftGraph.saveGraphConfig(config));

  console.log('IPC handlers registered: 112 channels');
}

module.exports = { registerHandlers };
