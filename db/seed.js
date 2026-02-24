/**
 * Seed script - initializes default data in the database.
 * Equivalent to initializeSpreadsheet() from Code.gs.
 * Run once: node db/seed.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('./database');

function seed() {
  console.log('Seeding database...');

  const now = new Date().toISOString();

  // Seed default email config
  const emailConfigDefaults = {
    'companyEmail': '',
    'emailSubject': 'Printer Issue Report',
    'emailTemplate': 'Dear Support Team,\n\nWe are experiencing issues with the following printer:\n\n{PRINTER_INFO}\n\nPlease assist.\n\nThank you.',
    'appTitle': 'Smart School Monitor',
    'appSubtitle': 'SNMP Network Monitoring System',
    'snmpGatewayUrl': 'http://localhost:5017',
    'snmpCommunity': 'public',
    'snmpPort': '161'
  };

  for (const [key, value] of Object.entries(emailConfigDefaults)) {
    const existing = db.getEmailConfigValue(key);
    if (existing === null) {
      db.setEmailConfigValue(key, value);
    }
  }
  console.log('  Email config seeded');

  // Seed default settings
  const settingsDefaults = {
    'theme': 'system',
    'pollInterval': '15000',
    'autoRefreshTraps': 'true',
    'securityPassword': '',
    'passwordProtected': 'false'
  };

  for (const [key, value] of Object.entries(settingsDefaults)) {
    const existing = db.getSetting(key);
    if (existing === null) {
      db.setSetting(key, value);
    }
  }
  console.log('  Settings seeded');

  // Seed default device types
  const existingTypes = db.getAll('device_types');
  if (existingTypes.length === 0) {
    const defaultTypes = [
      { id: db.generateId(), name: 'Sharp Copiers', icon: 'printer', color: '#ef4444', pageTitle: 'Report Copier Issue', description: 'Sharp copiers and multifunction printers', blueprintId: '', active: 'true', createdAt: now, updatedAt: now },
      { id: db.generateId(), name: 'Minga Machines', icon: 'credit-card', color: '#8b5cf6', pageTitle: 'Report Minga Issue', description: 'Minga kiosk machines', blueprintId: '', active: 'true', createdAt: now, updatedAt: now },
      { id: db.generateId(), name: 'Printers', icon: 'printer', color: '#22c55e', pageTitle: 'Report Printer Issue', description: 'Desktop and network printers', blueprintId: '', active: 'true', createdAt: now, updatedAt: now },
      { id: db.generateId(), name: 'Smartboards', icon: 'monitor', color: '#3b82f6', pageTitle: 'Report Smartboard Issue', description: 'Interactive displays and smartboards', blueprintId: '', active: 'true', createdAt: now, updatedAt: now }
    ];
    defaultTypes.forEach(t => db.insert('device_types', t));
    console.log('  Device types seeded');

    // Seed default issue buttons (depends on device types)
    const types = db.getAll('device_types');
    const copierType = types.find(t => t.name === 'Sharp Copiers');
    const smartboardType = types.find(t => t.name === 'Smartboards');
    const printerType = types.find(t => t.name === 'Printers');
    const mingaType = types.find(t => t.name === 'Minga Machines');

    const buttons = [];

    if (copierType) {
      buttons.push(
        { deviceTypeId: copierType.id, label: 'Out of Staples', icon: 'paperclip', color: '#f59e0b', sortOrder: 1 },
        { deviceTypeId: copierType.id, label: 'Out of Toner', icon: 'droplet', color: '#ef4444', sortOrder: 2 },
        { deviceTypeId: copierType.id, label: 'Paper Jam', icon: 'alert-triangle', color: '#dc2626', sortOrder: 3 },
        { deviceTypeId: copierType.id, label: 'Out of Paper', icon: 'file', color: '#f97316', sortOrder: 4 },
        { deviceTypeId: copierType.id, label: 'Other Issue', icon: 'help-circle', color: '#6b7280', sortOrder: 5 }
      );
    }
    if (smartboardType) {
      buttons.push(
        { deviceTypeId: smartboardType.id, label: 'No Power', icon: 'power', color: '#ef4444', sortOrder: 1 },
        { deviceTypeId: smartboardType.id, label: 'Wi-Fi Issues', icon: 'wifi-off', color: '#f59e0b', sortOrder: 2 },
        { deviceTypeId: smartboardType.id, label: 'Display Issues', icon: 'monitor-x', color: '#dc2626', sortOrder: 3 },
        { deviceTypeId: smartboardType.id, label: 'Touch Not Working', icon: 'hand', color: '#f97316', sortOrder: 4 },
        { deviceTypeId: smartboardType.id, label: 'Other Issue', icon: 'help-circle', color: '#6b7280', sortOrder: 5 }
      );
    }
    if (printerType) {
      buttons.push(
        { deviceTypeId: printerType.id, label: 'Out of Ink', icon: 'droplet', color: '#ef4444', sortOrder: 1 },
        { deviceTypeId: printerType.id, label: 'Paper Jam', icon: 'alert-triangle', color: '#dc2626', sortOrder: 2 },
        { deviceTypeId: printerType.id, label: 'Not Printing', icon: 'printer', color: '#f59e0b', sortOrder: 3 },
        { deviceTypeId: printerType.id, label: 'Other Issue', icon: 'help-circle', color: '#6b7280', sortOrder: 4 }
      );
    }
    if (mingaType) {
      buttons.push(
        { deviceTypeId: mingaType.id, label: 'No Power', icon: 'power', color: '#ef4444', sortOrder: 1 },
        { deviceTypeId: mingaType.id, label: 'Card Reader Issue', icon: 'credit-card', color: '#f59e0b', sortOrder: 2 },
        { deviceTypeId: mingaType.id, label: 'Screen Issue', icon: 'monitor-x', color: '#dc2626', sortOrder: 3 },
        { deviceTypeId: mingaType.id, label: 'Other Issue', icon: 'help-circle', color: '#6b7280', sortOrder: 4 }
      );
    }

    buttons.forEach(btn => {
      db.insert('issue_buttons', {
        id: db.generateId(),
        deviceTypeId: btn.deviceTypeId,
        label: btn.label,
        icon: btn.icon,
        color: btn.color,
        sortOrder: btn.sortOrder,
        active: 'true',
        createdAt: now,
        updatedAt: now
      });
    });
    console.log('  Issue buttons seeded');
  }

  // Seed default email templates
  const existingTemplates = db.getAll('email_templates');
  if (existingTemplates.length === 0) {
    // Confirmation template
    db.insert('email_templates', {
      id: db.generateId(),
      name: 'Service Request Confirmation',
      type: 'confirmation',
      subject: 'Service Request Received - {{issueLabel}}',
      htmlBody: getConfirmationTemplate(),
      active: 'true',
      createdAt: now,
      updatedAt: now
    });

    // Manufacturer template
    db.insert('email_templates', {
      id: db.generateId(),
      name: 'Manufacturer Repair Request',
      type: 'manufacturer',
      subject: 'Repair Request: {{deviceName}} - {{model}}',
      htmlBody: getManufacturerTemplate(),
      active: 'true',
      createdAt: now,
      updatedAt: now
    });
    console.log('  Email templates seeded');
  }

  // Seed default repair templates
  const existingRepairTemplates = db.getAll('repair_templates');
  if (existingRepairTemplates.length === 0) {
    const repairDefaults = [
      { name: 'Broken MAX Case', icon: 'shield-off', shortDescription: 'SWAP Chromebook - Broken MAX Case', description: 'The MAX protective case for this Chromebook is broken. The bottom portion of the case (top-right corner) has snapped off and can no longer secure the device correctly.', channel: 'self-service', category: 'Hardware', subcategory: 'Chromebook', serviceOffering: 'Other', manufacturer: 'Dell', model: 'Chromebook 3120 2-in-1', assetLocation: '1-153-J Techs Office', impact: '4', userType: 'Student', requiresSerial: 'TRUE', requiresPhoto: 'TRUE', sortOrder: 1, active: 'TRUE' },
      { name: 'Cracked Screen', icon: 'monitor-x', shortDescription: 'SWAP Chromebook - Cracked Screen', description: 'The screen on this Chromebook is cracked/broken and needs to be replaced. The device is not usable in its current condition.', channel: 'self-service', category: 'Hardware', subcategory: 'Chromebook', serviceOffering: 'Other', manufacturer: 'Dell', model: 'Chromebook 3120 2-in-1', assetLocation: '1-153-J Techs Office', impact: '4', userType: 'Student', requiresSerial: 'TRUE', requiresPhoto: 'TRUE', sortOrder: 2, active: 'TRUE' },
      { name: 'Keyboard Issue', icon: 'keyboard', shortDescription: 'Chromebook - Keyboard Not Working', description: 'The keyboard on this Chromebook is malfunctioning. Keys are stuck, unresponsive, or damaged.', channel: 'self-service', category: 'Hardware', subcategory: 'Chromebook', serviceOffering: 'Other', manufacturer: 'Dell', model: 'Chromebook 3120 2-in-1', assetLocation: '1-153-J Techs Office', impact: '4', userType: 'Student', requiresSerial: 'TRUE', requiresPhoto: 'FALSE', sortOrder: 3, active: 'TRUE' }
    ];

    repairDefaults.forEach(t => {
      db.insert('repair_templates', {
        id: db.generateId(),
        ...t,
        createdAt: now,
        updatedAt: now
      });
    });
    console.log('  Repair templates seeded');
  }

  console.log('Database seeded successfully!');
}

function getConfirmationTemplate() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px;">SharkQuick</h1>
              <p style="color: #93c5fd; margin: 5px 0 0 0; font-size: 14px;">Service Request System</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px 30px 20px 30px; text-align: center;">
              <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border-radius: 50%; margin: 0 auto; line-height: 60px;">
                <span style="color: white; font-size: 30px;">&#10003;</span>
              </div>
              <h2 style="color: #1e3a8a; margin: 20px 0 10px 0;">Request Received!</h2>
              <p style="color: #64748b; margin: 0;">Your service request has been logged in our system.</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <table width="100%" cellpadding="15" cellspacing="0" style="background-color: #f8fafc; border-radius: 8px;">
                <tr><td style="border-bottom: 1px solid #e2e8f0;"><strong style="color: #64748b; font-size: 12px; text-transform: uppercase;">Issue</strong><br><span style="color: #1e3a8a; font-size: 16px; font-weight: 600;">{{issueLabel}}</span></td></tr>
                <tr><td style="border-bottom: 1px solid #e2e8f0;"><strong style="color: #64748b; font-size: 12px; text-transform: uppercase;">Device</strong><br><span style="color: #1e3a8a; font-size: 16px;">{{deviceName}}</span></td></tr>
                <tr><td style="border-bottom: 1px solid #e2e8f0;"><strong style="color: #64748b; font-size: 12px; text-transform: uppercase;">Location</strong><br><span style="color: #1e3a8a; font-size: 16px;">{{location}}</span></td></tr>
                <tr><td style="border-bottom: 1px solid #e2e8f0;"><strong style="color: #64748b; font-size: 12px; text-transform: uppercase;">Submitted</strong><br><span style="color: #1e3a8a; font-size: 16px;">{{submittedAt}}</span></td></tr>
                <tr><td><strong style="color: #64748b; font-size: 12px; text-transform: uppercase;">Request ID</strong><br><span style="color: #1e3a8a; font-size: 14px; font-family: monospace;">{{requestId}}</span></td></tr>
              </table>
            </td>
          </tr>
          {{#afterHoursSection}}
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <table width="100%" cellpadding="20" cellspacing="0" style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 8px;">
                <tr><td>
                  <h3 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px;">After-Hours Notice</h3>
                  <p style="color: #78350f; margin: 0 0 15px 0; font-size: 14px; line-height: 1.5;">{{afterHoursMessage}}</p>
                  <div style="border-top: 1px solid rgba(120, 53, 15, 0.2); padding-top: 15px;">
                    <p style="color: #78350f; margin: 0 0 5px 0; font-size: 14px;"><strong>For urgent issues:</strong></p>
                    <p style="color: #1e40af; margin: 0; font-size: 14px;">{{urgentEmail}}</p>
                    <p style="color: #1e40af; margin: 5px 0 0 0; font-size: 14px;">{{urgentPhone}}</p>
                  </div>
                </td></tr>
              </table>
            </td>
          </tr>
          {{/afterHoursSection}}
          <tr>
            <td style="padding: 0 30px 20px 30px; text-align: center;">
              <p style="color: #64748b; font-size: 14px; line-height: 1.5;">{{footerMessage}}</p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #94a3b8; font-size: 12px; margin: 0;">This is an automated message from Smart School Monitor.</p>
              <p style="color: #94a3b8; font-size: 12px; margin: 5px 0 0 0;">Please do not reply to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function getManufacturerTemplate() {
  return '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n</head>\n<body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; margin: 0; padding: 0;">\n  <div style="max-width: 600px; margin: 20px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">\n    <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 30px 20px; text-align: center;">\n      <h1 style="margin: 0; font-size: 24px;">&#128295; Repair Request</h1>\n      <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 14px;">Service Required for Device</p>\n      <span style="display: inline-block; background: #fef2f2; color: #dc2626; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-top: 10px;">&#9888;&#65039; REQUIRES ATTENTION</span>\n    </div>\n    <div style="padding: 30px 20px;">\n      <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin-bottom: 20px; border-radius: 0 8px 8px 0; white-space: pre-wrap; font-size: 14px;">{{message}}</div>\n      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px;">\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Device Name</div><div style="font-size: 14px; font-weight: 600; color: #1e293b;">{{deviceName}}</div></div>\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Model</div><div style="font-size: 14px; font-weight: 600; color: #1e293b;">{{model}}</div></div>\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">IP Address</div><div style="font-size: 14px; font-weight: 600; color: #1e293b; font-family: monospace;">{{ip}}</div></div>\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Location</div><div style="font-size: 14px; font-weight: 600; color: #1e293b;">{{location}}</div></div>\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Machine ID</div><div style="font-size: 14px; font-weight: 600; color: #1e293b; font-family: monospace;">{{machineId}}</div></div>\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Serial Number</div><div style="font-size: 14px; font-weight: 600; color: #1e293b; font-family: monospace;">{{serialNumber}}</div></div>\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Device Type</div><div style="font-size: 14px; font-weight: 600; color: #1e293b; text-transform: capitalize;">{{deviceType}}</div></div>\n        <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Current Status</div><div style="font-size: 14px; font-weight: 600; color: {{statusColor}}; text-transform: capitalize;">{{status}}</div></div>\n      </div>\n      <div style="margin-top: 20px;"><h3 style="margin-bottom: 15px; font-size: 16px; color: #374151;">&#128202; Current Supply Levels</h3>{{supplyLevels}}</div>\n      <div style="background: #f0f9ff; border: 1px solid #bae6fd; padding: 15px; border-radius: 8px; margin-top: 20px;">\n        <h4 style="margin: 0 0 10px 0; color: #0369a1; font-size: 14px;">&#128231; Contact Information</h4>\n        <p style="margin: 0; font-size: 13px; color: #475569;">Please respond to this email to coordinate repair/service scheduling.</p>\n      </div>\n    </div>\n    <div style="background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">\n      <p style="margin: 5px 0;"><strong>{{schoolName}}</strong></p>\n      <p style="margin: 5px 0;">Automated repair request generated on {{dateTime}}</p>\n      <p style="font-size: 11px; color: #94a3b8; margin: 5px 0;">This is an automated message from the school\'s network monitoring system.</p>\n    </div>\n  </div>\n</body>\n</html>';
}

// Run the seed
seed();
