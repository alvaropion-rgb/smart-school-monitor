#!/usr/bin/env node
/**
 * Reconstruct the SQLite database from seed.sql on Render.
 * This avoids committing the binary .sqlite file to git (which gets corrupted).
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'database.sqlite');
const seedPath = path.join(__dirname, '..', 'data', 'seed.sql');

// Only seed if database doesn't exist yet
if (fs.existsSync(dbPath)) {
  console.log('Database already exists at', dbPath, '— skipping seed.');
  process.exit(0);
}

if (!fs.existsSync(seedPath)) {
  console.log('No seed.sql found at', seedPath, '— skipping seed.');
  process.exit(0);
}

console.log('Seeding database from', seedPath, '→', dbPath);
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
const sql = fs.readFileSync(seedPath, 'utf8');
db.exec(sql);
db.pragma('journal_mode = DELETE');
db.close();

console.log('Database seeded successfully.');
