const db = require('../database/db');

// Standard Printer MIB Alert Codes (RFC 3805)
const PRINTER_ALERT_CODES = {
  1: 'Other Alert', 3: 'Cover Open', 4: 'Cover Closed', 5: 'Interlock Open',
  6: 'Interlock Closed', 7: 'Configuration Change', 8: 'Paper Jam', 9: 'Paper Jam Cleared',
  10: 'Toner Empty', 11: 'Toner Low', 12: 'Waste Toner Full', 13: 'Paper Empty',
  14: 'Paper Low', 15: 'Paper Added', 16: 'Door Open', 17: 'Door Closed',
  18: 'Power Up', 19: 'Power Down', 20: 'Device Offline', 21: 'Device Online',
  22: 'Input Tray Missing', 23: 'Output Tray Missing', 24: 'Marker Supply Missing',
  25: 'Output Tray Full', 26: 'Output Almost Full', 27: 'Marker Supply Empty',
  28: 'Marker Supply Low', 29: 'OPC Drum Near End', 30: 'OPC Drum End of Life',
  31: 'Developer Low', 32: 'Developer Empty', 41: 'Service Required',
  42: 'Multi-Feed Jam', 43: 'Fuser Over Temperature', 44: 'Fuser Under Temperature',
  45: 'Toner Low (Replace Soon)', 46: 'Misfeed',
  501: 'Tray 1 Paper Low', 502: 'Tray 2 Paper Low', 503: 'Tray 3 Paper Low', 504: 'Tray 4 Paper Low',
  1001: 'Black Toner Low', 1002: 'Cyan Toner Low', 1003: 'Magenta Toner Low', 1004: 'Yellow Toner Low'
};

const VENDOR_ALERT_CODES = {
  800: { message: 'Normal Operation', severity: 'info', ignore: true },
  801: { message: 'Ready', severity: 'info', ignore: true },
  802: { message: 'Warming Up', severity: 'info', ignore: true },
  803: { message: 'Energy Saver Mode', severity: 'info', ignore: true },
  804: { message: 'Sleep Mode', severity: 'info', ignore: true },
  805: { message: 'Paper Jam', severity: 'critical' },
  806: { message: 'Cover Open', severity: 'warning' },
  807: { message: 'Paper Low', severity: 'warning' },
  808: { message: 'Input Tray Empty', severity: 'warning' },
  809: { message: 'Toner Low', severity: 'warning' },
  810: { message: 'Toner Empty', severity: 'critical' },
  811: { message: 'Waste Toner Almost Full', severity: 'warning' },
  812: { message: 'Waste Toner Full', severity: 'critical' },
  813: { message: 'Drum Near End', severity: 'warning' },
  814: { message: 'Drum End of Life', severity: 'critical' },
  815: { message: 'Developer Low', severity: 'warning' },
  816: { message: 'Fuser Error', severity: 'critical' },
  817: { message: 'Service Required', severity: 'critical' },
  818: { message: 'Multi-Feed Jam', severity: 'critical' },
  819: { message: 'Output Tray Full', severity: 'warning' },
  820: { message: 'Staple Empty', severity: 'warning' },
  821: { message: 'Staple Jam', severity: 'critical' },
  822: { message: 'Punch Waste Full', severity: 'warning' },
  823: { message: 'Door Open', severity: 'warning' },
  824: { message: 'Misfeed', severity: 'critical' },
  825: { message: 'Communication Error', severity: 'critical' },
  10003: { message: 'Normal Operation', severity: 'info', ignore: true },
  10033: { message: 'Energy Saver Mode', severity: 'info', ignore: true },
  10034: { message: 'Sleep Mode', severity: 'info', ignore: true },
  13100: { message: 'Toner OK', severity: 'info', ignore: true },
  13200: { message: 'Drum OK', severity: 'info', ignore: true },
  13300: { message: 'Fuser OK', severity: 'info', ignore: true },
  13400: { message: 'Paper Feed OK', severity: 'info', ignore: true },
  13500: { message: 'Output OK', severity: 'info', ignore: true }
};

