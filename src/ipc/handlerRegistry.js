// handlerRegistry.js — All 112 IPC handler functions as a plain object.
// No Electron dependency. Used by server.js to create the /api/ipc/:channel bridge.

let cachedHandlers = null;

function buildHandlerRegistry() {
  if (cachedHandlers) return cachedHandlers;

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

  cachedHandlers = {
    // --- Devices ---
    'getDevices': () => devices.getDevices(),
    'saveDevice': (device) => devices.saveDevice(device),
    'deleteDevice': (deviceId) => devices.deleteDevice(deviceId),
    'updateDeviceStatus': (data) => devices.updateDeviceStatus(data),
    'getDeviceById': (deviceId) => devices.getDeviceById(deviceId),
    'clearAllDevices': () => devices.clearAllDevices(),

    // --- SNMP Traps ---
    'getTraps': (limit) => traps.getTraps(limit),
    'addTrap': (trapData) => traps.addTrap(trapData),
    'resolveTrap': (trapId) => traps.resolveTrap(trapId),
    'resolveTrapsByIp': (ip) => traps.resolveTrapsByIp(ip),
    'reprocessAllTraps': () => traps.reprocessAllTraps(),
    'assignTrap': (trapId, techId) => traps.assignTrap(trapId, techId),
    'assignTrapsByIp': (ip, techId) => traps.assignTrapsByIp(ip, techId),
    'unassignTrap': (trapId) => traps.unassignTrap(trapId),
    'getTrapsWithAssignments': () => traps.getTrapsWithAssignments(),
    'clearAllTraps': () => traps.clearAllTraps(),

    // --- Supply History ---
    'pushSupplyData': (data) => supplyHistory.pushSupplyData(data),

    // --- Settings ---
    'getEmailConfig': () => settings.getEmailConfig(),
    'saveEmailConfig': (config) => settings.saveEmailConfig(config),
    'getSettings': () => settings.getSettings(),
    'saveSetting': (key, value) => settings.saveSetting(key, value),
    'saveSettings': (settingsObj) => {
      if (settingsObj && typeof settingsObj === 'object') {
        for (const [key, value] of Object.entries(settingsObj)) {
          settings.saveSetting(key, value);
        }
      }
      return { success: true };
    },
    'saveAfterHoursSettings': (data) => settings.saveAfterHoursSettings(data),
    'getAfterHoursSettings': () => settings.getAfterHoursSettings(),
    'getRequestPageBranding': () => settings.getRequestPageBranding(),
    'saveRequestPageBranding': (data) => settings.saveRequestPageBranding(data),

    // --- Working Hours ---
    'isWithinWorkingHours': () => workingHours.isWithinWorkingHours(),
    'getWorkingHoursStatus': () => workingHours.getWorkingHoursStatus(),

    // --- Blueprints ---
    'getBlueprints': () => blueprints.getBlueprints(),
    'saveBlueprint': (blueprint) => blueprints.saveBlueprint(blueprint),
    'deleteBlueprint': (blueprintId) => blueprints.deleteBlueprint(blueprintId),
    'saveBlueprintImage': (blueprintId, base64Data) => blueprints.saveBlueprintImage(blueprintId, base64Data),
    'getBlueprintImage': (blueprintId) => blueprints.getBlueprintImage(blueprintId),

    // --- Employees (Teachers + Technicians) ---
    'getTechnicians': () => employees.getTechnicians(),
    'saveTechnician': (tech) => employees.saveTechnician(tech),
    'deleteTechnician': (techId) => employees.deleteTechnician(techId),
    'getTeachers': () => employees.getTeachers(),
    'saveTeacher': (teacher) => employees.saveTeacher(teacher),
    'deleteTeacher': (teacherId) => employees.deleteTeacher(teacherId),
    'deleteAllTeachers': () => employees.deleteAllTeachers(),
    'importTeachers': (csvData) => employees.importTeachers(csvData),
    'exportTeachers': () => employees.exportTeachers(),
    'lookupEmployee': (searchTerm) => employees.lookupEmployee(searchTerm),

    // --- Device Types ---
    'getDeviceTypes': () => deviceTypes.getDeviceTypes(),
    'saveDeviceType': (deviceType) => deviceTypes.saveDeviceType(deviceType),
    'deleteDeviceType': (deviceTypeId) => deviceTypes.deleteDeviceType(deviceTypeId),
    'getDeviceTypeById': (deviceTypeId) => deviceTypes.getDeviceTypeById(deviceTypeId),

    // --- Issue Buttons ---
    'getIssueButtons': () => issueButtons.getIssueButtons(),
    'getIssueButtonsByDeviceType': (deviceTypeId) => issueButtons.getIssueButtonsByDeviceType(deviceTypeId),
    'saveIssueButton': (button) => issueButtons.saveIssueButton(button),
    'deleteIssueButton': (buttonId) => issueButtons.deleteIssueButton(buttonId),

    // --- Email ---
    'sendDeviceEmail': (deviceId, emailType) => email.sendDeviceEmail(deviceId, emailType),
    'sendManufacturerEmail': (data) => email.sendManufacturerEmail(data),
    'previewManufacturerEmail': (data) => email.previewManufacturerEmail(data),
    'getEmailHistory': (limit) => email.getEmailHistory(limit),
    'getEmailById': (emailId) => email.getEmailById(emailId),
    'deleteEmailHistoryRecord': (emailId) => email.deleteEmailHistoryRecord(emailId),
    'deleteAllEmailHistory': () => email.deleteAllEmailHistory(),
    'testEmailAuthorization': () => email.testEmailAuthorization(),
    'testSmtpConnection': () => email.testSmtpConnection(),

    // --- Service Requests ---
    'getServiceRequests': () => serviceRequests.getServiceRequests(),
    'getPendingServiceRequests': () => serviceRequests.getPendingServiceRequests(),
    'createServiceRequest': (data) => serviceRequests.createServiceRequest(data),
    'assignServiceRequest': (requestId, techId) => serviceRequests.assignServiceRequest(requestId, techId),
    'unassignServiceRequest': (requestId) => serviceRequests.unassignServiceRequest(requestId),
    'completeServiceRequest': (requestId) => serviceRequests.completeServiceRequest(requestId),
    'deleteServiceRequest': (requestId) => serviceRequests.deleteServiceRequest(requestId),
    'deleteAllServiceRequests': () => serviceRequests.deleteAllServiceRequests(),
    'exportServiceRequests': () => serviceRequests.exportServiceRequests(),

    // --- QR Codes ---
    'getQRCodes': () => qrCodes.getQRCodes(),
    'generateQRCode': (deviceId) => qrCodes.generateQRCodeWithImage(deviceId),
    'updateAllQRCodeUrls': () => qrCodes.updateAllQRCodeUrls(),
    'getLabelLayout': () => qrCodes.getLabelLayout(),
    'saveLabelLayout': (layout) => qrCodes.saveLabelLayout(layout),

    // --- Email Templates ---
    'getEmailTemplates': () => emailTemplates.getEmailTemplates(),
    'saveEmailTemplate': (template) => emailTemplates.saveEmailTemplate(template),
    'deleteEmailTemplate': (templateId) => emailTemplates.deleteEmailTemplate(templateId),

    // --- Incidents ---
    'createIncident': (data) => incidents.createIncident(data),
    'getIncidents': (limit) => incidents.getIncidents(limit),
    'getIncidentsByEmployee': (empId) => incidents.getIncidentsByEmployee(empId),
    'updateIncidentField': (incidentId, fieldName, value) => incidents.updateIncidentField(incidentId, fieldName, value),
    'sendIncidentEmail': (incidentId) => incidents.sendIncidentEmail(incidentId),
    'queueIncidentEmail': (incidentId) => incidents.queueIncidentEmail(incidentId),

    // --- Email Queue ---
    'processEmailQueue': () => emailQueue.processEmailQueue(),
    'getEmailQueue': () => emailQueue.getEmailQueue(),

    // --- Security ---
    'verifySecurityPassword': (password) => security.verifySecurityPassword(password),
    'setSecurityPassword': (password) => security.setSecurityPassword(password),
    'isPasswordProtected': () => security.isPasswordProtected(),

    // --- ServiceNow ---
    'getLatestSnIncident': (empId) => servicenow.getLatestSnIncident(empId),
    'setupSnCredentials': (instance, user, password) => servicenow.setupSnCredentials(instance, user, password),

    // --- Classification ---
    'classifyIncident': (rawText, employeeName, roomNumber) => classification.classifyIncident(rawText, employeeName, roomNumber),
    'classifyComputerRepair': (rawText) => classification.classifyComputerRepair(rawText),
    'saveTrainingEntry': (data) => classification.saveTrainingEntry(data),
    'saveCrTrainingEntry': (data) => classification.saveCrTrainingEntry(data),
    'getTrainingData': () => classification.getTrainingData(),
    'findSimilarComputerRepairs': (searchText) => classification.findSimilarComputerRepairs(searchText),

    // --- Computer Repairs ---
    'createComputerRepair': (data) => computerRepairs.createComputerRepair(data),
    'getComputerRepairs': (limit) => computerRepairs.getComputerRepairs(limit),
    'getComputerRepairById': (repairId) => computerRepairs.getComputerRepairById(repairId),
    'updateComputerRepairField': (repairId, fieldName, value) => computerRepairs.updateComputerRepairField(repairId, fieldName, value),
    'sendComputerRepairEmail': (repairId) => computerRepairs.sendComputerRepairEmail(repairId),
    'queueComputerRepairEmail': (repairId) => computerRepairs.queueComputerRepairEmail(repairId),
    'getRepairTemplates': () => computerRepairs.getRepairTemplates(),
    'saveRepairTemplate': (template) => computerRepairs.saveRepairTemplate(template),
    'deleteRepairTemplate': (templateId) => computerRepairs.deleteRepairTemplate(templateId),

    // --- Data Management ---
    'getSheetStats': () => dataManagement.getSheetStats(),
    'getSpreadsheetInfo': (sheetName) => dataManagement.getSpreadsheetInfo(sheetName),
    'createFullBackup': () => dataManagement.createFullBackup(),
    'exportSheetAsCSV': (sheetName) => dataManagement.exportSheetAsCSV(sheetName),
    'importSheetFromCSV': (sheetName, csvData) => dataManagement.importSheetFromCSV(sheetName, csvData),
    'importDevicesFromCSV': (csvData) => dataManagement.importDevicesFromCSV(csvData),
    'clearSheet': (sheetName) => dataManagement.clearSheet(sheetName),
    'getAnalyticsData': () => dataManagement.getAnalyticsData(),
    'exportAllData': () => dataManagement.exportAllData(),
    'compactAllSheets': () => dataManagement.compactAllSheets(),
    'getWorkbookCellCount': () => dataManagement.getWorkbookCellCount(),

    // --- Utility ---
    'getWebAppUrl': () => qrCodes.getBaseUrl(),
    'getServerNetworkInfo': () => {
      const ip = qrCodes.getLocalNetworkIP();
      return {
        ip: ip,
        port: 3847,
        url: qrCodes.getBaseUrl(),
        hostname: qrCodes.getLocalHostname() || '',
        isLocalhost: ip === 'localhost'
      };
    },

    // openExternal is handled client-side by api-shim.js
    'openExternal': () => { /* no-op */ },

    // --- Import from CodeMAP ---
    'importFromCodeMAP': (options) => {
      const codeMAPImport = require('../services/codeMAPImport');
      return codeMAPImport.importFromCodeMAP(options);
    },
    'getImportStatus': () => {
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
          try { sourceDevices = JSON.parse(fs.readFileSync(devicesPath, 'utf-8')).length; } catch (e) {}
        }
        const csvPath = path.join(codeMAPDir, 'Employee Database - Employees.csv');
        if (fs.existsSync(csvPath)) {
          try {
            const lines = fs.readFileSync(csvPath, 'utf-8').replace(/\r/g, '').split('\n').filter(l => l.trim());
            sourceTeachers = Math.max(0, lines.length - 1);
          } catch (e) {}
        }
      }

      return { codeMAPExists, currentDevices: deviceCount, currentTeachers: teacherCount, sourceDevices, sourceTeachers };
    },
    'importPositionsFromGoogleSheet': () => {
      const codeMAPImport = require('../services/codeMAPImport');
      return codeMAPImport.importPositionsFromGoogleSheet();
    },
    'importRepairTemplatesFromGoogleSheet': () => {
      const codeMAPImport = require('../services/codeMAPImport');
      return codeMAPImport.importRepairTemplatesFromGoogleSheet();
    },

    // --- Google OAuth2 / Gmail API Email ---
    'msGraphSignIn': (clientId, clientSecret) => microsoftGraph.signIn(clientId, clientSecret),
    'msGraphSignOut': () => microsoftGraph.signOut(),
    'msGraphGetStatus': () => microsoftGraph.getSignInStatus(),
    'msGraphSendEmail': (to, subject, text, html, options) => microsoftGraph.sendGraphEmail(to, subject, text, html, options),
    'msGraphGetConfig': () => microsoftGraph.getGraphConfig(),
    'msGraphSaveConfig': (config) => microsoftGraph.saveGraphConfig(config),
  };

  return cachedHandlers;
}

module.exports = { buildHandlerRegistry };
