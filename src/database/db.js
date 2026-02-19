const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

let db = null;

function getDbPath() {
  const userDataPath = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
  return path.join(userDataPath, 'database.sqlite');
}

function getDb() {
  if (db) return db;
  const fs = require('fs');
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function generateId() {
  return crypto.randomUUID().substring(0, 8);
}

function getAll(table) {
  return getDb().prepare(`SELECT * FROM "${table}"`).all();
}

function getById(table, id) {
  return getDb().prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
}

function insert(table, obj) {
  const keys = Object.keys(obj);
  const placeholders = keys.map(() => '?').join(', ');
  const cols = keys.map(k => `"${k}"`).join(', ');
  const stmt = getDb().prepare(`INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`);
  stmt.run(...keys.map(k => obj[k]));
}

function update(table, id, obj) {
  const keys = Object.keys(obj).filter(k => k !== 'id');
  if (keys.length === 0) return;
  const sets = keys.map(k => `"${k}" = ?`).join(', ');
  const stmt = getDb().prepare(`UPDATE "${table}" SET ${sets} WHERE id = ?`);
  stmt.run(...keys.map(k => obj[k]), id);
}

function upsert(table, obj) {
  const existing = obj.id ? getById(table, obj.id) : null;
  if (existing) {
    update(table, obj.id, obj);
  } else {
    insert(table, obj);
  }
}

function deleteById(table, id) {
  return getDb().prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id);
}

function deleteAll(table) {
  return getDb().prepare(`DELETE FROM "${table}"`).run();
}

function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

function query(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

function queryOne(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

// Key-value helpers for settings/config tables
function getKeyValue(table) {
  const rows = getAll(table);
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  return obj;
}

function setKeyValue(table, key, value) {
  const now = new Date().toISOString();
  const existing = getDb().prepare(`SELECT key FROM "${table}" WHERE key = ?`).get(key);
  if (existing) {
    getDb().prepare(`UPDATE "${table}" SET value = ?, updatedAt = ? WHERE key = ?`).run(value, now, key);
  } else {
    getDb().prepare(`INSERT INTO "${table}" (key, value, updatedAt) VALUES (?, ?, ?)`).run(key, value, now);
  }
}

function setKeyValues(table, obj) {
  const now = new Date().toISOString();
  const upsertStmt = getDb().prepare(
    `INSERT INTO "${table}" (key, value, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
  );
  const transaction = getDb().transaction((entries) => {
    for (const [key, value] of entries) {
      upsertStmt.run(key, value != null ? String(value) : '', now);
    }
  });
  transaction(Object.entries(obj));
}

module.exports = {
  getDb, generateId, getAll, getById, insert, update, upsert,
  deleteById, deleteAll, run, query, queryOne, close,
  getKeyValue, setKeyValue, setKeyValues, getDbPath
};