const ALERT_GROUP_CONTEXT = {
  5: { msg: 'General Printer Alert', sev: 'warning' },
  6: { msg: 'Cover/Door Alert', sev: 'warning' },
  8: { msg: 'Input/Paper Tray Alert', sev: 'warning' },
  9: { msg: 'Output Tray Alert', sev: 'warning' },
  10: { msg: 'Marker Alert', sev: 'warning' },
  11: { msg: 'Toner/Supply Alert', sev: 'warning' },
  12: { msg: 'Colorant Alert', sev: 'warning' },
  13: { msg: 'Paper Path Alert', sev: 'warning' },
  14: { msg: 'Channel Alert', sev: 'info' },
  15: { msg: 'Interpreter Alert', sev: 'info' },
  30: { msg: 'Finisher Alert', sev: 'warning' },
  31: { msg: 'Finisher Supply Alert', sev: 'warning' },
  32: { msg: 'Finisher Media Input Alert', sev: 'warning' }
};

const CRITICAL_CODES = [8, 10, 12, 13, 20, 27, 30, 32, 42, 43, 44, 46];
const WARNING_CODES = [11, 14, 25, 26, 28, 29, 31, 41, 45];
const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };

const PROBLEM_PATTERNS = [
  { pattern: /paper\s*jam/i, message: 'Paper Jam', severity: 'critical' },
  { pattern: /misfeed/i, message: 'Misfeed', severity: 'critical' },
  { pattern: /toner\s*(empty|out)/i, message: 'Toner Empty', severity: 'critical' },
  { pattern: /toner\s*low/i, message: 'Toner Low', severity: 'warning' },
  { pattern: /ink\s*(empty|out)/i, message: 'Ink Empty', severity: 'critical' },
  { pattern: /ink\s*low/i, message: 'Ink Low', severity: 'warning' },
  { pattern: /paper\s*(empty|out)/i, message: 'Paper Empty', severity: 'critical' },
  { pattern: /paper\s*low/i, message: 'Paper Low', severity: 'warning' },
  { pattern: /cover\s*open/i, message: 'Cover Open', severity: 'warning' },
  { pattern: /door\s*open/i, message: 'Door Open', severity: 'warning' },
  { pattern: /drum\s*(empty|end|life)/i, message: 'Drum End of Life', severity: 'critical' },
  { pattern: /drum\s*low/i, message: 'Drum Near End of Life', severity: 'warning' },
  { pattern: /waste\s*toner/i, message: 'Waste Toner Full', severity: 'critical' },
  { pattern: /fuser/i, message: 'Fuser Error', severity: 'critical' },
  { pattern: /offline/i, message: 'Device Offline', severity: 'critical' },
  { pattern: /service\s*(call|required|request)/i, message: 'Service Required', severity: 'critical' },
  { pattern: /staple/i, message: 'Staples Low/Empty', severity: 'warning' },
  { pattern: /output\s*full/i, message: 'Output Tray Full', severity: 'warning' },
  { pattern: /warming/i, message: 'Warming Up', severity: 'info' },
  { pattern: /ready/i, message: 'Ready', severity: 'info' },
  { pattern: /error/i, message: 'Device Error', severity: 'warning' },
  { pattern: /alert/i, message: 'Device Alert', severity: 'info' }
];

