const express = require('express');
const router = express.Router();
const { db, generateId, getAll, getById, getByColumn, insert, update, updateField, remove, clearTable, count } = require('../db/database');

// ============================================
// TRAP MESSAGE PARSING
// ============================================

/**
 * Parse SNMP trap data into a human-readable message and severity.
 * Ported verbatim from Code.gs parseTrapMessage (lines 1089-1528).
 */
function parseTrapMessage(trapData) {
  // Standard Printer MIB Alert Codes (RFC 3805)
  const PRINTER_ALERT_CODES = {
    1: 'Other Alert',
    3: 'Cover Open',
    4: 'Cover Closed',
    5: 'Interlock Open',
    6: 'Interlock Closed',
    7: 'Configuration Change',
    8: 'Paper Jam',
    9: 'Paper Jam Cleared',
    10: 'Toner Empty',
    11: 'Toner Low',
    12: 'Waste Toner Full',
    13: 'Paper Empty',
    14: 'Paper Low',
    15: 'Paper Added',
    16: 'Door Open',
    17: 'Door Closed',
    18: 'Power Up',
    19: 'Power Down',
    20: 'Device Offline',
    21: 'Device Online',
    22: 'Input Tray Missing',
    23: 'Output Tray Missing',
    24: 'Marker Supply Missing',
    25: 'Output Tray Full',
    26: 'Output Almost Full',
    27: 'Marker Supply Empty',
    28: 'Marker Supply Low',
    29: 'OPC Drum Near End',
    30: 'OPC Drum End of Life',
    31: 'Developer Low',
    32: 'Developer Empty',
    41: 'Service Required',
    42: 'Multi-Feed Jam',
    43: 'Fuser Over Temperature',
    44: 'Fuser Under Temperature',
    45: 'Toner Low (Replace Soon)',
    46: 'Misfeed',
    501: 'Tray 1 Paper Low',
    502: 'Tray 2 Paper Low',
    503: 'Tray 3 Paper Low',
    504: 'Tray 4 Paper Low',
    1001: 'Black Toner Low',
    1002: 'Cyan Toner Low',
    1003: 'Magenta Toner Low',
    1004: 'Yellow Toner Low'
  };

  // Sharp vendor codes (BP-series copiers)
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
    // Ricoh vendor codes
    10003: { message: 'Normal Operation', severity: 'info', ignore: true },
    10033: { message: 'Energy Saver Mode', severity: 'info', ignore: true },
    10034: { message: 'Sleep Mode', severity: 'info', ignore: true },
    13100: { message: 'Toner OK', severity: 'info', ignore: true },
    13200: { message: 'Drum OK', severity: 'info', ignore: true },
    13300: { message: 'Fuser OK', severity: 'info', ignore: true },
    13400: { message: 'Paper Feed OK', severity: 'info', ignore: true },
    13500: { message: 'Output OK', severity: 'info', ignore: true }
  };

  // Alert Group context mapping (RFC 3805 prtAlertGroup)
  const ALERT_GROUP_CONTEXT = {
    5:  { msg: 'General Printer Alert', sev: 'warning' },
    6:  { msg: 'Cover/Door Alert', sev: 'warning' },
    8:  { msg: 'Input/Paper Tray Alert', sev: 'warning' },
    9:  { msg: 'Output Tray Alert', sev: 'warning' },
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

  // Common problem keywords to detect in raw text
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

  // Helper: parse a single alert entry (one set of alert fields by index)
  function parseAlertEntry(entry) {
    var entryMsg = '';
    var entrySev = 'info';
    var stdCode = parseInt(entry['7']) || 0;
    var vendorCode = parseInt(entry['6']) || 0;
    var alertGroup = parseInt(entry['4']) || 0;
    var alertDesc = entry['8'] ? String(entry['8']).trim() : '';

    // 1. Standard alert code
    if (stdCode >= 2 && stdCode <= 46 && PRINTER_ALERT_CODES[stdCode]) {
      entryMsg = PRINTER_ALERT_CODES[stdCode];
      if (CRITICAL_CODES.indexOf(stdCode) >= 0) entrySev = 'critical';
      else if (WARNING_CODES.indexOf(stdCode) >= 0) entrySev = 'warning';
    }

    // 2. Vendor-specific code
    if (vendorCode > 0 && VENDOR_ALERT_CODES[vendorCode]) {
      var vendorInfo = VENDOR_ALERT_CODES[vendorCode];
      if (vendorInfo.ignore) {
        entryMsg = vendorInfo.message;
        entrySev = 'info';
        return { message: entryMsg, severity: entrySev, ignore: true };
      }
      entryMsg = vendorInfo.message;
      entrySev = vendorInfo.severity || 'warning';
    }

    // 3. Alert description
    if (alertDesc && alertDesc.length > 3 && alertDesc.indexOf('0x') !== 0) {
      var cleanDesc = alertDesc.replace(/\s*\{\d+\}\s*$/, '').trim();
      if (cleanDesc.length > 3 && (!entryMsg || entryMsg === 'Other Alert' || entryMsg === 'Device Alert')) {
        entryMsg = cleanDesc;
      }
    }

    // 4. Alert group context — when stdAlertCode=1 and no specific message
    if ((!entryMsg || entryMsg === 'Other Alert' || entryMsg === 'Device Alert') && alertGroup > 0) {
      var ctx = ALERT_GROUP_CONTEXT[alertGroup];
      if (ctx) {
        entryMsg = ctx.msg;
        if (entrySev === 'info') entrySev = ctx.sev;
      }
    }

    return { message: entryMsg, severity: entrySev, ignore: false };
  }

  let message = '';
  let severity = 'info';

  try {
    if (trapData) {
      // Check for alert code in various formats
      if (trapData.alertCode) {
        const code = parseInt(trapData.alertCode);
        if (PRINTER_ALERT_CODES[code]) {
          message = PRINTER_ALERT_CODES[code];
          if (CRITICAL_CODES.indexOf(code) >= 0) severity = 'critical';
          else if (WARNING_CODES.indexOf(code) >= 0) severity = 'warning';
        }
      }

      // Check for direct message text from gateway
      if (trapData.message && typeof trapData.message === 'string' && trapData.message.trim()) {
        message = trapData.message.trim();
        for (const prob of PROBLEM_PATTERNS) {
          if (prob.pattern.test(message)) {
            severity = prob.severity;
            break;
          }
        }
      }

      // Check for BER-decoded varbinds from gateway (decodedVarbinds)
      if ((!message || message === 'Device Alert' || message === 'SNMP Alert') && trapData.decodedVarbinds) {
        const vb = trapData.decodedVarbinds;

        // Group varbinds by alert table index (.43.18.1.1.FIELD.INDEX)
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
          if (oid.indexOf('1.3.6.1.2.1.43.11.1.1.9') >= 0) {
            supplyLevel = parseInt(value) || 0;
          }
          if (oid.indexOf('1.3.6.1.2.1.43.11.1.1.6') >= 0 && value) {
            supplyName = String(value).trim();
          }
        }

        // Parse each alert entry and pick the most critical non-ignored one
        var entryKeys = Object.keys(alertEntries);
        if (entryKeys.length > 0) {
          var bestAlert = null;
          for (var ei = 0; ei < entryKeys.length; ei++) {
            var parsed = parseAlertEntry(alertEntries[entryKeys[ei]]);
            if (parsed.ignore) continue;
            if (!bestAlert || (SEVERITY_RANK[parsed.severity] || 0) > (SEVERITY_RANK[bestAlert.severity] || 0)) {
              bestAlert = parsed;
            }
            if (bestAlert && (SEVERITY_RANK[parsed.severity] || 0) === (SEVERITY_RANK[bestAlert.severity] || 0)) {
              if ((!bestAlert.message || bestAlert.message === 'Device Alert') && parsed.message && parsed.message !== 'Device Alert') {
                bestAlert = parsed;
              }
            }
          }
          if (bestAlert && bestAlert.message) {
            message = bestAlert.message;
            severity = bestAlert.severity;
          }
        } else {
          // No structured entries — try flat varbind parsing (legacy)
          var stdAlertCode = 0;
          var vendorCode = 0;
          var alertGroup = 0;
          var alertDesc = '';
          for (const [oid, value] of Object.entries(vb)) {
            if (oid.indexOf('1.3.6.1.2.1.43.18.1.1.7') >= 0) stdAlertCode = parseInt(value) || 0;
            if (oid.indexOf('1.3.6.1.2.1.43.18.1.1.6') >= 0) vendorCode = parseInt(value) || 0;
            if (oid.indexOf('1.3.6.1.2.1.43.18.1.1.4') >= 0) alertGroup = parseInt(value) || 0;
            if (oid.indexOf('1.3.6.1.2.1.43.18.1.1.8') >= 0 && value) alertDesc = String(value).trim();
          }
          var flatParsed = parseAlertEntry({ '7': stdAlertCode, '6': vendorCode, '4': alertGroup, '8': alertDesc });
          if (flatParsed.message && !flatParsed.ignore) {
            message = flatParsed.message;
            severity = flatParsed.severity;
          }
        }

        // Supply level check
        if (supplyLevel !== null && supplyLevel >= 0) {
          var displayName = supplyName || 'Toner/Supply';
          if (supplyLevel <= 5) { message = displayName + ' Empty (' + supplyLevel + '%)'; severity = 'critical'; }
          else if (supplyLevel > 5 && supplyLevel <= 20) { message = displayName + ' Low (' + supplyLevel + '%)'; severity = 'warning'; }
        }
      }

      // Check pdu varbinds format
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
            if (desc.length > 3 && (!message || message === 'Device Alert' || message === 'Other Alert')) {
              message = desc;
            }
          }

          if (typeof vb.value === 'string' && vb.value.length > 3) {
            const val = vb.value.trim();
            if (!/^[\d\.]+$/.test(val) && !/^[0-9a-f]+$/i.test(val)) {
              for (const prob of PROBLEM_PATTERNS) {
                if (prob.pattern.test(val)) {
                  message = prob.message;
                  severity = prob.severity;
                  break;
                }
              }
              if (!message && val.length >= 5 && val.length <= 100) {
                message = val.substring(0, 80);
              }
            }
          }
        }
      }

      // Check for varbinds array directly (alternative format)
      if ((!message || message === 'Device Alert') && trapData.varbinds && Array.isArray(trapData.varbinds)) {
        for (const vb of trapData.varbinds) {
          if (typeof vb.value === 'string' && vb.value.length > 3) {
            const val = vb.value.trim();
            if (!/^[\d\.]+$/.test(val) && !/^[0-9a-f]+$/i.test(val)) {
              for (const prob of PROBLEM_PATTERNS) {
                if (prob.pattern.test(val)) {
                  message = prob.message;
                  severity = prob.severity;
                  break;
                }
              }
              if (!message && val.length >= 5 && val.length <= 100) {
                message = val.substring(0, 80);
              }
            }
          }
        }
      }

      // Check for polled_alert type (from device polling)
      if (trapData.type === 'polled_alert') {
        if (trapData.supply) {
          const level = trapData.supply.percentage || 0;
          const name = trapData.supply.name || 'Supply';
          if (level <= 5) {
            message = name + ' Empty (' + level + '%)';
            severity = 'critical';
          } else if (level <= 20) {
            message = name + ' Low (' + level + '%)';
            severity = 'warning';
          }
        }
        if (trapData.alert && trapData.alert.text) {
          message = trapData.alert.text;
          severity = trapData.alert.severity || 'warning';
        }
      }

      // Check rawData field (from gateway)
      if (!message && trapData.rawData && typeof trapData.rawData === 'string') {
        const rawStr = trapData.rawData;
        for (const prob of PROBLEM_PATTERNS) {
          if (prob.pattern.test(rawStr)) {
            message = prob.message;
            severity = prob.severity;
            break;
          }
        }
      }

      // Check for OID-specific messages
      if (!message && trapData.oid) {
        const oid = trapData.oid;
        if (oid.includes('43.18')) {
          message = 'Printer Alert';
          severity = 'warning';
        } else if (oid.includes('43.11')) {
          message = 'Supply Status Change';
          severity = 'info';
        } else if (oid.includes('25.3.5')) {
          message = 'Printer Status Change';
          severity = 'info';
        }
      }

      // Safe raw hex fallback — check for printer alert OIDs in decoded data
      // (Replaces unreliable byte-scanning that caused false positives)
      if (!message && trapData.decodedVarbinds) {
        var hasAlertOid = Object.keys(trapData.decodedVarbinds).some(function(oid) {
          return oid.indexOf('43.18') >= 0;
        });
        if (hasAlertOid) {
          message = 'Printer Alert (unrecognized code)';
          severity = 'warning';
        }
      }

      // Use varbind summary if available and still no message
      if (!message && trapData.varbindSummary && typeof trapData.varbindSummary === 'string') {
        // Extract any useful info from the summary
        var summaryMatch = trapData.varbindSummary.match(/alertGroup=(\d+)/);
        if (summaryMatch) {
          var grp = parseInt(summaryMatch[1]);
          var grpCtx = ALERT_GROUP_CONTEXT[grp];
          if (grpCtx) {
            message = grpCtx.msg;
            severity = grpCtx.sev;
          }
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
    console.log('Error parsing trap: ' + e);
  }

  // Fallback to generic message
  if (!message) {
    message = 'SNMP Alert';
  }

  return { message: message, severity: severity };
}

