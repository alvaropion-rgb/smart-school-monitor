const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Ensure data directory exists
const dbDir = path.dirname(path.resolve(config.DB_PATH));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(config.DB_PATH));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

// Generate short ID (matches Utilities.getUuid().substring(0,8) from Code.gs)
function generateId() {
  const crypto = require('crypto');
  return crypto.randomUUID().substring(0, 8);
}

// Get all rows from a table (replaces getSheetData)
function getAll(table) {
  return db.prepare(`SELECT * FROM "${table}"`).all();
}

// Get row by ID (replaces findRowById)
function getById(table, id) {
  return db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
}

// Get rows by column value
function getByColumn(table, column, value) {
  return db.prepare(`SELECT * FROM "${table}" WHERE "${column}" = ?`).all(value);
}

// Insert a row (replaces sheet.appendRow)
function insert(table, obj) {
  const keys = Object.keys(obj);
  const placeholders = keys.map(() => '?').join(', ');
  const values = keys.map(k => obj[k] === undefined ? '' : obj[k]);
  const stmt = db.prepare(`INSERT OR REPLACE INTO "${table}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders})`);
  return stmt.run(...values);
}

// Update a row by ID (replaces sheet.getRange().setValues())
function update(table, id, obj) {
  const keys = Object.keys(obj).filter(k => k !== 'id');
  if (keys.length === 0) return;
  const sets = keys.map(k => `"${k}" = ?`).join(', ');
  const values = keys.map(k => obj[k] === undefined ? '' : obj[k]);
  const stmt = db.prepare(`UPDATE "${table}" SET ${sets} WHERE id = ?`);
  return stmt.run(...values, id);
}

// Update a single field
function updateField(table, id, field, value) {
  const stmt = db.prepare(`UPDATE "${table}" SET "${field}" = ? WHERE id = ?`);
  return stmt.run(value === undefined ? '' : value, id);
}

// Delete by ID (replaces sheet.deleteRow)
function remove(table, id) {
  return db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id);
}

// Delete all rows
function clearTable(table) {
  return db.prepare(`DELETE FROM "${table}"`).run();
}

// Count rows
function count(table) {
  return db.prepare(`SELECT COUNT(*) as count FROM "${table}"`).get().count;
}

// Get by key-value store (for settings/email_config tables)
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const now = new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES (?, ?, ?)').run(key, value, now);
}

function getEmailConfigValue(key) {
  const row = db.prepare('SELECT value FROM email_config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setEmailConfigValue(key, value) {
  const now = new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO email_config (key, value, updatedAt) VALUES (?, ?, ?)').run(key, value, now);
}

module.exports = {
  db,
  generateId,
  getAll,
  getById,
  getByColumn,
  insert,
  update,
  updateField,
  remove,
  clearTable,
  count,
  getSetting,
  setSetting,
  getEmailConfigValue,
  setEmailConfigValue
};