function parseAlertEntry(entry) {
  var entryMsg = '';
  var entrySev = 'info';
  var stdCode = parseInt(entry['7']) || 0;
  var vendorCode = parseInt(entry['6']) || 0;
  var alertGroup = parseInt(entry['4']) || 0;
  var alertDesc = entry['8'] ? String(entry['8']).trim() : '';

  if (stdCode >= 2 && stdCode <= 46 && PRINTER_ALERT_CODES[stdCode]) {
    entryMsg = PRINTER_ALERT_CODES[stdCode];
    if (CRITICAL_CODES.indexOf(stdCode) >= 0) entrySev = 'critical';
    else if (WARNING_CODES.indexOf(stdCode) >= 0) entrySev = 'warning';
  }

  if (vendorCode > 0 && VENDOR_ALERT_CODES[vendorCode]) {
    var vendorInfo = VENDOR_ALERT_CODES[vendorCode];
    if (vendorInfo.ignore) return { message: vendorInfo.message, severity: 'info', ignore: true };
    entryMsg = vendorInfo.message;
    entrySev = vendorInfo.severity || 'warning';
  }

  if (alertDesc && alertDesc.length > 3 && alertDesc.indexOf('0x') !== 0) {
    var cleanDesc = alertDesc.replace(/\s*\{\d+\}\s*$/, '').trim();
    if (cleanDesc.length > 3 && (!entryMsg || entryMsg === 'Other Alert' || entryMsg === 'Device Alert')) {
      entryMsg = cleanDesc;
    }
  }

  if ((!entryMsg || entryMsg === 'Other Alert' || entryMsg === 'Device Alert') && alertGroup > 0) {
    var ctx = ALERT_GROUP_CONTEXT[alertGroup];
    if (ctx) {
      entryMsg = ctx.msg;
      if (entrySev === 'info') entrySev = ctx.sev;
    }
  }

  return { message: entryMsg, severity: entrySev, ignore: false };
}

