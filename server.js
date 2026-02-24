const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Handle ?page=request before static middleware (backward compat with old QR codes)
app.get('/', (req, res, next) => {
  if (req.query.page === 'request') {
    return res.sendFile(path.join(__dirname, 'public', 'request.html'));
  }
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Mount API routes
app.use('/api', require('./routes/devices'));
app.use('/api', require('./routes/traps'));
app.use('/api', require('./routes/blueprints'));
app.use('/api', require('./routes/email'));
app.use('/api', require('./routes/teachers'));
app.use('/api', require('./routes/technicians'));
app.use('/api', require('./routes/serviceRequests'));
app.use('/api', require('./routes/incidents'));
app.use('/api', require('./routes/computerRepairs'));
app.use('/api', require('./routes/settings'));
app.use('/api', require('./routes/qrCodes'));
app.use('/api', require('./routes/data'));
app.use('/api', require('./routes/gateway'));

// Serve request page for QR code scans
app.get('/request', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'request.html'));
});

// Serve main dashboard for all other routes
app.get('*', (req, res) => {
  // Don't intercept API calls or static files
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return;
  // Backward compatibility: ?page=request serves request.html (matches original doGet behavior)
  if (req.query.page === 'request') {
    return res.sendFile(path.join(__dirname, 'public', 'request.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize database on startup
require('./db/database');

app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`Smart School Monitor running at http://localhost:${config.PORT}`);
});
