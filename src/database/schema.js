const db = require('./db');

function initialize() {
  const d = db.getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      ip TEXT DEFAULT '',
      model TEXT DEFAULT '',
      type TEXT DEFAULT 'printer',
      location TEXT DEFAULT '',
      machineId TEXT DEFAULT '',
      serialNumber TEXT DEFAULT '',
      status TEXT DEFAULT 'offline',
      lastSeen TEXT DEFAULT '',
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      blueprintId TEXT DEFAULT '',
      supplies TEXT DEFAULT '[]',
      messages TEXT DEFAULT '[]',
      inputTrays TEXT DEFAULT '[]',
      pageCount INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);
    CREATE INDEX IF NOT EXISTS idx_devices_type ON devices(type);

    CREATE TABLE IF NOT EXISTS supply_history (
      id TEXT PRIMARY KEY,
      deviceId TEXT DEFAULT '',
      supplyName TEXT DEFAULT '',
      level INTEGER DEFAULT 0,
      maxCapacity INTEGER DEFAULT 0,
      percentage REAL DEFAULT 0,
      timestamp TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_supply_deviceId ON supply_history(deviceId);

    CREATE TABLE IF NOT EXISTS snmp_traps (
      id TEXT PRIMARY KEY,
      sourceIp TEXT DEFAULT '',
      trapData TEXT DEFAULT '',
      parsedMessage TEXT DEFAULT '',
      severity TEXT DEFAULT '',
      receivedAt TEXT DEFAULT '',
      processed INTEGER DEFAULT 0,
      resolvedAt TEXT DEFAULT '',
      resolvedBy TEXT DEFAULT '',
      assignedTo TEXT DEFAULT '',
      assignedAt TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_traps_sourceIp ON snmp_traps(sourceIp);
    CREATE INDEX IF NOT EXISTS idx_traps_processed ON snmp_traps(processed);

    CREATE TABLE IF NOT EXISTS technicians (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS email_config (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS email_history (
      id TEXT PRIMARY KEY,
      deviceId TEXT DEFAULT '',
      recipient TEXT DEFAULT '',
      cc TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      body TEXT DEFAULT '',
      htmlBody TEXT DEFAULT '',
      sentAt TEXT DEFAULT '',
      status TEXT DEFAULT '',
      errorMessage TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ms_graph_config (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS blueprints (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      imageData TEXT DEFAULT '',
      createdAt TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id TEXT PRIMARY KEY,
      empId TEXT DEFAULT '',
      name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      roomNumber TEXT DEFAULT '',
      createdAt TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_teachers_empId ON teachers(empId);

    CREATE TABLE IF NOT EXISTS device_types (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      color TEXT DEFAULT '',
      pageTitle TEXT DEFAULT '',
      description TEXT DEFAULT '',
      blueprintId TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS issue_buttons (
      id TEXT PRIMARY KEY,
      deviceTypeId TEXT DEFAULT '',
      label TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      color TEXT DEFAULT '',
      sortOrder INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS service_requests (
      id TEXT PRIMARY KEY,
      deviceId TEXT DEFAULT '',
      deviceName TEXT DEFAULT '',
      deviceType TEXT DEFAULT '',
      location TEXT DEFAULT '',
      blueprintId TEXT DEFAULT '',
      issueType TEXT DEFAULT '',
      issueLabel TEXT DEFAULT '',
      employeeId TEXT DEFAULT '',
      employeeName TEXT DEFAULT '',
      employeeEmail TEXT DEFAULT '',
      technicianId TEXT DEFAULT '',
      technicianName TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      notes TEXT DEFAULT '',
      submittedAt TEXT DEFAULT '',
      assignedAt TEXT DEFAULT '',
      completedAt TEXT DEFAULT '',
      createdAt TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_sr_status ON service_requests(status);

    CREATE TABLE IF NOT EXISTS qr_codes (
      id TEXT PRIMARY KEY,
      deviceId TEXT DEFAULT '',
      qrData TEXT DEFAULT '',
      generatedAt TEXT DEFAULT '',
      printedAt TEXT DEFAULT '',
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS email_templates (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      type TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      htmlBody TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      employeeId TEXT DEFAULT '',
      employeeName TEXT DEFAULT '',
      employeeEmail TEXT DEFAULT '',
      roomNumber TEXT DEFAULT '',
      shortDescription TEXT DEFAULT '',
      description TEXT DEFAULT '',
      category TEXT DEFAULT '',
      subcategory TEXT DEFAULT '',
      channel TEXT DEFAULT '',
      impact TEXT DEFAULT '',
      userType TEXT DEFAULT '',
      snowIncidentNumber TEXT DEFAULT '',
      snowUrl TEXT DEFAULT '',
      emailStatus TEXT DEFAULT 'not-sent',
      emailSentAt TEXT DEFAULT '',
      status TEXT DEFAULT 'open',
      createdAt TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS email_queue (
      id TEXT PRIMARY KEY,
      incidentId TEXT DEFAULT '',
      "to" TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      body TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      scheduledAt TEXT DEFAULT '',
      sentAt TEXT DEFAULT '',
      createdAt TEXT DEFAULT '',
      error TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ai_training (
      id TEXT PRIMARY KEY,
      rawDescription TEXT DEFAULT '',
      improvedDescription TEXT DEFAULT '',
      category TEXT DEFAULT '',
      subcategory TEXT DEFAULT '',
      channel TEXT DEFAULT '',
      impact TEXT DEFAULT '',
      serviceOffering TEXT DEFAULT '',
      keywords TEXT DEFAULT '',
      aiAccepted INTEGER DEFAULT 0,
      confidence REAL DEFAULT 0,
      source TEXT DEFAULT '',
      incidentId TEXT DEFAULT '',
      createdAt TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS computer_repairs (
      id TEXT PRIMARY KEY,
      employeeId TEXT DEFAULT '',
      employeeName TEXT DEFAULT '',
      employeeEmail TEXT DEFAULT '',
      roomNumber TEXT DEFAULT '',
      serialNumber TEXT DEFAULT '',
      computerModel TEXT DEFAULT '',
      manufacturer TEXT DEFAULT '',
      warrantyDate TEXT DEFAULT '',
      warrantyStatus TEXT DEFAULT 'unknown',
      assetTag TEXT DEFAULT '',
      shortDescription TEXT DEFAULT '',
      description TEXT DEFAULT '',
      category TEXT DEFAULT '',
      subcategory TEXT DEFAULT '',
      channel TEXT DEFAULT '',
      impact TEXT DEFAULT '',
      userType TEXT DEFAULT '',
      snowIncidentNumber TEXT DEFAULT '',
      snowUrl TEXT DEFAULT '',
      repairStatus TEXT DEFAULT 'pending',
      emailStatus TEXT DEFAULT 'not-sent',
      emailSentAt TEXT DEFAULT '',
      photoDataUrl TEXT DEFAULT '',
      createdAt TEXT DEFAULT '',
      updatedAt TEXT DEFAULT '',
      isQuickTicket INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cr_training (
      id TEXT PRIMARY KEY,
      rawDescription TEXT DEFAULT '',
      improvedDescription TEXT DEFAULT '',
      category TEXT DEFAULT '',
      subcategory TEXT DEFAULT '',
      impact TEXT DEFAULT '',
      aiAccepted INTEGER DEFAULT 0,
      confidence REAL DEFAULT 0,
      source TEXT DEFAULT '',
      repairId TEXT DEFAULT '',
      isQuickTicket INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS repair_templates (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      shortDescription TEXT DEFAULT '',
      description TEXT DEFAULT '',
      channel TEXT DEFAULT '',
      category TEXT DEFAULT '',
      subcategory TEXT DEFAULT '',
      serviceOffering TEXT DEFAULT '',
      manufacturer TEXT DEFAULT '',
      model TEXT DEFAULT '',
      assetLocation TEXT DEFAULT '',
      impact TEXT DEFAULT '',
      userType TEXT DEFAULT '',
      requiresSerial INTEGER DEFAULT 0,
      requiresPhoto INTEGER DEFAULT 0,
      sortOrder INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    );
  `);

  // --- Request Page Branding (single-row config) ---
  d.exec(`
    CREATE TABLE IF NOT EXISTS request_page_branding (
      id INTEGER PRIMARY KEY DEFAULT 1,
      logoDataUrl TEXT DEFAULT '',
      headerTitle TEXT DEFAULT 'SHARKQUICK',
      headerSubtitle TEXT DEFAULT 'SERVICE REQUEST PORTAL',
      backgroundColor TEXT DEFAULT '#7BA3C9',
      headerBackgroundColor TEXT DEFAULT '#6B8FB8',
      cardBackgroundColor TEXT DEFAULT '#F5F0E6',
      deviceInfoBackgroundColor TEXT DEFAULT '#6B8FB8',
      buttonColor TEXT DEFAULT '#5CB85C',
      titleColor TEXT DEFAULT '#3D5A73',
      subtitleColor TEXT DEFAULT '#C9524A',
      fontFamily TEXT DEFAULT 'Inter',
      buttonBorderRadius TEXT DEFAULT '20',
      buttonTextColor TEXT DEFAULT '#FFFFFF'
    );
    INSERT OR IGNORE INTO request_page_branding (id) VALUES (1);
  `);

  // --- Migrations (add columns to existing tables) ---
  // Add imageDataUrl to issue_buttons if not present
  try {
    d.exec("ALTER TABLE issue_buttons ADD COLUMN imageDataUrl TEXT DEFAULT ''");
  } catch (e) {
    // Column already exists — ignore
  }

  // Add new request page branding columns for redesigned layout
  var brandingMigrations = [
    "ALTER TABLE request_page_branding ADD COLUMN headerLayout TEXT DEFAULT 'horizontal'",
    "ALTER TABLE request_page_branding ADD COLUMN cardGradientStart TEXT DEFAULT '#6B8FB8'",
    "ALTER TABLE request_page_branding ADD COLUMN cardGradientEnd TEXT DEFAULT '#C8D8E8'",
    "ALTER TABLE request_page_branding ADD COLUMN buttonBackground TEXT DEFAULT '#F2F2F2'",
    "ALTER TABLE request_page_branding ADD COLUMN employeeCardBackground TEXT DEFAULT '#FFFFFF'",
    "ALTER TABLE request_page_branding ADD COLUMN welcomeText TEXT DEFAULT 'Welcome, {name}!'",
    "ALTER TABLE request_page_branding ADD COLUMN showDeviceInfo TEXT DEFAULT 'minimal'",
    "ALTER TABLE request_page_branding ADD COLUMN showRememberUsername TEXT DEFAULT 'true'",
    "ALTER TABLE request_page_branding ADD COLUMN headerStripeColor TEXT DEFAULT '#5B8DB8'",
    "ALTER TABLE request_page_branding ADD COLUMN logoSize TEXT DEFAULT '140'"
  ];
  brandingMigrations.forEach(function(sql) {
    try { d.exec(sql); } catch (e) { /* column already exists */ }
  });

  // Seed defaults
  seedEmailConfig();
  seedSettings();
  seedDeviceTypes();
  seedRepairTemplates();

  // Fix orphaned device type references from CodeMAPCopier imports
  fixOrphanedDeviceTypes();
}

function seedEmailConfig() {
  const existing = db.getKeyValue('email_config');
  const defaults = {
    companyEmail: '',
    emailSubject: 'Printer Issue Report',
    emailTemplate: 'Dear Support Team,\n\nWe are experiencing issues with the following printer:\n\n{PRINTER_INFO}\n\nPlease assist.\n\nThank you.',
    appTitle: 'Smart School Monitor',
    appSubtitle: 'SNMP Network Monitoring System',
    snmpGatewayUrl: 'http://localhost:5017',
    snmpCommunity: 'public',
    snmpPort: '161',
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPassword: '',
    smtpSecure: 'false'
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in existing)) {
      db.setKeyValue('email_config', key, value);
    }
  }
}

function seedSettings() {
  const existing = db.getKeyValue('settings');
  const defaults = {
    theme: 'system',
    pollInterval: '15000',
    autoRefreshTraps: 'true',
    securityPassword: '',
    passwordProtected: 'false'
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in existing)) {
      db.setKeyValue('settings', key, value);
    }
  }
}

function seedDeviceTypes() {
  const existing = db.getAll('device_types');
  if (existing.length > 0) return;

  const now = new Date().toISOString();
  const types = [
    { id: db.generateId(), name: 'Sharp Copiers', icon: 'printer', color: '#ef4444', pageTitle: 'Report Copier Issue', description: 'Sharp copiers and multifunction printers', blueprintId: '', active: 1, createdAt: now, updatedAt: now },
    { id: db.generateId(), name: 'Minga Machines', icon: 'credit-card', color: '#8b5cf6', pageTitle: 'Report Minga Issue', description: 'Minga kiosk machines', blueprintId: '', active: 1, createdAt: now, updatedAt: now },
    { id: db.generateId(), name: 'Printers', icon: 'printer', color: '#22c55e', pageTitle: 'Report Printer Issue', description: 'Desktop and network printers', blueprintId: '', active: 1, createdAt: now, updatedAt: now },
    { id: db.generateId(), name: 'Smartboards', icon: 'monitor', color: '#3b82f6', pageTitle: 'Report Smartboard Issue', description: 'Interactive displays and smartboards', blueprintId: '', active: 1, createdAt: now, updatedAt: now }
  ];
  types.forEach(t => db.insert('device_types', t));

  // Seed issue buttons
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
      id: db.generateId(), ...btn, active: 1, createdAt: now, updatedAt: now
    });
  });
}

function seedRepairTemplates() {
  const existing = db.getAll('repair_templates');
  if (existing.length > 0) return;

  const now = new Date().toISOString();
  const templates = [
    {
      id: db.generateId(), name: 'Broken MAX Case', icon: 'shield-off',
      shortDescription: 'SWAP Chromebook - Broken MAX Case',
      description: 'The MAX protective case for this Chromebook is broken. The bottom portion of the case (top-right corner) has snapped off and can no longer secure the device correctly.',
      channel: 'self-service', category: 'Hardware', subcategory: 'Chromebook', serviceOffering: 'Other',
      manufacturer: 'Dell', model: 'Chromebook 3120 2-in-1', assetLocation: '1-153-J Techs Office',
      impact: '4', userType: 'Student', requiresSerial: 1, requiresPhoto: 1,
      sortOrder: 1, active: 1, createdAt: now, updatedAt: now
    },
    {
      id: db.generateId(), name: 'Cracked Screen', icon: 'monitor-x',
      shortDescription: 'SWAP Chromebook - Cracked Screen',
      description: 'The screen on this Chromebook is cracked/broken and needs to be replaced. The device is not usable in its current condition.',
      channel: 'self-service', category: 'Hardware', subcategory: 'Chromebook', serviceOffering: 'Other',
      manufacturer: 'Dell', model: 'Chromebook 3120 2-in-1', assetLocation: '1-153-J Techs Office',
      impact: '4', userType: 'Student', requiresSerial: 1, requiresPhoto: 1,
      sortOrder: 2, active: 1, createdAt: now, updatedAt: now
    },
    {
      id: db.generateId(), name: 'Keyboard Issue', icon: 'keyboard',
      shortDescription: 'Chromebook - Keyboard Not Working',
      description: 'The keyboard on this Chromebook is malfunctioning. Keys are stuck, unresponsive, or damaged.',
      channel: 'self-service', category: 'Hardware', subcategory: 'Chromebook', serviceOffering: 'Other',
      manufacturer: 'Dell', model: 'Chromebook 3120 2-in-1', assetLocation: '1-153-J Techs Office',
      impact: '4', userType: 'Student', requiresSerial: 1, requiresPhoto: 0,
      sortOrder: 3, active: 1, createdAt: now, updatedAt: now
    }
  ];
  templates.forEach(t => db.insert('repair_templates', t));
}

function fixOrphanedDeviceTypes() {
  try {
    const d = db.getDb();
    const deviceTypes = db.getAll('device_types');
    if (deviceTypes.length === 0) return;

    // Build a map: lowercase name → device type ID
    const nameToId = {};
    deviceTypes.forEach(dt => {
      nameToId[dt.name.toLowerCase()] = dt.id;
    });

    // Find devices whose type doesn't match any device_type ID
    const devices = db.getAll('devices');
    let fixed = 0;
    devices.forEach(dev => {
      if (!dev.type) return;
      // Already matches a device type ID directly
      if (deviceTypes.some(dt => dt.id === dev.type)) return;

      // Try case-insensitive name match
      const lowerType = dev.type.toLowerCase();
      if (nameToId[lowerType]) {
        d.prepare('UPDATE devices SET type = ? WHERE id = ?').run(nameToId[lowerType], dev.id);
        fixed++;
        return;
      }

      // Try to infer from model name for Sharp copiers
      const model = (dev.model || '').toUpperCase();
      if (model.startsWith('BP') || model.includes('SHARP') || model.includes('MX-')) {
        const sharpId = nameToId['sharp copiers'];
        if (sharpId) {
          d.prepare('UPDATE devices SET type = ? WHERE id = ?').run(sharpId, dev.id);
          fixed++;
          return;
        }
      }

      // Try to infer Minga machines
      const name = (dev.name || '').toUpperCase();
      if (name.includes('MINGA') || lowerType.includes('minga')) {
        const mingaId = nameToId['minga machines'];
        if (mingaId) {
          d.prepare('UPDATE devices SET type = ? WHERE id = ?').run(mingaId, dev.id);
          fixed++;
          return;
        }
      }
    });

    if (fixed > 0) {
      console.log('Fixed ' + fixed + ' devices with orphaned device type references');
    }
  } catch (e) {
    console.error('Error fixing orphaned device types:', e.message);
  }
}

module.exports = { initialize };