function parseTrapMessage(trapData) {
  let message = '';
  let severity = 'info';

  try {
    if (trapData) {
      if (trapData.alertCode) {
        const code = parseInt(trapData.alertCode);
        if (PRINTER_ALERT_CODES[code]) {
          message = PRINTER_ALERT_CODES[code];
          if (CRITICAL_CODES.indexOf(code) >= 0) severity = 'critical';
          else if (WARNING_CODES.indexOf(code) >= 0) severity = 'warning';
        }
      }

      if (trapData.message && typeof trapData.message === 'string' && trapData.message.trim()) {
        message = trapData.message.trim();
        for (const prob of PROBLEM_PATTERNS) {
          if (prob.pattern.test(message)) { severity = prob.severity; break; }
        }
      }

      if ((!message || message === 'Device Alert' || message === 'SNMP Alert') && trapData.decodedVarbinds) {
        const vb = trapData.decodedVarbinds;
        var alertEntries = {};
        var supplyLevel = null;
        var supplyName = '';

        for (const [oid, value] of Object.entries(vb)) {
          var alertMatch = oid.match(/43\.18\.1\.1\.(\d+)(?:\.(\d+))?$/);
          if (alertMatch) {
            var field = alertMatch[1];
            var index = alertMatch[2] || '0';
            if (!alertEntries[index]) alertEntries[index] = {};
            alertEntries[index][field] = value;
          }
          if (oid.indexOf('1.3.6.1.2.1.43.11.1.1.9') >= 0) supplyLevel = parseInt(value) || 0;
          if (oid.indexOf('1.3.6.1.2.1.43.11.1.1.6') >= 0 && value) supplyName = String(value).trim();
        }

        var entryKeys = Object.keys(alertEntries);
        if (entryKeys.length > 0) {
          var bestAlert = null;
          for (var ei = 0; ei < entryKeys.length; ei++) {
            var parsed = parseAlertEntry(alertEntries[entryKeys[ei]]);
            if (parsed.ignore) continue;
            if (!bestAlert || (SEVERITY_RANK[parsed.severity] || 0) > (SEVERITY_RANK[bestAlert.severity] || 0)) bestAlert = parsed;
            if (bestAlert && (SEVERITY_RANK[parsed.severity] || 0) === (SEVERITY_RANK[bestAlert.severity] || 0)) {
              if ((!bestAlert.message || bestAlert.message === 'Device Alert') && parsed.message && parsed.message !== 'Device Alert') bestAlert = parsed;
            }
          }
          if (bestAlert && bestAlert.message) { message = bestAlert.message; severity = bestAlert.severity; }
        } else {
          var stdAlertCode = 0, vendorCode2 = 0, alertGroup = 0, alertDesc = '';
          for (const [oid, value] of Object.entries(vb)) {
            if (oid.indexOf('1.3.6.1.2.1.43.18.1.1.7') >= 0) stdAlertCode = parseInt(value) || 0;
            if (oid.indexOf('1.3.6.1.2.1.43.18.1.1.6') >= 0) vendorCode2 = parseInt(value) || 0;
            if (oid.indexOf('1.3.6.1.2.1.43.18.1.1.4') >= 0) alertGroup = parseInt(value) || 0;
            if (oid.indexOf('1.3.6.1.2.1.43.18.1.1.8') >= 0 && value) alertDesc = String(value).trim();
          }
          var flatParsed = parseAlertEntry({ '7': stdAlertCode, '6': vendorCode2, '4': alertGroup, '8': alertDesc });
          if (flatParsed.message && !flatParsed.ignore) { message = flatParsed.message; severity = flatParsed.severity; }
        }

        if (supplyLevel !== null && supplyLevel >= 0) {
          var displayName = supplyName || 'Toner/Supply';
          if (supplyLevel <= 5) { message = displayName + ' Empty (' + supplyLevel + '%)'; severity = 'critical'; }
          else if (supplyLevel > 5 && supplyLevel <= 20) { message = displayName + ' Low (' + supplyLevel + '%)'; severity = 'warning'; }
        }
      }

      if ((!message || message === 'Device Alert' || message === 'SNMP Alert') && trapData.pdu && trapData.pdu.varbinds && Array.isArray(trapData.pdu.varbinds)) {
        for (const vb of trapData.pdu.varbinds) {
          if (!vb.oid) continue;
          if (vb.oid.includes('1.3.6.1.2.1.43.18.1.1.7')) {
            const code = parseInt(vb.value);
            if (PRINTER_ALERT_CODES[code]) {
              message = PRINTER_ALERT_CODES[code];
              if (CRITICAL_CODES.indexOf(code) >= 0) severity = 'critical';
              else if (WARNING_CODES.indexOf(code) >= 0) severity = 'warning';
            }
          }
          if (vb.oid.includes('1.3.6.1.2.1.43.11.1.1.9') && typeof vb.value === 'number') {
            if (vb.value <= 5) { message = 'Supply Empty (' + vb.value + '%)'; severity = 'critical'; }
            else if (vb.value <= 20) { message = 'Supply Low (' + vb.value + '%)'; severity = 'warning'; }
          }
          if (vb.oid.includes('1.3.6.1.2.1.43.18.1.1.8') && vb.value) {
            const desc = String(vb.value).trim();
            if (desc.length > 3 && (!message || message === 'Device Alert' || message === 'Other Alert')) message = desc;
          }
          if (typeof vb.value === 'string' && vb.value.length > 3) {
            const val = vb.value.trim();
            if (!/^[\d\.]+$/.test(val) && !/^[0-9a-f]+$/i.test(val)) {
              for (const prob of PROBLEM_PATTERNS) {
                if (prob.pattern.test(val)) { message = prob.message; severity = prob.severity; break; }
              }
              if (!message && val.length >= 5 && val.length <= 100) message = val.substring(0, 80);
            }
          }
        }
      }

      if ((!message || message === 'Device Alert') && trapData.varbinds && Array.isArray(trapData.varbinds)) {
        for (const vb of trapData.varbinds) {
          if (typeof vb.value === 'string' && vb.value.length > 3) {
            const val = vb.value.trim();
            if (!/^[\d\.]+$/.test(val) && !/^[0-9a-f]+$/i.test(val)) {
              for (const prob of PROBLEM_PATTERNS) {
                if (prob.pattern.test(val)) { message = prob.message; severity = prob.severity; break; }
              }
              if (!message && val.length >= 5 && val.length <= 100) message = val.substring(0, 80);
            }
          }
        }
      }

      if (trapData.type === 'polled_alert') {
        if (trapData.supply) {
          const level = trapData.supply.percentage || 0;
          const name = trapData.supply.name || 'Supply';
          if (level <= 5) { message = name + ' Empty (' + level + '%)'; severity = 'critical'; }
          else if (level <= 20) { message = name + ' Low (' + level + '%)'; severity = 'warning'; }
        }
        if (trapData.alert && trapData.alert.text) { message = trapData.alert.text; severity = trapData.alert.severity || 'warning'; }
      }

      if (!message && trapData.rawData && typeof trapData.rawData === 'string') {
        for (const prob of PROBLEM_PATTERNS) {
          if (prob.pattern.test(trapData.rawData)) { message = prob.message; severity = prob.severity; break; }
        }
      }

      if (!message && trapData.oid) {
        const oid = trapData.oid;
        if (oid.includes('43.18')) { message = 'Printer Alert'; severity = 'warning'; }
        else if (oid.includes('43.11')) { message = 'Supply Status Change'; severity = 'info'; }
        else if (oid.includes('25.3.5')) { message = 'Printer Status Change'; severity = 'info'; }
      }

      if (!message && trapData.decodedVarbinds) {
        var hasAlertOid = Object.keys(trapData.decodedVarbinds).some(oid => oid.indexOf('43.18') >= 0);
        if (hasAlertOid) { message = 'Printer Alert (unrecognized code)'; severity = 'warning'; }
      }

      if (!message && trapData.varbindSummary && typeof trapData.varbindSummary === 'string') {
        var summaryMatch = trapData.varbindSummary.match(/alertGroup=(\d+)/);
        if (summaryMatch) {
          var grp = parseInt(summaryMatch[1]);
          var grpCtx = ALERT_GROUP_CONTEXT[grp];
          if (grpCtx) { message = grpCtx.msg; severity = grpCtx.sev; }
        }
        if (!message) {
          var vendorMatch = trapData.varbindSummary.match(/vendorCode=(\d+)/);
          if (vendorMatch) {
            var vc = parseInt(vendorMatch[1]);
            if (VENDOR_ALERT_CODES[vc] && !VENDOR_ALERT_CODES[vc].ignore) {
              message = VENDOR_ALERT_CODES[vc].message;
              severity = VENDOR_ALERT_CODES[vc].severity || 'warning';
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('Error parsing trap:', e);
  }

  if (!message) message = 'SNMP Alert';
  return { message, severity };
}

function getTraps(limit = 100) {
  try {
    let traps = db.query('SELECT * FROM snmp_traps ORDER BY receivedAt DESC LIMIT ?', [limit]);
    return traps.map(t => {
      let trapData = {};
      try { trapData = t.trapData ? JSON.parse(t.trapData) : {}; } catch (e) {}
      return { ...t, trapData };
    });
  } catch (error) {
    console.error('Error getting traps:', error);
    return [];
  }
}

function addTrap(data) {
  try {
    const now = new Date().toISOString();
    const trapId = db.generateId();

    let message = data.parsedMessage;
    let severity = data.severity;

    if (!message || message === 'Device Alert' || message === 'SNMP Alert' || !severity) {
      const parsed = parseTrapMessage(data.trapData);
      if (parsed.message && parsed.message !== 'SNMP Alert') message = parsed.message;
      severity = severity || parsed.severity;
    }

    db.insert('snmp_traps', {
      id: trapId,
      sourceIp: data.sourceIp || 'unknown',
      trapData: JSON.stringify(data.trapData || {}),
      parsedMessage: message,
      severity: severity,
      receivedAt: now,
      processed: 0,
      resolvedAt: '',
      resolvedBy: '',
      assignedTo: '',
      assignedAt: ''
    });

    return { success: true, trapId };
  } catch (error) {
    console.error('Error adding trap:', error);
    return { success: false, error: error.message };
  }
}

function resolveTrap(trapId, resolvedBy) {
  try {
    const now = new Date().toISOString();
    const result = db.run(
      'UPDATE snmp_traps SET processed = 1, resolvedAt = ?, resolvedBy = ? WHERE id = ?',
      [now, resolvedBy || 'User', trapId]
    );
    if (result.changes > 0) return { success: true };
    return { success: false, error: 'Trap not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function resolveTrapsByIp(sourceIp, resolvedBy) {
  try {
    const now = new Date().toISOString();
    const result = db.run(
      'UPDATE snmp_traps SET processed = 1, resolvedAt = ?, resolvedBy = ? WHERE sourceIp = ? AND processed = 0',
      [now, resolvedBy || 'User', sourceIp]
    );
    return { success: true, resolved: result.changes };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function reprocessAllTraps() {
  try {
    const traps = db.query("SELECT id, trapData, parsedMessage FROM snmp_traps WHERE parsedMessage IS NULL OR parsedMessage = '' OR parsedMessage = 'Device Alert' OR parsedMessage = 'SNMP Alert'");
    let updatedCount = 0;

    for (const trap of traps) {
      try {
        let trapData = {};
        if (trap.trapData) trapData = JSON.parse(trap.trapData);
        const parsed = parseTrapMessage(trapData);
        if (parsed.message && parsed.message !== 'SNMP Alert') {
          db.run('UPDATE snmp_traps SET parsedMessage = ?, severity = ? WHERE id = ?',
            [parsed.message, parsed.severity, trap.id]);
          updatedCount++;
        }
      } catch (e) {}
    }

    return { success: true, message: 'Reprocessed all traps', updated: updatedCount, total: traps.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function assignTrap(trapId, technicianName) {
  try {
    const now = new Date().toISOString();
    const result = db.run(
      'UPDATE snmp_traps SET assignedTo = ?, assignedAt = ? WHERE id = ?',
      [technicianName, now, trapId]
    );
    if (result.changes > 0) return { success: true, message: 'Trap assigned to ' + technicianName };
    return { success: false, error: 'Trap not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function assignTrapsByIp(sourceIp, technicianName) {
  try {
    const now = new Date().toISOString();
    const result = db.run(
      'UPDATE snmp_traps SET assignedTo = ?, assignedAt = ? WHERE sourceIp = ? AND processed = 0',
      [technicianName, now, sourceIp]
    );
    return { success: true, assigned: result.changes, message: result.changes + ' trap(s) assigned to ' + technicianName };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function unassignTrap(trapId) {
  try {
    const result = db.run(
      'UPDATE snmp_traps SET assignedTo = \'\', assignedAt = \'\' WHERE id = ?', [trapId]
    );
    if (result.changes > 0) return { success: true };
    return { success: false, error: 'Trap not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getTrapsWithAssignments(limit) {
  limit = limit || 100;
  try {
    let traps = db.query('SELECT * FROM snmp_traps ORDER BY receivedAt DESC LIMIT ?', [limit]);
    return traps.map(t => {
      let trapData = {};
      try { trapData = t.trapData ? JSON.parse(t.trapData) : {}; } catch (e) {}
      return { ...t, trapData };
    });
  } catch (error) {
    console.error('Error getting traps with assignments:', error);
    return [];
  }
}

function clearAllTraps() {
  try {
    db.deleteAll('snmp_traps');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  getTraps, addTrap, resolveTrap, resolveTrapsByIp, parseTrapMessage,
  reprocessAllTraps, assignTrap, assignTrapsByIp, unassignTrap,
  getTrapsWithAssignments, clearAllTraps
};