// ============================================
// TRAP ROUTES
// ============================================

/**
 * Get traps with parsed trapData, sorted by receivedAt DESC
 */
router.post('/getTraps', (req, res) => {
  try {
    const [limit = 100] = req.body.args || [];
    let traps = getAll('snmp_traps');

    // Parse trap data (safely per-trap)
    traps = traps.map(t => {
      var trapData = {};
      try {
        trapData = t.trapData ? JSON.parse(t.trapData) : {};
      } catch (e) {
        console.log('Bad JSON in trapData for trap ' + (t.id || 'unknown') + ': ' + e.message);
      }
      return { ...t, trapData: trapData };
    });

    // Sort by receivedAt descending
    traps.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));

    res.json(traps.slice(0, limit));
  } catch (error) {
    console.log('Error getting traps: ' + error);
    res.json([]);
  }
});

/**
 * Add a new trap
 */
router.post('/addTrap', (req, res) => {
  try {
    const [data] = req.body.args || [];
    const now = new Date().toISOString();
    const trapId = generateId();

    // Use pre-parsed message and severity from gateway if provided,
    // otherwise fall back to parsing trapData
    let message = data.parsedMessage;
    let severity = data.severity;

    // If gateway sent a generic fallback message, try our own parser too
    if (!message || message === 'Device Alert' || message === 'SNMP Alert' || !severity) {
      const parsed = parseTrapMessage(data.trapData);
      // Only override if our parser found something better
      if (parsed.message && parsed.message !== 'SNMP Alert') {
        message = parsed.message;
      }
      severity = severity || parsed.severity;
    }

    const trapRow = {
      id: trapId,
      sourceIp: data.sourceIp || 'unknown',
      trapData: JSON.stringify(data.trapData || {}),
      parsedMessage: message,
      severity: severity,
      receivedAt: now,
      processed: '0',
      resolvedAt: '',
      resolvedBy: '',
      assignedTo: '',
      assignedAt: ''
    };

    insert('snmp_traps', trapRow);

    console.log('Added trap: ' + trapId + ' - ' + message + ' (' + severity + ')');
    res.json({ success: true, trapId: trapId });
  } catch (error) {
    console.log('Error adding trap: ' + error.message);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Resolve a single trap by ID
 */
router.post('/resolveTrap', (req, res) => {
  try {
    const [trapId, resolvedBy] = req.body.args || [];
    const existing = getById('snmp_traps', trapId);

    if (existing) {
      const now = new Date().toISOString();
      updateField('snmp_traps', trapId, 'processed', '1');
      updateField('snmp_traps', trapId, 'resolvedAt', now);
      updateField('snmp_traps', trapId, 'resolvedBy', resolvedBy || 'User');
      res.json({ success: true });
    } else {
      res.json({ success: false, error: 'Trap not found' });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * Resolve all unresolved traps from a given IP
 */
router.post('/resolveTrapsByIp', (req, res) => {
  try {
    const [sourceIp, resolvedBy] = req.body.args || [];
    const now = new Date().toISOString();

    // Get all traps for this IP that are unresolved
    const traps = getByColumn('snmp_traps', 'sourceIp', sourceIp);
    let resolvedCount = 0;

    for (const trap of traps) {
      if (trap.processed === '0' || trap.processed === 0) {
        updateField('snmp_traps', trap.id, 'processed', '1');
        updateField('snmp_traps', trap.id, 'resolvedAt', now);
        updateField('snmp_traps', trap.id, 'resolvedBy', resolvedBy || 'User');
        resolvedCount++;
      }
    }

    res.json({ success: true, resolved: resolvedCount });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * Assign a single trap to a technician
 */
router.post('/assignTrap', (req, res) => {
  try {
    const [trapId, technicianName] = req.body.args || [];
    const existing = getById('snmp_traps', trapId);
    const now = new Date().toISOString();

    if (existing) {
      updateField('snmp_traps', trapId, 'assignedTo', technicianName);
      updateField('snmp_traps', trapId, 'assignedAt', now);
      res.json({ success: true, message: 'Trap assigned to ' + technicianName });
    } else {
      res.json({ success: false, error: 'Trap not found' });
    }
  } catch (error) {
    console.log('Error assigning trap: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Assign all unresolved traps for a device IP to a technician
 */
router.post('/assignTrapsByIp', (req, res) => {
  try {
    const [sourceIp, technicianName] = req.body.args || [];
    const now = new Date().toISOString();

    const traps = getByColumn('snmp_traps', 'sourceIp', sourceIp);
    let assignedCount = 0;

    for (const trap of traps) {
      if (trap.processed === '0' || trap.processed === 0) {
        updateField('snmp_traps', trap.id, 'assignedTo', technicianName);
        updateField('snmp_traps', trap.id, 'assignedAt', now);
        assignedCount++;
      }
    }

    res.json({ success: true, assigned: assignedCount, message: assignedCount + ' trap(s) assigned to ' + technicianName });
  } catch (error) {
    console.log('Error assigning traps by IP: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Clear all traps
 */
router.post('/clearAllTraps', (req, res) => {
  try {
    const rowCount = count('snmp_traps');
    clearTable('snmp_traps');
    res.json({ success: true, cleared: rowCount });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * Reprocess all traps that have generic messages
 */
router.post('/reprocessAllTraps', (req, res) => {
  try {
    const traps = getAll('snmp_traps');

    if (traps.length === 0) {
      res.json({ success: true, message: 'No traps to process', updated: 0 });
      return;
    }

    let updatedCount = 0;

    for (const trap of traps) {
      const currentMessage = trap.parsedMessage;

      // Only reprocess if message is empty, generic, or missing
      if (!currentMessage || currentMessage === 'Device Alert' || currentMessage === 'SNMP Alert' || currentMessage.trim() === '') {
        try {
          let trapData = {};
          if (trap.trapData && typeof trap.trapData === 'string') {
            trapData = JSON.parse(trap.trapData);
          } else if (trap.trapData && typeof trap.trapData === 'object') {
            trapData = trap.trapData;
          }

          const parsed = parseTrapMessage(trapData);

          if (parsed.message && parsed.message !== 'SNMP Alert') {
            updateField('snmp_traps', trap.id, 'parsedMessage', parsed.message);

            // Update severity if we got a better one
            if (parsed.severity && parsed.severity !== 'info') {
              updateField('snmp_traps', trap.id, 'severity', parsed.severity);
            }

            updatedCount++;
            console.log('Updated trap ' + trap.id + ': ' + parsed.message + ' (' + parsed.severity + ')');
          }
        } catch (e) {
          console.log('Error processing trap ' + trap.id + ': ' + e);
        }
      }
    }

    res.json({
      success: true,
      message: 'Reprocessed all traps',
      updated: updatedCount,
      total: traps.length
    });
  } catch (error) {
    console.log('Error in reprocessAllTraps: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Parse a trap message (exposed as route for external callers)
 */
router.post('/parseTrapMessage', (req, res) => {
  try {
    const [trapData] = req.body.args || [];
    const result = parseTrapMessage(trapData);
    res.json(result);
  } catch (error) {
    res.json({ error: error.message });
  }
});

module.exports = router;
