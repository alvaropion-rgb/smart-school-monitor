/**
 * QR Codes Routes - Ported from Code.gs
 * Handles QR code generation, management, and label layout.
 */
const express = require('express');
const router = express.Router();
const { db, generateId, getAll, getById, getByColumn, insert, update, updateField, remove, getSetting, setSetting } = require('../db/database');
const config = require('../config');

// ============================================
// QR CODE MANAGEMENT
// ============================================

/**
 * getQRCodes - Get all QR codes
 */
router.post('/getQRCodes', (req, res) => {
  try {
    const qrCodes = getAll('qr_codes');
    res.json(qrCodes);
  } catch (error) {
    console.error('Error getting QR codes:', error);
    res.json([]);
  }
});

/**
 * generateQRCode - Create QR code record for a device
 * Args: [deviceId]
 * qrData URL = config.WEB_APP_URL + '/request?device=' + deviceId
 */
router.post('/generateQRCode', (req, res) => {
  try {
    const [deviceId] = req.body.args || [];
    const now = new Date().toISOString();
    const qrData = config.WEB_APP_URL + '/request?device=' + deviceId;

    // Check if QR already exists for this device
    const allQr = getAll('qr_codes');
    const existing = allQr.find(q => q.deviceId === deviceId);

    if (existing) {
      // Always update the URL to the current deployment
      if (existing.qrData !== qrData) {
        updateField('qr_codes', existing.id, 'qrData', qrData);
        existing.qrData = qrData;
      }
      return res.json({ success: true, qrCode: existing });
    }

    const data = {
      id: generateId(),
      deviceId: deviceId,
      qrData: qrData,
      generatedAt: now,
      printedAt: '',
      active: 'true'
    };

    insert('qr_codes', data);

    res.json({ success: true, qrCode: data });
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * generateQRCodesForDevices - Batch generate for array of device IDs
 * Args: [deviceIdsArray]
 */
router.post('/generateQRCodesForDevices', (req, res) => {
  try {
    const [deviceIds] = req.body.args || [];
    const results = [];
    const now = new Date().toISOString();
    const allQr = getAll('qr_codes');

    (deviceIds || []).forEach(deviceId => {
      try {
        const qrData = config.WEB_APP_URL + '/request?device=' + deviceId;
        const existing = allQr.find(q => q.deviceId === deviceId);

        if (existing) {
          if (existing.qrData !== qrData) {
            updateField('qr_codes', existing.id, 'qrData', qrData);
            existing.qrData = qrData;
          }
          results.push({ deviceId, success: true, qrCode: existing });
        } else {
          const data = {
            id: generateId(),
            deviceId: deviceId,
            qrData: qrData,
            generatedAt: now,
            printedAt: '',
            active: 'true'
          };
          insert('qr_codes', data);
          allQr.push(data); // Add to local cache for subsequent iterations
          results.push({ deviceId, success: true, qrCode: data });
        }
      } catch (err) {
        results.push({ deviceId, success: false, error: err.message });
      }
    });

    res.json({ success: true, results });
  } catch (error) {
    console.error('Error generating QR codes:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * updateAllQRCodeUrls - Update all QR code URLs to current WEB_APP_URL
 * Call after changing the server URL to fix QR codes.
 */
router.post('/updateAllQRCodeUrls', (req, res) => {
  try {
    const allQr = getAll('qr_codes');
    let updated = 0;

    allQr.forEach(qr => {
      const newUrl = config.WEB_APP_URL + '/request?device=' + qr.deviceId;
      if (qr.qrData !== newUrl) {
        updateField('qr_codes', qr.id, 'qrData', newUrl);
        updated++;
      }
    });

    res.json({ success: true, updated: updated, currentUrl: config.WEB_APP_URL });
  } catch (error) {
    console.error('Error updating QR code URLs:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * getQRCodeForDevice - Find QR code by deviceId (active only)
 * Args: [deviceId]
 */
router.post('/getQRCodeForDevice', (req, res) => {
  try {
    const [deviceId] = req.body.args || [];
    const allQr = getAll('qr_codes');
    const qr = allQr.find(q => q.deviceId === deviceId && q.active !== 'false' && q.active !== false);
    res.json(qr || null);
  } catch (error) {
    console.error('Error getting QR code for device:', error);
    res.json(null);
  }
});

/**
 * markQRCodePrinted - Set printedAt to now
 * Args: [qrCodeId]
 */
router.post('/markQRCodePrinted', (req, res) => {
  try {
    const [qrCodeId] = req.body.args || [];
    const existing = getById('qr_codes', qrCodeId);

    if (existing) {
      updateField('qr_codes', qrCodeId, 'printedAt', new Date().toISOString());
      return res.json({ success: true });
    }

    res.json({ success: false, error: 'QR code not found' });
  } catch (error) {
    console.error('Error marking QR code as printed:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// QR LABEL LAYOUT
// ============================================

/**
 * Default v2 label layout
 */
function getDefaultV2LabelLayout() {
  return {
    version: 2,
    labelSize: '4x2.125',
    labelWidth: 384,
    labelHeight: 204,
    padding: 6,
    fontFamily: 'Arial, sans-serif',
    snapToGrid: true,
    gridSize: 4,
    elements: [
      { id: 'qr', type: 'qr', x: 6, y: 6, width: 140, height: 140, locked: false },
      { id: 'field-machineId', type: 'field', fieldKey: 'machineId', x: 155, y: 10, width: 220, height: 22, label: 'Machine ID', showLabel: true, fontSize: 14, bold: true, align: 'left', locked: false },
      { id: 'field-location', type: 'field', fieldKey: 'location', x: 155, y: 38, width: 220, height: 20, label: 'Room', showLabel: true, fontSize: 12, bold: false, align: 'left', locked: false },
      { id: 'field-serialNumber', type: 'field', fieldKey: 'serialNumber', x: 155, y: 62, width: 220, height: 18, label: 'S/N', showLabel: true, fontSize: 10, bold: false, align: 'left', locked: false },
      { id: 'field-name', type: 'field', fieldKey: 'name', x: 155, y: 84, width: 220, height: 20, label: 'Name', showLabel: true, fontSize: 12, bold: false, align: 'left', locked: false, hidden: true },
      { id: 'field-model', type: 'field', fieldKey: 'model', x: 155, y: 106, width: 220, height: 18, label: 'Model', showLabel: true, fontSize: 10, bold: false, align: 'left', locked: false, hidden: true },
      { id: 'field-ip', type: 'field', fieldKey: 'ip', x: 155, y: 126, width: 220, height: 18, label: 'IP', showLabel: true, fontSize: 10, bold: false, align: 'left', locked: false, hidden: true },
      { id: 'scanText', type: 'customText', x: 155, y: 155, width: 220, height: 16, text: 'Scan to report an issue', fontSize: 9, bold: false, align: 'left', locked: false }
    ]
  };
}

/**
 * Migrate v1 label layout to v2 format
 */
function migrateV1LabelLayout(v1) {
  const v2 = getDefaultV2LabelLayout();
  v2.fontFamily = v1.fontFamily || 'Arial, sans-serif';
  const qrLeft = (v1.qrPosition || 'left') === 'left';
  const qrSize = v1.qrSize || 150;
  const textX = qrLeft ? (qrSize + 15) : 6;
  const qrX = qrLeft ? 6 : (v1.labelWidth || 384) - qrSize - 6;

  // Update QR element
  const qrEl = v2.elements.find(e => e.id === 'qr');
  if (qrEl) { qrEl.x = qrX; qrEl.width = qrSize - 10; qrEl.height = qrSize - 10; }

  // Update field elements from v1 fields
  if (v1.fields) {
    let yPos = 10;
    const fieldKeys = Object.keys(v1.fields).sort((a, b) => {
      return (v1.fields[a].order || 99) - (v1.fields[b].order || 99);
    });
    fieldKeys.forEach(key => {
      const f = v1.fields[key];
      const el = v2.elements.find(e => e.type === 'field' && e.fieldKey === key);
      if (el) {
        el.x = textX;
        el.y = yPos;
        el.label = f.label || key;
        el.fontSize = f.fontSize || 12;
        el.bold = f.bold || false;
        el.hidden = !f.enabled;
        yPos += (f.fontSize || 12) + 8;
      }
    });
  }

  // Update scan text
  if (v1.showScanText === false) {
    const scanEl = v2.elements.find(e => e.id === 'scanText');
    if (scanEl) scanEl.hidden = true;
  }
  if (v1.scanText) {
    const scanEl2 = v2.elements.find(e => e.id === 'scanText');
    if (scanEl2) scanEl2.text = v1.scanText;
  }

  return v2;
}

/**
 * getLabelLayout - Return label layout from settings, parse JSON or return default
 */
router.post('/getLabelLayout', (req, res) => {
  try {
    const layoutStr = getSetting('qrLabelLayout');
    if (layoutStr) {
      const layout = JSON.parse(layoutStr);
      // Migrate v1 layouts (no version field) to v2
      if (!layout.version) {
        return res.json(migrateV1LabelLayout(layout));
      }
      return res.json(layout);
    }
    res.json(getDefaultV2LabelLayout());
  } catch (error) {
    console.error('Error getting label layout:', error);
    res.json(getDefaultV2LabelLayout());
  }
});

/**
 * saveLabelLayout - Save layout JSON string to settings
 * Args: [layoutJsonString]
 */
router.post('/saveLabelLayout', (req, res) => {
  try {
    const [layoutJson] = req.body.args || [];
    setSetting('qrLabelLayout', layoutJson);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving label layout:', error);
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;
