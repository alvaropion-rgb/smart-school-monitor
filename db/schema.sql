-- Smart School Monitor - SQLite Schema
-- Mirrors Google Sheets structure from Code.gs initializeSpreadsheet()

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  model TEXT DEFAULT '',
  type TEXT DEFAULT 'printer',
  location TEXT DEFAULT '',
  machineId TEXT DEFAULT '',
  serialNumber TEXT DEFAULT '',
  status TEXT DEFAULT 'unknown',
  lastSeen TEXT DEFAULT '',
  x REAL DEFAULT 0,
  y REAL DEFAULT 0,
  blueprintId TEXT DEFAULT 'blueprint1',
  supplies TEXT DEFAULT '[]',
  messages TEXT DEFAULT '[]',
  inputTrays TEXT DEFAULT '[]',
  pageCount INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT '',
  updatedAt TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS supply_history (
  id TEXT PRIMARY KEY,
  deviceId TEXT DEFAULT '',
  supplyName TEXT DEFAULT '',
  level REAL DEFAULT 0,
  maxCapacity REAL DEFAULT 0,
  percentage REAL DEFAULT 0,
  timestamp TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS snmp_traps (
  id TEXT PRIMARY KEY,
  sourceIp TEXT DEFAULT '',
  trapData TEXT DEFAULT '',
  parsedMessage TEXT DEFAULT '',
  severity TEXT DEFAULT 'info',
  receivedAt TEXT DEFAULT '',
  processed TEXT DEFAULT '',
  resolvedAt TEXT DEFAULT '',
  resolvedBy TEXT DEFAULT '',
  assignedTo TEXT DEFAULT '',
  assignedAt TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS technicians (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  active TEXT DEFAULT 'true',
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

CREATE TABLE IF NOT EXISTS device_types (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  icon TEXT DEFAULT '',
  color TEXT DEFAULT '',
  pageTitle TEXT DEFAULT '',
  description TEXT DEFAULT '',
  blueprintId TEXT DEFAULT '',
  active TEXT DEFAULT 'true',
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
  active TEXT DEFAULT 'true',
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

CREATE TABLE IF NOT EXISTS qr_codes (
  id TEXT PRIMARY KEY,
  deviceId TEXT DEFAULT '',
  qrData TEXT DEFAULT '',
  generatedAt TEXT DEFAULT '',
  printedAt TEXT DEFAULT '',
  active TEXT DEFAULT 'true'
);

CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  type TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  htmlBody TEXT DEFAULT '',
  active TEXT DEFAULT 'true',
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
  toAddr TEXT DEFAULT '',
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
  aiAccepted TEXT DEFAULT '',
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
  isQuickTicket TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cr_training (
  id TEXT PRIMARY KEY,
  rawDescription TEXT DEFAULT '',
  improvedDescription TEXT DEFAULT '',
  category TEXT DEFAULT '',
  subcategory TEXT DEFAULT '',
  impact TEXT DEFAULT '',
  aiAccepted TEXT DEFAULT '',
  confidence REAL DEFAULT 0,
  source TEXT DEFAULT '',
  repairId TEXT DEFAULT '',
  isQuickTicket TEXT DEFAULT '',
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
  requiresSerial TEXT DEFAULT '',
  requiresPhoto TEXT DEFAULT '',
  sortOrder INTEGER DEFAULT 0,
  active TEXT DEFAULT 'true',
  createdAt TEXT DEFAULT '',
  updatedAt TEXT DEFAULT ''
);
