require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT) || 3000,
  WEB_APP_URL: process.env.WEB_APP_URL || 'http://localhost:3000',
  DB_PATH: process.env.DB_PATH || (process.env.RAILWAY_ENVIRONMENT ? '/data/smartschool.db' : './data/smartschool.db'),
  TIMEZONE: process.env.TIMEZONE || 'America/New_York',
  SNMP_GATEWAY_URL: process.env.SNMP_GATEWAY_URL || 'http://localhost:5017',
  BLUEPRINT_DIR: process.env.BLUEPRINT_DIR || './uploads/blueprints',
  GMAIL_USER: process.env.GMAIL_USER || '',
  GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID || '',
  GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET || '',
  GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN || '',
  DEFAULT_POLL_INTERVAL: 15000
};
