// ============================================
// Global Error Handler - Ensure loading screen gets dismissed
// ============================================
window.onerror = function(msg, url, lineNo, columnNo, error) {
  console.error('Global error: ' + msg + ' at line ' + lineNo + ':' + columnNo, error);
  // If there's a fatal error, still dismiss loading screen after a delay
  setTimeout(function() {
    if (typeof window.__dismissLoading === 'function') {
      window.__dismissLoading();
    }
  }, 2000);
  return false;
};

window.addEventListener('unhandledrejection', function(event) {
  console.error('Unhandled promise rejection:', event.reason);
  // Dismiss loading screen on unhandled promise rejection
  setTimeout(function() {
    if (typeof window.__dismissLoading === 'function') {
      window.__dismissLoading();
    }
  }, 2000);
});

// Google Apps Script IFRAME fix: set all buttons to type="button" to prevent
// implicit form submission behavior in the sandboxed iframe
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('button:not([type])').forEach(function(btn) {
    btn.setAttribute('type', 'button');
  });

  // Also observe for dynamically added buttons
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) {
          if (node.tagName === 'BUTTON' && !node.getAttribute('type')) {
            node.setAttribute('type', 'button');
          }
          if (node.querySelectorAll) {
            node.querySelectorAll('button:not([type])').forEach(function(btn) {
              btn.setAttribute('type', 'button');
            });
          }
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
});

// ============================================
// IndexedDB for Blueprint Images
// ============================================
const BlueprintDB = {
  db: null,
  dbName: 'CodeMAPBlueprints',
  storeName: 'images',
  version: 1,

  // Initialize the database
  init() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this.db);
        return;
      }

      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        log('IndexedDB initialized');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
          log('IndexedDB store created');
        }
      };
    });
  },

  // Save image to IndexedDB
  async saveImage(blueprintId, imageData) {
    try {
      await this.init();
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put({ id: blueprintId, imageData: imageData, updatedAt: Date.now() });

        request.onsuccess = () => {
          log('Image saved to IndexedDB:', blueprintId);
          resolve(true);
        };
        request.onerror = (event) => {
          logError('Error saving image:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      logError('IndexedDB saveImage error:', error);
      return false;
    }
  },

  // Get image from IndexedDB
  async getImage(blueprintId) {
    try {
      await this.init();
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(blueprintId);

        request.onsuccess = (event) => {
          const result = event.target.result;
          resolve(result ? result.imageData : null);
        };
        request.onerror = (event) => {
          logError('Error getting image:', event.target.error);
          resolve(null);
        };
      });
    } catch (error) {
      logError('IndexedDB getImage error:', error);
      return null;
    }
  },

  // Delete image from IndexedDB
  async deleteImage(blueprintId) {
    try {
      await this.init();
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(blueprintId);

        request.onsuccess = () => {
          log('Image deleted from IndexedDB:', blueprintId);
          resolve(true);
        };
        request.onerror = (event) => {
          logError('Error deleting image:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      logError('IndexedDB deleteImage error:', error);
      return false;
    }
  },

  // Get all stored blueprint IDs
  async getAllIds() {
    try {
      await this.init();
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.getAllKeys();

        request.onsuccess = (event) => {
          resolve(event.target.result || []);
        };
        request.onerror = (event) => {
          logError('Error getting keys:', event.target.error);
          resolve([]);
        };
      });
    } catch (error) {
      logError('IndexedDB getAllIds error:', error);
      return [];
    }
  }
};

// Initialize IndexedDB on load
BlueprintDB.init().catch(function(err) {
  console.error('IndexedDB initialization failed:', err);
});

// ============================================
// Blueprint Cloud Storage Helpers
// ============================================

/**
 * Compress image to JPEG for cloud storage.
 * Renders onto white background, caps at 4000px, returns JPEG data URL.
 */
function compressForCloudStorage(img, maxDim, quality) {
  maxDim = maxDim || 4000;
  quality = quality || 0.85;

  var canvas = document.createElement('canvas');
  var width = img.naturalWidth || img.width;
  var height = img.naturalHeight || img.height;

  if (width > maxDim || height > maxDim) {
    if (width > height) {
      height = Math.round(height * maxDim / width);
      width = maxDim;
    } else {
      width = Math.round(width * maxDim / height);
      height = maxDim;
    }
  }

  canvas.width = width;
  canvas.height = height;
  var ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Upload blueprint image to Google Drive via server.
 * Returns a promise with {success, driveFileId}.
 */
function uploadImageToDrive(blueprintId, imageDataUrl) {
  return new Promise(function(resolve, reject) {
    google.script.run
      .withSuccessHandler(function(result) {
        if (result && result.success) {
          resolve(result);
        } else {
          reject(new Error((result && result.error) || 'Upload failed'));
        }
      })
      .withFailureHandler(function(err) {
        reject(err);
      })
      .saveBlueprintImage(blueprintId, imageDataUrl);
  });
}

/**
 * Fetch blueprint image from Google Drive via server, cache in IndexedDB.
 * Returns the base64 data URL or null.
 */
function fetchImageFromDrive(driveFileId, blueprintId) {
  return new Promise(function(resolve) {
    google.script.run
      .withSuccessHandler(function(result) {
        if (result && result.success && result.imageData) {
          // Cache in IndexedDB for fast future access
          BlueprintDB.saveImage(blueprintId, result.imageData).then(function() {
            console.log('Cached Drive image in IndexedDB:', blueprintId);
          });
          resolve(result.imageData);
        } else {
          resolve(null);
        }
      })
      .withFailureHandler(function(err) {
        console.error('Failed to fetch image from Drive:', err);
        resolve(null);
      })
      .getBlueprintImage(driveFileId);
  });
}

/**
 * Migrate all local-only blueprints to Google Drive cloud storage.
 *
 * This switches to each blueprint tab, waits for the image to load,
 * reads it from the <img> element, and uploads to Drive.
 * No dependency on IndexedDB — works as long as maps display on screen.
 */
async function migrateLocalBlueprintsToDrive() {
  // Find which blueprints need migration
  var localBlueprints = [];
  Object.keys(state.blueprints).forEach(function(id) {
    var bp = state.blueprints[id];
    var ref = bp._storageRef || bp.imageData || '';
    if (!ref.startsWith('drive:')) {
      localBlueprints.push(id);
    }
  });

  if (localBlueprints.length === 0) {
    showToast('All maps are already stored in the cloud!', 'info');
    return;
  }

  var originalBlueprint = state.activeBlueprint;
  showToast('Migrating ' + localBlueprints.length + ' map(s) to cloud. Please wait...', 'info');

  var migrated = 0;
  var failed = 0;

  for (var i = 0; i < localBlueprints.length; i++) {
    var bpId = localBlueprints[i];
    var bp = state.blueprints[bpId];

    console.log('Migrating blueprint:', bpId, bp.name);

    // Switch to this blueprint tab so the image loads
    switchBlueprint(bpId);

    // Wait for the image to load (up to 10 seconds)
    var imageData = await new Promise(function(resolve) {
      var attempts = 0;
      var maxAttempts = 40; // 40 x 250ms = 10 seconds

      function checkImage() {
        attempts++;

        // Check 1: The <img> element has a data: src
        var imgEl = document.getElementById('blueprint-image');
        if (imgEl && imgEl.src && imgEl.src.startsWith('data:') && !imgEl.classList.contains('hidden')) {
          console.log('Found image from <img> element for', bpId);
          resolve(imgEl.src);
          return;
        }

        // Check 2: state has the image loaded as data URL
        var bpState = state.blueprints[bpId];
        if (bpState && bpState.imageData && bpState.imageData.startsWith('data:')) {
          console.log('Found image from state for', bpId);
          resolve(bpState.imageData);
          return;
        }

        // Check 3: Try IndexedDB directly
        if (attempts === 1) {
          // Try all possible keys on first attempt
          Promise.all([
            BlueprintDB.getImage(bpId),
            BlueprintDB.getImage('blueprint1'),
            BlueprintDB.getImage('all-devices-map')
          ]).then(function(results) {
            for (var r = 0; r < results.length; r++) {
              if (results[r]) {
                console.log('Found image from IndexedDB for', bpId, 'key index:', r);
                resolve(results[r]);
                return;
              }
            }
          });
        }

        if (attempts >= maxAttempts) {
          console.warn('Timeout waiting for image:', bpId);
          resolve(null);
          return;
        }

        setTimeout(checkImage, 250);
      }

      checkImage();
    });

    if (!imageData) {
      console.error('No image found for blueprint:', bpId, bp.name);
      failed++;
      continue;
    }

    try {
      // Compress to JPEG for cloud storage
      var jpegDataUrl = await new Promise(function(resolve) {
        var tempImg = new Image();
        tempImg.onload = function() { resolve(compressForCloudStorage(tempImg)); };
        tempImg.onerror = function() { resolve(null); };
        tempImg.src = imageData;
      });

      if (!jpegDataUrl) { failed++; continue; }

      showToast('Uploading "' + (bp.name || bpId) + '" to cloud... (' + (i + 1) + '/' + localBlueprints.length + ')', 'info');

      var result = await uploadImageToDrive(bpId, jpegDataUrl);

      bp._storageRef = 'drive:' + result.driveFileId;

      await new Promise(function(resolve) {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(function(err) {
            console.error('Sheet update failed for', bpId, err);
            resolve();
          })
          .saveBlueprint({
            id: bpId,
            name: bp.name || bpId,
            imageData: 'drive:' + result.driveFileId
          });
      });

      migrated++;
    } catch (err) {
      console.error('Migration failed for', bpId, err);
      failed++;
    }
  }

  // Switch back to original blueprint
  switchBlueprint(originalBlueprint);

  var msg = migrated + ' of ' + localBlueprints.length + ' map(s) uploaded to cloud!';
  if (failed > 0) msg += ' ' + failed + ' failed — use the Cloud button on each map.';
  showToast(msg, migrated > 0 ? 'success' : 'error');
}

/**
 * Upload the currently visible blueprint image to Google Drive.
 * Use this if bulk migration fails — navigate to each map and click this.
 */
async function uploadCurrentBlueprintToCloud() {
  var bpId = state.activeBlueprint;
  var bp = state.blueprints[bpId];
  if (!bp) {
    showToast('No active blueprint selected', 'warning');
    return;
  }

  // Check if already on Drive
  var ref = bp._storageRef || '';
  if (ref.startsWith('drive:')) {
    showToast('This map is already stored in the cloud!', 'info');
    return;
  }

  // Get the image - try state first, then IndexedDB
  var imageData = null;
  if (bp.imageData && bp.imageData.startsWith('data:')) {
    imageData = bp.imageData;
  }
  if (!imageData) {
    imageData = await BlueprintDB.getImage(bpId);
  }

  // Also try the currently displayed image element
  if (!imageData) {
    var imgEl = document.getElementById('blueprint-image');
    if (imgEl && imgEl.src && imgEl.src.startsWith('data:')) {
      imageData = imgEl.src;
    }
  }

  if (!imageData) {
    showToast('No image found for this map. Try re-uploading the image first.', 'error');
    return;
  }

  showToast('Uploading "' + (bp.name || bpId) + '" to cloud...', 'info');

  try {
    // Compress to JPEG
    var jpegDataUrl = await new Promise(function(resolve) {
      var tempImg = new Image();
      tempImg.onload = function() { resolve(compressForCloudStorage(tempImg)); };
      tempImg.onerror = function() { resolve(null); };
      tempImg.src = imageData;
    });

    if (!jpegDataUrl) {
      showToast('Failed to compress image', 'error');
      return;
    }

    var result = await uploadImageToDrive(bpId, jpegDataUrl);
    bp._storageRef = 'drive:' + result.driveFileId;

    await new Promise(function(resolve) {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(resolve)
        .saveBlueprint({
          id: bpId,
          name: bp.name || bpId,
          imageData: 'drive:' + result.driveFileId
        });
    });

    showToast('"' + (bp.name || bpId) + '" uploaded to cloud!', 'success');
  } catch (err) {
    console.error('Cloud upload failed:', err);
    showToast('Upload failed: ' + (err.message || err), 'error');
  }
}

// ============================================
// Performance Configuration
// ============================================
const DEBUG_MODE = false; // Set to false for production - disables console logs
const DEBOUNCE_DELAY = 150; // ms delay for debounced functions

// Optimized logging - only logs in debug mode
const log = DEBUG_MODE ? console.log.bind(console) : () => {};
const logError = console.error.bind(console); // Always log errors
const logWarn = DEBUG_MODE ? console.warn.bind(console) : () => {};

// Debounce utility for performance
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle utility for scroll/resize events
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// DOM element cache for frequently accessed elements
const domCache = {
  _cache: {},
  get(id) {
    if (!this._cache[id]) {
      this._cache[id] = document.getElementById(id);
    }
    return this._cache[id];
  },
  clear() {
    this._cache = {};
  }
};

// ============================================
// Global State
// ============================================
const state = {
  devices: [],
  deviceTypes: [],
  traps: [],
  blueprints: {},
  settings: {},
  emailConfig: {},
  technicians: [],
  currentTechName: localStorage.getItem('currentTechName') || '',
  activeBlueprint: 'blueprint1',
  activeDeviceType: 'all', // 'all' or a device type ID - controls which map/devices are shown
  currentTab: 'blueprint',
  placingDevice: false,
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  trapAutoRefresh: false,  // Default OFF - only listen for traps sent by copiers
  trapRefreshInterval: null,
  previousTrapCount: 0,
  alertingDevices: new Set(),
  serviceRequestAlertingDevices: new Set(), // For service request alerts
  previousServiceRequestCount: 0,
  previousServiceRequestIds: [],
  serviceRequestsInitialized: false,
  serviceRequestRefreshInterval: null,
  viewMode: 'bars', // 'bars', 'gauges', or 'cards'
  audioEnabled: true,
  isAuthenticated: false,
  passwordProtected: false,
  // Trap alert tracking - stores {trapId: lastAlertTime} to avoid duplicate alerts
  trapAlertTimes: {},
  // Re-alert interval in milliseconds (1 hour = 3600000)
  trapReAlertInterval: 3600000,
  // Track which traps we've already seen to avoid duplicate alerts
  knownTrapIds: new Set(),
  // Filter mode for showing only devices with issues
  showOnlyIssues: false,
  // Performance: cache for filtered devices
  _deviceCache: null,
  _deviceCacheKey: null,
  // Remote mode: true when gateway is unreachable (accessing from outside school network)
  isRemote: false,
  gatewayOnline: false
};

// ============================================
// Inline Confirmation Card (replaces native confirm())
// ============================================

/**
 * Shows a styled inline confirmation card instead of the native browser confirm() dialog.
 * @param {object} opts
 * @param {string} opts.title - Card header title
 * @param {string} opts.message - Card body message
 * @param {string} [opts.type='warn'] - 'warn', 'danger', or 'info' — controls icon and button color
 * @param {string} [opts.confirmText='Confirm'] - Text on the confirm button
 * @param {string} [opts.cancelText='Cancel'] - Text on the cancel button
 * @param {function} opts.onConfirm - Called when user clicks confirm
 * @param {function} [opts.onCancel] - Called when user clicks cancel (optional)
 */
function showConfirmCard(opts) {
  var type = opts.type || 'warn';
  var iconSvg = '';
  if (type === 'danger') {
    iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
  } else if (type === 'info') {
    iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  } else {
    iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  }

  // Create overlay
  var overlay = document.createElement('div');
  overlay.className = 'confirm-card-overlay';
  overlay.innerHTML =
    '<div class="confirm-card">' +
      '<div class="confirm-card-header">' +
        '<div class="confirm-card-icon ' + type + '">' + iconSvg + '</div>' +
        '<div class="confirm-card-title">' + (opts.title || 'Confirm') + '</div>' +
      '</div>' +
      '<div class="confirm-card-body">' + (opts.message || 'Are you sure?') + '</div>' +
      '<div class="confirm-card-actions">' +
        '<button class="btn-confirm-cancel">' + (opts.cancelText || 'Cancel') + '</button>' +
        '<button class="btn-confirm-ok ' + type + '">' + (opts.confirmText || 'Confirm') + '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  // Close on overlay click (outside card)
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) {
      overlay.remove();
      if (opts.onCancel) opts.onCancel();
    }
  });

  // Cancel button
  overlay.querySelector('.btn-confirm-cancel').addEventListener('click', function() {
    overlay.remove();
    if (opts.onCancel) opts.onCancel();
  });

  // Confirm button
  overlay.querySelector('.btn-confirm-ok').addEventListener('click', function() {
    overlay.remove();
    if (opts.onConfirm) opts.onConfirm();
  });

  // Focus confirm button for keyboard accessibility
  overlay.querySelector('.btn-confirm-ok').focus();

  // ESC key to cancel
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKeyDown);
      if (opts.onCancel) opts.onCancel();
    }
  }
  document.addEventListener('keydown', onKeyDown);
}

/**
 * Show an in-app input prompt card (replaces browser prompt()).
 * opts: { title, message, placeholder, defaultValue, type('info'|'warn'), confirmText, cancelText, onConfirm(value), onCancel }
 */
function showInputCard(opts) {
  var type = opts.type || 'info';
  var iconSvg = type === 'warn'
    ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';

  var overlay = document.createElement('div');
  overlay.className = 'confirm-card-overlay';
  overlay.innerHTML =
    '<div class="confirm-card">' +
      '<div class="confirm-card-header">' +
        '<div class="confirm-card-icon ' + type + '">' + iconSvg + '</div>' +
        '<div class="confirm-card-title">' + (opts.title || 'Input') + '</div>' +
      '</div>' +
      '<div class="confirm-card-body">' +
        '<p style="margin:0 0 12px 0;">' + (opts.message || '') + '</p>' +
        '<input type="text" class="input-card-field" placeholder="' + (opts.placeholder || '') + '" value="' + (opts.defaultValue || '') + '" style="width:100%;padding:10px 12px;border:1px solid var(--border-color,#e2e8f0);border-radius:8px;font-size:14px;background:var(--bg-primary,#fff);color:var(--text-primary,#1e293b);outline:none;box-sizing:border-box;" />' +
      '</div>' +
      '<div class="confirm-card-actions">' +
        '<button class="btn-confirm-cancel">' + (opts.cancelText || 'Cancel') + '</button>' +
        '<button class="btn-confirm-ok info">' + (opts.confirmText || 'OK') + '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  var inputEl = overlay.querySelector('.input-card-field');
  inputEl.focus();
  if (opts.defaultValue) inputEl.select();

  function submit() {
    var val = inputEl.value;
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
    if (opts.onConfirm) opts.onConfirm(val);
  }
  function cancel() {
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
    if (opts.onCancel) opts.onCancel();
  }

  overlay.addEventListener('click', function(e) { if (e.target === overlay) cancel(); });
  overlay.querySelector('.btn-confirm-cancel').addEventListener('click', cancel);
  overlay.querySelector('.btn-confirm-ok').addEventListener('click', submit);
  inputEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') submit(); });

  function onKeyDown(e) { if (e.key === 'Escape') cancel(); }
  document.addEventListener('keydown', onKeyDown);
}

// ============================================
// Audio Alert System
// ============================================
const AudioAlert = {
  context: null,
  enabled: true,
  initialized: false,

  init() {
    // Create audio context on any user interaction
    const initAudio = () => {
      if (!this.context) {
        try {
          this.context = new (window.AudioContext || window.webkitAudioContext)();
          this.initialized = true;
          console.log('Audio context initialized');
        } catch (e) {
          console.warn('Audio context creation failed:', e);
        }
      }
      // Resume if suspended
      if (this.context && this.context.state === 'suspended') {
        this.context.resume();
      }
    };

    // Listen for multiple interaction types
    ['click', 'touchstart', 'keydown'].forEach(event => {
      document.addEventListener(event, initAudio, { once: false, passive: true });
    });

    // Also request notification permission for visual alerts
    if ('Notification' in window && Notification.permission === 'default') {
      // Will request when user interacts
      document.addEventListener('click', () => {
        Notification.requestPermission();
      }, { once: true });
    }
  },

  ensureContext() {
    if (!this.context) {
      try {
        this.context = new (window.AudioContext || window.webkitAudioContext)();
        this.initialized = true;
      } catch (e) {
        console.warn('Audio not available');
        return false;
      }
    }
    // Resume if suspended (browser policy)
    if (this.context.state === 'suspended') {
      this.context.resume();
    }
    return true;
  },

  playChime() {
    if (!this.enabled) return;
    if (!this.ensureContext()) return;

    const ctx = this.context;
    const now = ctx.currentTime;

    // Create a pleasant alert chime (two-tone)
    const frequencies = [880, 1100, 880]; // A5, C#6, A5
    const durations = [0.15, 0.15, 0.2];

    frequencies.forEach((freq, i) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = freq;
      oscillator.type = 'sine';

      const startTime = now + (i * 0.15);
      gainNode.gain.setValueAtTime(0.3, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + durations[i]);

      oscillator.start(startTime);
      oscillator.stop(startTime + durations[i]);
    });
  },

  playUrgentAlert() {
    if (!this.enabled) return;

    // Play chime 3 times for urgent alerts
    this.playChime();
    setTimeout(() => this.playChime(), 400);
    setTimeout(() => this.playChime(), 800);
  },

  // New distinct tone for service requests (doorbell-like)
  playServiceRequestAlert() {
    if (!this.enabled) return;
    if (!this.ensureContext()) return;

    const ctx = this.context;
    const now = ctx.currentTime;

    // Two-tone doorbell sound (ding-dong) - different from SNMP chime
    const frequencies = [659, 523]; // E5, C5 - classic doorbell
    const durations = [0.3, 0.4];

    frequencies.forEach((freq, i) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = freq;
      oscillator.type = 'triangle'; // Softer sound than sine

      const startTime = now + (i * 0.35);
      gainNode.gain.setValueAtTime(0.4, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + durations[i]);

      oscillator.start(startTime);
      oscillator.stop(startTime + durations[i]);
    });

    // Also try browser notification
    this.showBrowserNotification('New Service Request', 'A new issue has been reported');
  },

  showBrowserNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: body,
          icon: '🔔',
          tag: 'service-request',
          requireInteraction: false
        });
      } catch (e) {
        console.log('Browser notification failed:', e);
      }
    }
  },

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
};

// Initialize audio system
AudioAlert.init();

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', function() {
  initializeApp();
});

// Helper: wrap a promise with a timeout
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error(label + ' timed out after ' + ms + 'ms')); }, ms);
    })
  ]);
}

async function initializeApp() {
  try {
    console.log('initializeApp: starting...');

    // Check if google.script.run is available (required for Apps Script deployment)
    if (typeof google === 'undefined' || !google.script || !google.script.run) {
      console.error('google.script.run is not available - app must be deployed as a Google Apps Script web app');
      return;
    }

    // Apply splash screen customization immediately
    applySplashSettingsToScreen();

    // Check if password protected (with timeout)
    await withTimeout(checkPasswordProtection(), 10000, 'checkPasswordProtection')
      .catch(function(e) { console.error('Password check failed/timeout:', e); });

    // Load all data with timeout protection (30 second timeout per call)
    console.log('initializeApp: loading data...');
    await Promise.all([
      withTimeout(loadDevices(), 30000, 'loadDevices').catch(e => console.error('Error loading devices:', e)),
      withTimeout(loadTraps(), 30000, 'loadTraps').catch(e => console.error('Error loading traps:', e)),
      withTimeout(loadSettings(), 30000, 'loadSettings').catch(e => console.error('Error loading settings:', e)),
      withTimeout(loadEmailConfig(), 30000, 'loadEmailConfig').catch(e => console.error('Error loading email config:', e)),
      withTimeout(loadBlueprints(), 30000, 'loadBlueprints').catch(e => console.error('Error loading blueprints:', e)),
      withTimeout(loadTechnicians(), 30000, 'loadTechnicians').catch(e => console.error('Error loading technicians:', e))
    ]);
    console.log('initializeApp: data loaded.');

    // Apply theme
    const savedTheme = localStorage.getItem('theme') || 'system';
    setTheme(savedTheme);

    // Set up event listeners
    setupBlueprintCanvas();
    setupTrapAutoRefresh();
    setupServiceRequestAutoRefresh();

    // Update UI
    updateAllStats();
    renderDeviceMarkers();
    renderDeviceTable();
    renderDashboard();
    renderTrapsList();

    // Initialize polling checkbox (OFF by default)
    var pollingCheckbox = document.getElementById('auto-refresh-traps');
    if (pollingCheckbox) {
      pollingCheckbox.checked = state.trapAutoRefresh;
    }
    updatePollingStatusText();

    // Apply saved settings
    applySettings();

    // Load saved map background color
    loadMapBackgroundColor();

    // Initialize test environment settings
    initTestEnvironment();

    // Set up gateway port display sync
    const trapPortInput = document.getElementById('setting-trap-port');
    const portDisplay = document.getElementById('gateway-port-display');
    if (trapPortInput && portDisplay) {
      trapPortInput.addEventListener('input', () => {
        portDisplay.textContent = trapPortInput.value || '1162';
      });
    }

    // Check gateway status on load and set up periodic checks
    checkGatewayStatus();
    setInterval(checkGatewayStatus, 10000);

    // Start real-time trap listener (push notifications from gateway)
    startRealTimeTrapListener();

    // Request notification permission for desktop alerts
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Device type color picker is now synced via oninput handlers in HTML
    // (syncDeviceTypeColor and syncDeviceTypeColorFromHex)

    // Sync markers on window resize (debounced)
    var resizeTimeout;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(function() {
        syncMarkersToImage();
        renderDeviceMarkers();
      }, 150);
    });

  } catch (error) {
    console.error('Error initializing app:', error);
  } finally {
    // Always hide loading screen after init attempt
    setTimeout(function() {
      try {
        if (typeof window.__dismissLoading === 'function') {
          window.__dismissLoading();
        } else {
          document.getElementById('loading-screen').classList.add('hidden');
          document.getElementById('main-app').classList.remove('hidden');
        }
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
        // Nuclear overlay cleanup — ensure NOTHING blocks clicks
        clearAllBlockingOverlays();
      } catch (e) {
        console.error('Error dismissing loading screen:', e);
        // Last resort - force hide loading screen
        var ls = document.getElementById('loading-screen');
        var ma = document.getElementById('main-app');
        if (ls) ls.style.display = 'none';
        if (ma) { ma.classList.remove('hidden'); ma.style.display = ''; }
      }
    }, 500);
  }
}

/**
 * Nuclear cleanup: find and disable any element that could be blocking clicks.
 * Runs after init to ensure the UI is fully interactive.
 */
function clearAllBlockingOverlays() {
  // 1. Force-hide loading screen
  var ls = document.getElementById('loading-screen');
  if (ls) {
    ls.style.display = 'none';
    ls.style.pointerEvents = 'none';
    ls.style.zIndex = '-1';
    ls.style.visibility = 'hidden';
  }

  // 2. Remove any stuck sidebar overlay
  var so = document.getElementById('sidebar-overlay');
  if (so && so.classList.contains('active')) {
    var sb = document.getElementById('sidebar');
    if (!sb || !sb.classList.contains('open')) {
      so.classList.remove('active');
    }
  }

  // 3. Remove any stuck modal backdrops
  document.querySelectorAll('.modal-backdrop, .confirm-card-overlay').forEach(function(el) {
    if (el.offsetParent !== null) { // visible
      el.remove();
    }
  });

  // 4. Scan for ANY fixed/absolute element covering the viewport that blocks clicks
  var allEls = document.querySelectorAll('*');
  for (var i = 0; i < allEls.length; i++) {
    var el = allEls[i];
    var cs = window.getComputedStyle(el);
    if ((cs.position === 'fixed' || cs.position === 'absolute') &&
        cs.display !== 'none' && cs.visibility !== 'hidden' &&
        el.offsetWidth >= window.innerWidth * 0.9 &&
        el.offsetHeight >= window.innerHeight * 0.9 &&
        cs.pointerEvents !== 'none' &&
        el.id !== 'main-app' && el.id !== 'app' &&
        !el.classList.contains('tab-content') &&
        !el.classList.contains('main-content') &&
        !el.classList.contains('overview-dashboard')) {
      console.warn('[OVERLAY DETECTED] Blocking element found:', el.tagName, el.id || el.className, 'z-index:', cs.zIndex);
      // Force it to not block clicks
      el.style.pointerEvents = 'none';
    }
  }

  console.log('[INIT] Overlay cleanup complete. UI should be interactive.');
}

// ============================================
// Data Loading Functions
// ============================================
async function loadDevices() {
  return new Promise(function(resolve, reject) {
    google.script.run
      .withSuccessHandler(function(devices) {
        try {
          state.devices = Array.isArray(devices) ? devices : [];
        } catch (e) {
          console.error('Error processing devices:', e);
          state.devices = [];
        }
        resolve();
      })
      .withFailureHandler(function(err) {
        console.error('Error loading devices:', err);
        state.devices = [];
        resolve();
      })
      .getDevices();
  });
}

async function loadTraps() {
  return new Promise(function(resolve, reject) {
    google.script.run
      .withSuccessHandler(function(traps) {
        try {
          var newTraps = Array.isArray(traps) ? traps : [];
          var now = Date.now();
          var trapsToAlert = [];

          // Process each unresolved trap
          newTraps.forEach(function(trap) {
            if (trap.processed !== 0) return; // Skip resolved traps

            var trapId = trap.id || (trap.sourceIp + '_' + trap.receivedAt);

            // Check if this is a NEW trap we haven't seen before
            if (!state.knownTrapIds.has(trapId)) {
              state.knownTrapIds.add(trapId);
              state.trapAlertTimes[trapId] = now;
              trapsToAlert.push(trap);
            } else {
              // Check if we need to re-alert (trap not resolved after 1 hour)
              var lastAlertTime = state.trapAlertTimes[trapId] || 0;
              var timeSinceLastAlert = now - lastAlertTime;

              if (timeSinceLastAlert >= state.trapReAlertInterval) {
                // Re-alert - it's been over 1 hour
                state.trapAlertTimes[trapId] = now;
                trapsToAlert.push(trap);
              }
            }
          });

          // Alert for new or re-alerting traps
          if (trapsToAlert.length > 0) {
            // Trigger visual alert for each trap's device
            trapsToAlert.forEach(function(trap) {
              triggerDeviceAlert(trap.sourceIp);
            });

            // Play sound if enabled
            var soundEnabled = document.getElementById('trap-sound-alert');
            if (soundEnabled && soundEnabled.checked) {
              AudioAlert.playChime();
            }

            // Desktop notification if enabled
            var desktopNotify = document.getElementById('trap-desktop-notify');
            if (desktopNotify && desktopNotify.checked && 'Notification' in window) {
              if (Notification.permission === 'granted') {
                var isReAlert = trapsToAlert.some(function(t) {
                  var tid = t.id || (t.sourceIp + '_' + t.receivedAt);
                  return state.trapAlertTimes[tid] && (now - state.trapAlertTimes[tid]) < 1000;
                });
                new Notification(isReAlert ? '⚠️ Unresolved SNMP Trap' : '🚨 New SNMP Trap', {
                  body: trapsToAlert.length + ' trap(s) need attention',
                  icon: '/favicon.ico'
                });
              }
            }

            // Show notification
            var plural = trapsToAlert.length > 1 ? 's' : '';
            showToast('🚨 ' + trapsToAlert.length + ' trap' + plural + ' need attention!', 'warning');
          }

          // Clean up old trap tracking for resolved traps
          var activeTrapIds = new Set(newTraps.filter(function(t) { return t.processed === 0; }).map(function(t) {
            return t.id || (t.sourceIp + '_' + t.receivedAt);
          }));

          // Remove tracking for resolved traps
          Object.keys(state.trapAlertTimes).forEach(function(trapId) {
            if (!activeTrapIds.has(trapId)) {
              delete state.trapAlertTimes[trapId];
              state.knownTrapIds.delete(trapId);
            }
          });

          state.traps = newTraps;
          state.previousTrapCount = newTraps.length;
          updateTrapBadge();

          // Update trap statistics display
          var lastTrapTime = newTraps.length > 0 ? newTraps[0].receivedAt : null;
          updateTrapStats(newTraps.length, lastTrapTime);
        } catch (e) {
          console.error('Error processing traps:', e);
          state.traps = [];
        }
        resolve();
      })
      .withFailureHandler(function(err) {
        console.error('Error loading traps:', err);
        state.traps = [];
        resolve();
      })
      .getTraps(100);
  });
}

async function loadSettings() {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(settings => {
        state.settings = settings || {};
        resolve();
      })
      .withFailureHandler(function(err) {
        console.error('Error loading settings:', err);
        state.settings = {};
        resolve();
      })
      .getSettings();
  });
}

async function loadEmailConfig() {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(config => {
        state.emailConfig = config || {};
        resolve();
      })
      .withFailureHandler(function(err) {
        console.error('Error loading email config:', err);
        state.emailConfig = {};
        resolve();
      })
      .getEmailConfig();
  });
}

async function loadBlueprints() {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(function(blueprints) {
        try {
          var bps = blueprints || [];
          if (Array.isArray(bps)) {
            bps.forEach(function(bp) {
              if (bp && bp.id) {
                // Preserve the storage reference (drive:xxx or local:xxx) separately
                bp._storageRef = bp.imageData || '';
                state.blueprints[bp.id] = bp;
              }
            });
          }
          updateBlueprintDisplay();
        } catch (e) {
          console.error('Error processing blueprints:', e);
        }
        resolve();
      })
      .withFailureHandler(function(err) {
        console.error('Error loading blueprints:', err);
        resolve();
      })
      .getBlueprints();
  });
}

async function loadTechnicians() {
  return new Promise(function(resolve, reject) {
    google.script.run
      .withSuccessHandler(function(techs) {
        state.technicians = techs || [];
        resolve();
      })
      .withFailureHandler(function(err) {
        console.error('Error loading technicians:', err);
        state.technicians = [];
        resolve(); // Don't fail initialization
      })
      .getTechnicians();
  });
}

async function checkPasswordProtection() {
  return new Promise(function(resolve) {
    google.script.run
      .withSuccessHandler(function(result) {
        console.log('Password protection check result:', result);
        state.passwordProtected = result.protected === true;
        console.log('state.passwordProtected set to:', state.passwordProtected);

        if (state.passwordProtected) {
          // Check if already authenticated this session
          var sessionAuth = sessionStorage.getItem('authenticated');
          if (sessionAuth === 'true') {
            state.isAuthenticated = true;
            console.log('Session auth found, isAuthenticated = true');
          } else {
            state.isAuthenticated = false;
            console.log('No session auth, isAuthenticated = false');
          }
        } else {
          state.isAuthenticated = true;
          console.log('Not password protected, isAuthenticated = true');
        }
        // Update lock indicators on nav items
        setTimeout(function() {
          updateNavLockIndicators();
        }, 500);
        resolve();
      })
      .withFailureHandler(function(err) {
        console.error('Password protection check failed:', err);
        state.passwordProtected = false;
        state.isAuthenticated = true;
        resolve();
      })
      .isPasswordProtected();
  });
}

async function refreshData() {
  showToast('Refreshing data...', 'info');
  try {
    await Promise.all([loadDevices(), loadTraps()]);
    updateAllStats();
    renderDeviceMarkers();
    renderDeviceTable();
    renderDashboard();
    renderTrapsList();
    showToast('Data refreshed', 'success');
  } catch (error) {
    showToast('Error refreshing data', 'error');
  }
}

// ============================================
// Theme Management
// ============================================
function setTheme(theme) {
  localStorage.setItem('theme', theme);

  // Update active button
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });

  // Apply theme
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// ============================================
// Theme Customization Functions
// ============================================
var customTheme = {};

// Update a single theme color
function updateThemeColor(colorName, value) {
  document.documentElement.style.setProperty('--' + colorName, value);
  customTheme[colorName] = value;

  // Sync hex input
  var hexInput = document.getElementById('theme-' + colorName + '-hex');
  if (hexInput) hexInput.value = value;

  // Handle special cases
  if (colorName === 'primary') {
    document.documentElement.style.setProperty('--primary-hover', adjustColor(value, -15));
    document.documentElement.style.setProperty('--primary-light', adjustColor(value, 80, true));
  }
  if (colorName === 'sidebar-bg') {
    document.querySelector('.sidebar').style.background = value;
  }
  if (colorName === 'header-bg') {
    document.querySelector('.header').style.background = value;
  }
  if (colorName === 'title-color') {
    var titleEl = document.querySelector('.brand h1');
    if (titleEl) titleEl.style.color = value;
  }
}

// Update color from hex input
function updateThemeColorFromHex(colorName, value) {
  if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
    var colorPicker = document.getElementById('theme-' + colorName);
    if (colorPicker) colorPicker.value = value;
    updateThemeColor(colorName, value);
  }
}

// Adjust color brightness
function adjustColor(hex, percent, lighten) {
  var num = parseInt(hex.replace('#', ''), 16);
  var r = (num >> 16) + (lighten ? percent : -percent);
  var g = ((num >> 8) & 0x00FF) + (lighten ? percent : -percent);
  var b = (num & 0x0000FF) + (lighten ? percent : -percent);
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));
  return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

// Update font family
function updateThemeFont(fontFamily) {
  document.documentElement.style.setProperty('--font-family', fontFamily);
  document.body.style.fontFamily = fontFamily;
  customTheme['font-family'] = fontFamily;
}

// Update font size
function updateThemeFontSize(size) {
  document.documentElement.style.fontSize = size;
  customTheme['font-size'] = size;
}

// Update heading weight
function updateThemeHeadingWeight(weight) {
  document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function(el) {
    el.style.fontWeight = weight;
  });
  customTheme['heading-weight'] = weight;
}

// Update border radius
function updateThemeRadius(radius) {
  document.documentElement.style.setProperty('--radius-sm', radius);
  document.documentElement.style.setProperty('--radius-md', parseInt(radius) + 4 + 'px');
  document.documentElement.style.setProperty('--radius-lg', parseInt(radius) + 8 + 'px');
  customTheme['radius'] = radius;
}

// Update shadow intensity
function updateThemeShadow(intensity) {
  var shadows = {
    'none': 'none',
    'light': 'rgba(0, 0, 0, 0.05)',
    'medium': 'rgba(0, 0, 0, 0.1)',
    'heavy': 'rgba(0, 0, 0, 0.2)'
  };
  document.documentElement.style.setProperty('--shadow', shadows[intensity] || shadows['medium']);
  customTheme['shadow'] = intensity;
}

// Update sidebar width
function updateThemeSidebarWidth(width) {
  document.documentElement.style.setProperty('--sidebar-width', width);
  customTheme['sidebar-width'] = width;
}

// Update app title
function updateAppTitle(title) {
  var titleEl = document.querySelector('.brand h1');
  if (titleEl) titleEl.textContent = title;
  customTheme['app-title'] = title;
}

// Update app subtitle
function updateAppSubtitle(subtitle) {
  var subtitleEl = document.querySelector('.brand p');
  if (subtitleEl) subtitleEl.textContent = subtitle;
  customTheme['app-subtitle'] = subtitle;
}

// Apply preset theme
function applyPresetTheme(themeName) {
  var themes = {
    // === ✨ MODERN LIGHT THEMES ===
    'default': {
      primary: '#6366f1', success: '#22c55e', warning: '#f59e0b', danger: '#ef4444',
      'bg-primary': '#ffffff', 'bg-secondary': '#f8fafc', 'bg-tertiary': '#f1f5f9',
      'text-primary': '#0f172a', 'text-secondary': '#475569', 'sidebar-bg': '#1e293b'
    },
    'glass': {
      primary: '#3b82f6', success: '#10b981', warning: '#f59e0b', danger: '#ef4444',
      'bg-primary': '#ffffff', 'bg-secondary': 'rgba(248,250,252,0.8)', 'bg-tertiary': 'rgba(241,245,249,0.9)',
      'text-primary': '#1e293b', 'text-secondary': '#64748b', 'sidebar-bg': 'rgba(15,23,42,0.95)'
    },
    'notion': {
      primary: '#2563eb', success: '#059669', warning: '#d97706', danger: '#dc2626',
      'bg-primary': '#ffffff', 'bg-secondary': '#f7f6f3', 'bg-tertiary': '#efeee8',
      'text-primary': '#37352f', 'text-secondary': '#787774', 'sidebar-bg': '#f7f6f3'
    },
    'linear': {
      primary: '#5e6ad2', success: '#2da44e', warning: '#bf8700', danger: '#cf222e',
      'bg-primary': '#ffffff', 'bg-secondary': '#f5f5f5', 'bg-tertiary': '#ebebeb',
      'text-primary': '#1b1b1f', 'text-secondary': '#6c6c6c', 'sidebar-bg': '#0d0d0d'
    },
    'vercel': {
      primary: '#000000', success: '#50e3c2', warning: '#f5a623', danger: '#e00',
      'bg-primary': '#fafafa', 'bg-secondary': '#f5f5f5', 'bg-tertiary': '#eaeaea',
      'text-primary': '#000000', 'text-secondary': '#666666', 'sidebar-bg': '#000000'
    },
    'stripe': {
      primary: '#635bff', success: '#30c48d', warning: '#f8b73e', danger: '#ed5f74',
      'bg-primary': '#ffffff', 'bg-secondary': '#f6f9fc', 'bg-tertiary': '#e3e8ee',
      'text-primary': '#0a2540', 'text-secondary': '#425466', 'sidebar-bg': '#0a2540'
    },

    // === 🌙 MODERN DARK THEMES ===
    'obsidian': {
      primary: '#a78bfa', success: '#34d399', warning: '#fbbf24', danger: '#f87171',
      'bg-primary': '#1a1a2e', 'bg-secondary': '#16213e', 'bg-tertiary': '#0f3460',
      'text-primary': '#eaeaea', 'text-secondary': '#a5b4c4', 'sidebar-bg': '#0f0f1a'
    },
    'github-dark': {
      primary: '#58a6ff', success: '#3fb950', warning: '#d29922', danger: '#f85149',
      'bg-primary': '#0d1117', 'bg-secondary': '#161b22', 'bg-tertiary': '#21262d',
      'text-primary': '#c9d1d9', 'text-secondary': '#8b949e', 'sidebar-bg': '#010409'
    },
    'vscode': {
      primary: '#007acc', success: '#4ec9b0', warning: '#dcdcaa', danger: '#f14c4c',
      'bg-primary': '#1e1e1e', 'bg-secondary': '#252526', 'bg-tertiary': '#2d2d30',
      'text-primary': '#d4d4d4', 'text-secondary': '#808080', 'sidebar-bg': '#181818'
    },
    'discord': {
      primary: '#5865f2', success: '#3ba55c', warning: '#faa61a', danger: '#ed4245',
      'bg-primary': '#36393f', 'bg-secondary': '#2f3136', 'bg-tertiary': '#40444b',
      'text-primary': '#dcddde', 'text-secondary': '#8e9297', 'sidebar-bg': '#202225'
    },
    'spotify': {
      primary: '#1db954', success: '#1db954', warning: '#ffa42b', danger: '#e91429',
      'bg-primary': '#121212', 'bg-secondary': '#181818', 'bg-tertiary': '#282828',
      'text-primary': '#ffffff', 'text-secondary': '#b3b3b3', 'sidebar-bg': '#000000'
    },
    'slack': {
      primary: '#4a154b', success: '#2eb67d', warning: '#ecb22e', danger: '#e01e5a',
      'bg-primary': '#1a1d21', 'bg-secondary': '#222529', 'bg-tertiary': '#2c2d30',
      'text-primary': '#d1d2d3', 'text-secondary': '#ababad', 'sidebar-bg': '#19171d'
    },

    // === 🎨 GRADIENT & TRENDY ===
    'aurora-glow': {
      primary: '#06b6d4', success: '#84cc16', warning: '#eab308', danger: '#f43f5e',
      'bg-primary': '#0f0f23', 'bg-secondary': '#1a1a3e', 'bg-tertiary': '#252559',
      'text-primary': '#e0f2fe', 'text-secondary': '#7dd3fc', 'sidebar-bg': '#050514'
    },
    'sunset-dream': {
      primary: '#f97316', success: '#22c55e', warning: '#fbbf24', danger: '#ef4444',
      'bg-primary': '#fef7f0', 'bg-secondary': '#ffecd2', 'bg-tertiary': '#fcb69f',
      'text-primary': '#7c2d12', 'text-secondary': '#9a3412', 'sidebar-bg': '#1c1917'
    },
    'ocean-breeze': {
      primary: '#0891b2', success: '#059669', warning: '#d97706', danger: '#dc2626',
      'bg-primary': '#f0fdff', 'bg-secondary': '#e0f7fa', 'bg-tertiary': '#b2ebf2',
      'text-primary': '#164e63', 'text-secondary': '#0e7490', 'sidebar-bg': '#083344'
    },
    'berry-blast': {
      primary: '#c026d3', success: '#22c55e', warning: '#f59e0b', danger: '#ef4444',
      'bg-primary': '#fdf4ff', 'bg-secondary': '#fae8ff', 'bg-tertiary': '#f5d0fe',
      'text-primary': '#701a75', 'text-secondary': '#a21caf', 'sidebar-bg': '#4a044e'
    },
    'mint-fresh': {
      primary: '#14b8a6', success: '#10b981', warning: '#f59e0b', danger: '#ef4444',
      'bg-primary': '#f0fdfa', 'bg-secondary': '#ccfbf1', 'bg-tertiary': '#99f6e4',
      'text-primary': '#134e4a', 'text-secondary': '#0f766e', 'sidebar-bg': '#042f2e'
    },
    'lavender-mist': {
      primary: '#8b5cf6', success: '#22c55e', warning: '#f59e0b', danger: '#ef4444',
      'bg-primary': '#faf5ff', 'bg-secondary': '#f3e8ff', 'bg-tertiary': '#e9d5ff',
      'text-primary': '#581c87', 'text-secondary': '#7c3aed', 'sidebar-bg': '#2e1065'
    },

    // === 💼 PROFESSIONAL ===
    'corporate': {
      primary: '#2563eb', success: '#16a34a', warning: '#ca8a04', danger: '#dc2626',
      'bg-primary': '#ffffff', 'bg-secondary': '#f8fafc', 'bg-tertiary': '#e2e8f0',
      'text-primary': '#1e293b', 'text-secondary': '#475569', 'sidebar-bg': '#1e40af'
    },
    'executive': {
      primary: '#1e3a5f', success: '#166534', warning: '#854d0e', danger: '#991b1b',
      'bg-primary': '#ffffff', 'bg-secondary': '#f8fafc', 'bg-tertiary': '#e2e8f0',
      'text-primary': '#0f172a', 'text-secondary': '#334155', 'sidebar-bg': '#0f172a'
    },
    'finance': {
      primary: '#0369a1', success: '#15803d', warning: '#a16207', danger: '#b91c1c',
      'bg-primary': '#ffffff', 'bg-secondary': '#f0f9ff', 'bg-tertiary': '#e0f2fe',
      'text-primary': '#0c4a6e', 'text-secondary': '#0284c7', 'sidebar-bg': '#082f49'
    },
    'healthcare': {
      primary: '#0891b2', success: '#059669', warning: '#d97706', danger: '#dc2626',
      'bg-primary': '#ffffff', 'bg-secondary': '#ecfeff', 'bg-tertiary': '#cffafe',
      'text-primary': '#155e75', 'text-secondary': '#0e7490', 'sidebar-bg': '#164e63'
    },
    'legal': {
      primary: '#44403c', success: '#166534', warning: '#92400e', danger: '#991b1b',
      'bg-primary': '#fafaf9', 'bg-secondary': '#f5f5f4', 'bg-tertiary': '#e7e5e4',
      'text-primary': '#1c1917', 'text-secondary': '#44403c', 'sidebar-bg': '#1c1917'
    },
    'education': {
      primary: '#7c3aed', success: '#22c55e', warning: '#f59e0b', danger: '#ef4444',
      'bg-primary': '#ffffff', 'bg-secondary': '#f5f3ff', 'bg-tertiary': '#ede9fe',
      'text-primary': '#4c1d95', 'text-secondary': '#6d28d9', 'sidebar-bg': '#4c1d95'
    },

    // === 🌿 NATURE INSPIRED ===
    'forest': {
      primary: '#166534', success: '#15803d', warning: '#a16207', danger: '#b91c1c',
      'bg-primary': '#f0fdf4', 'bg-secondary': '#dcfce7', 'bg-tertiary': '#bbf7d0',
      'text-primary': '#14532d', 'text-secondary': '#166534', 'sidebar-bg': '#052e16'
    },
    'ocean': {
      primary: '#0284c7', success: '#059669', warning: '#d97706', danger: '#dc2626',
      'bg-primary': '#f0f9ff', 'bg-secondary': '#e0f2fe', 'bg-tertiary': '#bae6fd',
      'text-primary': '#0c4a6e', 'text-secondary': '#0369a1', 'sidebar-bg': '#082f49'
    },
    'desert': {
      primary: '#b45309', success: '#65a30d', warning: '#d97706', danger: '#c2410c',
      'bg-primary': '#fffbeb', 'bg-secondary': '#fef3c7', 'bg-tertiary': '#fde68a',
      'text-primary': '#78350f', 'text-secondary': '#92400e', 'sidebar-bg': '#451a03'
    },
    'mountain': {
      primary: '#64748b', success: '#22c55e', warning: '#f59e0b', danger: '#ef4444',
      'bg-primary': '#f8fafc', 'bg-secondary': '#f1f5f9', 'bg-tertiary': '#e2e8f0',
      'text-primary': '#1e293b', 'text-secondary': '#475569', 'sidebar-bg': '#1e293b'
    },
    'sunset': {
      primary: '#ea580c', success: '#16a34a', warning: '#fbbf24', danger: '#dc2626',
      'bg-primary': '#fffbeb', 'bg-secondary': '#fef3c7', 'bg-tertiary': '#fde68a',
      'text-primary': '#7c2d12', 'text-secondary': '#c2410c', 'sidebar-bg': '#431407'
    },
    'sakura': {
      primary: '#ec4899', success: '#22c55e', warning: '#f59e0b', danger: '#ef4444',
      'bg-primary': '#fdf2f8', 'bg-secondary': '#fce7f3', 'bg-tertiary': '#fbcfe8',
      'text-primary': '#831843', 'text-secondary': '#be185d', 'sidebar-bg': '#500724'
    },

    // === 🎮 TECH & GAMING ===
    'cyberpunk': {
      primary: '#f0abfc', success: '#4ade80', warning: '#fde047', danger: '#f87171',
      'bg-primary': '#0c0a1d', 'bg-secondary': '#1a1833', 'bg-tertiary': '#2d2a4a',
      'text-primary': '#f0abfc', 'text-secondary': '#c084fc', 'sidebar-bg': '#05040f'
    },
    'matrix': {
      primary: '#22c55e', success: '#4ade80', warning: '#fde047', danger: '#f87171',
      'bg-primary': '#030712', 'bg-secondary': '#0a0f0d', 'bg-tertiary': '#111827',
      'text-primary': '#22c55e', 'text-secondary': '#16a34a', 'sidebar-bg': '#010204'
    },
    'retro': {
      primary: '#fbbf24', success: '#22c55e', warning: '#f97316', danger: '#ef4444',
      'bg-primary': '#1f1f23', 'bg-secondary': '#2a2a2e', 'bg-tertiary': '#38383c',
      'text-primary': '#fef3c7', 'text-secondary': '#fcd34d', 'sidebar-bg': '#0f0f11'
    },
    'synthwave': {
      primary: '#f472b6', success: '#2dd4bf', warning: '#fbbf24', danger: '#fb7185',
      'bg-primary': '#0f0524', 'bg-secondary': '#1a0a3e', 'bg-tertiary': '#2d1664',
      'text-primary': '#f9a8d4', 'text-secondary': '#e879f9', 'sidebar-bg': '#05010f'
    },
    'hacker': {
      primary: '#4ade80', success: '#22c55e', warning: '#fde047', danger: '#f87171',
      'bg-primary': '#000000', 'bg-secondary': '#0a0a0a', 'bg-tertiary': '#141414',
      'text-primary': '#4ade80', 'text-secondary': '#22c55e', 'sidebar-bg': '#000000'
    },
    'neon': {
      primary: '#e879f9', success: '#2dd4bf', warning: '#facc15', danger: '#fb923c',
      'bg-primary': '#0a0a0a', 'bg-secondary': '#171717', 'bg-tertiary': '#262626',
      'text-primary': '#f5f5f5', 'text-secondary': '#a3a3a3', 'sidebar-bg': '#000000'
    },

    // === 🔌 NETWORK & INFRASTRUCTURE ===
    'extreme': {
      primary: '#7c3aed', success: '#22c55e', warning: '#f59e0b', danger: '#f87171',
      'bg-primary': '#0d1117', 'bg-secondary': '#161b22', 'bg-tertiary': '#21262d',
      'text-primary': '#e6edf3', 'text-secondary': '#8b949e', 'sidebar-bg': '#0d1117'
    }
  };

  var theme = themes[themeName];
  if (!theme) return;

  // Apply all colors
  Object.keys(theme).forEach(function(key) {
    updateThemeColor(key, theme[key]);
    var input = document.getElementById('theme-' + key);
    if (input) input.value = theme[key];
    var hexInput = document.getElementById('theme-' + key + '-hex');
    if (hexInput) hexInput.value = theme[key];
  });

  // Update active preset button
  document.querySelectorAll('.preset-theme-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.theme === themeName);
  });

  showToast('Applied ' + themeName + ' theme', 'success');
}

// Reset theme to default
function resetThemeToDefault() {
  showConfirmCard({
    title: 'Reset Theme',
    message: 'Reset all theme settings to default?',
    type: 'warn',
    confirmText: 'Reset',
    onConfirm: function() {
      applyPresetTheme('default');

      // Reset other settings
      document.getElementById('theme-font-family').value = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      document.getElementById('theme-font-size').value = '16px';
      document.getElementById('theme-heading-weight').value = '600';
      document.getElementById('theme-radius').value = '12px';
      document.getElementById('theme-shadow').value = 'medium';
      document.getElementById('theme-sidebar-width').value = '260px';

      updateThemeFont("'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
      updateThemeFontSize('16px');
      updateThemeHeadingWeight('600');
      updateThemeRadius('12px');
      updateThemeShadow('medium');
      updateThemeSidebarWidth('260px');

      customTheme = {};
      localStorage.removeItem('customTheme');

      showToast('Theme reset to default', 'success');
    }
  });
}

// Save theme to localStorage and backend
function saveTheme() {
  localStorage.setItem('customTheme', JSON.stringify(customTheme));

  // Also save to backend
  google.script.run
    .withSuccessHandler(function(result) {
      showToast('Theme saved successfully!', 'success');
    })
    .withFailureHandler(function(err) {
      showToast('Theme saved locally', 'info');
    })
    .saveSetting('customTheme', JSON.stringify(customTheme));
}

// Load saved theme
function loadSavedTheme() {
  var savedTheme = localStorage.getItem('customTheme');
  if (savedTheme) {
    try {
      customTheme = JSON.parse(savedTheme);
      Object.keys(customTheme).forEach(function(key) {
        if (key.startsWith('font') || key === 'radius' || key === 'shadow' || key === 'sidebar-width' || key === 'heading-weight') {
          // Handle non-color settings
          var select = document.getElementById('theme-' + key.replace('-', '-'));
          if (select) select.value = customTheme[key];
        } else if (key === 'app-title' || key === 'app-subtitle') {
          var input = document.getElementById('theme-' + key);
          if (input) input.value = customTheme[key];
        } else {
          updateThemeColor(key, customTheme[key]);
        }
      });
    } catch (e) {
      console.error('Error loading saved theme:', e);
    }
  }
}

// Export theme as JSON
function exportTheme() {
  var themeData = JSON.stringify(customTheme, null, 2);
  var blob = new Blob([themeData], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'smart-school-monitor-theme.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Theme exported', 'success');
}

// Import theme from JSON file
function importTheme(event) {
  var file = event.target.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var imported = JSON.parse(e.target.result);
      customTheme = imported;

      Object.keys(imported).forEach(function(key) {
        if (key === 'font-family') {
          updateThemeFont(imported[key]);
          var select = document.getElementById('theme-font-family');
          if (select) select.value = imported[key];
        } else if (key === 'font-size') {
          updateThemeFontSize(imported[key]);
          var select = document.getElementById('theme-font-size');
          if (select) select.value = imported[key];
        } else if (key === 'radius') {
          updateThemeRadius(imported[key]);
          var select = document.getElementById('theme-radius');
          if (select) select.value = imported[key];
        } else {
          updateThemeColor(key, imported[key]);
        }
      });

      showToast('Theme imported successfully!', 'success');
    } catch (err) {
      showToast('Invalid theme file', 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// Initialize theme on page load
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(loadSavedTheme, 500);
});

// ============================================
// Icon Customization
// ============================================
var iconSettings = {
  customIcons: [], // Array of {id, name, dataUrl}
  assignments: {
    'app-logo': 'monitor',
    'dashboard': 'layout-dashboard',
    'devices': 'printer',
    'alerts': 'bell',
    'service': 'wrench',
    'settings': 'settings',
    'online': 'check-circle',
    'offline': 'x-circle',
    'warning': 'alert-triangle'
  },
  currentPickerTarget: null
};

// Common Lucide icons organized by category
var lucideIconLibrary = {
  devices: ['printer', 'monitor', 'laptop', 'tablet', 'smartphone', 'server', 'hard-drive', 'cpu', 'memory-stick', 'usb', 'wifi', 'bluetooth', 'router', 'network', 'cable', 'plug', 'battery', 'camera', 'video', 'mic', 'speaker', 'headphones', 'keyboard', 'mouse', 'gamepad', 'watch', 'tv', 'projector', 'scan', 'qr-code'],
  status: ['check', 'check-circle', 'check-circle-2', 'x', 'x-circle', 'alert-circle', 'alert-triangle', 'info', 'help-circle', 'ban', 'clock', 'timer', 'hourglass', 'loader', 'refresh-cw', 'power', 'power-off', 'zap', 'zap-off', 'wifi', 'wifi-off', 'signal', 'signal-low', 'signal-medium', 'signal-high'],
  actions: ['plus', 'minus', 'edit', 'edit-2', 'edit-3', 'trash', 'trash-2', 'save', 'download', 'upload', 'share', 'share-2', 'copy', 'clipboard', 'cut', 'paste', 'undo', 'redo', 'rotate-ccw', 'rotate-cw', 'maximize', 'minimize', 'expand', 'shrink', 'move', 'lock', 'unlock', 'eye', 'eye-off', 'search', 'filter', 'sort-asc', 'sort-desc'],
  navigation: ['home', 'menu', 'more-horizontal', 'more-vertical', 'grid', 'list', 'layout-grid', 'layout-list', 'layout-dashboard', 'sidebar', 'panel-left', 'panel-right', 'chevron-up', 'chevron-down', 'chevron-left', 'chevron-right', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'corner-up-left', 'corner-up-right', 'external-link', 'link', 'link-2'],
  alerts: ['bell', 'bell-off', 'bell-ring', 'alarm-clock', 'siren', 'megaphone', 'volume', 'volume-1', 'volume-2', 'volume-x', 'message-circle', 'message-square', 'mail', 'inbox', 'send', 'flag', 'bookmark', 'star', 'heart', 'thumbs-up', 'thumbs-down']
};

// Initialize icon customization
function initIconCustomization() {
  loadSavedIconSettings();
  renderIconLibrary();
  renderDeviceTypeIcons();
  setupIconDropzone();

  // Close icon picker when clicking outside
  var modal = document.getElementById('icon-picker-modal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closeIconPicker();
      }
    });
  }
}

// Load saved icon settings
function loadSavedIconSettings() {
  try {
    var saved = localStorage.getItem('smartSchoolIcons');
    if (saved) {
      var parsed = JSON.parse(saved);
      iconSettings.customIcons = parsed.customIcons || [];
      iconSettings.assignments = Object.assign({}, iconSettings.assignments, parsed.assignments || {});
    }
    applyIconAssignments();
    renderCustomIconsGrid();
    updateIconPreviews();
  } catch (err) {
    console.error('Error loading icon settings:', err);
  }
}

// Save icon settings
function saveIconSettings() {
  try {
    var toSave = {
      customIcons: iconSettings.customIcons,
      assignments: iconSettings.assignments
    };
    localStorage.setItem('smartSchoolIcons', JSON.stringify(toSave));

    // Try to save to server
    if (typeof google !== 'undefined' && google.script && google.script.run) {
      google.script.run
        .withSuccessHandler(function() {
          showToast('Icon settings saved!', 'success');
        })
        .withFailureHandler(function() {
          showToast('Icons saved locally', 'info');
        })
        .saveSettings({ icons: toSave });
    } else {
      showToast('Icon settings saved locally!', 'success');
    }
  } catch (err) {
    showToast('Error saving icons: ' + err.message, 'error');
  }
}

// Reset icons to default
function resetIconsToDefault() {
  iconSettings.assignments = {
    'app-logo': 'monitor',
    'dashboard': 'layout-dashboard',
    'devices': 'printer',
    'alerts': 'bell',
    'service': 'wrench',
    'settings': 'settings',
    'online': 'check-circle',
    'offline': 'x-circle',
    'warning': 'alert-triangle'
  };
  applyIconAssignments();
  updateIconPreviews();
  showToast('Icons reset to default', 'success');
}

// Apply icon assignments to the UI
function applyIconAssignments() {
  // Update sidebar navigation icons
  var navMappings = {
    'dashboard': '[data-tab="dashboard"] i, [data-tab="dashboard"] svg',
    'devices': '[data-tab="devices"] i, [data-tab="devices"] svg',
    'alerts': '[data-tab="alerts"] i, [data-tab="alerts"] svg',
    'service': '[data-tab="service-requests"] i, [data-tab="service-requests"] svg',
    'settings': '[data-tab="settings"] i, [data-tab="settings"] svg'
  };

  Object.keys(navMappings).forEach(function(key) {
    var iconName = iconSettings.assignments[key];
    if (iconName && !iconName.startsWith('custom-')) {
      var elements = document.querySelectorAll(navMappings[key]);
      elements.forEach(function(el) {
        el.setAttribute('data-lucide', iconName);
      });
    }
  });

  // Re-render lucide icons
  if (typeof lucide !== 'undefined') {
    setTimeout(function() { lucide.createIcons(); }, 50);
  }
}

// Update icon preview buttons
function updateIconPreviews() {
  Object.keys(iconSettings.assignments).forEach(function(key) {
    var iconName = iconSettings.assignments[key];
    var btn = document.getElementById('icon-' + key + '-btn');
    var nameSpan = document.getElementById('icon-' + key + '-name');
    var input = document.getElementById('icon-' + key);

    if (btn) {
      if (iconName && iconName.startsWith('custom-')) {
        // Custom icon
        var customIcon = iconSettings.customIcons.find(function(c) { return c.id === iconName; });
        if (customIcon) {
          btn.innerHTML = '<img src="' + customIcon.dataUrl + '" alt="' + customIcon.name + '">';
        }
      } else {
        btn.innerHTML = '<i data-lucide="' + iconName + '"></i>';
      }
    }

    if (nameSpan) {
      nameSpan.textContent = iconName || 'none';
    }

    if (input) {
      input.value = iconName || '';
    }
  });

  if (typeof lucide !== 'undefined') {
    setTimeout(function() { lucide.createIcons(); }, 50);
  }
}

// Upload custom icons
function uploadCustomIcons(event) {
  var files = event.target.files;
  if (!files || files.length === 0) return;

  Array.from(files).forEach(function(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Please upload image files only', 'warning');
      return;
    }

    if (file.size > 500 * 1024) {
      showToast(file.name + ' is too large (max 500KB)', 'warning');
      return;
    }

    var reader = new FileReader();
    reader.onload = function(e) {
      var iconId = 'custom-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      var iconName = file.name.replace(/\.[^.]+$/, ''); // Remove extension

      iconSettings.customIcons.push({
        id: iconId,
        name: iconName,
        dataUrl: e.target.result
      });

      renderCustomIconsGrid();
      showToast('Icon "' + iconName + '" uploaded', 'success');
    };
    reader.readAsDataURL(file);
  });

  event.target.value = '';
}

// Setup icon dropzone
function setupIconDropzone() {
  var dropzone = document.getElementById('icon-dropzone');
  if (!dropzone) return;

  dropzone.addEventListener('dragover', function(e) {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', function() {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropzone.classList.remove('dragover');

    var files = e.dataTransfer.files;
    if (files.length > 0) {
      var input = document.getElementById('icon-file-input');
      input.files = files;
      uploadCustomIcons({ target: input });
    }
  });
}

// Render custom icons grid
function renderCustomIconsGrid() {
  var grid = document.getElementById('custom-icons-grid');
  if (!grid) return;

  if (iconSettings.customIcons.length === 0) {
    grid.innerHTML = '<div class="no-icons-message">No custom icons uploaded yet</div>';
    return;
  }

  grid.innerHTML = iconSettings.customIcons.map(function(icon) {
    return '<div class="custom-icon-item" data-id="' + icon.id + '" onclick="selectCustomIconForCopy(\'' + icon.id + '\')">' +
      '<button class="delete-icon" onclick="event.stopPropagation(); deleteCustomIcon(\'' + icon.id + '\')">&times;</button>' +
      '<img src="' + icon.dataUrl + '" alt="' + icon.name + '">' +
      '<span class="icon-label">' + escapeHtml(icon.name) + '</span>' +
      '</div>';
  }).join('');
}

// Delete custom icon
function deleteCustomIcon(iconId) {
  iconSettings.customIcons = iconSettings.customIcons.filter(function(i) { return i.id !== iconId; });

  // Remove from any assignments
  Object.keys(iconSettings.assignments).forEach(function(key) {
    if (iconSettings.assignments[key] === iconId) {
      iconSettings.assignments[key] = 'image'; // Reset to default
    }
  });

  renderCustomIconsGrid();
  updateIconPreviews();
  showToast('Icon deleted', 'info');
}

// Render icon library
function renderIconLibrary() {
  var grid = document.getElementById('icon-library-grid');
  if (!grid) return;

  var allIcons = [];
  Object.keys(lucideIconLibrary).forEach(function(category) {
    lucideIconLibrary[category].forEach(function(icon) {
      if (allIcons.indexOf(icon) === -1) {
        allIcons.push(icon);
      }
    });
  });

  allIcons.sort();

  grid.innerHTML = allIcons.map(function(icon) {
    return '<div class="icon-library-item" data-icon="' + icon + '" onclick="copyIconName(\'' + icon + '\')">' +
      '<i data-lucide="' + icon + '"></i>' +
      '<span>' + icon + '</span>' +
      '</div>';
  }).join('');

  if (typeof lucide !== 'undefined') {
    setTimeout(function() { lucide.createIcons(); }, 50);
  }
}

// Filter icon library
function filterIconLibrary(search) {
  var grid = document.getElementById('icon-library-grid');
  if (!grid) return;

  var items = grid.querySelectorAll('.icon-library-item');
  var searchLower = search.toLowerCase();

  items.forEach(function(item) {
    var iconName = item.dataset.icon;
    var matches = !search || iconName.toLowerCase().includes(searchLower);
    item.style.display = matches ? '' : 'none';
  });
}

// Filter by category
function filterIconCategory(category) {
  // Update active button
  document.querySelectorAll('.category-btn').forEach(function(btn) {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');

  var grid = document.getElementById('icon-library-grid');
  if (!grid) return;

  var items = grid.querySelectorAll('.icon-library-item');

  if (category === 'all') {
    items.forEach(function(item) { item.style.display = ''; });
    return;
  }

  var categoryIcons = lucideIconLibrary[category] || [];

  items.forEach(function(item) {
    var iconName = item.dataset.icon;
    var matches = categoryIcons.indexOf(iconName) !== -1;
    item.style.display = matches ? '' : 'none';
  });
}

// Copy icon name to clipboard
function copyIconName(iconName) {
  navigator.clipboard.writeText(iconName).then(function() {
    showToast('Copied "' + iconName + '" to clipboard', 'success');
  }).catch(function() {
    showToast('Icon: ' + iconName, 'info');
  });
}

// Show icon picker modal
function showIconPicker(targetKey) {
  iconSettings.currentPickerTarget = targetKey;

  var modal = document.getElementById('icon-picker-modal');
  if (modal) {
    modal.style.display = 'flex';
    renderIconPickerGrid('lucide');
  }
}

// Close icon picker
function closeIconPicker() {
  var modal = document.getElementById('icon-picker-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  iconSettings.currentPickerTarget = null;
}

// Switch picker tab
function switchPickerTab(tab) {
  document.querySelectorAll('.picker-tab').forEach(function(t) {
    t.classList.toggle('active', t.textContent.toLowerCase().includes(tab));
  });
  renderIconPickerGrid(tab);
}

// Render icon picker grid
function renderIconPickerGrid(tab) {
  var grid = document.getElementById('icon-picker-grid');
  if (!grid) return;

  var currentIcon = iconSettings.currentPickerTarget ?
    iconSettings.assignments[iconSettings.currentPickerTarget] : '';

  if (tab === 'custom') {
    if (iconSettings.customIcons.length === 0) {
      grid.innerHTML = '<div class="no-icons-message">No custom icons. Upload some first!</div>';
      return;
    }

    grid.innerHTML = iconSettings.customIcons.map(function(icon) {
      var selected = currentIcon === icon.id ? ' selected' : '';
      return '<div class="icon-picker-item' + selected + '" data-icon="' + icon.id + '" onclick="selectIconFromPicker(\'' + icon.id + '\')">' +
        '<img src="' + icon.dataUrl + '" alt="' + icon.name + '">' +
        '<span>' + escapeHtml(icon.name) + '</span>' +
        '</div>';
    }).join('');
  } else {
    // Lucide icons
    var allIcons = [];
    Object.keys(lucideIconLibrary).forEach(function(category) {
      lucideIconLibrary[category].forEach(function(icon) {
        if (allIcons.indexOf(icon) === -1) {
          allIcons.push(icon);
        }
      });
    });
    allIcons.sort();

    grid.innerHTML = allIcons.map(function(icon) {
      var selected = currentIcon === icon ? ' selected' : '';
      return '<div class="icon-picker-item' + selected + '" data-icon="' + icon + '" onclick="selectIconFromPicker(\'' + icon + '\')">' +
        '<i data-lucide="' + icon + '"></i>' +
        '<span>' + icon + '</span>' +
        '</div>';
    }).join('');

    if (typeof lucide !== 'undefined') {
      setTimeout(function() { lucide.createIcons(); }, 50);
    }
  }
}

// Filter picker icons
function filterPickerIcons(search) {
  var grid = document.getElementById('icon-picker-grid');
  if (!grid) return;

  var items = grid.querySelectorAll('.icon-picker-item');
  var searchLower = search.toLowerCase();

  items.forEach(function(item) {
    var iconName = item.dataset.icon;
    var label = item.querySelector('span');
    var matches = !search || iconName.toLowerCase().includes(searchLower) ||
      (label && label.textContent.toLowerCase().includes(searchLower));
    item.style.display = matches ? '' : 'none';
  });
}

// Select icon from picker
function selectIconFromPicker(iconName) {
  if (!iconSettings.currentPickerTarget) return;

  iconSettings.assignments[iconSettings.currentPickerTarget] = iconName;
  updateIconPreviews();
  applyIconAssignments();
  closeIconPicker();
  showToast('Icon updated', 'success');
}

// Render device type icons
function renderDeviceTypeIcons() {
  var grid = document.getElementById('device-type-icons-grid');
  if (!grid) return;

  // Get device types from state
  var deviceTypes = state.deviceTypes || [];

  if (deviceTypes.length === 0) {
    grid.innerHTML = '<div class="loading-message">No device types defined</div>';
    return;
  }

  grid.innerHTML = deviceTypes.map(function(type) {
    var iconName = type.icon || 'box';
    return '<div class="device-type-icon-card">' +
      '<div class="type-icon"><i data-lucide="' + iconName + '"></i></div>' +
      '<span class="type-name">' + escapeHtml(type.name) + '</span>' +
      '</div>';
  }).join('');

  if (typeof lucide !== 'undefined') {
    setTimeout(function() { lucide.createIcons(); }, 50);
  }
}

// Export icon settings
function exportIconSettings() {
  var data = {
    customIcons: iconSettings.customIcons,
    assignments: iconSettings.assignments,
    exportedAt: new Date().toISOString()
  };

  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'smart-school-icons-' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Icons exported', 'success');
}

// Import icon settings
function importIconSettings(event) {
  var file = event.target.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var imported = JSON.parse(e.target.result);

      if (imported.customIcons) {
        iconSettings.customIcons = imported.customIcons;
      }
      if (imported.assignments) {
        iconSettings.assignments = Object.assign({}, iconSettings.assignments, imported.assignments);
      }

      renderCustomIconsGrid();
      updateIconPreviews();
      applyIconAssignments();
      showToast('Icons imported successfully!', 'success');
    } catch (err) {
      showToast('Invalid icon settings file', 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// Select custom icon for copy (when clicking in the custom icons grid)
function selectCustomIconForCopy(iconId) {
  var icon = iconSettings.customIcons.find(function(i) { return i.id === iconId; });
  if (icon) {
    showToast('Custom icon: ' + icon.name + ' (ID: ' + iconId + ')', 'info');
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(initIconCustomization, 600);
});

// ============================================
// Navigation
// ============================================

// Default locked tabs - can be customized by user
var lockedTabs = JSON.parse(localStorage.getItem('lockedTabs') || '["devices", "analytics", "requests", "repairs", "settings"]');

function switchTab(tabName) {
  // Check if this tab requires authentication
  var isProtectedTab = lockedTabs.indexOf(tabName) !== -1;

  if (isProtectedTab && state.passwordProtected === true && state.isAuthenticated !== true) {
    showAuthPromptForTab(tabName);
    return;
  }

  performTabSwitch(tabName);
}

// Toggle lock status for a tab
function toggleTabLock(tabName, isLocked) {
  if (isLocked) {
    // Add to locked tabs if not already there
    if (lockedTabs.indexOf(tabName) === -1) {
      lockedTabs.push(tabName);
    }
  } else {
    // Remove from locked tabs
    var index = lockedTabs.indexOf(tabName);
    if (index > -1) {
      lockedTabs.splice(index, 1);
    }
  }

  // Save to localStorage
  localStorage.setItem('lockedTabs', JSON.stringify(lockedTabs));

  // Update nav lock indicators
  updateNavLockIndicators();

  showToast(tabName.charAt(0).toUpperCase() + tabName.slice(1) + ' tab is now ' + (isLocked ? 'locked' : 'unlocked'), 'success');
}

// Load saved tab lock settings
function loadTabLockSettings() {
  var allTabs = ['blueprint', 'dashboard', 'devices', 'traps', 'analytics', 'requests', 'repairs', 'settings'];

  allTabs.forEach(function(tabName) {
    var checkbox = document.getElementById('lock-tab-' + tabName);
    if (checkbox) {
      checkbox.checked = lockedTabs.indexOf(tabName) !== -1;
    }
  });
}

function performTabSwitch(tabName) {
  state.currentTab = tabName;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });

  // Lazy-load analytics data when tab is opened
  if (tabName === 'analytics') {
    loadAnalytics();
  }

  // Load Overview Dashboard data when tab is opened
  if (tabName === 'overview') {
    setTimeout(function() { loadOverviewDashboard(); }, 100);
  }

  // Re-render icons after tab switch
  setTimeout(() => lucide.createIcons(), 100);
}

// Show auth prompt for protected tabs
function showAuthPromptForTab(targetTab) {
  var existingModal = document.getElementById('password-modal');
  if (existingModal) existingModal.remove();

  var modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'password-modal';
  modal.innerHTML = '<div class="modal-backdrop"></div>' +
    '<div class="modal-content" style="max-width: 400px;">' +
    '<div class="modal-header">' +
    '<h3><i data-lucide="lock"></i> Password Required</h3>' +
    '</div>' +
    '<div class="modal-body">' +
    '<p style="margin-bottom: 16px; color: var(--text-secondary);">This section is password protected. Please enter the password to continue.</p>' +
    '<div class="form-group">' +
    '<label>Password</label>' +
    '<input type="password" id="auth-password-tab" placeholder="Enter password" autofocus>' +
    '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-outline" onclick="closeAuthPromptForTab()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="verifyPasswordForTab(\'' + targetTab + '\')"><i data-lucide="unlock"></i> Unlock</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(modal);
  lucide.createIcons();

  // Focus password field
  setTimeout(function() {
    var input = document.getElementById('auth-password-tab');
    if (input) {
      input.focus();
      input.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          verifyPasswordForTab(targetTab);
        }
      });
    }
  }, 100);
}

function closeAuthPromptForTab() {
  var modal = document.getElementById('password-modal');
  if (modal) modal.remove();
}

function verifyPasswordForTab(targetTab) {
  var password = document.getElementById('auth-password-tab').value;
  if (!password) {
    showToast('Please enter a password', 'warning');
    return;
  }

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.valid) {
        state.isAuthenticated = true;
        sessionStorage.setItem('authenticated', 'true');
        closeAuthPromptForTab();
        showToast('Access granted', 'success');
        // Update lock indicators
        updateNavLockIndicators();
        // Now switch to the target tab
        performTabSwitch(targetTab);
      } else {
        showToast('Incorrect password', 'error');
        document.getElementById('auth-password-tab').value = '';
        document.getElementById('auth-password-tab').focus();
      }
    })
    .withFailureHandler(function(err) {
      showToast('Authentication error: ' + err.message, 'error');
    })
    .verifySecurityPassword(password);
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  sidebar.classList.toggle('open');
  overlay.classList.toggle('active');

  // Prevent body scroll when sidebar is open on mobile
  if (sidebar.classList.contains('open')) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
}

// Mobile Sidebar Swipe Support
(function() {
  var sidebar = null;
  var touchStartY = 0;
  var touchStartX = 0;
  var touchCurrentY = 0;
  var isSwiping = false;

  document.addEventListener('DOMContentLoaded', function() {
    sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Touch start
    sidebar.addEventListener('touchstart', function(e) {
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
      isSwiping = true;
    }, { passive: true });

    // Touch move
    sidebar.addEventListener('touchmove', function(e) {
      if (!isSwiping) return;
      touchCurrentY = e.touches[0].clientY;
    }, { passive: true });

    // Touch end - swipe down to close
    sidebar.addEventListener('touchend', function(e) {
      if (!isSwiping) return;
      isSwiping = false;

      var deltaY = touchCurrentY - touchStartY;

      // If swipe down more than 50px, close sidebar
      if (deltaY > 50 && sidebar.classList.contains('open')) {
        toggleSidebar();
      }
    });

    // Click on handle area to toggle
    sidebar.addEventListener('click', function(e) {
      // Only if clicking on the top handle area (first 40px)
      var rect = sidebar.getBoundingClientRect();
      var clickY = e.clientY - rect.top;

      if (clickY < 40 && !sidebar.classList.contains('open')) {
        toggleSidebar();
      }
    });
  });

  // Close sidebar when navigating on mobile
  var origSwitchTab = window.switchTab;
  if (origSwitchTab) {
    window.switchTab = function(tabId) {
      origSwitchTab(tabId);

      // Close sidebar on mobile after tab switch
      if (window.innerWidth <= 768) {
        var sidebar = document.getElementById('sidebar');
        var overlay = document.getElementById('sidebar-overlay');
        if (sidebar && sidebar.classList.contains('open')) {
          sidebar.classList.remove('open');
          if (overlay) overlay.classList.remove('active');
          document.body.style.overflow = '';
        }
      }
    };
  }
})();

// ============================================
// Settings Submenu Navigation
// ============================================
function initSettingsNav() {
  // Handle nav item clicks
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', function() {
      const section = this.dataset.section;
      if (section) {
        switchSettingsPanel(section);
      }
    });
  });

  // Handle clickable category headers (like QR Codes)
  document.querySelectorAll('.settings-nav-header.clickable').forEach(header => {
    header.addEventListener('click', function() {
      const section = this.dataset.section;
      if (section) {
        switchSettingsPanel(section);
      }
    });
  });
}

function switchSettingsPanel(sectionName) {
  // Update nav items - remove active from all, add to selected
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.section === sectionName);
  });

  // Update clickable headers
  document.querySelectorAll('.settings-nav-header.clickable').forEach(header => {
    header.classList.toggle('active', header.dataset.section === sectionName);
  });

  // Update panels - hide all, show selected
  document.querySelectorAll('.settings-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `settings-panel-${sectionName}`);
  });

  // Lazy-load data management when panel is opened
  if (sectionName === 'data-management') {
    loadDataManagement();
  }

  // Lazy-load repair templates when panel is opened
  if (sectionName === 'repair-templates') {
    renderTemplateSettingsList();
  }

  // Re-render icons after panel switch
  setTimeout(() => {
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }, 50);
}

// Initialize settings nav when DOM is ready
document.addEventListener('DOMContentLoaded', initSettingsNav);

// ============================================
// Blueprint Management
// ============================================
function switchBlueprint(blueprintId) {
  state.activeBlueprint = blueprintId;

  document.querySelectorAll('.blueprint-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.blueprint === blueprintId);
  });

  updateBlueprintDisplay();
  renderDeviceMarkers();
}

function renderBlueprintTabs() {
  // Update both the legacy tabs and the new dropdown
  const container = document.getElementById('blueprint-tabs-list');
  const dropdown = document.getElementById('blueprint-dropdown-menu');
  const activeNameEl = document.getElementById('active-blueprint-name');

  const blueprintIds = Object.keys(state.blueprints);

  // If no blueprints, create a default one
  if (blueprintIds.length === 0) {
    state.blueprints['blueprint1'] = { id: 'blueprint1', name: 'Main Floor', imageData: null };
    state.activeBlueprint = 'blueprint1';
  }

  // Ensure activeBlueprint exists
  if (!state.blueprints[state.activeBlueprint]) {
    state.activeBlueprint = Object.keys(state.blueprints)[0];
  }

  // Update active blueprint name display
  const activeBp = state.blueprints[state.activeBlueprint];
  if (activeNameEl && activeBp) {
    activeNameEl.textContent = activeBp.name || activeBp.id;
  }

  // Build dropdown menu
  if (dropdown) {
    let dropdownHtml = '';
    Object.values(state.blueprints).forEach(function(bp) {
      const isActive = bp.id === state.activeBlueprint;
      dropdownHtml += '<div class="blueprint-dropdown-item' + (isActive ? ' active' : '') + '" onclick="selectBlueprint(\'' + bp.id + '\')">';
      if (isActive) {
        dropdownHtml += '<i data-lucide="check" class="check-icon"></i>';
      }
      dropdownHtml += '<i data-lucide="map-pin"></i>';
      dropdownHtml += '<span>' + escapeHtml(bp.name || bp.id) + '</span>';
      dropdownHtml += '</div>';
    });
    dropdown.innerHTML = dropdownHtml;
  }

  // Legacy tabs (for backward compatibility)
  if (container) {
    let html = '';
    Object.values(state.blueprints).forEach(function(bp) {
      const isActive = bp.id === state.activeBlueprint;
      html += '<button class="blueprint-tab' + (isActive ? ' active' : '') + '" ' +
              'data-blueprint="' + bp.id + '" ' +
              'onclick="switchBlueprint(\'' + bp.id + '\')">' +
              '<i data-lucide="map-pin"></i> ' + escapeHtml(bp.name || bp.id) +
              '</button>';
    });
    container.innerHTML = html;
  }

  lucide.createIcons();
}

// Toggle blueprint dropdown
function toggleBlueprintDropdown() {
  const dropdown = document.getElementById('blueprint-dropdown-menu');
  if (dropdown) {
    dropdown.classList.toggle('show');
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.blueprint-dropdown-wrapper')) {
    const dropdown = document.getElementById('blueprint-dropdown-menu');
    if (dropdown) {
      dropdown.classList.remove('show');
    }
  }
});

// Select blueprint from dropdown
function selectBlueprint(blueprintId) {
  switchBlueprint(blueprintId);
  const dropdown = document.getElementById('blueprint-dropdown-menu');
  if (dropdown) {
    dropdown.classList.remove('show');
  }
}

// Show rename blueprint modal
function showRenameBlueprintModal() {
  const bp = state.blueprints[state.activeBlueprint];
  if (!bp) return;

  const modal = document.getElementById('rename-blueprint-modal');
  const input = document.getElementById('blueprint-new-name');

  if (input) {
    input.value = bp.name || bp.id;
    // Add enter key handler
    input.onkeydown = function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveBlueprintName();
      } else if (e.key === 'Escape') {
        closeRenameBlueprintModal();
      }
    };
  }

  modal.classList.add('active');
  if (input) input.focus();
  if (input) input.select();
}

// Close rename blueprint modal
function closeRenameBlueprintModal() {
  const modal = document.getElementById('rename-blueprint-modal');
  const modalTitle = modal.querySelector('.modal-header h3');
  modal.classList.remove('active');
  window._creatingNewBlueprint = false;
  if (modalTitle) modalTitle.textContent = 'Rename Blueprint';
}

// Save blueprint name (handles both rename and create new)
function saveBlueprintName() {
  const input = document.getElementById('blueprint-new-name');
  const newName = input ? input.value.trim() : '';
  const modal = document.getElementById('rename-blueprint-modal');
  const modalTitle = modal.querySelector('.modal-header h3');

  if (!newName) {
    showToast('Please enter a name', 'warning');
    return;
  }

  // Check if we're creating a new blueprint
  if (window._creatingNewBlueprint) {
    window._creatingNewBlueprint = false;
    if (modalTitle) modalTitle.textContent = 'Rename Blueprint';
    closeRenameBlueprintModal();
    createNewBlueprint(newName);
    return;
  }

  // Renaming existing blueprint
  const bp = state.blueprints[state.activeBlueprint];
  if (!bp) return;

  bp.name = newName;

  showToast('Saving...', 'info');

  // Only send id, name, and storage reference (not full image data)
  // Preserve drive: or local: reference from _storageRef
  var storageRef = bp._storageRef || '';
  if (!storageRef.startsWith('drive:') && !storageRef.startsWith('local:')) {
    storageRef = 'local:' + bp.id;
  }
  var saveData = {
    id: bp.id,
    name: newName,
    imageData: storageRef
  };

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        showToast('Blueprint renamed to "' + newName + '"', 'success');
        closeRenameBlueprintModal();
        renderBlueprintTabs();
      } else {
        showToast('Error saving name', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error: ' + err.message, 'error');
    })
    .saveBlueprint(saveData);
}

async function updateBlueprintDisplay() {
  const img = document.getElementById('blueprint-image');
  const noBp = document.getElementById('no-blueprint');

  // Special handling for "All Devices" master map
  let bp;
  let imageData = null;

  if (state.activeBlueprint === 'all-devices-map') {
    // Load "All Devices Map" from IndexedDB or state
    bp = state.blueprints['all-devices-map'];
    imageData = bp ? bp.imageData : null;

    // Try loading from IndexedDB
    if (!imageData) {
      imageData = await BlueprintDB.getImage('all-devices-map');
      if (imageData) {
        if (!state.blueprints['all-devices-map']) {
          state.blueprints['all-devices-map'] = { name: 'All Devices Map', imageData: imageData };
        } else {
          state.blueprints['all-devices-map'].imageData = imageData;
        }
        bp = state.blueprints['all-devices-map'];
      }
    }
  } else {
    bp = state.blueprints[state.activeBlueprint];
    imageData = bp ? bp.imageData : null;
  }

  // If imageData is a local reference, load from IndexedDB
  if (imageData && imageData.startsWith('local:')) {
    const blueprintId = imageData.substring(6);
    imageData = await BlueprintDB.getImage(blueprintId);
    if (imageData) {
      bp.imageData = imageData; // Cache it in state
    }
  }

  // If imageData is a Drive reference, try IndexedDB cache first, then fetch from Drive
  if (imageData && imageData.startsWith('drive:')) {
    var driveFileId = imageData.substring(6);
    var bpId = state.activeBlueprint;

    // Try IndexedDB cache first (fast)
    var cachedImage = await BlueprintDB.getImage(bpId);
    if (cachedImage) {
      imageData = cachedImage;
      if (bp) bp.imageData = cachedImage;
    } else {
      // Show loading indicator while fetching from cloud
      noBp.innerHTML = '<div class="no-blueprint-content">' +
        '<div style="text-align:center;">' +
        '<div class="loading-spinner" style="width:40px;height:40px;border:4px solid #e0e0e0;border-top:4px solid var(--primary);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 12px;"></div>' +
        '<p style="color:var(--text-muted);">Loading map from cloud...</p></div></div>';
      noBp.classList.remove('hidden');
      img.classList.add('hidden');

      // Fetch from Google Drive
      imageData = await fetchImageFromDrive(driveFileId, bpId);
      if (imageData && bp) {
        bp.imageData = imageData;
      }
    }
  }

  // Also try loading from IndexedDB if no image data
  if (!imageData && state.activeBlueprint) {
    imageData = await BlueprintDB.getImage(state.activeBlueprint);
    if (imageData && bp) {
      bp.imageData = imageData;
    }
  }

  // Return a promise that resolves when image is loaded
  return new Promise((resolve) => {
    if (imageData && imageData.startsWith('data:')) {
      img.onerror = function() {
        console.error('Failed to load blueprint image');
        img.classList.add('hidden');
        noBp.classList.remove('hidden');
        resolve();
      };

      img.onload = function() {
        img.classList.remove('hidden');
        noBp.classList.add('hidden');
        // CRITICAL: Sync markers container to image dimensions FIRST
        syncMarkersToImage();
        applyZoom();
        // Re-render markers after image loads to ensure proper positioning
        renderDeviceMarkers();
        resolve();
      };

      img.src = imageData;
    } else {
      img.classList.add('hidden');
      // Show special message for All Devices map
      if (state.activeBlueprint === 'all-devices-map') {
        noBp.innerHTML = '<div class="no-blueprint-content">' +
          '<i data-lucide="map" style="width: 48px; height: 48px; color: var(--text-muted);"></i>' +
          '<h3>No "All Devices" Map Uploaded</h3>' +
          '<p>Upload a master map to display all devices in one view</p>' +
          '<button class="btn btn-primary" onclick="uploadAllDevicesMap()">' +
          '<i data-lucide="upload"></i> Upload All Devices Map</button>' +
          '</div>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      } else {
        noBp.innerHTML = '<div class="no-blueprint-content">' +
          '<i data-lucide="map" style="width: 48px; height: 48px; color: var(--text-muted);"></i>' +
          '<h3>No Blueprint Uploaded</h3>' +
          '<p>Upload a floor plan image to get started</p>' +
          '</div>';
      }
      noBp.classList.remove('hidden');
      resolve();
    }

    // Update the tabs rendering
    renderBlueprintTabs();

    // Ensure all icons are rendered including static ones in the blueprint selector bar
    setTimeout(function() {
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }, 50);
  });
}

function uploadBlueprint() {
  document.getElementById('blueprint-upload').click();
}

/**
 * Upload the "All Devices" master map
 */
function uploadAllDevicesMap() {
  // Create a file input for the all devices map
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.pdf';
  input.onchange = function(e) {
    handleAllDevicesMapUpload(e);
  };
  input.click();
}

/**
 * Handle the upload of the All Devices master map
 */
function handleAllDevicesMapUpload(event) {
  var file = event.target.files[0];
  if (!file) return;

  var isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  var isImage = file.type.startsWith('image/');

  if (!isImage && !isPDF) {
    showToast('Please upload an image or PDF file', 'error');
    return;
  }

  showToast(isPDF ? 'Converting PDF for All Devices Map...' : 'Uploading All Devices Map...', 'info');

  if (isPDF) {
    // Handle PDF upload for all devices map
    handlePDFUploadForAllDevices(file);
    return;
  }

  // Handle image upload
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var imageData = e.target.result;
      var isPNG = file.type === 'image/png';

      // Resize if needed
      if (img.width > 4000 || img.height > 4000) {
        var canvas = document.createElement('canvas');
        var width = img.width;
        var height = img.height;
        var maxDim = 4000;

        if (width > height && width > maxDim) {
          height = Math.round(height * maxDim / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round(width * maxDim / height);
          height = maxDim;
        }

        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        imageData = canvas.toDataURL(isPNG ? 'image/png' : 'image/jpeg', 0.95);
      }

      // Save to IndexedDB (local cache) and upload to Drive
      BlueprintDB.saveImage('all-devices-map', imageData).then(function() {
        state.blueprints['all-devices-map'] = {
          id: 'all-devices-map', name: 'All Devices Map', imageData: imageData
        };

        // Compress and upload to Drive
        var jpegDataUrl = compressForCloudStorage(img);
        showToast('Uploading All Devices Map to cloud...', 'info');

        uploadImageToDrive('all-devices-map', jpegDataUrl)
          .then(function(result) {
            state.blueprints['all-devices-map']._storageRef = 'drive:' + result.driveFileId;
            google.script.run
              .withSuccessHandler(function() {
                showToast('All Devices Map uploaded to cloud!', 'success');
                updateBlueprintDisplay();
                renderDeviceMarkers();
              })
              .withFailureHandler(function() {
                updateBlueprintDisplay();
                renderDeviceMarkers();
                showToast('All Devices Map saved to cloud!', 'success');
              })
              .saveBlueprint({ id: 'all-devices-map', name: 'All Devices Map', imageData: 'drive:' + result.driveFileId });
          })
          .catch(function(err) {
            console.error('Drive upload failed for All Devices Map:', err);
            state.blueprints['all-devices-map']._storageRef = 'local:all-devices-map';
            google.script.run.withSuccessHandler(function(){}).withFailureHandler(function(){})
              .saveBlueprint({ id: 'all-devices-map', name: 'All Devices Map', imageData: 'local:all-devices-map' });
            updateBlueprintDisplay();
            renderDeviceMarkers();
            showToast('Cloud upload failed. Map saved locally only.', 'warning');
          });
      });
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/**
 * Handle PDF upload for All Devices Map
 */
function handlePDFUploadForAllDevices(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    var typedArray = new Uint8Array(e.target.result);

    pdfjsLib.getDocument(typedArray).promise.then(function(pdf) {
      pdf.getPage(1).then(function(page) {
        var scale = 3;
        var viewport = page.getViewport({ scale: scale });

        var canvas = document.createElement('canvas');
        var context = canvas.getContext('2d');

        var maxDim = 4000;
        var width = viewport.width;
        var height = viewport.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            scale = scale * (maxDim / width);
          } else {
            scale = scale * (maxDim / height);
          }
          viewport = page.getViewport({ scale: scale });
          width = viewport.width;
          height = viewport.height;
        }

        canvas.width = width;
        canvas.height = height;

        page.render({ canvasContext: context, viewport: viewport }).promise.then(function() {
          var imageData = canvas.toDataURL('image/png', 1.0);

          BlueprintDB.saveImage('all-devices-map', imageData).then(function() {
            state.blueprints['all-devices-map'] = {
              id: 'all-devices-map', name: 'All Devices Map', imageData: imageData
            };

            // Compress and upload to Drive
            var tempImg = new Image();
            tempImg.onload = function() {
              var jpegDataUrl = compressForCloudStorage(tempImg);
              showToast('Uploading PDF map to cloud...', 'info');

              uploadImageToDrive('all-devices-map', jpegDataUrl)
                .then(function(result) {
                  state.blueprints['all-devices-map']._storageRef = 'drive:' + result.driveFileId;
                  google.script.run
                    .withSuccessHandler(function() {
                      showToast('All Devices Map (PDF) uploaded to cloud!', 'success');
                      updateBlueprintDisplay();
                      renderDeviceMarkers();
                    })
                    .withFailureHandler(function() {
                      updateBlueprintDisplay();
                      renderDeviceMarkers();
                    })
                    .saveBlueprint({ id: 'all-devices-map', name: 'All Devices Map', imageData: 'drive:' + result.driveFileId });
                })
                .catch(function(err) {
                  console.error('Drive upload failed:', err);
                  state.blueprints['all-devices-map']._storageRef = 'local:all-devices-map';
                  google.script.run.withSuccessHandler(function(){}).withFailureHandler(function(){})
                    .saveBlueprint({ id: 'all-devices-map', name: 'All Devices Map', imageData: 'local:all-devices-map' });
                  updateBlueprintDisplay();
                  renderDeviceMarkers();
                  showToast('Cloud failed. PDF map saved locally.', 'warning');
                });
            };
            tempImg.src = imageData;
          });
        });
      });
    }).catch(function(err) {
      showToast('Error loading PDF: ' + err.message, 'error');
    });
  };
  reader.readAsArrayBuffer(file);
}

function handleBlueprintUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');

  if (!isImage && !isPDF) {
    showToast('Please upload an image or PDF file', 'error');
    return;
  }

  // Show loading state
  showToast(isPDF ? 'Converting PDF...' : 'Uploading image...', 'info');

  if (isPDF) {
    // Handle PDF file
    handlePDFUpload(file);
    event.target.value = '';
    return;
  }

  // Read image and keep original format (preserve transparency)
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      let imageData = e.target.result;
      const isPNG = file.type === 'image/png';

      // Only resize if image is extremely large (> 4000px) to preserve quality
      // IndexedDB can handle large images, so we keep high resolution
      if (img.width > 4000 || img.height > 4000) {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Scale down to max 4000px on longest side (high quality for zoom)
        const maxDim = 4000;
        if (width > height && width > maxDim) {
          height = Math.round(height * maxDim / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round(width * maxDim / height);
          height = maxDim;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Enable high quality image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // For PNG, keep transparency. For others, fill white background first
        if (!isPNG) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Keep PNG format to preserve transparency and quality, use high-quality JPEG for others
        if (isPNG) {
          imageData = canvas.toDataURL('image/png');
        } else {
          imageData = canvas.toDataURL('image/jpeg', 0.95); // Higher quality (0.95 vs 0.92)
        }
      }

      const bp = state.blueprints[state.activeBlueprint] || {};
      const blueprintId = state.activeBlueprint;

      // Save full-quality image to IndexedDB (local cache)
      BlueprintDB.saveImage(blueprintId, imageData).then(function(saved) {
        if (!saved) {
          showToast('Error saving image locally', 'error');
          return;
        }

        // Compress to JPEG for cloud storage
        var jpegDataUrl = compressForCloudStorage(img);
        showToast('Uploading map to cloud...', 'info');

        // Upload to Google Drive
        uploadImageToDrive(blueprintId, jpegDataUrl)
          .then(function(result) {
            // Save metadata with drive: reference
            google.script.run
              .withSuccessHandler(function(saveResult) {
                if (saveResult && saveResult.success) {
                  saveResult.blueprint.imageData = imageData;
                  saveResult.blueprint._storageRef = 'drive:' + result.driveFileId;
                  state.blueprints[blueprintId] = saveResult.blueprint;
                } else {
                  state.blueprints[blueprintId] = {
                    id: blueprintId, name: bp.name || blueprintId,
                    imageData: imageData, _storageRef: 'drive:' + result.driveFileId
                  };
                }
                updateBlueprintDisplay();
                showToast('Map uploaded to cloud successfully!', 'success');
              })
              .withFailureHandler(function() {
                state.blueprints[blueprintId] = {
                  id: blueprintId, name: bp.name || blueprintId,
                  imageData: imageData, _storageRef: 'drive:' + result.driveFileId
                };
                updateBlueprintDisplay();
                showToast('Map saved to cloud!', 'success');
              })
              .saveBlueprint({
                id: blueprintId,
                name: bp.name || blueprintId,
                imageData: 'drive:' + result.driveFileId
              });
          })
          .catch(function(err) {
            // Drive upload failed - fall back to local-only
            console.error('Drive upload failed:', err);
            state.blueprints[blueprintId] = {
              id: blueprintId, name: bp.name || blueprintId,
              imageData: imageData, _storageRef: 'local:' + blueprintId
            };
            google.script.run
              .withSuccessHandler(function() {})
              .withFailureHandler(function() {})
              .saveBlueprint({ id: blueprintId, name: bp.name || blueprintId, imageData: 'local:' + blueprintId });
            updateBlueprintDisplay();
            showToast('Cloud upload failed. Map saved locally only.', 'warning');
          });
      });
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);

  event.target.value = '';
}

// Handle PDF file upload - convert first page to image
async function handlePDFUpload(file) {
  try {
    // Set PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Get first page
    const page = await pdf.getPage(1);

    // Set scale for HIGH quality (3x for crisp zoom - higher than before)
    const scale = 3;
    const viewport = page.getViewport({ scale: scale });

    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Enable high quality rendering
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    // Fill white background
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Render PDF page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;

    // Convert to PNG (lossless)
    let imageData = canvas.toDataURL('image/png');

    // Resize only if extremely large (> 4000px) to preserve quality for zooming
    if (canvas.width > 4000 || canvas.height > 4000) {
      const resizeCanvas = document.createElement('canvas');
      let width = canvas.width;
      let height = canvas.height;

      const maxDim = 4000;
      if (width > height && width > maxDim) {
        height = Math.round(height * maxDim / width);
        width = maxDim;
      } else if (height > maxDim) {
        width = Math.round(width * maxDim / height);
        height = maxDim;
      }

      resizeCanvas.width = width;
      resizeCanvas.height = height;
      const resizeCtx = resizeCanvas.getContext('2d');
      resizeCtx.imageSmoothingEnabled = true;
      resizeCtx.imageSmoothingQuality = 'high';
      resizeCtx.fillStyle = '#FFFFFF';
      resizeCtx.fillRect(0, 0, width, height);
      resizeCtx.drawImage(canvas, 0, 0, width, height);

      imageData = resizeCanvas.toDataURL('image/png');
    }

    // Save to IndexedDB (local cache) and upload to Drive
    const bp = state.blueprints[state.activeBlueprint] || {};
    const blueprintId = state.activeBlueprint;

    const saved = await BlueprintDB.saveImage(blueprintId, imageData);
    if (saved) {
      // Compress to JPEG for cloud storage
      var tempImg = new Image();
      tempImg.onload = function() {
        var jpegDataUrl = compressForCloudStorage(tempImg);
        showToast('Uploading PDF map to cloud...', 'info');

        uploadImageToDrive(blueprintId, jpegDataUrl)
          .then(function(result) {
            google.script.run
              .withSuccessHandler(function(saveResult) {
                if (saveResult && saveResult.success) {
                  saveResult.blueprint.imageData = imageData;
                  saveResult.blueprint._storageRef = 'drive:' + result.driveFileId;
                  state.blueprints[blueprintId] = saveResult.blueprint;
                } else {
                  state.blueprints[blueprintId] = {
                    id: blueprintId, name: bp.name || blueprintId,
                    imageData: imageData, _storageRef: 'drive:' + result.driveFileId
                  };
                }
                updateBlueprintDisplay();
                showToast('PDF map uploaded to cloud!', 'success');
              })
              .withFailureHandler(function() {
                state.blueprints[blueprintId] = {
                  id: blueprintId, name: bp.name || blueprintId,
                  imageData: imageData, _storageRef: 'drive:' + result.driveFileId
                };
                updateBlueprintDisplay();
                showToast('PDF map saved to cloud!', 'success');
              })
              .saveBlueprint({
                id: blueprintId, name: bp.name || blueprintId,
                imageData: 'drive:' + result.driveFileId
              });
          })
          .catch(function(err) {
            console.error('Drive upload failed:', err);
            state.blueprints[blueprintId] = {
              id: blueprintId, name: bp.name || blueprintId,
              imageData: imageData, _storageRef: 'local:' + blueprintId
            };
            google.script.run.withSuccessHandler(function(){}).withFailureHandler(function(){})
              .saveBlueprint({ id: blueprintId, name: bp.name || blueprintId, imageData: 'local:' + blueprintId });
            updateBlueprintDisplay();
            showToast('Cloud upload failed. PDF saved locally only.', 'warning');
          });
      };
      tempImg.src = imageData;
    } else {
      showToast('Error saving image locally', 'error');
    }
  } catch (error) {
    console.error('PDF processing error:', error);
    showToast('Error processing PDF: ' + error.message, 'error');
  }
}

// Compress image progressively until it fits within size limit
function compressImageProgressive(file, callback) {
  const maxSize = 45000; // ~45KB limit for Google Sheets cell
  const reader = new FileReader();

  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // Try different size/quality combinations until it fits
      const attempts = [
        { maxWidth: 1200, quality: 0.7 },
        { maxWidth: 1000, quality: 0.6 },
        { maxWidth: 800, quality: 0.5 },
        { maxWidth: 600, quality: 0.4 },
        { maxWidth: 500, quality: 0.3 },
        { maxWidth: 400, quality: 0.25 },
        { maxWidth: 300, quality: 0.2 }
      ];

      for (let i = 0; i < attempts.length; i++) {
        const { maxWidth, quality } = attempts[i];
        const result = compressToSize(img, maxWidth, quality);

        if (result.length <= maxSize) {
          const sizeKB = Math.round(result.length / 1024);
          callback(result, sizeKB);
          return;
        }
      }

      // If still too large after all attempts, return null
      callback(null, 0);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Compress image to specific size/quality
function compressToSize(img, maxWidth, quality) {
  const canvas = document.createElement('canvas');
  let width = img.width;
  let height = img.height;

  // Scale down if larger than maxWidth
  if (width > maxWidth) {
    height = Math.round(height * maxWidth / width);
    width = maxWidth;
  }

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  // Convert to JPEG with compression
  return canvas.toDataURL('image/jpeg', quality);
}

// Legacy compress function (kept for compatibility)
function compressImage(file, maxWidth, quality, callback) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const result = compressToSize(img, maxWidth, quality);
      callback(result);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function addNewBlueprint() {
  // Show the rename modal for creating a new blueprint
  const modal = document.getElementById('rename-blueprint-modal');
  const input = document.getElementById('blueprint-new-name');
  const modalTitle = modal.querySelector('.modal-header h3');

  // Change modal title temporarily
  if (modalTitle) modalTitle.textContent = 'Create New Blueprint';

  if (input) {
    input.value = 'New Blueprint ' + (Object.keys(state.blueprints).length + 1);
  }

  // Override save button to create new
  window._creatingNewBlueprint = true;

  modal.classList.add('active');
  if (input) input.focus();
  if (input) input.select();
}

// Create new blueprint (called from save when creating)
function createNewBlueprint(name) {
  const id = 'blueprint_' + Date.now();
  const newBlueprint = {
    id: id,
    name: name.trim(),
    imageData: null
  };

  showToast('Creating new map...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        state.blueprints[id] = result.blueprint;
        state.activeBlueprint = id;
        updateBlueprintDisplay();
        renderDeviceMarkers();
        showToast('Map "' + name + '" created', 'success');
      } else {
        showToast('Error creating map', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error creating map: ' + err.message, 'error');
    })
    .saveBlueprint(newBlueprint);
}

function deleteCurrentBlueprint() {
  const blueprintIds = Object.keys(state.blueprints);
  if (blueprintIds.length <= 1) {
    showToast('Cannot delete the last map', 'warning');
    return;
  }

  const bp = state.blueprints[state.activeBlueprint];
  const bpName = bp ? bp.name : state.activeBlueprint;

  showConfirmCard({
    title: 'Delete Map',
    message: 'Are you sure you want to delete the map "<strong>' + bpName + '</strong>"? All devices on this map will become unassigned.',
    type: 'danger',
    confirmText: 'Delete',
    onConfirm: function() {
      showToast('Deleting map...', 'info');
      google.script.run
        .withSuccessHandler(function(result) {
          if (result.success) {
            delete state.blueprints[state.activeBlueprint];
            state.activeBlueprint = Object.keys(state.blueprints)[0];
            updateBlueprintDisplay();
            renderDeviceMarkers();
            showToast('Map deleted', 'success');
          } else {
            showToast('Error deleting map', 'error');
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error deleting map: ' + err.message, 'error');
        })
        .deleteBlueprint(state.activeBlueprint);
    }
  });
}

// ============================================
// Map Background Color
// ============================================
function changeMapBackgroundColor(color) {
  var canvas = document.getElementById('blueprint-canvas');
  if (canvas) {
    canvas.style.backgroundColor = color;
  }

  // Update the color picker input
  var colorInput = document.getElementById('map-bg-color');
  if (colorInput) {
    colorInput.value = color;
  }

  // Update active state on preset buttons using data-color attribute
  var presets = document.querySelectorAll('.map-bg-preset');
  presets.forEach(function(preset) {
    var presetColor = preset.dataset.color || '';
    preset.classList.toggle('active', presetColor.toLowerCase() === color.toLowerCase());
  });

  // Save preference to localStorage
  localStorage.setItem('codemap-map-bg-color', color);
}

function rgbToHex(rgb) {
  if (rgb.startsWith('#')) return rgb;
  var result = rgb.match(/\d+/g);
  if (!result || result.length < 3) return rgb;
  return '#' + result.slice(0, 3).map(function(x) {
    var hex = parseInt(x).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function loadMapBackgroundColor() {
  var savedColor = localStorage.getItem('codemap-map-bg-color');
  if (savedColor) {
    changeMapBackgroundColor(savedColor);
  }
}

// ============================================
// Device Placement
// ============================================
function togglePlaceMode() {
  state.placingDevice = !state.placingDevice;
  const canvas = document.getElementById('blueprint-canvas');
  const btn = document.getElementById('place-device-btn');
  const indicator = document.getElementById('tap-indicator');

  canvas.classList.toggle('placing', state.placingDevice);
  btn.classList.toggle('btn-primary', state.placingDevice);
  btn.classList.toggle('btn-outline', !state.placingDevice);

  if (state.placingDevice) {
    showToast('Click on the blueprint to place a device', 'info');
  }
}

function setupBlueprintCanvas() {
  const canvas = document.getElementById('blueprint-canvas');
  const img = document.getElementById('blueprint-image');

  // Click to place device
  canvas.addEventListener('click', function(e) {
    if (!state.placingDevice) return;
    if (e.target.classList.contains('device-marker')) return;

    const rect = canvas.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();

    console.log('Place device click - canvas rect:', rect.width, 'x', rect.height, 'img rect:', imgRect.width, 'x', imgRect.height);

    let x, y;

    // Check if image is loaded and has valid dimensions
    if (!imgRect.width || !imgRect.height || imgRect.width < 10 || imgRect.height < 10 || img.classList.contains('hidden')) {
      // Image not loaded, use canvas dimensions instead
      console.log('Image not loaded or hidden, using canvas for positioning');
      if (rect.width > 10 && rect.height > 10) {
        x = (e.clientX - rect.left) / rect.width;
        y = (e.clientY - rect.top) / rect.height;
      } else {
        // Canvas also too small, use default position
        console.log('Canvas too small, using default center position');
        x = 0.5;
        y = 0.5;
      }
    } else {
      // Calculate normalized position (0-1) based on image
      x = (e.clientX - imgRect.left) / imgRect.width;
      y = (e.clientY - imgRect.top) / imgRect.height;
    }

    console.log('Calculated position:', x, y);

    // Clamp values to valid range
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));

    // Always show the modal if we got this far
    state.placingDevice = false;
    canvas.classList.remove('placing');
    document.getElementById('place-device-btn').classList.remove('btn-primary');
    document.getElementById('place-device-btn').classList.add('btn-outline');

    showAddDeviceModal(x, y);
  });

  // Mouse move for tap indicator
  canvas.addEventListener('mousemove', function(e) {
    if (!state.placingDevice) return;

    const indicator = document.getElementById('tap-indicator');
    const rect = canvas.getBoundingClientRect();

    indicator.style.left = (e.clientX - rect.left + canvas.scrollLeft) + 'px';
    indicator.style.top = (e.clientY - rect.top + canvas.scrollTop) + 'px';
    indicator.classList.remove('hidden');
  });

  canvas.addEventListener('mouseleave', function() {
    document.getElementById('tap-indicator').classList.add('hidden');
  });

  // Pan support - click and drag to move around the map
  canvas.addEventListener('mousedown', function(e) {
    if (state.placingDevice) return;
    if (e.target.classList.contains('device-marker')) return;

    e.preventDefault();
    state.isDragging = true;
    state.dragStart = { x: e.clientX + canvas.scrollLeft, y: e.clientY + canvas.scrollTop };
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('mousemove', function(e) {
    if (!state.isDragging) return;
    e.preventDefault();

    canvas.scrollLeft = state.dragStart.x - e.clientX;
    canvas.scrollTop = state.dragStart.y - e.clientY;

    // Update tooltip overlay positions during drag/pan
    if (typeof updateAlertTooltipOverlay === 'function') {
      updateAlertTooltipOverlay();
    }
  });

  // Also update tooltip overlay on scroll (programmatic or user scroll)
  canvas.addEventListener('scroll', function() {
    if (typeof updateAlertTooltipOverlay === 'function') {
      updateAlertTooltipOverlay();
    }
  });

  canvas.addEventListener('mouseup', function() {
    state.isDragging = false;
    canvas.style.cursor = state.placingDevice ? 'crosshair' : 'grab';
  });

  canvas.addEventListener('mouseleave', function() {
    if (state.isDragging) {
      state.isDragging = false;
      canvas.style.cursor = state.placingDevice ? 'crosshair' : 'grab';
    }
  });

  // Prevent default drag behavior on the image
  if (img) {
    img.addEventListener('dragstart', function(e) {
      e.preventDefault();
    });
  }
}

// ============================================
// Zoom Controls
// ============================================
function zoomIn() {
  state.zoom = Math.min(state.zoom + 0.25, 5);
  applyZoom();
}

function zoomOut() {
  state.zoom = Math.max(state.zoom - 0.25, 0.5);
  applyZoom();
}

function resetZoom() {
  state.zoom = 1;
  applyZoom();
  // Reset scroll position
  const canvas = document.getElementById('blueprint-canvas');
  if (canvas) {
    canvas.scrollLeft = 0;
    canvas.scrollTop = 0;
  }
}

function applyZoom() {
  const img = document.getElementById('blueprint-image');
  const wrapper = document.getElementById('blueprint-wrapper');
  const markers = document.getElementById('device-markers');

  // Apply zoom using CSS transform for visual scaling
  // Use scale3d for GPU acceleration and better rendering quality
  if (wrapper) {
    wrapper.style.transform = `scale3d(${state.zoom}, ${state.zoom}, 1)`;
    wrapper.style.transformOrigin = 'top left';
  }

  // Update zoom level display
  const zoomEl = document.getElementById('zoom-level');
  if (zoomEl) {
    zoomEl.textContent = Math.round(state.zoom * 100) + '%';
  }

  // Adjust marker size inversely to zoom level
  // When zoomed in (zoom > 1), make markers smaller so you can place precisely
  // When zoomed out (zoom < 1), keep markers normal size for visibility
  updateMarkerSizeForZoom();

  renderDeviceMarkers();
}

/**
 * Adjust marker size based on zoom level
 * Zoomed in = smaller markers for precise placement
 * Zoomed out = normal markers for visibility
 */
function updateMarkerSizeForZoom() {
  const markersContainer = document.getElementById('device-markers');
  if (!markersContainer) return;

  // Calculate inverse scale factor
  // At zoom 1.0 = markers are 24px (normal)
  // At zoom 2.0 = markers are 12px (half size)
  // At zoom 0.5 = markers stay 24px (don't grow larger)
  var scaleFactor = 1;
  if (state.zoom > 1) {
    scaleFactor = 1 / state.zoom;
  }

  // Minimum size is 10px, maximum is 24px
  var markerSize = Math.max(10, Math.min(24, 24 * scaleFactor));

  // Apply CSS variable for marker size
  markersContainer.style.setProperty('--marker-size', markerSize + 'px');
  markersContainer.style.setProperty('--marker-icon-size', (markerSize * 0.6) + 'px');
}

/**
 * Sync the device-markers container to match the exact image dimensions
 * This is CRITICAL for accurate percentage-based marker positioning
 */
function syncMarkersToImage() {
  const img = document.getElementById('blueprint-image');
  const markers = document.getElementById('device-markers');

  if (!img || !markers) return;

  // Wait for image to load if not ready
  if (!img.complete || !img.naturalWidth) {
    // Use addEventListener to avoid overwriting other handlers
    img.addEventListener('load', function onImageLoad() {
      img.removeEventListener('load', onImageLoad);
      syncMarkersToImage();
    });
    return;
  }

  // Get the actual rendered size of the image (before zoom transform)
  const imgWidth = img.offsetWidth;
  const imgHeight = img.offsetHeight;

  // Set markers container to exact same size as image
  // Use exact pixel values, not percentages, to prevent rounding errors
  if (imgWidth > 0 && imgHeight > 0) {
    markers.style.width = imgWidth + 'px';
    markers.style.height = imgHeight + 'px';
    markers.style.position = 'absolute';
    markers.style.top = '0';
    markers.style.left = '0';
  }
}

/**
 * Center the blueprint in the canvas viewport
 */
function centerBlueprint() {
  const canvas = document.getElementById('blueprint-canvas');
  const wrapper = document.getElementById('blueprint-wrapper');
  const img = document.getElementById('blueprint-image');

  if (!canvas || !wrapper || !img) return;

  // Wait for image to be loaded
  if (!img.naturalWidth) {
    img.onload = function() {
      centerBlueprint();
    };
    return;
  }

  // Calculate scaled dimensions
  const scaledWidth = img.naturalWidth * state.zoom;
  const scaledHeight = img.naturalHeight * state.zoom;

  // Calculate scroll position to center
  const scrollLeft = Math.max(0, (scaledWidth - canvas.clientWidth) / 2);
  const scrollTop = Math.max(0, (scaledHeight - canvas.clientHeight) / 2);

  canvas.scrollLeft = scrollLeft;
  canvas.scrollTop = scrollTop;
}

/**
 * Zoom and pan to a specific device on the map
 * @param {string} deviceId - The device ID to focus on
 * @param {number} targetZoom - The zoom level (default 2.5 for good visibility)
 * @param {boolean} highlight - Whether to add highlight animation
 */
function zoomToDevice(deviceId, targetZoom, highlight) {
  targetZoom = targetZoom || 2.5;
  highlight = highlight !== false;

  // IMPORTANT: Get fresh device data from state each time
  const device = state.devices.find(d => d.id === deviceId);
  if (!device || device.x === undefined || device.y === undefined) {
    console.log('Cannot zoom: device not found or has no position', deviceId);
    return;
  }

  // Debug: Log the device we're zooming to
  console.log('zoomToDevice called with:', {
    deviceId: deviceId,
    foundDevice: device.name,
    coords: { x: device.x, y: device.y },
    blueprintId: device.blueprintId
  });

  // Switch to Blueprint View tab first
  switchTab('blueprint');

  // Switch to the correct blueprint if needed
  if (device.blueprintId && device.blueprintId !== state.activeBlueprint) {
    state.activeBlueprint = device.blueprintId;
    updateBlueprintDisplay();
  }

  // Wait for tab to render, then perform zoom
  setTimeout(() => {
    const canvas = document.getElementById('blueprint-canvas');
    const img = document.getElementById('blueprint-image');
    if (!canvas || !img) {
      console.log('Cannot zoom: canvas or image not found');
      return;
    }

    // Wait for image to load if not already
    if (!img.naturalWidth || img.naturalWidth === 0) {
      console.log('Image not loaded yet, waiting...');
      img.onload = function() {
        performZoomToDevice(device, canvas, img, targetZoom, highlight);
      };
      return;
    }

    performZoomToDevice(device, canvas, img, targetZoom, highlight);
  }, 200);
}

/**
 * Internal function to perform the actual zoom after tab is ready
 */
function performZoomToDevice(device, canvas, img, targetZoom, highlight) {
  // Apply target zoom
  state.zoom = targetZoom;
  applyZoom();

  // Wait for zoom to fully render
  setTimeout(() => {
    const marker = document.getElementById('marker-' + device.id);

    if (!marker) {
      console.log('Cannot zoom: marker not found', device.id);
      return;
    }

    // scrollIntoView handles CSS transforms correctly
    marker.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    });

    console.log('Zoom to device:', {
      deviceId: device.id,
      deviceName: device.name,
      deviceCoords: { x: device.x, y: device.y }
    });

    // Highlight the device marker after scroll animation
    if (highlight && marker) {
      setTimeout(() => {
        marker.classList.add('zoom-highlight');
        marker.style.animation = 'none';
        marker.offsetHeight;
        marker.style.animation = 'zoomHighlight 2s ease-out';

        setTimeout(() => {
          marker.classList.remove('zoom-highlight');
        }, 3000);
      }, 600);
    }
  }, 350);
}

/**
 * Zoom to device by IP address
 * @param {string} deviceIp - The device IP address
 */
function zoomToDeviceByIp(deviceIp) {
  const device = state.devices.find(d => d.ip === deviceIp);
  if (device) {
    zoomToDevice(device.id);
  }
}

// ============================================
// Device Markers
// ============================================
function renderDeviceMarkers() {
  const container = domCache.get('device-markers') || document.getElementById('device-markers');

  // Only skip if container doesn't exist
  if (!container) {
    return;
  }

  // CRITICAL: Sync markers container size to actual image dimensions
  // This ensures percentage-based positioning stays accurate regardless of viewport/zoom
  syncMarkersToImage();

  log('renderDeviceMarkers - activeDeviceType:', state.activeDeviceType, 'activeBlueprint:', state.activeBlueprint);

  // Use cached filter if available and cache key matches
  const cacheKey = `${state.activeDeviceType}_${state.activeBlueprint}_${state.devices.length}`;
  let filteredDevices;

  if (state._deviceCacheKey === cacheKey && state._deviceCache) {
    filteredDevices = state._deviceCache;
  } else {
    // Filter devices by blueprint AND device type (if a specific type is selected)
    filteredDevices = state.devices.filter(d => {
      // Must have position
      if (d.x === undefined || d.x === null || d.x === '' ||
          d.y === undefined || d.y === null || d.y === '') {
        return false;
      }

      // SPECIAL CASE: "All Devices" view - show ALL devices with positions
      if (state.activeDeviceType === 'all' && state.activeBlueprint === 'all-devices-map') {
        // Show ALL devices that have x,y positions (already checked above)
        // This displays every device on the master "All Devices" map
        return true;
      }

      // If viewing a specific device type, filter by type
      if (state.activeDeviceType && state.activeDeviceType !== 'all') {
        var deviceType = deviceTypesData.find(function(dt) { return dt.id === state.activeDeviceType; });
        if (deviceType) {
          // Device must match this type (by ID or name, case-insensitive)
          var deviceTypeLower = (d.type || '').toLowerCase();
          var typeIdLower = (deviceType.id || '').toLowerCase();
          var typeNameLower = (deviceType.name || '').toLowerCase();

          if (deviceTypeLower !== typeIdLower && deviceTypeLower !== typeNameLower) {
            return false;
          }
          // When viewing a device type with a specific blueprint, filter by that blueprint
          if (deviceType.blueprintId) {
            return (d.blueprintId || 'blueprint1') === deviceType.blueprintId;
          }
          // Device type has no blueprint assigned - show device if it's on the current active blueprint
          return (d.blueprintId || 'blueprint1') === state.activeBlueprint;
        }
      }

      // Default: filter by current blueprint
      return (d.blueprintId || 'blueprint1') === state.activeBlueprint;
    });

    // Cache the result
    state._deviceCache = filteredDevices;
    state._deviceCacheKey = cacheKey;
  }

  // Apply "Show Issues" filter if active
  var displayDevices = filteredDevices;
  if (state.showOnlyIssues) {
    var issueDeviceIds = new Set(getDevicesWithIssues().map(function(d) { return d.id; }));
    displayDevices = filteredDevices.filter(function(d) {
      return issueDeviceIds.has(d.id);
    });
  }

  log('Filtered devices count:', filteredDevices.length, 'Display devices:', displayDevices.length);

  // Update issues badge
  updateIssuesCountBadge();

  var markersHtml = '';
  displayDevices.forEach(function(device) {
    // Use percentage-based positioning relative to the image
    var xPercent = device.x * 100;
    var yPercent = device.y * 100;

    var statusClass = getDeviceStatusClass(device);
    var deviceTraps = state.traps.filter(function(t) {
      return t.sourceIp === device.ip && t.processed === 0;
    });
    var unresolvedTraps = deviceTraps.length;

    // Check for pending service requests for this device
    var deviceServiceRequests = (serviceRequestsData || []).filter(function(sr) {
      return (sr.status === 'pending' || sr.status === 'in-progress') && serviceRequestMatchesDevice(sr, device);
    });
    var pendingServiceRequests = deviceServiceRequests.length;

    // Check if this device is currently alerting (new trap or new service request)
    var isAlerting = state.alertingDevices.has(device.ip);
    var isServiceRequestAlerting = state.serviceRequestAlertingDevices.has(device.id);
    var alertClass = isAlerting ? 'alerting' : '';
    var serviceAlertClass = isServiceRequestAlerting ? 'service-request-alerting' : '';
    var hasAlertClass = unresolvedTraps > 0 ? 'has-alert' : '';
    var hasServiceRequestClass = pendingServiceRequests > 0 ? 'has-service-request' : '';
    var icon = getDeviceIcon(device.type);

    // Badge shows total alerts (traps + service requests)
    var totalAlerts = unresolvedTraps + pendingServiceRequests;
    var badge = totalAlerts > 0 ? '<span class="trap-badge' + (pendingServiceRequests > 0 ? ' service-request-badge' : '') + '">' + totalAlerts + '</span>' : '';

    // Enhanced alert info tooltip
    var alertInfo = '';
    if (unresolvedTraps > 0) {
      var latestTrap = deviceTraps[0];
      var assignedTo = latestTrap.assignedTo || '';
      alertInfo = latestTrap.parsedMessage || 'Alert';
      if (assignedTo) {
        alertInfo += ' (Assigned: ' + assignedTo + ')';
      }
    }
    if (pendingServiceRequests > 0) {
      var latestRequest = deviceServiceRequests[0];
      if (alertInfo) alertInfo += ' | ';
      alertInfo += 'Service: ' + (latestRequest.issueLabel || latestRequest.issueType || 'Request');
      if (latestRequest.assignedTo) {
        alertInfo += ' (Assigned: ' + latestRequest.assignedTo + ')';
      }
    }

    // Build marker style - position + optional custom color
    var markerStyle = 'left: ' + xPercent + '%; top: ' + yPercent + '%;';

    // COLOR LOGIC:
    // - Has alert/trap → RED with pulse animation (critical class)
    // - Toner empty (0-5%) → RED pulsing (toner-empty class)
    // - Toner low (6-20%) → ORANGE pulsing (toner-low class)
    // - No alert → Use device type's custom color, or default GREEN
    var hasActiveAlert = hasAlertClass || hasServiceRequestClass;

    // Check toner/supply levels for color coding
    var tonerStatus = 'ok'; // ok, low, empty
    if (Array.isArray(device.supplies) && device.supplies.length > 0) {
      device.supplies.forEach(function(s) {
        if (s.percentage >= 0 && s.percentage !== -1) {
          var nameL = (s.name || '').toLowerCase();
          // Check toner, ink, and drum supplies (skip waste toner)
          if (nameL.indexOf('toner') !== -1 || nameL.indexOf('ink') !== -1 || nameL.indexOf('drum') !== -1) {
            if (nameL.indexOf('waste') !== -1) return; // Skip waste toner
            if (s.percentage <= 5 && tonerStatus !== 'empty') {
              tonerStatus = 'empty';
            } else if (s.percentage <= 20 && tonerStatus === 'ok') {
              tonerStatus = 'low';
            }
          }
        }
      });
    }

    // Look up the device type color
    var deviceTypeColor = '';
    if (!hasActiveAlert) {
      var dtConfig = deviceTypesData.find(function(dt) {
        return dt.name && dt.name.toLowerCase() === (device.type || '').toLowerCase();
      });
      if (dtConfig && dtConfig.color) {
        deviceTypeColor = dtConfig.color;
      }
    }

    if (hasActiveAlert) {
      statusClass = 'critical';
    } else if (tonerStatus === 'empty') {
      statusClass = 'toner-empty';
    } else if (tonerStatus === 'low') {
      statusClass = 'toner-low';
    } else if (deviceTypeColor) {
      statusClass = 'custom-color';
      markerStyle += ' background: ' + deviceTypeColor + ';';
    } else {
      statusClass = 'online';  // Default green for devices without a custom color
    }

    markersHtml += '<div class="device-marker ' + statusClass + ' ' + alertClass + ' ' + serviceAlertClass + ' ' + hasAlertClass + ' ' + hasServiceRequestClass + (hasActiveAlert ? ' has-active-alert' : '') + '"';
    markersHtml += ' id="marker-' + device.id + '"';
    markersHtml += ' style="' + markerStyle + '"';
    markersHtml += ' onclick="showEnhancedDeviceModal(\'' + device.id + '\')"';
    markersHtml += ' title="' + device.name + (totalAlerts > 0 ? ' - ' + totalAlerts + ' alert(s): ' + alertInfo : '') + '">';
    markersHtml += icon + badge;

    // Build tooltip data for the external overlay (avoids overflow:hidden clipping)
    if (unresolvedTraps > 0 || pendingServiceRequests > 0) {
      var assignedBadge = '';
      var shortMsg = '';

      if (pendingServiceRequests > 0) {
        assignedBadge = deviceServiceRequests[0].assignedTo ? '<span class="assigned-indicator">👤</span>' : '';
        shortMsg = (deviceServiceRequests[0].issueLabel || deviceServiceRequests[0].issueType || 'Service Request').substring(0, 30);
      } else if (unresolvedTraps > 0) {
        assignedBadge = deviceTraps[0].assignedTo ? '<span class="assigned-indicator">👤</span>' : '';
        var trapMsg = (deviceTraps[0].parsedMessage && deviceTraps[0].parsedMessage !== 'Device Alert') ? deviceTraps[0].parsedMessage : extractTrapDescription(deviceTraps[0]);
        shortMsg = trapMsg.substring(0, 30);
      }

      var tooltipMsg = shortMsg || 'Device Alert';
      // Escape for safe HTML attribute value
      var safeMsg = tooltipMsg.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Store tooltip data as data attributes on the marker for the overlay to read
      markersHtml = markersHtml.replace(
        'id="marker-' + device.id + '"',
        'id="marker-' + device.id + '" data-tooltip-msg="' + safeMsg + '"' +
        ' data-tooltip-assigned="' + (assignedBadge ? '1' : '0') + '"' +
        ' data-tooltip-type="' + (pendingServiceRequests > 0 ? 'service' : 'alert') + '"'
      );
    }

    markersHtml += '</div>';
  });
  container.innerHTML = markersHtml;

  // Render Lucide icons in markers only (scoped to container)
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // Update the external tooltip overlay (positioned outside overflow:hidden containers)
  updateAlertTooltipOverlay();
}

/**
 * Update the alert tooltip overlay that sits OUTSIDE the blueprint-container.
 * This avoids the overflow:hidden clipping that hides tooltips inside the container.
 * Calculates marker positions relative to the container wrapper and places
 * tooltip elements in the overlay at the correct positions.
 *
 * Only shows tooltips for markers that are visually within the container bounds
 * (i.e., not scrolled out of view).
 */
function updateAlertTooltipOverlay() {
  var overlay = document.getElementById('alert-tooltip-overlay');
  if (!overlay) return;

  // The overlay's parent is .blueprint-container-wrap
  var wrapEl = overlay.parentElement;
  if (!wrapEl) { overlay.innerHTML = ''; return; }

  // Get the container rect (the clipping boundary)
  var containerEl = wrapEl.querySelector('.blueprint-container');
  if (!containerEl) { overlay.innerHTML = ''; return; }

  var containerRect = containerEl.getBoundingClientRect();
  var wrapRect = wrapEl.getBoundingClientRect();

  // Find all markers that have tooltip data
  var markers = document.querySelectorAll('.device-marker[data-tooltip-msg]');
  if (!markers.length) { overlay.innerHTML = ''; return; }

  // Helper to escape HTML entities
  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var tooltipHtml = '';
  markers.forEach(function(marker) {
    var msg = marker.getAttribute('data-tooltip-msg') || 'Alert';
    var hasAssigned = marker.getAttribute('data-tooltip-assigned') === '1';
    var tooltipType = marker.getAttribute('data-tooltip-type');
    var isService = tooltipType === 'service';

    // Get the marker's position relative to the viewport
    var markerRect = marker.getBoundingClientRect();
    var markerCenterX = markerRect.left + markerRect.width / 2;
    var markerTopY = markerRect.top;

    // Check if the marker center is within the visible container area
    // (skip tooltips for markers scrolled out of view)
    if (markerCenterX < containerRect.left || markerCenterX > containerRect.right ||
        markerTopY < containerRect.top - 60 || markerRect.bottom > containerRect.bottom + 10) {
      return; // skip — marker is not visible
    }

    // Position relative to the wrap element
    var tooltipLeft = markerCenterX - wrapRect.left;
    var tooltipTop = markerTopY - wrapRect.top - 8; // 8px gap above marker

    var assignedHtml = hasAssigned ? '<span class="assigned-indicator">👤</span>' : '';
    var typeClass = isService ? ' service-request-tooltip' : '';

    var deviceId = marker.id ? marker.id.replace('marker-', '') : '';
    tooltipHtml += '<div class="overlay-tooltip' + typeClass + '"';
    tooltipHtml += ' style="left: ' + tooltipLeft + 'px; top: ' + tooltipTop + 'px; transform: translateX(-50%) translateY(-100%); pointer-events: auto; cursor: pointer;"';
    tooltipHtml += ' onclick="showEnhancedDeviceModal(\'' + deviceId + '\')">';
    tooltipHtml += assignedHtml + '<span class="alert-preview">' + escapeHtml(msg) + '</span>';
    tooltipHtml += '</div>';
  });

  overlay.innerHTML = tooltipHtml;
}

// Trigger alert animation for a specific device
function triggerDeviceAlert(deviceIp) {
  state.alertingDevices.add(deviceIp);

  // Find device marker and add new-trap class
  var device = state.devices.find(function(d) { return d.ip === deviceIp; });
  if (device) {
    var marker = document.getElementById('marker-' + device.id);
    if (marker) {
      marker.classList.add('new-trap');
      setTimeout(function() { marker.classList.remove('new-trap'); }, 1500);
    }

    // Auto-navigate to device's map (device type tab) and zoom to it
    var autoZoomEnabled = localStorage.getItem('codemap-auto-zoom-alerts') !== 'false';
    var hasPosition = device.x !== undefined && device.x !== null && device.x !== '' &&
                      device.y !== undefined && device.y !== null && device.y !== '';
    var hasBlueprint = state.blueprints && Object.keys(state.blueprints).length > 0;

    if (autoZoomEnabled && hasPosition && hasBlueprint) {
      // Small delay to let the user see the notification first
      // Use navigateToDeviceOnMap to switch to correct device type tab and zoom
      setTimeout(function() {
        navigateToDeviceOnMap(device.id, true);
      }, 500);
    }
  }

  // Remove alerting state after 10 seconds
  setTimeout(function() {
    state.alertingDevices.delete(deviceIp);
    renderDeviceMarkers();
  }, 10000);

  // Play alert chime
  AudioAlert.playChime();

  // Re-render markers
  renderDeviceMarkers();
}

// ============================================
// Find Issues / Show Devices with Problems
// ============================================

/**
 * Toggle showing only devices with issues (unresolved traps, low supplies, offline)
 */
function toggleShowIssues() {
  state.showOnlyIssues = !state.showOnlyIssues;

  var btn = document.getElementById('show-issues-btn');
  if (btn) {
    btn.classList.toggle('active', state.showOnlyIssues);
    // Update button text
    var span = btn.querySelector('span:not(.issues-count-badge)');
    if (span) {
      span.textContent = state.showOnlyIssues ? 'Show All' : 'Find Issues';
    }
  }

  // Re-render markers with filter
  renderDeviceMarkers();

  // Show notification
  if (state.showOnlyIssues) {
    var issueCount = getDevicesWithIssues().length;
    if (issueCount > 0) {
      showToast('Showing ' + issueCount + ' device(s) with issues', 'warning');
    } else {
      showToast('No devices with issues found!', 'success');
      // Auto-disable filter if no issues
      state.showOnlyIssues = false;
      btn.classList.remove('active');
      var span = btn.querySelector('span:not(.issues-count-badge)');
      if (span) span.textContent = 'Find Issues';
    }
  } else {
    showToast('Showing all devices', 'info');
  }
}

/**
 * Get list of devices that have issues
 */
function getDevicesWithIssues() {
  return state.devices.filter(function(device) {
    // Check for unresolved SNMP traps
    var hasUnresolvedTraps = state.traps.some(function(t) {
      return t.sourceIp === device.ip && t.processed === 0;
    });
    if (hasUnresolvedTraps) return true;

    // Check for offline status
    if (device.status === 'offline') return true;

    // Check for issue status
    if (device.status === 'issue') return true;

    // Check for critical supply levels (below 10%)
    if (device.supplies && device.supplies.length > 0) {
      var hasCriticalSupply = device.supplies.some(function(s) {
        return s.percentage <= 10;
      });
      if (hasCriticalSupply) return true;
    }

    // Check for pending service requests
    var hasPendingRequest = (serviceRequestsData || []).some(function(sr) {
      return serviceRequestMatchesDevice(sr, device) &&
             sr.status !== 'resolved' && sr.status !== 'closed';
    });
    if (hasPendingRequest) return true;

    return false;
  });
}

/**
 * Update the issues count badge
 */
function updateIssuesCountBadge() {
  var badge = document.getElementById('issues-count-badge');
  if (!badge) return;

  var issueCount = getDevicesWithIssues().length;
  badge.textContent = issueCount;
  badge.style.display = issueCount > 0 ? 'inline-flex' : 'none';
}

function getDeviceStatusClass(device) {
  if (device.status === 'offline') return 'offline';
  if (device.status === 'issue') return 'issue';

  // Check supplies for critical levels
  if (device.supplies && device.supplies.length > 0) {
    const hasCritical = device.supplies.some(s => s.percentage <= 5);
    const hasWarning = device.supplies.some(s => s.percentage > 5 && s.percentage <= 35);

    if (hasCritical) return 'critical';
    if (hasWarning) return 'issue';
  }

  return 'online';
}

// ============================================
// Device Modal
// ============================================
function showDeviceModal(deviceId) {
  showEnhancedDeviceModal(deviceId);
}

// Enhanced Device Modal - Compact FrameFlow Style
function showEnhancedDeviceModal(deviceId) {
  var device = state.devices.find(function(d) { return d.id === deviceId; });
  if (!device) return;

  // Hide alert tooltip overlay so it doesn't appear on top of modal
  var tooltipOverlay = document.getElementById('alert-tooltip-overlay');
  if (tooltipOverlay) tooltipOverlay.style.display = 'none';

  var modal = document.getElementById('device-modal');
  var nameEl = document.getElementById('modal-device-name');
  var bodyEl = document.getElementById('modal-device-body');
  var footerEl = document.getElementById('modal-device-footer');

  // Calculate overall health score
  var healthScore = calculateDeviceHealth(device);
  var healthClass = getHealthClass(healthScore);
  var healthColor = getHealthColor(healthScore);

  nameEl.textContent = device.name;

  // Get unresolved SNMP traps for this device
  var deviceTraps = state.traps.filter(function(t) { return t.sourceIp === device.ip && t.processed === 0; });

  // Get service requests (QR scanned issues) for this device
  var deviceServiceRequests = (serviceRequestsData || []).filter(function(sr) {
    return serviceRequestMatchesDevice(sr, device) &&
           (sr.status === 'pending' || sr.status === 'in-progress');
  });

  var totalAlerts = deviceTraps.length + deviceServiceRequests.length;
  var bodyHtml = '';

  // ===== COMPACT HEADER WITH STATUS INDICATORS =====
  bodyHtml += '<div class="compact-device-header">';

  // Left side - Health gauge (smaller)
  var gaugeOffset = 157 - (157 * healthScore / 100); // 2*PI*25
  bodyHtml += '<div class="compact-health-gauge">';
  bodyHtml += '<svg viewBox="0 0 60 60" width="70" height="70">';
  bodyHtml += '<circle cx="30" cy="30" r="25" fill="none" stroke="#e5e7eb" stroke-width="6"/>';
  bodyHtml += '<circle cx="30" cy="30" r="25" fill="none" stroke="' + healthColor + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="157" stroke-dashoffset="' + gaugeOffset + '" transform="rotate(-90 30 30)"/>';
  bodyHtml += '</svg>';
  bodyHtml += '<div class="compact-gauge-value" style="color:' + healthColor + '">' + healthScore + '%</div>';
  bodyHtml += '</div>';

  // Right side - Device info
  bodyHtml += '<div class="compact-device-info">';
  bodyHtml += '<div class="compact-model">' + escapeHtml(device.model || device.type || 'Unknown') + '</div>';
  bodyHtml += '<div class="compact-meta">';
  bodyHtml += '<span class="meta-item"><i data-lucide="map-pin"></i>' + escapeHtml(device.location || 'N/A') + '</span>';
  bodyHtml += '<span class="meta-item"><i data-lucide="network"></i>' + device.ip + '</span>';
  bodyHtml += '</div>';
  if (device.machineId || device.serialNumber) {
    bodyHtml += '<div class="compact-meta" style="margin-top: 4px;">';
    if (device.machineId) {
      bodyHtml += '<span class="meta-item"><i data-lucide="hash"></i>ID: ' + escapeHtml(device.machineId) + '</span>';
    }
    if (device.serialNumber) {
      bodyHtml += '<span class="meta-item"><i data-lucide="barcode"></i>S/N: ' + escapeHtml(device.serialNumber) + '</span>';
    }
    bodyHtml += '</div>';
  }
  bodyHtml += '<div class="compact-status-row">';
  bodyHtml += '<span class="status-chip ' + device.status + '">' + (device.status || 'unknown') + '</span>';
  if (totalAlerts > 0) {
    bodyHtml += '<span class="alert-chip">' + totalAlerts + ' Alert' + (totalAlerts > 1 ? 's' : '') + '</span>';
  }
  bodyHtml += '</div>';
  bodyHtml += '</div>';
  bodyHtml += '</div>';

  // ===== DEVICE PHOTO SECTION =====
  bodyHtml += buildDevicePhotoSection(device.id, device.model || device.type || 'Unknown');

  // ===== LIVE ACTIVITY SECTION =====
  bodyHtml += '<div class="live-activity-section">';
  bodyHtml += '<div class="section-header">';
  bodyHtml += '<span class="section-icon">📡</span> Live Activity';
  bodyHtml += '<button class="btn btn-xs btn-ghost refresh-activity-btn" id="refresh-btn-' + device.id + '" onclick="event.stopPropagation(); refreshLiveActivity(\'' + device.id + '\', \'' + device.ip + '\')" title="Refresh">';
  bodyHtml += '<i data-lucide="refresh-cw"></i>';
  bodyHtml += '</button>';
  bodyHtml += '</div>';
  bodyHtml += '<div class="live-activity-content" id="live-activity-content-' + device.id + '">';
  bodyHtml += '<div class="activity-loading"><i data-lucide="loader" class="spin"></i> Checking device status...</div>';
  bodyHtml += '</div>';
  bodyHtml += '</div>';

  // Start live activity fetch for this device
  setTimeout(function() { refreshLiveActivity(device.id, device.ip); }, 300);

  // ===== PROBLEMS SECTION - SNMP TRAPS & SERVICE REQUESTS =====
  if (totalAlerts > 0) {
    bodyHtml += '<div class="problems-section">';
    bodyHtml += '<div class="section-header"><span class="section-icon">⚠️</span> Active Problems</div>';
    bodyHtml += '<div class="problems-list">';

    // SNMP Trap Problems (from copier)
    deviceTraps.forEach(function(trap, idx) {
      var priorityClass = trap.severity === 'critical' ? 'critical' : trap.severity === 'warning' ? 'warning' : 'medium';
      var timeAgo = getTimeAgo(trap.receivedAt);
      var assignedTo = trap.assignedTo || '';
      var trapUniqueId = 'snmp-' + idx;

      // Try to extract meaningful message from trap data
      var displayMessage = trap.parsedMessage;
      if (!displayMessage || displayMessage === 'Device Alert' || displayMessage === 'SNMP Alert' || displayMessage.trim() === '') {
        // Try to get info from trapData
        displayMessage = extractTrapDescription(trap);
      }

      bodyHtml += '<div class="problem-card snmp-problem">';
      bodyHtml += '<div class="problem-header">';
      bodyHtml += '<span class="problem-type-badge snmp">SNMP</span>';
      bodyHtml += '<span class="problem-priority ' + priorityClass + '">' + (trap.severity || 'Info') + '</span>';
      bodyHtml += '<span class="problem-time">' + timeAgo + '</span>';
      bodyHtml += '</div>';
      bodyHtml += '<div class="problem-message">' + escapeHtml(displayMessage) + '</div>';
      if (trap.oid) {
        bodyHtml += '<div class="problem-detail"><span class="detail-label">OID:</span> ' + trap.oid + '</div>';
      }
      bodyHtml += '<div class="problem-actions">';
      if (assignedTo) {
        bodyHtml += '<span class="assigned-to"><i data-lucide="user"></i>' + escapeHtml(assignedTo) + '</span>';
        bodyHtml += '<button class="btn btn-xs btn-success" onclick="resolveTrap(\'' + trap.id + '\')"><i data-lucide="check"></i>Complete</button>';
        bodyHtml += '<button class="btn btn-xs btn-ghost" onclick="unassignTrap(\'' + trap.id + '\', \'' + device.id + '\')"><i data-lucide="x"></i></button>';
      } else {
        bodyHtml += '<button class="btn btn-xs btn-primary" onclick="assignToMe(\'' + device.ip + '\')"><i data-lucide="user-plus"></i>Claim</button>';
        bodyHtml += '<div class="tech-assign-dropdown">';
        bodyHtml += '<button class="btn btn-xs btn-outline" onclick="toggleTechDropdown(\'' + trapUniqueId + '\')"><i data-lucide="users"></i>Assign</button>';
        bodyHtml += '<div class="tech-dropdown-menu" id="dropdown-' + trapUniqueId + '">';
        bodyHtml += buildTechDropdownItems('snmp', trap.id, device.ip, device.id);
        bodyHtml += '</div>';
        bodyHtml += '</div>';
      }
      bodyHtml += '</div>';
      bodyHtml += '</div>';
    });

    // Service Request Problems (from QR scan)
    deviceServiceRequests.forEach(function(sr, idx) {
      var priorityClass = sr.priority || 'medium';
      var timeAgo = getTimeAgo(sr.createdAt || sr.submittedAt);
      var assignedTo = sr.technicianName || sr.assignedTo || '';
      var statusClass = sr.status === 'in-progress' ? 'in-progress' : 'pending';
      // Use issueLabel for display, fallback to issueType
      var issueDisplay = sr.issueLabel || sr.issueType || 'Service Request';
      // Use employeeName (from backend) or submitterName as fallback
      var reporterName = sr.employeeName || sr.submitterName || 'Unknown';
      var srUniqueId = 'sr-' + idx;

      bodyHtml += '<div class="problem-card service-request">';
      bodyHtml += '<div class="problem-header">';
      bodyHtml += '<span class="problem-type-badge qr">QR REQUEST</span>';
      bodyHtml += '<span class="problem-priority ' + priorityClass + '">' + priorityClass + '</span>';
      bodyHtml += '<span class="problem-status ' + statusClass + '">' + sr.status + '</span>';
      bodyHtml += '<span class="problem-time">' + timeAgo + '</span>';
      bodyHtml += '</div>';
      bodyHtml += '<div class="problem-message"><strong>' + escapeHtml(issueDisplay) + '</strong></div>';
      if (sr.notes) {
        bodyHtml += '<div class="problem-detail">' + escapeHtml(sr.notes.substring(0, 100)) + '</div>';
      }
      bodyHtml += '<div class="problem-submitter"><i data-lucide="user"></i>Reported by: ' + escapeHtml(reporterName) + '</div>';
      bodyHtml += '<div class="problem-actions">';
      if (assignedTo) {
        bodyHtml += '<span class="assigned-to"><i data-lucide="user-check"></i>' + escapeHtml(assignedTo) + '</span>';
        bodyHtml += '<button class="btn btn-xs btn-success" onclick="completeServiceRequestDirect(\'' + sr.id + '\')"><i data-lucide="check"></i>Complete</button>';
        bodyHtml += '<button class="btn btn-xs btn-ghost" onclick="unassignServiceRequest(\'' + sr.id + '\', \'' + device.id + '\')"><i data-lucide="x"></i></button>';
      } else {
        bodyHtml += '<button class="btn btn-xs btn-primary" onclick="claimAlert(\'' + sr.id + '\')"><i data-lucide="user-plus"></i>Claim</button>';
        bodyHtml += '<div class="tech-assign-dropdown">';
        bodyHtml += '<button class="btn btn-xs btn-outline" onclick="toggleTechDropdown(\'' + srUniqueId + '\')"><i data-lucide="users"></i>Assign</button>';
        bodyHtml += '<div class="tech-dropdown-menu" id="dropdown-' + srUniqueId + '">';
        bodyHtml += buildTechDropdownItems('sr', sr.id, device.ip, device.id);
        bodyHtml += '</div>';
        bodyHtml += '</div>';
      }
      bodyHtml += '<button class="btn btn-xs btn-ghost" onclick="viewServiceRequest(\'' + sr.id + '\')"><i data-lucide="eye"></i></button>';
      bodyHtml += '</div>';
      bodyHtml += '</div>';
    });

    bodyHtml += '</div>'; // problems-list

    // Quick resolve all button
    if (totalAlerts > 1) {
      bodyHtml += '<div class="resolve-all-row">';
      bodyHtml += '<button class="btn btn-sm btn-danger" onclick="resolveAllDeviceAlerts(\'' + device.id + '\', \'' + device.ip + '\')"><i data-lucide="check-circle"></i>Resolve All (' + totalAlerts + ')</button>';
      bodyHtml += '</div>';
    }
    bodyHtml += '</div>'; // problems-section
  }

  // ===== SUPPLY LEVELS - COMPACT HORIZONTAL BARS =====
  if (device.supplies && device.supplies.length > 0) {
    bodyHtml += '<div class="supplies-section-compact">';
    bodyHtml += '<div class="section-header"><span class="section-icon">📊</span> Supply Levels</div>';
    bodyHtml += '<div class="compact-supplies-grid">';

    device.supplies.forEach(function(s) {
      var supplyInfo = getSupplyDisplayInfo(s);
      var shortName = s.name.length > 20 ? s.name.substring(0, 18) + '...' : s.name;

      bodyHtml += '<div class="compact-supply-row">';
      bodyHtml += '<span class="supply-name" title="' + escapeHtml(s.name) + '">' + escapeHtml(shortName) + '</span>';
      bodyHtml += '<div class="supply-bar-compact">';
      bodyHtml += '<div class="supply-fill-compact" style="width:' + supplyInfo.displayPercentage + '%;background:' + supplyInfo.barColor + '"></div>';
      bodyHtml += '</div>';
      bodyHtml += '<span class="supply-pct ' + supplyInfo.levelClass + '">' + supplyInfo.displayPercentage + '%</span>';
      bodyHtml += '</div>';
    });

    bodyHtml += '</div>';
    bodyHtml += '</div>';
  }

  // ===== QUICK ACTIONS ROW =====
  bodyHtml += '<div class="quick-actions-row">';
  bodyHtml += '<button class="quick-action-btn" onclick="openPrinterWebPage(\'' + device.ip + '\', \'' + escapeHtml(device.name) + '\')"><i data-lucide="globe"></i><span>Web Page</span></button>';
  bodyHtml += '<button class="quick-action-btn" onclick="generateQRForDevice(\'' + device.id + '\')"><i data-lucide="qr-code"></i><span>QR Code</span></button>';
  bodyHtml += '<button class="quick-action-btn" onclick="showEmailDeviceModal(\'' + device.id + '\')"><i data-lucide="mail"></i><span>Email</span></button>';
  bodyHtml += '<button class="quick-action-btn" onclick="editDevice(\'' + device.id + '\')"><i data-lucide="edit-2"></i><span>Edit</span></button>';
  bodyHtml += '<button class="quick-action-btn danger" onclick="confirmDeleteDevice(\'' + device.id + '\')"><i data-lucide="trash-2"></i><span>Delete</span></button>';
  bodyHtml += '</div>';

  bodyEl.innerHTML = bodyHtml;

  // Footer with zoom to device button
  footerEl.innerHTML = '<button class="btn btn-outline" onclick="closeDeviceModal(); zoomToDevice(\'' + device.id + '\');"><i data-lucide="scan"></i> Zoom to Device</button>' +
    '<button class="btn btn-ghost" onclick="closeDeviceModal()">Close</button>';

  modal.classList.add('active');
  modal.classList.add('device-detail-modal');
  modal.classList.add('compact-modal');
  lucide.createIcons();
}

// ============================================
// Device Photo Functions (by Model)
// Photos are shared across all devices with the same model
// ============================================

// Normalize model name for use as storage key
function normalizeModelKey(model) {
  if (!model) return 'unknown';
  // Remove special chars, convert to lowercase, trim
  return model.toString().toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// Get device photo from localStorage by model
function getDevicePhotoByModel(model) {
  try {
    var modelKey = normalizeModelKey(model);
    var photos = JSON.parse(localStorage.getItem('deviceModelPhotos') || '{}');
    return photos[modelKey] || null;
  } catch (e) {
    return null;
  }
}

// Save device photo to localStorage by model
function saveDevicePhotoByModel(model, photoDataUrl) {
  try {
    var modelKey = normalizeModelKey(model);
    var photos = JSON.parse(localStorage.getItem('deviceModelPhotos') || '{}');
    photos[modelKey] = photoDataUrl;
    localStorage.setItem('deviceModelPhotos', JSON.stringify(photos));
    return true;
  } catch (e) {
    console.error('Error saving device photo:', e);
    return false;
  }
}

// Delete device photo from localStorage by model
function deleteDevicePhotoByModel(model) {
  try {
    var modelKey = normalizeModelKey(model);
    var photos = JSON.parse(localStorage.getItem('deviceModelPhotos') || '{}');
    delete photos[modelKey];
    localStorage.setItem('deviceModelPhotos', JSON.stringify(photos));
    return true;
  } catch (e) {
    console.error('Error deleting device photo:', e);
    return false;
  }
}

// Trigger file input for photo upload
function triggerDevicePhotoUpload(deviceId) {
  var fileInput = document.getElementById('device-photo-input-' + deviceId);
  if (fileInput) {
    fileInput.click();
  }
}

// Handle device photo file selection
function handleDevicePhotoUpload(deviceId, model, input) {
  var file = input.files && input.files[0];
  if (!file) return;

  // Validate file type
  if (!file.type.startsWith('image/')) {
    showToast('Please select an image file', 'error');
    return;
  }

  // Validate file size (max 2MB)
  if (file.size > 2 * 1024 * 1024) {
    showToast('Image too large. Maximum size is 2MB', 'error');
    return;
  }

  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      // Resize image to reasonable size for storage
      var canvas = document.createElement('canvas');
      var maxWidth = 800;
      var maxHeight = 600;
      var width = img.width;
      var height = img.height;

      if (width > maxWidth) {
        height = height * (maxWidth / width);
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = width * (maxHeight / height);
        height = maxHeight;
      }

      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      var resizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

      if (saveDevicePhotoByModel(model, resizedDataUrl)) {
        showToast('Photo saved for all ' + model + ' devices', 'success');
        // Refresh the modal to show the new photo
        showEnhancedDeviceModal(deviceId);
      } else {
        showToast('Error saving photo', 'error');
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Delete device photo with confirmation
function deleteDevicePhoto(deviceId, model) {
  // Count how many devices use this model
  var devicesWithModel = state.devices.filter(function(d) {
    return normalizeModelKey(d.model) === normalizeModelKey(model);
  }).length;

  var message = 'Are you sure you want to remove this photo?';
  if (devicesWithModel > 1) {
    message = 'This will remove the photo for all ' + devicesWithModel + ' devices with model "' + model + '". Continue?';
  }

  showConfirmModal(
    'Delete Model Photo',
    message,
    function() {
      if (deleteDevicePhotoByModel(model)) {
        showToast('Photo deleted for ' + model, 'success');
        // Refresh the modal to show placeholder
        showEnhancedDeviceModal(deviceId);
      } else {
        showToast('Error deleting photo', 'error');
      }
    }
  );
}

// View device photo in full size
function viewDevicePhoto(model) {
  var photo = getDevicePhotoByModel(model);
  if (!photo) return;

  // Create photo modal overlay
  var overlay = document.createElement('div');
  overlay.className = 'photo-modal-overlay';
  overlay.onclick = function(e) {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
    }
  };

  overlay.innerHTML =
    '<div class="photo-modal-content">' +
    '<button class="photo-modal-close" onclick="this.closest(\'.photo-modal-overlay\').remove()"><i data-lucide="x"></i></button>' +
    '<img src="' + photo + '" alt="' + escapeHtml(model) + '">' +
    '</div>';

  document.body.appendChild(overlay);
  lucide.createIcons();
}

// Build device photo section HTML
function buildDevicePhotoSection(deviceId, model) {
  var photo = getDevicePhotoByModel(model);
  var hasPhoto = !!photo;
  var escapedModel = escapeHtml(model || 'Unknown');
  var modelForJs = (model || 'Unknown').replace(/'/g, "\\'");

  // Count devices with same model
  var devicesWithModel = state.devices.filter(function(d) {
    return normalizeModelKey(d.model) === normalizeModelKey(model);
  }).length;

  var html = '<div class="device-photo-section">';
  html += '<div class="device-photo-container">';

  // Photo preview
  html += '<div class="device-photo-preview' + (hasPhoto ? ' has-photo' : '') + '" ';
  if (hasPhoto) {
    html += 'onclick="viewDevicePhoto(\'' + modelForJs + '\')" title="Click to view full size">';
    html += '<img src="' + photo + '" alt="' + escapedModel + '">';
  } else {
    html += 'onclick="triggerDevicePhotoUpload(\'' + deviceId + '\')" title="Click to add photo">';
    html += '<div class="device-photo-placeholder">';
    html += '<i data-lucide="camera"></i>';
    html += '<span>Add Photo</span>';
    html += '</div>';
  }
  html += '</div>';

  // Actions
  html += '<div class="device-photo-actions">';
  html += '<div class="device-photo-label"><i data-lucide="image"></i>Model Photo';
  if (devicesWithModel > 1) {
    html += ' <span class="photo-shared-badge">Shared by ' + devicesWithModel + ' devices</span>';
  }
  html += '</div>';
  html += '<div class="device-photo-buttons">';
  html += '<input type="file" id="device-photo-input-' + deviceId + '" accept="image/*" onchange="handleDevicePhotoUpload(\'' + deviceId + '\', \'' + modelForJs + '\', this)">';

  if (hasPhoto) {
    html += '<button class="btn btn-sm btn-outline" onclick="triggerDevicePhotoUpload(\'' + deviceId + '\')"><i data-lucide="upload"></i> Change</button>';
    html += '<button class="btn btn-sm btn-ghost" onclick="deleteDevicePhoto(\'' + deviceId + '\', \'' + modelForJs + '\')"><i data-lucide="trash-2"></i></button>';
  } else {
    html += '<button class="btn btn-sm btn-primary" onclick="triggerDevicePhotoUpload(\'' + deviceId + '\')"><i data-lucide="upload"></i> Upload Photo</button>';
  }

  html += '</div>';
  html += '</div>';
  html += '</div>';
  html += '</div>';

  return html;
}

// Build technician dropdown items
function buildTechDropdownItems(type, itemId, deviceIp, deviceId) {
  var html = '';

  if (state.technicians && state.technicians.length > 0) {
    state.technicians.forEach(function(tech) {
      var techName = escapeHtml(tech.name);
      var firstName = tech.name.split(' ')[0];
      var initials = tech.name.split(' ').map(function(n) { return n.charAt(0); }).join('').toUpperCase();

      if (type === 'snmp') {
        html += '<div class="tech-dropdown-item" onclick="assignTrapToTech(\'' + deviceIp + '\', \'' + techName + '\', \'' + deviceId + '\')">';
      } else {
        html += '<div class="tech-dropdown-item" onclick="assignServiceRequestToTech(\'' + itemId + '\', \'' + techName + '\', \'' + deviceId + '\')">';
      }
      html += '<span class="tech-avatar-mini">' + initials + '</span>';
      html += '<span class="tech-name-mini">' + techName + '</span>';
      html += '</div>';
    });
  } else {
    html += '<div class="tech-dropdown-empty">No technicians configured</div>';
  }

  return html;
}

// Toggle tech dropdown visibility
function toggleTechDropdown(uniqueId) {
  // Close all other dropdowns first
  document.querySelectorAll('.tech-dropdown-menu.show').forEach(function(menu) {
    if (menu.id !== 'dropdown-' + uniqueId) {
      menu.classList.remove('show');
    }
  });

  var dropdown = document.getElementById('dropdown-' + uniqueId);
  if (dropdown) {
    dropdown.classList.toggle('show');
  }
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.tech-assign-dropdown')) {
    document.querySelectorAll('.tech-dropdown-menu.show').forEach(function(menu) {
      menu.classList.remove('show');
    });
  }
});

// Assign SNMP trap to a specific technician
function assignTrapToTech(deviceIp, techName, deviceId) {
  showToast('Assigning to ' + techName + '...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        showToast('Assigned to ' + techName, 'success');
        loadTraps().then(function() {
          renderTrapsList();
          renderDashboard();
          updateAllStats();
          renderDeviceMarkers();
          // Refresh modal
          if (deviceId) showEnhancedDeviceModal(deviceId);
        });
      } else {
        showToast(result.error || 'Error assigning', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error assigning: ' + err.message, 'error');
    })
    .assignTrapsByIp(deviceIp, techName);
}

// Assign service request to a specific technician
function assignServiceRequestToTech(requestId, techName, deviceId) {
  // Optimistic UI update
  var snapshot = applyOptimisticUpdate(requestId, {
    status: 'in-progress',
    technicianName: techName,
    assignedAt: new Date().toISOString()
  });
  showToast('Assigning to ' + techName + '...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      showToast('Assigned to ' + techName, 'success');
      if (result && result.updatedRequest) {
        mergeServerUpdate(result.updatedRequest);
      }
      // Refresh modal
      if (deviceId) showEnhancedDeviceModal(deviceId);
    })
    .withFailureHandler(function(error) {
      revertOptimisticUpdate(snapshot);
      showToast('Error assigning: ' + error.message, 'error');
    })
    .assignServiceRequest(requestId, techName);
}

// Unassign SNMP trap
function unassignTrap(trapId, deviceId) {
  google.script.run
    .withSuccessHandler(function(result) {
      showToast('Assignment removed', 'success');
      loadTraps().then(function() {
        renderTrapsList();
        renderDashboard();
        updateAllStats();
        renderDeviceMarkers();
        if (deviceId) showEnhancedDeviceModal(deviceId);
      });
    })
    .withFailureHandler(function(err) {
      showToast('Error: ' + err.message, 'error');
    })
    .unassignTrap(trapId);
}

// Unassign service request
function unassignServiceRequest(requestId, deviceId) {
  // Optimistic UI update
  var snapshot = applyOptimisticUpdate(requestId, {
    status: 'pending',
    technicianName: '',
    technicianId: '',
    assignedAt: ''
  });

  google.script.run
    .withSuccessHandler(function(result) {
      showToast('Assignment removed', 'success');
      if (result && result.updatedRequest) {
        mergeServerUpdate(result.updatedRequest);
      }
      if (deviceId) showEnhancedDeviceModal(deviceId);
    })
    .withFailureHandler(function(error) {
      revertOptimisticUpdate(snapshot);
      showToast('Error: ' + error.message, 'error');
    })
    .unassignServiceRequest(requestId);
}

// Complete service request directly from device modal
function completeServiceRequestDirect(requestId) {
  // Optimistic UI update
  var snapshot = applyOptimisticUpdate(requestId, {
    status: 'completed',
    completedAt: new Date().toISOString()
  });
  showToast('Completing request...', 'info');
  google.script.run
    .withSuccessHandler(function(result) {
      showToast('Request completed', 'success');
      if (result && result.updatedRequest) {
        mergeServerUpdate(result.updatedRequest);
      }
      // Refresh the modal if still open
      var modal = document.getElementById('device-modal');
      if (modal && modal.classList.contains('active')) {
        var deviceName = document.getElementById('modal-device-name').textContent;
        var device = state.devices.find(function(d) { return d.name === deviceName; });
        if (device) showEnhancedDeviceModal(device.id);
      }
    })
    .withFailureHandler(function(error) {
      revertOptimisticUpdate(snapshot);
      showToast('Error: ' + error.message, 'error');
    })
    .completeServiceRequest(requestId, 'Completed from device modal');
}

// Resolve all alerts for a device (both SNMP and service requests)
function resolveAllDeviceAlerts(deviceId, deviceIp) {
  showConfirmCard({
    title: 'Resolve All Alerts',
    message: 'Mark all alerts for this device as resolved?',
    type: 'info',
    confirmText: 'Resolve All',
    onConfirm: function() {
      showToast('Resolving all alerts...', 'info');
      google.script.run
        .withSuccessHandler(function(result) {
          var deviceServiceRequests = (serviceRequestsData || []).filter(function(sr) {
            return (sr.deviceId === deviceId) && (sr.status === 'pending' || sr.status === 'in-progress');
          });
          var promises = deviceServiceRequests.map(function(sr) {
            return new Promise(function(resolve) {
              google.script.run
                .withSuccessHandler(resolve)
                .withFailureHandler(resolve)
                .completeServiceRequest(sr.id, 'Bulk resolved');
            });
          });
          Promise.all(promises).then(function() {
            showToast('All alerts resolved', 'success');
            loadTraps();
            loadServiceRequests();
            closeDeviceModal();
            renderDeviceMarkers();
            updateAllStats();
          });
        })
        .withFailureHandler(function(err) {
          showToast('Error resolving alerts', 'error');
        })
        .resolveTrapsByIp(deviceIp, state.currentTechName || 'User');
    }
  });
}

// Show email modal for device
function showEmailDeviceModal(deviceId) {
  var device = state.devices.find(function(d) { return d.id === deviceId; });
  if (!device) return;

  var deviceTraps = state.traps.filter(function(t) { return t.sourceIp === device.ip && t.processed === 0; });
  var issueText = 'Requesting maintenance/repair';
  if (deviceTraps.length > 0) {
    var firstTrap = deviceTraps[0];
    issueText = (firstTrap.parsedMessage && firstTrap.parsedMessage !== 'Device Alert') ? firstTrap.parsedMessage : extractTrapDescription(firstTrap);
  }
  var supplyText = 'N/A';
  if (device.supplies && device.supplies.length > 0) {
    supplyText = device.supplies.map(function(s) { return '- ' + s.name + ': ' + s.percentage + '%'; }).join('\n');
  }
  var defaultMessage = 'Device: ' + device.name + '\nModel: ' + (device.model || 'N/A') + '\nIP: ' + device.ip + '\nLocation: ' + (device.location || 'N/A') + '\n\nIssue: ' + issueText + '\n\nSupply Levels:\n' + supplyText;

  var modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'email-device-modal';
  modal.innerHTML = '<div class="modal-backdrop" onclick="closeEmailDeviceModal()"></div>' +
    '<div class="modal-content" style="max-width:560px;">' +
    '<div class="modal-header">' +
    '<h3><i data-lucide="mail"></i> Contact Manufacturer</h3>' +
    '<button class="modal-close" onclick="closeEmailDeviceModal()"><i data-lucide="x"></i></button>' +
    '</div>' +
    '<div class="modal-body">' +
    '<div class="form-group">' +
    '<label>Manufacturer Email <span style="color:#dc2626;">*</span></label>' +
    '<input type="email" id="mfg-email" placeholder="manufacturer@example.com" value="' + escapeHtml(device.manufacturerEmail || '') + '">' +
    '</div>' +
    '<div class="form-group">' +
    '<label>CC <span style="color:var(--text-secondary);font-weight:400;font-size:12px;">(separate multiple with commas)</span></label>' +
    '<input type="text" id="mfg-cc" placeholder="manager@school.org, tech@school.org">' +
    '</div>' +
    '<div class="form-group">' +
    '<label>Subject</label>' +
    '<input type="text" id="mfg-subject" value="Repair Request: ' + escapeHtml(device.name) + ' - ' + escapeHtml(device.model || 'Device') + '">' +
    '</div>' +
    '<div class="form-group">' +
    '<label>Message</label>' +
    '<textarea id="mfg-message" rows="8">' + escapeHtml(defaultMessage) + '</textarea>' +
    '</div>' +
    '</div>' +
    '<div class="modal-footer" style="justify-content:space-between;">' +
    '<button class="btn btn-ghost" onclick="closeEmailDeviceModal()">Cancel</button>' +
    '<div style="display:flex;gap:8px;">' +
    '<button class="btn btn-outline" onclick="previewManufacturerEmail(\'' + device.id + '\')"><i data-lucide="eye"></i> Preview</button>' +
    '<button class="btn btn-primary" onclick="sendManufacturerEmailFromModal(\'' + device.id + '\')"><i data-lucide="send"></i> Send</button>' +
    '</div>' +
    '</div>' +
    '</div>';

  document.body.appendChild(modal);
  lucide.createIcons();
}

function closeEmailDeviceModal() {
  var modal = document.getElementById('email-device-modal');
  if (modal) modal.remove();
}

function sendManufacturerEmailFromModal(deviceId) {
  var email = document.getElementById('mfg-email').value.trim();
  var cc = document.getElementById('mfg-cc').value.trim();
  var subject = document.getElementById('mfg-subject').value.trim();
  var message = document.getElementById('mfg-message').value;

  if (!email) {
    showToast('Please enter manufacturer email', 'warning');
    return;
  }

  showToast('Sending email...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        showToast('Email sent successfully!', 'success');
        closeEmailDeviceModal();
      } else {
        showToast(result.error || 'Error sending email', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error sending email: ' + err.message, 'error');
    })
    .sendManufacturerEmail(deviceId, email, message, cc, subject);
}

function previewManufacturerEmail(deviceId) {
  var message = document.getElementById('mfg-message').value;
  showToast('Loading preview...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        showEmailPreview(result.html);
      } else {
        showToast('Preview failed', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Preview error: ' + err.message, 'error');
    })
    .previewManufacturerEmail(deviceId, message);
}

// Calculate device health score based on supplies and status
function calculateDeviceHealth(device) {
  if (device.status === 'offline') return 0;

  if (!device.supplies || device.supplies.length === 0) {
    return device.status === 'online' ? 100 : 50;
  }

  // Calculate average using display percentages (properly handles waste toner)
  var totalDisplay = 0;
  device.supplies.forEach(function(s) {
    var info = getSupplyDisplayInfo(s);
    totalDisplay += info.displayPercentage;
  });
  const avgSupply = totalDisplay / device.supplies.length;

  // Penalize for low supplies (using display percentages)
  var minSupply = 100;
  device.supplies.forEach(function(s) {
    var info = getSupplyDisplayInfo(s);
    if (info.displayPercentage < minSupply) {
      minSupply = info.displayPercentage;
    }
  });
  const penalty = minSupply < 10 ? 20 : minSupply < 20 ? 10 : 0;

  // Factor in unresolved traps
  const trapCount = state.traps.filter(t => t.sourceIp === device.ip && t.processed === 0).length;
  const trapPenalty = trapCount * 5;

  return Math.max(0, Math.round(avgSupply - penalty - trapPenalty));
}

function getHealthClass(score) {
  if (score >= 75) return 'excellent';
  if (score >= 50) return 'good';
  if (score >= 25) return 'warning';
  return 'critical';
}

/**
 * Get supply display info - handles Waste Toner specially
 * Waste Toner: 0% from copier = empty container (good, show as 100%)
 *              100% from copier = full container (bad, show as 0%)
 * For waste toner, we invert the display and use different color thresholds
 */
function getSupplyDisplayInfo(supply) {
  var name = supply.name || '';
  var rawPercentage = supply.percentage || 0;
  var isWasteToner = /waste/i.test(name);

  var displayPercentage, levelClass, barColor;

  if (isWasteToner) {
    // Invert waste toner: 0% full = 100% capacity remaining, 100% full = 0% capacity remaining
    displayPercentage = 100 - rawPercentage;

    // Color thresholds for waste toner (based on capacity remaining):
    // 100-40% remaining = green (container 0-60% full)
    // 40-20% remaining = orange (container 60-80% full)
    // 20-0% remaining = red (container 80-100% full)
    if (displayPercentage > 40) {
      levelClass = 'high';
      barColor = '#22c55e'; // green
    } else if (displayPercentage > 20) {
      levelClass = 'medium';
      barColor = '#f59e0b'; // orange
    } else if (displayPercentage > 10) {
      levelClass = 'low';
      barColor = '#f97316'; // dark orange
    } else {
      levelClass = 'critical';
      barColor = '#ef4444'; // red
    }
  } else {
    // Normal supply (toner, etc): higher percentage = better
    displayPercentage = rawPercentage;

    if (displayPercentage > 50) {
      levelClass = 'high';
      barColor = '#22c55e'; // green
    } else if (displayPercentage > 20) {
      levelClass = 'medium';
      barColor = '#f59e0b'; // orange
    } else if (displayPercentage > 5) {
      levelClass = 'low';
      barColor = '#f97316'; // dark orange
    } else {
      levelClass = 'critical';
      barColor = '#ef4444'; // red
    }
  }

  return {
    displayPercentage: displayPercentage,
    levelClass: levelClass,
    barColor: barColor,
    isWasteToner: isWasteToner
  };
}

function getHealthText(score) {
  if (score >= 75) return '✓ Operating Normally';
  if (score >= 50) return '⚠ Attention Recommended';
  if (score >= 25) return '⚠ Service Required Soon';
  return '✗ Critical - Immediate Attention Needed';
}

function setViewMode(mode, deviceId) {
  state.viewMode = mode;
  showEnhancedDeviceModal(deviceId);
}

// Send email to manufacturer
function sendManufacturerEmail(deviceId) {
  var device = state.devices.find(function(d) { return d.id === deviceId; });
  if (!device) return;

  var email = document.getElementById('manufacturer-email').value;
  var message = document.getElementById('manufacturer-message').value;

  if (!email) {
    showToast('Please enter manufacturer email', 'warning');
    return;
  }

  // Save manufacturer email to device
  device.manufacturerEmail = email;

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        showToast('Repair request sent successfully!', 'success');
      } else {
        showToast(result.error || 'Error sending email', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error sending email', 'error');
    })
    .sendManufacturerEmail(deviceId, email, message);
}

function closeDeviceModal() {
  document.getElementById('device-modal').classList.remove('active');
  // Stop live activity polling when modal closes
  stopAllLiveActivityPolling();

  // Re-show alert tooltip overlay
  var tooltipOverlay = document.getElementById('alert-tooltip-overlay');
  if (tooltipOverlay) {
    tooltipOverlay.style.display = '';
    // Refresh tooltip positions
    if (typeof updateAlertTooltipOverlay === 'function') {
      updateAlertTooltipOverlay();
    }
  }
}

// ============================================
// Printer Web Page Viewer
// ============================================
function openPrinterWebPage(ip, deviceName) {
  if (!ip) {
    showToast('No IP address available for this device', 'warning');
    return;
  }

  // Build the printer URL (most printers use HTTP on port 80)
  var printerUrl = 'http://' + ip;

  // Open directly in new tab - iframes don't work due to browser security
  // (HTTPS apps can't load HTTP content in iframes)
  window.open(printerUrl, '_blank');
  showToast('Opening ' + deviceName + ' web interface...', 'info');
}

// Legacy functions kept for compatibility
function openPrinterInNewTab() {
  if (window._currentPrinterUrl) {
    window.open(window._currentPrinterUrl, '_blank');
  }
}

function closePrinterWebModal() {
  var modal = document.getElementById('printer-web-modal');
  if (modal) {
    modal.classList.remove('active');
  }
}

// Old iframe-based approach (kept for reference but not used)
function openPrinterWebPageIframe(ip, deviceName) {
  // This doesn't work due to browser security - HTTPS can't embed HTTP iframes
  // Set a timeout - if iframe doesn't load in 10 seconds, show message
  window._printerLoadTimeout = setTimeout(function() {
    var loadingEl = document.getElementById('printer-iframe-loading');
    if (loadingEl && loadingEl.style.display !== 'none') {
      loadingEl.innerHTML = `
        <p style="color: #f59e0b; font-weight: 600;">⚠️ Unable to load in iframe</p>
        <p>The printer's web page may be blocked by browser security.</p>
        <button class="btn btn-primary" onclick="openPrinterInNewTab()">
          <i data-lucide="external-link"></i> Open in New Tab
        </button>
      `;
      lucide.createIcons();
    }
  }, 10000);
}

function onPrinterFrameLoad() {
  clearTimeout(window._printerLoadTimeout);
  var loadingEl = document.getElementById('printer-iframe-loading');
  var iframe = document.getElementById('printer-web-iframe');
  if (loadingEl) loadingEl.style.display = 'none';
  if (iframe) iframe.style.opacity = '1';
}

function onPrinterFrameError() {
  clearTimeout(window._printerLoadTimeout);
  var loadingEl = document.getElementById('printer-iframe-loading');
  if (loadingEl) {
    loadingEl.innerHTML = `
      <p style="color: #ef4444; font-weight: 600;">❌ Failed to load printer page</p>
      <p>The printer may be offline or unreachable.</p>
      <button class="btn btn-primary" onclick="openPrinterInNewTab()">
        <i data-lucide="external-link"></i> Try in New Tab
      </button>
    `;
    loadingEl.style.display = 'flex';
    lucide.createIcons();
  }
}

function openPrinterInNewTab() {
  if (window._currentPrinterUrl) {
    window.open(window._currentPrinterUrl, '_blank');
  }
}

function refreshPrinterFrame() {
  var iframe = document.getElementById('printer-web-iframe');
  var loadingEl = document.getElementById('printer-iframe-loading');
  if (iframe && window._currentPrinterUrl) {
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="spinner"></div>
        <p>Loading printer interface...</p>
        <p class="printer-loading-hint">If the page doesn't load, click "Open in New Tab" above.</p>
      `;
      loadingEl.style.display = 'flex';
    }
    iframe.style.opacity = '0';
    iframe.src = window._currentPrinterUrl;
  }
}

function closePrinterWebModal() {
  clearTimeout(window._printerLoadTimeout);
  var modal = document.getElementById('printer-web-modal');
  if (modal) {
    modal.classList.remove('active');
    // Clear iframe src to stop any loading
    var iframe = document.getElementById('printer-web-iframe');
    if (iframe) iframe.src = 'about:blank';
  }
}

// ============================================
// Add/Edit Device Modal
// ============================================
// --- Device Picker (place existing device on map) ---
var pickerPlaceX = 0;
var pickerPlaceY = 0;

function showAddDeviceModal(x, y) {
  x = x || 0;
  y = y || 0;

  // If we have existing devices, show the picker first so user can choose one
  if (state.devices.length > 0 && (x !== 0 || y !== 0)) {
    pickerPlaceX = x;
    pickerPlaceY = y;
    showDevicePicker();
    return;
  }

  // No devices or called without coordinates (e.g. from "Add Device" button) — go straight to form
  openAddDeviceForm(x, y);
}

function openAddDeviceForm(x, y) {
  var modal = document.getElementById('add-device-modal');
  var title = document.getElementById('add-device-title');
  var form = document.getElementById('device-form');

  title.textContent = 'Add New Device';
  form.reset();

  document.getElementById('device-id').value = '';
  document.getElementById('device-x').value = x || 0;
  document.getElementById('device-y').value = y || 0;
  document.getElementById('device-blueprint-id').value = state.activeBlueprint;

  // Pre-select device type if we're on a specific device type tab
  var preSelectedType = null;
  if (state.activeDeviceType && state.activeDeviceType !== 'all') {
    var activeType = deviceTypesData.find(function(dt) { return dt.id === state.activeDeviceType; });
    if (activeType) {
      preSelectedType = activeType.name;
    }
  }
  populateDeviceTypeDropdown(preSelectedType);

  modal.classList.add('active');
  lucide.createIcons();
}

function showDevicePicker() {
  var modal = document.getElementById('device-picker-modal');
  var searchInput = document.getElementById('device-picker-search');
  if (searchInput) searchInput.value = '';
  renderDevicePickerList('');
  modal.classList.add('active');
  lucide.createIcons();
  if (searchInput) searchInput.focus();
}

function closeDevicePicker() {
  var modal = document.getElementById('device-picker-modal');
  if (modal) modal.classList.remove('active');
}

function filterDevicePicker(query) {
  renderDevicePickerList(query);
}

function renderDevicePickerList(query) {
  var container = document.getElementById('device-picker-list');
  if (!container) return;

  var q = (query || '').toLowerCase().trim();

  // Split devices into unplaced (no X/Y or not on any blueprint) and already placed
  var unplaced = [];
  var placed = [];

  state.devices.forEach(function(d) {
    var hasPosition = (d.x !== undefined && d.x !== null && d.x !== '' &&
                       d.y !== undefined && d.y !== null && d.y !== '');
    var onCurrentMap = hasPosition && (d.blueprintId || 'blueprint1') === state.activeBlueprint;

    // Filter by search query
    if (q) {
      var searchStr = ((d.name || '') + ' ' + (d.ip || '') + ' ' + (d.location || '') + ' ' + (d.model || '')).toLowerCase();
      if (searchStr.indexOf(q) === -1) return;
    }

    if (!hasPosition) {
      unplaced.push(d);
    } else if (onCurrentMap) {
      placed.push({ device: d, label: 'On this map' });
    } else {
      placed.push({ device: d, label: 'On another map' });
    }
  });

  var html = '';

  if (unplaced.length === 0 && placed.length === 0) {
    html = '<div class="device-picker-empty">' +
      (q ? 'No devices match your search.' : 'No devices found. Create a new one below.') +
      '</div>';
    container.innerHTML = html;
    return;
  }

  // Unplaced devices section (priority)
  if (unplaced.length > 0) {
    html += '<div class="device-picker-section-label">Not on any map (' + unplaced.length + ')</div>';
    unplaced.forEach(function(d) {
      html += buildPickerItem(d, false, 'Not placed');
    });
  }

  // Already placed devices section
  if (placed.length > 0) {
    html += '<div class="device-picker-section-label">Already placed (' + placed.length + ')</div>';
    placed.forEach(function(p) {
      html += buildPickerItem(p.device, true, p.label);
    });
  }

  container.innerHTML = html;
  lucide.createIcons();
}

function buildPickerItem(device, isPlaced, badgeText) {
  var iconClass = isPlaced ? 'placed' : 'unplaced';
  var badgeClass = isPlaced ? 'placed' : 'unplaced';
  var itemClass = isPlaced ? 'device-picker-item already-placed' : 'device-picker-item';
  var details = [];
  if (device.ip) details.push(device.ip);
  if (device.model) details.push(device.model);
  if (device.location) details.push(device.location);

  return '<div class="' + itemClass + '" onclick="pickerSelectDevice(\'' + device.id + '\')">' +
    '<div class="device-picker-icon ' + iconClass + '"><i data-lucide="printer"></i></div>' +
    '<div class="device-picker-info">' +
      '<div class="device-picker-name">' + escapeHtml(device.name) + '</div>' +
      '<div class="device-picker-details">' + escapeHtml(details.join(' · ')) + '</div>' +
    '</div>' +
    '<span class="device-picker-badge ' + badgeClass + '">' + badgeText + '</span>' +
  '</div>';
}

function pickerSelectDevice(deviceId) {
  var device = state.devices.find(function(d) { return d.id === deviceId; });
  if (!device) return;

  closeDevicePicker();

  // Update device position to the clicked map coordinates
  device.x = pickerPlaceX;
  device.y = pickerPlaceY;
  device.blueprintId = state.activeBlueprint;

  showToast('Placing "' + device.name + '" on map...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        showToast('"' + device.name + '" placed on map!', 'success');
        loadDevices().then(function() {
          updateAllStats();
          renderDeviceMarkers();
          renderDeviceTable();
          renderDashboard();
        });
      } else {
        showToast(result.error || 'Error placing device', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error placing device: ' + err.message, 'error');
    })
    .saveDevice(device);
}

function pickerCreateNewDevice() {
  closeDevicePicker();
  openAddDeviceForm(pickerPlaceX, pickerPlaceY);
}

function populateDeviceTypeDropdown(selectedValue) {
  var select = document.getElementById('device-type');
  if (!select) return;

  var options = '<option value="">Select type...</option>';

  if (deviceTypesData && deviceTypesData.length > 0) {
    deviceTypesData.forEach(function(dt) {
      if (dt.active !== false) {
        var selected = (selectedValue && dt.name.toLowerCase() === selectedValue.toLowerCase()) ? ' selected' : '';
        options += '<option value="' + dt.name.toLowerCase() + '"' + selected + '>' + escapeHtml(dt.name) + '</option>';
      }
    });
  } else {
    // Fallback to default types if no device types configured
    var defaults = ['Printer', 'Copier', 'Router', 'Switch', 'Access Point', 'Camera', 'Other'];
    defaults.forEach(function(type) {
      var value = type.toLowerCase().replace(' ', '-');
      var selected = (selectedValue && value === selectedValue.toLowerCase()) ? ' selected' : '';
      options += '<option value="' + value + '"' + selected + '>' + type + '</option>';
    });
  }

  select.innerHTML = options;
}

function editDevice(deviceId) {
  closeDeviceModal();

  var device = state.devices.find(function(d) { return d.id === deviceId; });
  if (!device) return;

  var modal = document.getElementById('add-device-modal');
  var title = document.getElementById('add-device-title');

  title.textContent = 'Edit Device';

  // Populate device type dropdown first, then set values
  populateDeviceTypeDropdown(device.type);

  document.getElementById('device-id').value = device.id;
  document.getElementById('device-name').value = device.name;
  document.getElementById('device-ip').value = device.ip;
  document.getElementById('device-model').value = device.model || '';
  document.getElementById('device-location').value = device.location || '';
  document.getElementById('device-machine-id').value = device.machineId || '';
  document.getElementById('device-serial').value = device.serialNumber || '';
  document.getElementById('device-x').value = device.x;
  document.getElementById('device-y').value = device.y;
  document.getElementById('device-blueprint-id').value = device.blueprintId || 'blueprint1';

  modal.classList.add('active');
  lucide.createIcons();
}

function closeAddDeviceModal() {
  document.getElementById('add-device-modal').classList.remove('active');
}

function saveDeviceForm(event) {
  event.preventDefault();

  const device = {
    id: document.getElementById('device-id').value || undefined,
    name: document.getElementById('device-name').value,
    ip: document.getElementById('device-ip').value,
    type: document.getElementById('device-type').value,
    model: document.getElementById('device-model').value,
    location: document.getElementById('device-location').value,
    machineId: document.getElementById('device-machine-id').value,
    serialNumber: document.getElementById('device-serial').value,
    x: parseFloat(document.getElementById('device-x').value) || 0,
    y: parseFloat(document.getElementById('device-y').value) || 0,
    blueprintId: document.getElementById('device-blueprint-id').value,
    status: 'unknown'
  };

  // Find existing device to preserve supplies and status
  const existing = state.devices.find(d => d.id === device.id);
  if (existing) {
    device.status = existing.status;
    device.supplies = existing.supplies;
    device.messages = existing.messages;
    device.lastSeen = existing.lastSeen;
  }

  google.script.run
    .withSuccessHandler(result => {
      if (result.success) {
        closeAddDeviceModal();
        showToast('Device saved successfully', 'success');
        loadDevices().then(() => {
          updateAllStats();
          renderDeviceMarkers();
          renderDeviceTable();
          renderDashboard();
        });
      } else {
        showToast(result.error || 'Error saving device', 'error');
      }
    })
    .withFailureHandler(err => {
      showToast('Error saving device', 'error');
    })
    .saveDevice(device);
}

function confirmDeleteDevice(deviceId) {
  showConfirmCard({
    title: 'Delete Device',
    message: 'Are you sure you want to delete this device?',
    type: 'danger',
    confirmText: 'Delete',
    onConfirm: function() {
      google.script.run
        .withSuccessHandler(result => {
          if (result.success) {
            closeDeviceModal();
            showToast('Device deleted', 'success');
            loadDevices().then(() => {
              updateAllStats();
              renderDeviceMarkers();
              renderDeviceTable();
              renderDashboard();
            });
          } else {
            showToast(result.error || 'Error deleting device', 'error');
          }
        })
        .withFailureHandler(err => {
          showToast('Error deleting device', 'error');
        })
        .deleteDevice(deviceId);
    }
  });
}

// ============================================
// Stats & Dashboard
// ============================================
function updateAllStats() {
  const total = state.devices.length;
  const online = state.devices.filter(d => d.status === 'online').length;
  const offline = state.devices.filter(d => d.status === 'offline').length;
  const issues = state.devices.filter(d => d.status === 'issue').length;
  const unresolvedTraps = state.traps.filter(t => t.processed === 0).length;

  // Quick stats
  document.getElementById('stat-online').textContent = online;
  document.getElementById('stat-offline').textContent = offline;
  document.getElementById('stat-issues').textContent = issues;
  document.getElementById('stat-traps').textContent = unresolvedTraps;

  // Ring progress charts
  updateRingProgress('ring-online', online, total, '#22c55e');
  updateRingProgress('ring-offline', offline, total, '#6b7280');
  updateRingProgress('ring-issues', issues, total, '#f59e0b');
  updateRingProgress('ring-traps', unresolvedTraps, state.traps.length || unresolvedTraps, '#ef4444');

  // Update issues count badge for Find Issues button
  updateIssuesCountBadge();
}

function updateRingProgress(id, value, total, color) {
  const ring = document.getElementById(id);
  if (!ring) return;

  const percent = total > 0 ? (value / total) * 100 : 0;
  const circle = ring.querySelector('.ring-fill');
  const offset = 283 - (283 * percent / 100);

  circle.style.strokeDashoffset = offset;
  circle.style.stroke = color;

  ring.querySelector('.ring-value').textContent = value;
  ring.querySelector('.ring-total').textContent = `/${total}`;
}

// Dashboard view state
var dashboardViewMode = 'overview';

function setDashboardView(viewMode) {
  dashboardViewMode = viewMode;

  // Update toggle buttons
  document.querySelectorAll('.view-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.view === viewMode);
  });

  // Render appropriate view
  renderDashboard();
}

function renderDashboard() {
  // Check view mode
  if (dashboardViewMode === 'cards') {
    renderCardViewDashboard();
    return;
  }

  if (dashboardViewMode === 'gauges') {
    renderGaugesViewDashboard();
    return;
  }

  // Default overview mode
  renderOverviewDashboard();
}

function renderOverviewDashboard() {
  // Show standard sections
  var overviewSection = document.getElementById('overview-section');
  if (overviewSection) overviewSection.style.display = 'block';

  // Device supply list
  var supplyList = document.getElementById('device-supply-list');
  var devicesWithSupplies = state.devices.filter(function(d) {
    return d.supplies && d.supplies.length > 0;
  });

  if (devicesWithSupplies.length === 0) {
    supplyList.innerHTML = '<div class="empty-state">' +
      '<i data-lucide="printer"></i>' +
      '<p>No devices with supply data</p>' +
      '</div>';
  } else {
    var html = '';
    devicesWithSupplies.forEach(function(device) {
      html += '<div class="supply-card" onclick="showDeviceModal(\'' + device.id + '\')">';
      html += '<div class="supply-card-header">';
      html += '<span class="supply-card-name">' + device.name + '</span>';
      html += '<span class="supply-card-status ' + device.status + '">' + device.status + '</span>';
      html += '</div>';

      device.supplies.slice(0, 4).forEach(function(s) {
        var supplyInfo = getSupplyDisplayInfo(s);
        var displayName = s.name.length > 15 ? s.name.substring(0, 15) + '...' : s.name;
        html += '<div class="supply-bar">';
        html += '<div class="supply-bar-header">';
        html += '<span class="supply-bar-name">' + displayName + '</span>';
        html += '<span class="supply-bar-value ' + supplyInfo.levelClass + '">' + supplyInfo.displayPercentage + '%</span>';
        html += '</div>';
        html += '<div class="supply-bar-track">';
        html += '<div class="supply-bar-fill ' + supplyInfo.levelClass + '" style="width: ' + supplyInfo.displayPercentage + '%"></div>';
        html += '</div></div>';
      });

      if (device.supplies.length > 4) {
        html += '<small style="color: var(--text-muted);">+' + (device.supplies.length - 4) + ' more</small>';
      }
      html += '</div>';
    });
    supplyList.innerHTML = html;
  }

  // Recent traps
  renderRecentTraps();

  lucide.createIcons();
}

function renderCardViewDashboard() {
  var container = document.getElementById('device-supply-list');
  if (!container) return;

  if (state.devices.length === 0) {
    container.innerHTML = '<div class="empty-state">' +
      '<i data-lucide="printer"></i>' +
      '<p>No devices added yet</p>' +
      '</div>';
    return;
  }

  var html = '<div class="card-view-container manufacturing-style">';

  state.devices.forEach(function(device) {
    var deviceTraps = state.traps.filter(function(t) {
      return t.sourceIp === device.ip && t.processed === 0;
    });
    var hasAlert = deviceTraps.length > 0;
    var assignedTo = hasAlert && deviceTraps[0].assignedTo ? deviceTraps[0].assignedTo : '';
    var healthScore = calculateDeviceHealth(device);
    var icon = getDeviceIcon(device.type);

    // Calculate efficiency metrics like Manufacturing dashboard
    var avgSupply = 0;
    if (device.supplies && device.supplies.length > 0) {
      var total = device.supplies.reduce(function(sum, s) { return sum + s.percentage; }, 0);
      avgSupply = Math.round(total / device.supplies.length);
    }
    var efficiencyScore = Math.round((healthScore + avgSupply) / 2);
    var uptimeScore = device.status === 'online' ? 100 : device.status === 'offline' ? 0 : 75;

    html += '<div class="mfg-card ' + (hasAlert ? 'has-alert' : '') + '">';

    // Card Header with status indicator
    html += '<div class="mfg-card-header">';
    html += '<div class="mfg-card-title-row">';
    html += '<div class="mfg-card-icon ' + (hasAlert ? 'alerting' : device.status) + '">' + icon + '</div>';
    html += '<div class="mfg-card-title">';
    html += '<h3>' + device.name + '</h3>';
    html += '<span class="mfg-card-location">' + (device.location || 'No location') + '</span>';
    html += '</div>';
    html += '<div class="mfg-status-badge ' + device.status + '">';
    html += '<span class="status-dot ' + device.status + '"></span>';
    html += device.status.charAt(0).toUpperCase() + device.status.slice(1);
    html += '</div>';
    html += '</div>';
    if (hasAlert) {
      var mfgAlertMsg = (deviceTraps[0].parsedMessage && deviceTraps[0].parsedMessage !== 'Device Alert') ? deviceTraps[0].parsedMessage : extractTrapDescription(deviceTraps[0]);
      html += '<div class="mfg-alert-strip">';
      html += '<span class="alert-icon">🚨</span>';
      html += '<span class="alert-text">' + deviceTraps.length + ' Alert' + (deviceTraps.length > 1 ? 's' : '') + ' - ' + mfgAlertMsg.substring(0, 40) + '</span>';
      html += '</div>';
    }
    html += '</div>';

    // Visualizations Row - Manufacturing Style
    html += '<div class="mfg-metrics-row">';

    // Semi-circle Gauge for Health (like Line Efficiency)
    html += '<div class="mfg-metric-item">';
    html += renderSemiGauge(healthScore, 'Health', getHealthColor(healthScore));
    html += '</div>';

    // Donut Chart for Supplies
    html += '<div class="mfg-metric-item">';
    html += renderDonutChart(avgSupply, 'Supplies', getHealthColor(avgSupply));
    html += '</div>';

    // Percentage Bar for Efficiency
    html += '<div class="mfg-metric-item">';
    html += renderPercentageBar(efficiencyScore, 'Efficiency');
    html += '</div>';

    html += '</div>';

    // Supply Level Bars (compact)
    if (device.supplies && device.supplies.length > 0) {
      html += '<div class="mfg-supplies-section">';
      html += '<div class="mfg-supplies-header">Supply Levels</div>';
      html += '<div class="mfg-supplies-grid">';
      device.supplies.slice(0, 4).forEach(function(s) {
        var supplyInfo = getSupplyDisplayInfo(s);
        html += '<div class="mfg-supply-item">';
        html += '<div class="mfg-supply-info">';
        html += '<span class="mfg-supply-name">' + s.name.substring(0, 10) + '</span>';
        html += '<span class="mfg-supply-value ' + supplyInfo.levelClass + '">' + supplyInfo.displayPercentage + '%</span>';
        html += '</div>';
        html += '<div class="mfg-supply-bar">';
        html += '<div class="mfg-supply-fill ' + supplyInfo.levelClass + '" style="width: ' + supplyInfo.displayPercentage + '%"></div>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
      html += '</div>';
    }

    // Action Buttons Row - Tech Assignment & Completion
    html += '<div class="mfg-card-actions">';

    if (hasAlert) {
      if (assignedTo) {
        // Show assigned tech and completion button
        html += '<div class="mfg-assigned-row">';
        html += '<div class="mfg-assigned-badge">';
        html += '<span class="assigned-avatar">' + assignedTo.charAt(0).toUpperCase() + '</span>';
        html += '<span class="assigned-name">' + assignedTo + '</span>';
        html += '<button class="btn-icon-sm" onclick="event.stopPropagation(); unassignDeviceTraps(\'' + device.ip + '\')" title="Unassign">';
        html += '<i data-lucide="x" style="width:14px;height:14px;"></i></button>';
        html += '</div>';
        html += '<button class="btn btn-success btn-sm mfg-complete-btn" onclick="event.stopPropagation(); markDeviceComplete(\'' + device.ip + '\')">';
        html += '<i data-lucide="check-circle" style="width:16px;height:16px;"></i> Mark Complete';
        html += '</button>';
        html += '</div>';
      } else {
        // Show tech assignment buttons
        html += '<div class="mfg-assign-row">';
        html += '<span class="assign-label">Assign to:</span>';
        html += '<div class="mfg-tech-buttons">';

        // Quick assign buttons for each technician
        if (state.technicians.length > 0) {
          state.technicians.slice(0, 3).forEach(function(tech) {
            var firstName = tech.name.split(' ')[0];
            html += '<button class="btn btn-tech" onclick="event.stopPropagation(); quickAssignToTech(\'' + device.ip + '\', \'' + tech.name + '\')">';
            html += '<span class="tech-avatar-sm">' + tech.name.charAt(0).toUpperCase() + '</span>';
            html += firstName;
            html += '</button>';
          });
        }

        // Assign to Me button
        html += '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); assignToMe(\'' + device.ip + '\')">';
        html += '<i data-lucide="user-plus" style="width:14px;height:14px;"></i> Me';
        html += '</button>';

        html += '</div>';
        html += '</div>';
      }
    } else {
      // No alerts - show view details button
      html += '<button class="btn btn-outline btn-sm" onclick="showEnhancedDeviceModal(\'' + device.id + '\')">';
      html += '<i data-lucide="eye" style="width:14px;height:14px;"></i> View Details';
      html += '</button>';
    }

    html += '</div>';

    html += '</div>';
  });

  html += '</div>';
  container.innerHTML = html;

  // Render recent traps
  renderRecentTraps();

  lucide.createIcons();
}

// Render Semi-circle Gauge (like Manufacturing Line Efficiency) - Compact version
function renderSemiGauge(value, label, color) {
  var circumference = Math.PI * 50; // Semi-circle (smaller)
  var offset = circumference - (circumference * value / 100);

  var html = '<div class="semi-gauge-container">';
  html += '<svg width="70" height="45" viewBox="0 0 70 45">';
  html += '<path class="semi-gauge-bg" d="M 7 40 A 28 28 0 0 1 63 40" fill="none" stroke-width="7" stroke-linecap="round"/>';
  html += '<path class="semi-gauge-fill" d="M 7 40 A 28 28 0 0 1 63 40" fill="none" stroke-width="7" stroke-linecap="round" style="stroke: ' + color + '; stroke-dasharray: ' + circumference + '; stroke-dashoffset: ' + offset + ';"/>';
  html += '</svg>';
  html += '<div class="semi-gauge-value" style="color: ' + color + '">' + value + '%</div>';
  html += '<div class="semi-gauge-label">' + label + '</div>';
  html += '</div>';
  return html;
}

// Render Donut Chart - Compact version
function renderDonutChart(value, label, color) {
  var circumference = 2 * Math.PI * 25;
  var offset = circumference - (circumference * value / 100);

  var html = '<div class="donut-container">';
  html += '<svg width="60" height="60" viewBox="0 0 60 60">';
  html += '<circle class="donut-bg" cx="30" cy="30" r="25" fill="none" stroke-width="7"/>';
  html += '<circle class="donut-fill" cx="30" cy="30" r="25" fill="none" stroke-width="7" stroke-linecap="round" style="stroke: ' + color + '; stroke-dasharray: ' + circumference + '; stroke-dashoffset: ' + offset + '; transform: rotate(-90deg); transform-origin: center;"/>';
  html += '</svg>';
  html += '<div class="donut-center-content">';
  html += '<span class="donut-value" style="color: ' + color + '">' + value + '</span>';
  html += '<span class="donut-unit">%</span>';
  html += '</div>';
  html += '<div class="donut-label">' + label + '</div>';
  html += '</div>';
  return html;
}

// Render Percentage Bar (horizontal) - Compact version
function renderPercentageBar(value, label) {
  var levelClass = value > 75 ? 'excellent' : value > 50 ? 'good' : value > 25 ? 'warning' : 'critical';

  var html = '<div class="pct-bar-container">';
  html += '<div class="pct-bar-header">';
  html += '<span class="pct-bar-label">' + label + '</span>';
  html += '<span class="pct-bar-value ' + levelClass + '">' + value + '%</span>';
  html += '</div>';
  html += '<div class="pct-bar-track">';
  html += '<div class="pct-bar-fill ' + levelClass + '" style="width: ' + value + '%"></div>';
  html += '</div>';
  html += '</div>';
  return html;
}

// Quick assign to a specific technician
function quickAssignToTech(deviceIp, techName) {
  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        showToast('Assigned to ' + techName, 'success');
        loadTraps().then(function() {
          renderTrapsList();
          renderDashboard();
          updateAllStats();
          renderDeviceMarkers();
        });
      } else {
        showToast(result.error || 'Error assigning', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error assigning', 'error');
    })
    .assignTrapsByIp(deviceIp, techName);
}

// Mark device alerts as complete
function markDeviceComplete(deviceIp) {
  showConfirmCard({
    title: 'Complete Alerts',
    message: 'Mark all alerts for this device as complete?',
    type: 'info',
    confirmText: 'Complete All',
    onConfirm: function() {
      google.script.run
        .withSuccessHandler(function(result) {
          if (result.success) {
            showToast(result.resolved + ' alert(s) marked as complete', 'success');
            loadTraps().then(function() {
              renderTrapsList();
              renderDashboard();
              updateAllStats();
              renderDeviceMarkers();
            });
          } else {
            showToast(result.error || 'Error completing alerts', 'error');
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error completing alerts', 'error');
        })
        .resolveTrapsByIp(deviceIp, state.currentTechName || 'User');
    }
  });
}

function renderGaugesViewDashboard() {
  var container = document.getElementById('device-supply-list');
  if (!container) return;

  if (state.devices.length === 0) {
    container.innerHTML = '<div class="empty-state">' +
      '<i data-lucide="printer"></i>' +
      '<p>No devices added yet</p>' +
      '</div>';
    return;
  }

  var html = '<div class="gauges-view-container">';

  state.devices.forEach(function(device) {
    var healthScore = calculateDeviceHealth(device);
    var gaugeOffset = 283 - (283 * healthScore / 100);
    var healthClass = getHealthClass(healthScore);
    var deviceTraps = state.traps.filter(function(t) {
      return t.sourceIp === device.ip && t.processed === 0;
    });
    var hasAlert = deviceTraps.length > 0;
    var color = getHealthColor(healthScore);

    html += '<div class="gauge-card ' + (hasAlert ? 'has-alert' : '') + '" onclick="showEnhancedDeviceModal(\'' + device.id + '\')">';

    // Main gauge
    html += '<div class="gauge-card-gauge">';
    html += '<svg class="gauge-svg" viewBox="0 0 100 100" width="100" height="100">';
    html += '<circle class="gauge-bg" cx="50" cy="50" r="45"/>';
    html += '<circle class="gauge-fill ' + healthClass + '" cx="50" cy="50" r="45" style="stroke-dashoffset: ' + gaugeOffset + '"/>';
    html += '</svg>';
    html += '<div class="gauge-center">';
    html += '<span class="gauge-value" style="color: ' + color + '">' + healthScore + '</span>';
    html += '<span class="gauge-label">%</span>';
    html += '</div></div>';

    // Device info
    html += '<div class="gauge-card-info">';
    html += '<h4>' + device.name + '</h4>';
    html += '<p>' + (device.model || device.type) + '</p>';
    if (hasAlert) {
      var gaugeAlertMsg = (deviceTraps[0].parsedMessage && deviceTraps[0].parsedMessage !== 'Device Alert') ? deviceTraps[0].parsedMessage : extractTrapDescription(deviceTraps[0]);
      html += '<div class="gauge-card-alert">🚨 ' + gaugeAlertMsg.substring(0, 25) + '</div>';
    }
    html += '</div>';

    html += '</div>';
  });

  html += '</div>';
  container.innerHTML = html;

  // Render recent traps
  renderRecentTraps();

  lucide.createIcons();
}

function getHealthColor(score) {
  if (score >= 75) return 'var(--success)';
  if (score >= 50) return '#84cc16';
  if (score >= 25) return 'var(--warning)';
  return 'var(--danger)';
}

function renderRecentTraps() {
  const container = document.getElementById('recent-traps');
  const recentTraps = state.traps.slice(0, 5);

  if (recentTraps.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="bell-off"></i>
        <p>No recent traps</p>
      </div>
    `;
  } else {
    container.innerHTML = recentTraps.map(trap => {
      const timeAgo = getTimeAgo(trap.receivedAt);
      const device = state.devices.find(d => d.ip === trap.sourceIp);
      const displayMsg = (trap.parsedMessage && trap.parsedMessage !== 'Device Alert') ? trap.parsedMessage : extractTrapDescription(trap);

      return `
        <div class="trap-item">
          <div class="trap-icon">🚨</div>
          <div class="trap-info">
            <span class="trap-ip">${trap.sourceIp}</span>
            <span class="trap-message">${displayMsg}</span>
            <span class="trap-time">${timeAgo}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  lucide.createIcons();
}

// ============================================
// Device Table
// ============================================
function getFilteredDevices() {
  var searchInput = document.getElementById('devices-search');
  var searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

  if (!searchTerm) {
    return state.devices;
  }

  return state.devices.filter(function(d) {
    return (d.name && d.name.toLowerCase().includes(searchTerm)) ||
           (d.ip && d.ip.toLowerCase().includes(searchTerm)) ||
           (d.model && d.model.toLowerCase().includes(searchTerm)) ||
           (d.machineId && String(d.machineId).toLowerCase().includes(searchTerm)) ||
           (d.serialNumber && String(d.serialNumber).toLowerCase().includes(searchTerm)) ||
           (d.location && d.location.toLowerCase().includes(searchTerm)) ||
           (d.status && d.status.toLowerCase().includes(searchTerm)) ||
           (d.type && d.type.toLowerCase().includes(searchTerm));
  });
}

function filterDevices() {
  renderDeviceTable();
}

function renderDeviceTable() {
  const tbody = document.getElementById('devices-table-body');
  var filtered = getFilteredDevices();

  if (state.devices.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">
          <div class="empty-state">
            <i data-lucide="printer"></i>
            <p>No devices added yet</p>
          </div>
        </td>
      </tr>
    `;
  } else if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">
          <div class="empty-state">
            <i data-lucide="search"></i>
            <p>No devices match your search</p>
          </div>
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = filtered.map(device => `
      <tr>
        <td>
          <span class="status-badge ${device.status}">
            <span class="dot"></span>
            ${device.status}
          </span>
        </td>
        <td><strong>${device.name}</strong></td>
        <td style="font-family: monospace;">${device.ip}</td>
        <td>${device.model || '-'}</td>
        <td>${device.machineId || '-'}</td>
        <td style="font-family: monospace; font-size:12px;">${device.serialNumber || '-'}</td>
        <td>${device.location || '-'}</td>
        <td>${device.lastSeen ? new Date(device.lastSeen).toLocaleString() : '-'}</td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-ghost btn-sm" onclick="editDevice('${device.id}')">
              <i data-lucide="edit-2" style="width:16px;height:16px;"></i>
            </button>
            <button class="btn btn-ghost btn-sm" onclick="confirmDeleteDevice('${device.id}')">
              <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  lucide.createIcons();
}

// ============================================
// Traps Management
// ============================================
function renderTrapsList() {
  const container = document.getElementById('traps-list');

  if (state.traps.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="bell-off"></i>
        <p>No SNMP traps received</p>
      </div>
    `;
  } else {
    container.innerHTML = state.traps.map(trap => {
      const timeAgo = getTimeAgo(trap.receivedAt);
      const isUnresolved = trap.processed === 0;
      const displayMsg = (trap.parsedMessage && trap.parsedMessage !== 'Device Alert') ? trap.parsedMessage : extractTrapDescription(trap);

      return `
        <div class="trap-card ${isUnresolved ? 'unresolved' : ''}">
          <div class="trap-card-icon">🚨</div>
          <div class="trap-card-content">
            <div class="trap-card-header">
              <span class="trap-card-ip">${trap.sourceIp}</span>
              <span class="trap-card-time">${timeAgo}</span>
            </div>
            <div class="trap-card-message">${displayMsg}</div>
            <div class="trap-card-date">${new Date(trap.receivedAt).toLocaleString()}</div>
          </div>
          <div class="trap-card-actions">
            <button class="btn btn-ghost btn-sm" onclick="zoomToDeviceByIp('${trap.sourceIp}')" title="Locate on map">
              <i data-lucide="scan"></i>
            </button>
            ${isUnresolved ? `
              <button class="btn btn-sm" style="background: var(--warning); color: #fff; border: none;" onclick="createTrapTicket('${trap.sourceIp}', '${displayMsg.replace(/'/g, "\\'")}', '${trap.id}')" title="Create service ticket">
                <i data-lucide="ticket"></i> Ticket
              </button>
              <button class="btn btn-outline btn-sm" onclick="resolveTrap('${trap.id}')">
                <i data-lucide="check"></i> Resolve
              </button>
            ` : `
              <span style="color: var(--success); font-size: 0.875rem;">✓ Resolved</span>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  updateTrapBadge();
  lucide.createIcons();
}

function updateTrapBadge() {
  const unresolvedCount = state.traps.filter(t => t.processed === 0).length;
  const badge = document.getElementById('trap-badge');

  if (unresolvedCount > 0) {
    badge.textContent = unresolvedCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function resolveTrap(trapId) {
  google.script.run
    .withSuccessHandler(result => {
      if (result.success) {
        showToast('Trap resolved', 'success');
        loadTraps().then(() => {
          renderTrapsList();
          renderDashboard();
          updateAllStats();
          renderDeviceMarkers();
        });
      }
    })
    .withFailureHandler(err => {
      showToast('Error resolving trap', 'error');
    })
    .resolveTrap(trapId, 'User');
}

function createTrapTicket(sourceIp, message, trapId) {
  // Find the device by IP
  var device = state.devices.find(function(d) { return (d.ip || '').trim() === sourceIp; });
  var deviceName = device ? device.name : sourceIp;
  var deviceId = device ? device.id : '';
  var location = device ? device.location : '';

  // Build the issue label from the trap message
  var issueLabel = message || 'Device Alert';
  var issueType = 'printer_alert';

  // Categorize the issue
  if (/toner/i.test(message)) issueType = 'toner';
  else if (/paper|tray|input/i.test(message)) issueType = 'paper';
  else if (/jam|misfeed/i.test(message)) issueType = 'paper_jam';
  else if (/cover|door/i.test(message)) issueType = 'cover_open';
  else if (/drum/i.test(message)) issueType = 'drum';
  else if (/waste/i.test(message)) issueType = 'waste_toner';
  else if (/fuser/i.test(message)) issueType = 'fuser';
  else if (/offline/i.test(message)) issueType = 'offline';
  else if (/service/i.test(message)) issueType = 'service_call';

  showConfirmCard({
    title: 'Create Service Ticket',
    message: '<b>' + deviceName + '</b> (' + sourceIp + ')<br><br>' +
      '<b>Issue:</b> ' + issueLabel + '<br>' +
      '<b>Location:</b> ' + (location || 'Unknown') + '<br><br>' +
      'This will create a service request ticket for this issue.',
    confirmText: 'Create Ticket',
    type: 'info',
    onConfirm: function() {
      showToast('Creating ticket...', 'info');

      google.script.run
        .withSuccessHandler(function(result) {
          if (result.success) {
            showToast('Ticket created for ' + deviceName + ': ' + issueLabel, 'success');
            // Also resolve the trap since a ticket was created
            resolveTrap(trapId);
          } else {
            showToast('Error: ' + (result.error || 'Failed to create ticket'), 'error');
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error creating ticket: ' + err.message, 'error');
        })
        .createServiceRequest({
          deviceId: deviceId,
          deviceName: deviceName,
          location: location,
          issueType: issueType,
          issueLabel: issueLabel,
          notes: 'Auto-created from SNMP trap alert: ' + message + ' (Trap ID: ' + trapId + ')',
          employeeId: '',
          employeeName: 'System (SNMP Alert)',
          employeeEmail: ''
        });
    }
  });
}

function resolveDeviceTraps(ip) {
  google.script.run
    .withSuccessHandler(result => {
      if (result.success) {
        showToast(`${result.resolved} trap(s) resolved`, 'success');
        loadTraps().then(() => {
          closeDeviceModal();
          renderTrapsList();
          renderDashboard();
          updateAllStats();
          renderDeviceMarkers();
        });
      }
    })
    .withFailureHandler(err => {
      showToast('Error resolving traps', 'error');
    })
    .resolveTrapsByIp(ip, 'User');
}

function toggleTrapAutoRefresh() {
  state.trapAutoRefresh = document.getElementById('auto-refresh-traps').checked;
  updatePollingStatusText();
  setupTrapAutoRefresh();

  if (state.trapAutoRefresh) {
    showToast('Auto-Refresh ON - Checking for traps every 5 seconds', 'info');
  } else {
    showToast('Auto-Refresh OFF - Use Refresh button to check for new traps', 'success');
  }
}

function updatePollingStatusText() {
  var statusText = document.getElementById('polling-status-text');
  if (statusText) {
    if (state.trapAutoRefresh) {
      statusText.textContent = 'Auto-Refresh ON';
      statusText.style.color = 'var(--success)';
    } else {
      statusText.textContent = 'Auto-Refresh OFF';
      statusText.style.color = 'var(--text-secondary)';
    }
  }
}

function toggleAudioAlerts() {
  const enabled = document.getElementById('audio-alerts').checked;
  AudioAlert.enabled = enabled;
  state.audioEnabled = enabled;
  showToast(enabled ? '🔔 Sound alerts enabled' : '🔕 Sound alerts disabled', 'info');
}

function testAlertSound() {
  AudioAlert.playChime();
  showToast('Playing alert sound...', 'info');
}

function manualRefreshTraps() {
  showToast('Checking for new traps...', 'info');
  loadTraps().then(() => {
    renderTrapsList();
    renderDashboard();
    updateAllStats();
    renderDeviceMarkers();
    showToast('Traps refreshed', 'success');
  }).catch(err => {
    showToast('Error refreshing traps', 'error');
  });
}

function setupTrapAutoRefresh() {
  if (state.trapRefreshInterval) {
    clearInterval(state.trapRefreshInterval);
    state.trapRefreshInterval = null;
  }

  // Only poll when toggle is ON
  if (state.trapAutoRefresh) {
    state.trapRefreshInterval = setInterval(() => {
      loadTraps().then(() => {
        renderTrapsList();
        renderDashboard();
        updateAllStats();
        renderDeviceMarkers();
      });
    }, 5000);
  }
}

// ============================================
// Real-time Trap Listener (push from gateway)
// ============================================
var realTimeTrapInterval = null;
var lastTrapCheckTime = new Date().toISOString();

/**
 * Start listening for real-time traps from the gateway
 * This is lightweight - only checks for NEW traps, doesn't poll Google Sheets
 */
function startRealTimeTrapListener() {
  if (realTimeTrapInterval) return; // Already running

  // Don't start real-time trap listener in remote mode (gateway unreachable)
  if (state.isRemote || !state.gatewayOnline) return;

  var gatewayUrl = state.emailConfig.snmpGatewayUrl || 'http://localhost:5017';

  realTimeTrapInterval = setInterval(function() {
    // Stop polling if gateway went offline or switched to remote mode
    if (!state.gatewayOnline) {
      stopRealTimeTrapListener();
      return;
    }
    fetch(gatewayUrl + '/traps/recent?since=' + encodeURIComponent(lastTrapCheckTime), {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    })
    .then(function(response) {
      if (!response.ok) return null;
      return response.json();
    })
    .then(function(data) {
      if (!data || !data.traps || data.traps.length === 0) return;

      // Update last check time
      lastTrapCheckTime = data.serverTime;

      // Process new traps
      data.traps.forEach(function(trap) {
        console.log('🚨 Real-time trap received:', trap);

        // Trigger visual alert for device
        triggerDeviceAlert(trap.sourceIp);

        // Play sound if enabled
        var soundEnabled = localStorage.getItem('codemap-alert-sound') !== 'false';
        if (soundEnabled && typeof AudioAlert !== 'undefined') {
          AudioAlert.playChime();
        }

        // Desktop notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('🚨 SNMP Alert: ' + (trap.deviceName || trap.sourceIp), {
            body: trap.parsedMessage || 'Device alert received',
            icon: '/favicon.ico',
            tag: 'trap-' + trap.sourceIp
          });
        }

        // Show toast
        showToast('🚨 Alert from ' + (trap.deviceName || trap.sourceIp) + ': ' + (trap.parsedMessage || 'Device alert'), 'warning');
      });

      // Reload full trap list from Google Sheets to get complete data
      loadTraps().then(function() {
        renderTrapsList();
        renderDashboard();
        updateAllStats();
        renderDeviceMarkers();
      });
    })
    .catch(function(err) {
      // Gateway might be offline, that's OK
      console.log('Real-time trap check failed (gateway may be offline)');
    });
  }, 2000); // Check every 2 seconds

  console.log('✅ Real-time trap listener started');
}

/**
 * Stop real-time trap listener
 */
function stopRealTimeTrapListener() {
  if (realTimeTrapInterval) {
    clearInterval(realTimeTrapInterval);
    realTimeTrapInterval = null;
    console.log('Real-time trap listener stopped');
  }
}

function clearAllTraps() {
  showConfirmCard({
    title: 'Clear All Traps',
    message: 'Are you sure you want to clear all traps?',
    type: 'danger',
    confirmText: 'Clear All',
    onConfirm: function() {
      showToast('Clearing traps...', 'info');
      google.script.run
        .withSuccessHandler(function(result) {
          if (result && result.success) {
            state.traps = [];
            renderTrapsList();
            renderDashboard();
            updateAllStats();
            showToast('All traps cleared', 'success');
          } else {
            showToast('Failed to clear traps: ' + (result && result.error ? result.error : 'Unknown error'), 'error');
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error clearing traps: ' + (err && err.message ? err.message : err), 'error');
        })
        .clearAllTraps();
    }
  });
}

// ============================================
// Email Management
// ============================================
function emailDevice(deviceId) {
  closeDeviceModal();

  const device = state.devices.find(d => d.id === deviceId);
  if (!device) return;

  showInputCard({
    title: 'Send Device Email',
    message: 'Enter a custom message (optional):',
    placeholder: 'Type your message here...',
    confirmText: 'Send',
    onConfirm: function(customMessage) {
      google.script.run
        .withSuccessHandler(function(result) {
          if (result.success) {
            showToast('Email sent successfully', 'success');
          } else {
            showToast(result.error || 'Error sending email', 'error');
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error sending email', 'error');
        })
        .sendDeviceEmail(deviceId, customMessage || '');
    }
  });
}

function saveEmailSettings(event) {
  event.preventDefault();

  const config = {
    companyEmail: document.getElementById('company-email').value,
    emailSubject: document.getElementById('email-subject').value,
    emailTemplate: document.getElementById('email-template').value
  };

  google.script.run
    .withSuccessHandler(result => {
      if (result.success) {
        state.emailConfig = { ...state.emailConfig, ...config };
        showToast('Email settings saved', 'success');
      } else {
        showToast('Error saving settings', 'error');
      }
    })
    .withFailureHandler(err => {
      showToast('Error saving settings', 'error');
    })
    .saveEmailConfig(config);
}

function testEmail() {
  if (!state.emailConfig.companyEmail) {
    showToast('Please configure company email first', 'warning');
    return;
  }

  if (state.devices.length === 0) {
    showToast('Add at least one device first', 'warning');
    return;
  }

  const deviceId = state.devices[0].id;

  google.script.run
    .withSuccessHandler(result => {
      if (result.success) {
        showToast('Test email sent', 'success');
      } else {
        showToast(result.error || 'Error sending test email', 'error');
      }
    })
    .withFailureHandler(err => {
      showToast('Error sending test email', 'error');
    })
    .sendDeviceEmail(deviceId, 'This is a test email from Smart School Monitor.');
}

// ============================================
// Settings Management
// ============================================
function applySettings() {
  // Apply email config to form
  document.getElementById('company-email').value = state.emailConfig.companyEmail || '';
  document.getElementById('email-subject').value = state.emailConfig.emailSubject || 'Printer Issue Report';
  document.getElementById('email-template').value = state.emailConfig.emailTemplate || '';

  // Apply app settings
  document.getElementById('setting-app-title').value = state.emailConfig.appTitle || 'Smart School Monitor';
  document.getElementById('setting-app-subtitle').value = state.emailConfig.appSubtitle || 'SNMP Network Monitoring System';
  document.getElementById('setting-gateway-url').value = state.emailConfig.snmpGatewayUrl || 'http://localhost:5017';
  document.getElementById('setting-snmp-community').value = state.emailConfig.snmpCommunity || 'public';
  document.getElementById('setting-snmp-port').value = state.emailConfig.snmpPort || '161';

  // Update header
  document.getElementById('app-title').textContent = state.emailConfig.appTitle || 'Smart School Monitor';
  document.getElementById('app-subtitle').textContent = state.emailConfig.appSubtitle || 'SNMP Network Monitoring System';

  // Update current tech name display
  var techDisplay = document.getElementById('current-tech-display');
  if (techDisplay) {
    techDisplay.textContent = state.currentTechName || '(Not set - click to set)';
  }

  // Update password status
  updatePasswordStatus();

  // Load tab lock settings
  loadTabLockSettings();

  // Render technicians list
  renderTechniciansList();

  // Apply alert behavior settings from localStorage
  var autoZoomEnabled = localStorage.getItem('codemap-auto-zoom-alerts') !== 'false';
  var alertSoundEnabled = localStorage.getItem('codemap-alert-sound') !== 'false';

  var autoZoomCheckbox = document.getElementById('setting-auto-zoom-alerts');
  var alertSoundCheckbox = document.getElementById('setting-alert-sound');

  if (autoZoomCheckbox) autoZoomCheckbox.checked = autoZoomEnabled;
  if (alertSoundCheckbox) alertSoundCheckbox.checked = alertSoundEnabled;

  // Load after-hours settings
  loadAfterHoursSettings();
}

function saveAppSettings() {
  const config = {
    appTitle: document.getElementById('setting-app-title').value,
    appSubtitle: document.getElementById('setting-app-subtitle').value,
    snmpGatewayUrl: document.getElementById('setting-gateway-url').value,
    snmpCommunity: document.getElementById('setting-snmp-community').value,
    snmpPort: document.getElementById('setting-snmp-port').value
  };

  google.script.run
    .withSuccessHandler(result => {
      if (result.success) {
        state.emailConfig = { ...state.emailConfig, ...config };
        document.getElementById('app-title').textContent = config.appTitle;
        document.getElementById('app-subtitle').textContent = config.appSubtitle;
        showToast('Settings saved', 'success');
      } else {
        showToast('Error saving settings', 'error');
      }
    })
    .withFailureHandler(err => {
      showToast('Error saving settings', 'error');
    })
    .saveEmailConfig(config);
}

/**
 * Save auto-zoom setting
 */
function saveAutoZoomSetting(enabled) {
  localStorage.setItem('codemap-auto-zoom-alerts', enabled ? 'true' : 'false');
  showToast('Auto-zoom ' + (enabled ? 'enabled' : 'disabled'), 'info');
}

/**
 * Save after-hours settings
 */
function saveAfterHoursSettings() {
  // Build workDays object
  var workDays = {
    mon: document.getElementById('setting-workday-mon').checked,
    tue: document.getElementById('setting-workday-tue').checked,
    wed: document.getElementById('setting-workday-wed').checked,
    thu: document.getElementById('setting-workday-thu').checked,
    fri: document.getElementById('setting-workday-fri').checked,
    sat: document.getElementById('setting-workday-sat').checked,
    sun: document.getElementById('setting-workday-sun').checked
  };

  // IMPORTANT: Stringify workDays to avoid google.script.run serialization issues
  var settings = {
    enabled: document.getElementById('setting-after-hours-enabled').checked,
    workStart: document.getElementById('setting-work-start').value,
    workEnd: document.getElementById('setting-work-end').value,
    workDaysJson: JSON.stringify(workDays),  // Send as JSON string to avoid serialization loss
    urgentEmail: document.getElementById('setting-urgent-email').value,
    urgentPhone: document.getElementById('setting-urgent-phone').value,
    afterHoursMessage: document.getElementById('setting-after-hours-message').value
  };

  console.log('Saving after-hours settings:', settings);
  console.log('workDays being saved:', workDays);

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        showToast('After-hours settings saved', 'success');
      } else {
        showToast('Error saving settings: ' + (result.error || 'Unknown error'), 'error');
      }
    })
    .withFailureHandler(function(err) {
      console.error('Error saving after-hours settings:', err);
      showToast('Error saving settings', 'error');
    })
    .saveAfterHoursSettings(settings);
}

/**
 * Load after-hours settings into the form
 */
function loadAfterHoursSettings() {
  google.script.run
    .withSuccessHandler(function(settings) {
      if (settings) {
        var enabledEl = document.getElementById('setting-after-hours-enabled');
        var startEl = document.getElementById('setting-work-start');
        var endEl = document.getElementById('setting-work-end');
        var emailEl = document.getElementById('setting-urgent-email');
        var phoneEl = document.getElementById('setting-urgent-phone');
        var messageEl = document.getElementById('setting-after-hours-message');

        if (enabledEl) enabledEl.checked = settings.enabled !== false;
        if (startEl) startEl.value = settings.workStart || '06:30';
        if (endEl) endEl.value = settings.workEnd || '16:00';
        if (emailEl) emailEl.value = settings.urgentEmail || 'itservicedesk@palmbeachschools.org';
        if (phoneEl) phoneEl.value = settings.urgentPhone || '(561) 242-6100';
        if (messageEl) messageEl.value = settings.afterHoursMessage || 'Your request has been submitted and will be addressed first thing during the next working hours.';

        if (settings.workDays) {
          var monEl = document.getElementById('setting-workday-mon');
          var tueEl = document.getElementById('setting-workday-tue');
          var wedEl = document.getElementById('setting-workday-wed');
          var thuEl = document.getElementById('setting-workday-thu');
          var friEl = document.getElementById('setting-workday-fri');
          var satEl = document.getElementById('setting-workday-sat');
          var sunEl = document.getElementById('setting-workday-sun');

          if (monEl) monEl.checked = settings.workDays.mon !== false;
          if (tueEl) tueEl.checked = settings.workDays.tue !== false;
          if (wedEl) wedEl.checked = settings.workDays.wed !== false;
          if (thuEl) thuEl.checked = settings.workDays.thu !== false;
          if (friEl) friEl.checked = settings.workDays.fri !== false;
          if (satEl) satEl.checked = settings.workDays.sat === true;
          if (sunEl) sunEl.checked = settings.workDays.sun === true;
        }
      }
    })
    .withFailureHandler(function(err) {
      console.error('Error loading after-hours settings:', err);
    })
    .getAfterHoursSettings();
}

/**
 * Save alert sound setting
 */
function saveAlertSoundSetting(enabled) {
  localStorage.setItem('codemap-alert-sound', enabled ? 'true' : 'false');
  AudioAlert.enabled = enabled;
  showToast('Alert sound ' + (enabled ? 'enabled' : 'disabled'), 'info');
}

function confirmClearDevices() {
  showConfirmCard({
    title: 'Delete All Devices',
    message: 'Are you sure you want to delete <strong>ALL</strong> devices? This cannot be undone.',
    type: 'danger',
    confirmText: 'Delete All',
    onConfirm: function() {
      google.script.run
        .withSuccessHandler(result => {
          if (result.success) {
            state.devices = [];
            updateAllStats();
            renderDeviceMarkers();
            renderDeviceTable();
            renderDashboard();
            showToast('All devices cleared', 'success');
          }
        })
        .withFailureHandler(err => {
          showToast('Error clearing devices', 'error');
        })
        .clearAllDevices();
    }
  });
}

function confirmClearTraps() {
  clearAllTraps();
}

function exportData() {
  google.script.run
    .withSuccessHandler(data => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smart-school-monitor-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Data exported', 'success');
    })
    .withFailureHandler(err => {
      showToast('Error exporting data', 'error');
    })
    .exportAllData();
}

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type, duration) {
  type = type || 'info';
  duration = (duration !== undefined) ? duration : 4000;
  var container = document.getElementById('toast-container');
  if (!container) return;

  var icons = {
    success: 'check-circle',
    error: 'x-circle',
    warning: 'alert-triangle',
    info: 'info'
  };

  var toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.innerHTML =
    '<i data-lucide="' + (icons[type] || 'info') + '" class="toast-icon"></i>' +
    '<span class="toast-message">' + message + '</span>' +
    '<button class="toast-close" onclick="this.parentElement.remove()">' +
    '<i data-lucide="x"></i>' +
    '</button>';

  container.appendChild(toast);
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Auto remove after specified duration
  if (duration > 0) {
    setTimeout(function() {
      toast.classList.add('hiding');
      setTimeout(function() { toast.remove(); }, 300);
    }, duration);
  }
}

// ============================================
// SNMP Gateway Control (Auto-Start via Controller)
// ============================================

const GATEWAY_PATH = '/Users/varycat/Desktop/CodeMAPCopier/snmp-gateway';
const CONTROLLER_URL = 'http://localhost:5018';

// Trap Listener State
var trapListenerState = {
  isListening: false,
  startTime: null,
  trapsReceived: 0,
  lastTrapTime: null,
  uptimeInterval: null
};

// Start Trap Listener
function startTrapListener() {
  const trapPort = document.getElementById('setting-trap-port')?.value || 1162;

  showToast('Starting SNMP trap listener...', 'info');

  // Try to start via controller (trap-only mode, no polling)
  fetch(CONTROLLER_URL + '/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trapPort: parseInt(trapPort), pollInterval: 0, trapOnly: true })
  })
  .then(response => response.json())
  .then(result => {
    if (result.success) {
      trapListenerState.isListening = true;
      trapListenerState.startTime = new Date();
      updateTrapListenerUI(true);
      startUptimeCounter();
      showToast('Trap listener started on port ' + trapPort, 'success');
      setTimeout(() => checkGatewayStatus(true), 2000);
    } else {
      showToast(result.message || 'Failed to start listener', 'error');
    }
  })
  .catch(err => {
    // Controller not running - show setup instructions
    showControllerSetupModal(trapPort, 0);
  });
}

// Stop Trap Listener
function stopTrapListener() {
  showToast('Stopping trap listener...', 'info');

  fetch(CONTROLLER_URL + '/stop', { method: 'POST' })
    .then(response => response.json())
    .then(result => {
      trapListenerState.isListening = false;
      updateTrapListenerUI(false);
      stopUptimeCounter();
      showToast('Trap listener stopped', 'success');
      setTimeout(() => checkGatewayStatus(false), 1000);
    })
    .catch(err => {
      trapListenerState.isListening = false;
      updateTrapListenerUI(false);
      stopUptimeCounter();
      showToast('Listener stopped', 'info');
    });
}

// Update Trap Listener UI
function updateTrapListenerUI(isListening) {
  const statusDot = document.querySelector('#trap-listener-status .status-dot');
  const statusText = document.getElementById('trap-listener-text');
  const btnStart = document.getElementById('btn-start-listener');
  const btnStop = document.getElementById('btn-stop-listener');

  if (statusDot) {
    statusDot.classList.toggle('online', isListening);
    statusDot.classList.toggle('offline', !isListening);
  }

  if (statusText) {
    statusText.textContent = isListening ? 'Listening for Traps...' : 'Listener Off';
  }

  if (btnStart) btnStart.classList.toggle('hidden', isListening);
  if (btnStop) btnStop.classList.toggle('hidden', !isListening);
}

// Start uptime counter
function startUptimeCounter() {
  stopUptimeCounter();
  trapListenerState.uptimeInterval = setInterval(updateUptimeDisplay, 1000);
}

// Stop uptime counter
function stopUptimeCounter() {
  if (trapListenerState.uptimeInterval) {
    clearInterval(trapListenerState.uptimeInterval);
    trapListenerState.uptimeInterval = null;
  }
  const uptimeEl = document.getElementById('listener-uptime');
  if (uptimeEl) uptimeEl.textContent = '-';
}

// Update uptime display
function updateUptimeDisplay() {
  if (!trapListenerState.startTime) return;

  const now = new Date();
  const diff = Math.floor((now - trapListenerState.startTime) / 1000);

  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;

  let uptime = '';
  if (hours > 0) uptime += hours + 'h ';
  if (minutes > 0 || hours > 0) uptime += minutes + 'm ';
  uptime += seconds + 's';

  const uptimeEl = document.getElementById('listener-uptime');
  if (uptimeEl) uptimeEl.textContent = uptime;
}

// Update trap statistics
function updateTrapStats(trapCount, lastTrapTime) {
  const countEl = document.getElementById('traps-received-count');
  const lastTimeEl = document.getElementById('last-trap-time');

  if (countEl) countEl.textContent = trapCount;

  if (lastTimeEl && lastTrapTime) {
    const time = new Date(lastTrapTime);
    const now = new Date();
    const diff = Math.floor((now - time) / 1000);

    if (diff < 60) {
      lastTimeEl.textContent = diff + 's ago';
    } else if (diff < 3600) {
      lastTimeEl.textContent = Math.floor(diff / 60) + 'm ago';
    } else {
      lastTimeEl.textContent = time.toLocaleTimeString();
    }
  }
}

// Check trap listener status periodically
function checkTrapListenerStatus() {
  fetch(CONTROLLER_URL + '/status')
    .then(response => response.json())
    .then(result => {
      const isListening = result.gateway === 'running';
      if (isListening !== trapListenerState.isListening) {
        trapListenerState.isListening = isListening;
        updateTrapListenerUI(isListening);
        if (isListening && !trapListenerState.startTime) {
          trapListenerState.startTime = new Date();
          startUptimeCounter();
        }
      }
    })
    .catch(() => {
      // Controller not running
      if (trapListenerState.isListening) {
        trapListenerState.isListening = false;
        updateTrapListenerUI(false);
        stopUptimeCounter();
      }
    });
}

// Start Gateway - Auto-starts via controller service (for backward compatibility)
function startGateway() {
  startTrapListener();
}

// Show setup modal when controller is not running
function showControllerSetupModal(trapPort, pollInterval) {
  // Store values for later use
  window._pendingTrapPort = trapPort;
  window._pendingPollInterval = pollInterval;

  var modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'gateway-start-modal';

  modal.innerHTML = '<div class="modal-backdrop" onclick="closeGatewayStartModal()"></div>' +
    '<div class="modal-content" style="max-width: 550px;">' +
    '<div class="modal-header">' +
    '<h3><i data-lucide="settings"></i> One-Time Setup Required</h3>' +
    '<button class="modal-close" onclick="closeGatewayStartModal()"><i data-lucide="x"></i></button>' +
    '</div>' +
    '<div class="modal-body">' +
    '<p style="margin-bottom: 16px;">To enable <strong>one-click gateway control</strong>, start the Gateway Controller once:</p>' +
    '<div class="setup-steps">' +
    '<div class="setup-step">' +
    '<div class="step-number">1</div>' +
    '<div class="step-content">' +
    '<strong>Double-click to start controller:</strong>' +
    '<div style="background: #1e293b; padding: 10px; border-radius: 6px; margin-top: 8px;">' +
    '<code style="color: #22c55e; font-size: 12px;">Desktop/CodeMAPCopier/gateway-helper/start-controller.command</code>' +
    '</div></div></div>' +
    '<div class="setup-step">' +
    '<div class="step-number">2</div>' +
    '<div class="step-content">' +
    '<strong>Keep the Terminal window open</strong>' +
    '<p style="color: var(--text-muted); font-size: 13px;">It runs in the background while you use the app.</p>' +
    '</div></div>' +
    '<div class="setup-step">' +
    '<div class="step-number">3</div>' +
    '<div class="step-content">' +
    '<strong>Click Start Gateway again</strong>' +
    '<p style="color: var(--text-muted); font-size: 13px;">Now it will start automatically!</p>' +
    '</div></div></div>' +
    '<div style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; padding: 12px; margin-top: 16px;">' +
    '<p style="margin: 0; font-size: 13px;">' +
    '<strong style="color: #22c55e;">After setup:</strong> Just click Start/Stop/Restart buttons - no more Terminal commands needed!' +
    '</p></div></div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-ghost" onclick="closeGatewayStartModal()">Close</button>' +
    '<button class="btn btn-outline" onclick="showManualStartModal(window._pendingTrapPort, window._pendingPollInterval)">' +
    '<i data-lucide="terminal"></i> Manual Start</button>' +
    '<button class="btn btn-primary" onclick="copyControllerPath()">' +
    '<i data-lucide="copy"></i> Copy Path</button>' +
    '</div></div>';

  document.body.appendChild(modal);
  lucide.createIcons();
}

// Copy controller path
function copyControllerPath() {
  navigator.clipboard.writeText('/Users/varycat/Desktop/CodeMAPCopier/gateway-helper/start-controller.command').then(() => {
    showToast('Path copied! Open Finder, press Cmd+Shift+G, paste the path.', 'success');
  });
}

// Show manual start modal (fallback)
function showManualStartModal(trapPort, pollInterval) {
  closeGatewayStartModal();
  const needsSudo = parseInt(trapPort) < 1024;
  var command = 'cd "' + GATEWAY_PATH + '" && npm start -- --port=' + trapPort + ' --poll=' + pollInterval;
  if (needsSudo) {
    command = 'cd "' + GATEWAY_PATH + '" && sudo npm start -- --port=' + trapPort + ' --poll=' + pollInterval;
  }

  var modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'gateway-start-modal';

  var sudoWarning = needsSudo ? '<p style="color: var(--warning); font-size: 13px;">Port ' + trapPort + ' requires admin password.</p>' : '';

  modal.innerHTML = '<div class="modal-backdrop" onclick="closeGatewayStartModal()"></div>' +
    '<div class="modal-content" style="max-width: 600px;">' +
    '<div class="modal-header">' +
    '<h3><i data-lucide="terminal"></i> Manual Start (Terminal)</h3>' +
    '<button class="modal-close" onclick="closeGatewayStartModal()"><i data-lucide="x"></i></button>' +
    '</div>' +
    '<div class="modal-body">' +
    '<p style="margin-bottom: 12px;">Open Terminal and run this command:</p>' +
    '<div style="background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 8px; font-family: monospace; font-size: 13px; position: relative; margin-bottom: 16px; word-break: break-all;">' +
    '<code id="manual-command">' + command + '</code>' +
    '</div>' +
    sudoWarning +
    '</div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-ghost" onclick="closeGatewayStartModal()">Close</button>' +
    '<button class="btn btn-primary" onclick="copyManualCommand()"><i data-lucide="copy"></i> Copy Command</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(modal);
  lucide.createIcons();
}

function copyManualCommand() {
  var cmd = document.getElementById('manual-command');
  if (cmd) {
    navigator.clipboard.writeText(cmd.textContent).then(function() {
      showToast('Command copied!', 'success');
      closeGatewayStartModal();
    });
  }
}

function closeGatewayStartModal() {
  const modal = document.getElementById('gateway-start-modal');
  if (modal) modal.remove();
}

function copyGatewayCommand(command) {
  navigator.clipboard.writeText(command).then(() => {
    showToast('Command copied!', 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

// Stop Gateway
function stopGateway() {
  showToast('Stopping gateway...', 'info');

  fetch(CONTROLLER_URL + '/stop', { method: 'POST' })
    .then(response => response.json())
    .then(result => {
      showToast('Gateway stopped', 'success');
      setTimeout(() => checkGatewayStatus(false), 1000);
    })
    .catch(err => {
      showToast('Controller not running. Close the Terminal window to stop.', 'info');
    });
}

async function checkGatewayStatus(showFeedback = false) {
  const statusIcon = document.getElementById('gateway-status-icon');
  const statusTitle = document.getElementById('gateway-status-title');
  const statusDesc = document.getElementById('gateway-status-desc');
  const btnStart = document.getElementById('btn-start-gateway');
  const btnStop = document.getElementById('btn-stop-gateway');
  const sidebarIndicator = document.getElementById('gateway-indicator');
  const sidebarText = document.getElementById('gateway-text');

  // Try to reach the gateway
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch('http://localhost:5017/health', {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      // Gateway is running — local network mode
      state.gatewayOnline = true;
      state.isRemote = false;

      if (statusIcon) {
        statusIcon.className = 'gateway-status-icon online';
        statusIcon.innerHTML = '<i data-lucide="wifi"></i>';
      }
      if (statusTitle) statusTitle.textContent = 'Gateway Online';
      if (statusDesc) statusDesc.textContent = 'Receiving SNMP data from devices';
      if (btnStart) btnStart.classList.add('hidden');
      if (btnStop) btnStop.classList.remove('hidden');
      if (sidebarIndicator) sidebarIndicator.className = 'status-dot online';
      if (sidebarText) sidebarText.textContent = 'Gateway: Online';
      if (statusIcon && typeof lucide !== 'undefined') lucide.createIcons();
      if (showFeedback) showToast('Gateway is online and receiving SNMP data', 'success');
      startRealTimeTrapListener();
      return true;
    }
  } catch (error) {
    // Gateway is not running or unreachable (remote access)
  }

  state.gatewayOnline = false;

  // Try to reach the controller too — if both gateway AND controller are unreachable,
  // we're most likely accessing remotely (not on the school network)
  var controllerReachable = false;
  try {
    var ctrlAbort = new AbortController();
    var ctrlTimeout = setTimeout(function() { ctrlAbort.abort(); }, 2000);
    var ctrlResp = await fetch(CONTROLLER_URL + '/status', {
      method: 'GET',
      signal: ctrlAbort.signal
    });
    clearTimeout(ctrlTimeout);
    controllerReachable = true;
  } catch (e) {
    controllerReachable = false;
  }

  // If controller is also unreachable, we're remote
  state.isRemote = !controllerReachable;

  if (state.isRemote) {
    // Remote access mode — gateway AND controller are both unreachable
    if (statusIcon) {
      statusIcon.className = 'gateway-status-icon remote';
      statusIcon.innerHTML = '<i data-lucide="globe"></i>';
    }
    if (statusTitle) statusTitle.textContent = 'Remote Access Mode';
    if (statusDesc) statusDesc.textContent = 'Viewing cached data — live polling requires school network';
    if (btnStart) btnStart.classList.add('hidden');
    if (btnStop) btnStop.classList.add('hidden');
    if (sidebarIndicator) sidebarIndicator.className = 'status-dot remote';
    if (sidebarText) sidebarText.textContent = 'Remote Mode';
    if (statusIcon && typeof lucide !== 'undefined') lucide.createIcons();
    if (showFeedback) showToast('Remote access — viewing cached data from Google Sheets', 'info');
  } else {
    // Controller is reachable but gateway is not — local, gateway just not started
    if (statusIcon) {
      statusIcon.className = 'gateway-status-icon offline';
      statusIcon.innerHTML = '<i data-lucide="wifi-off"></i>';
    }
    if (statusTitle) statusTitle.textContent = 'Gateway Offline';
    if (statusDesc) statusDesc.textContent = 'Not receiving SNMP data';
    if (btnStart) btnStart.classList.remove('hidden');
    if (btnStop) btnStop.classList.add('hidden');
    if (sidebarIndicator) sidebarIndicator.className = 'status-dot offline';
    if (sidebarText) sidebarText.textContent = 'Gateway: Offline';
    if (statusIcon && typeof lucide !== 'undefined') lucide.createIcons();
    if (showFeedback) showToast('Gateway is offline. Click "Start Gateway" to begin.', 'warning');
  }
  return false;
}

// Check gateway status periodically - moved to DOMContentLoaded
// setInterval is set up in initializeApp()

// Restart Gateway function
function restartGateway() {
  const trapPort = document.getElementById('setting-trap-port')?.value || 1162;
  const pollInterval = document.getElementById('setting-poll-interval')?.value || 60;

  showToast('Restarting gateway...', 'info');

  fetch(CONTROLLER_URL + '/restart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trapPort: parseInt(trapPort), pollInterval: parseInt(pollInterval) })
  })
  .then(response => response.json())
  .then(result => {
    showToast(result.message || 'Gateway restarting...', 'success');
    setTimeout(() => checkGatewayStatus(true), 3000);
  })
  .catch(err => {
    showToast('Controller not running. Start it first.', 'warning');
    startGateway();
  });
}

// Fetch and display gateway logs
function fetchGatewayLogs() {
  showToast('Fetching logs...', 'info');

  // Try controller logs first
  fetch(CONTROLLER_URL + '/logs')
    .then(response => {
      if (!response.ok) throw new Error('Controller not reachable');
      return response.json();
    })
    .then(data => {
      showGatewayLogsModal(data.logs || []);
    })
    .catch(err => {
      // Try gateway directly
      fetch('http://localhost:5017/api/logs')
        .then(response => response.json())
        .then(data => {
          showGatewayLogsModal(data.logs || []);
        })
        .catch(err2 => {
          // Show stored traps from database
          showToast('Showing recent traps from database...', 'info');
          showStoredLogsModal();
        });
    });
}

// Show gateway logs in a modal
function showGatewayLogsModal(logs) {
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'gateway-logs-modal';

  let logsHtml = '';
  if (logs.length === 0) {
    logsHtml = '<div class="empty-state"><i data-lucide="file-text"></i><p>No logs available</p></div>';
  } else {
    logsHtml = '<div class="logs-list">';
    logs.slice(-50).reverse().forEach(log => {
      const time = log.timestamp ? new Date(log.timestamp).toLocaleString() : '';
      const levelClass = log.level === 'error' ? 'error' : log.level === 'warning' ? 'warning' : 'info';
      logsHtml += `<div class="log-entry ${levelClass}">
        <span class="log-time">${time}</span>
        <span class="log-level">${log.level || 'info'}</span>
        <span class="log-message">${escapeHtml(log.message || log)}</span>
      </div>`;
    });
    logsHtml += '</div>';
  }

  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeGatewayLogsModal()"></div>
    <div class="modal-content" style="max-width: 700px; max-height: 80vh;">
      <div class="modal-header">
        <h3><i data-lucide="scroll-text"></i> Gateway Logs</h3>
        <button class="modal-close" onclick="closeGatewayLogsModal()"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
        ${logsHtml}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeGatewayLogsModal()">Close</button>
        <button class="btn btn-outline" onclick="fetchGatewayLogs()"><i data-lucide="refresh-cw"></i> Refresh</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  lucide.createIcons();
}

// Show stored logs/traps from the database when gateway is offline
function showStoredLogsModal() {
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'gateway-logs-modal';

  // Get recent traps from state
  const recentTraps = (state.traps || []).slice(0, 50);

  let logsHtml = '';
  if (recentTraps.length === 0) {
    logsHtml = '<div class="empty-state"><i data-lucide="file-text"></i><p>No trap data available</p></div>';
  } else {
    logsHtml = '<div class="logs-list">';
    recentTraps.forEach(trap => {
      const time = trap.receivedAt ? new Date(trap.receivedAt).toLocaleString() : '';
      const levelClass = trap.severity === 'critical' ? 'error' : trap.severity === 'warning' ? 'warning' : 'info';
      logsHtml += `<div class="log-entry ${levelClass}">
        <span class="log-time">${time}</span>
        <span class="log-ip">${trap.sourceIp || 'Unknown'}</span>
        <span class="log-message">${escapeHtml(trap.parsedMessage || trap.oid || 'SNMP Trap')}</span>
      </div>`;
    });
    logsHtml += '</div>';
  }

  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeGatewayLogsModal()"></div>
    <div class="modal-content" style="max-width: 700px; max-height: 80vh;">
      <div class="modal-header">
        <h3><i data-lucide="scroll-text"></i> Recent SNMP Traps</h3>
        <button class="modal-close" onclick="closeGatewayLogsModal()"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
        <p style="margin-bottom: 12px; color: var(--text-muted); font-size: 13px;">
          <i data-lucide="info" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i>
          Gateway is offline. Showing stored trap data from database.
        </p>
        ${logsHtml}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeGatewayLogsModal()">Close</button>
        <button class="btn btn-primary" onclick="closeGatewayLogsModal(); startGateway();">
          <i data-lucide="play"></i> Start Gateway
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  lucide.createIcons();
}

function closeGatewayLogsModal() {
  const modal = document.getElementById('gateway-logs-modal');
  if (modal) modal.remove();
}

// ============================================
// Utility Functions
// ============================================
function getTimeAgo(dateString) {
  const date = new Date(dateString);
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ============================================
// Technician Assignment Functions
// ============================================

function setCurrentTechName() {
  showInputCard({
    title: 'Set Your Name',
    message: 'Enter your name (this will be used when you assign alerts to yourself):',
    placeholder: 'Your name',
    defaultValue: state.currentTechName || '',
    confirmText: 'Save',
    onConfirm: function(name) {
      if (name && name.trim()) {
        state.currentTechName = name.trim();
        localStorage.setItem('currentTechName', name.trim());
        showToast('Your name has been set to: ' + name.trim(), 'success');
      }
    }
  });
}

function assignToMe(deviceIp) {
  function doAssign() {
    google.script.run
      .withSuccessHandler(function(result) {
        if (result.success) {
          showToast(result.message, 'success');
          loadTraps().then(function() {
            renderTrapsList();
            renderDashboard();
            updateAllStats();
            renderDeviceMarkers();
            var device = state.devices.find(function(d) { return d.ip === deviceIp; });
            if (device) {
              showEnhancedDeviceModal(device.id);
            }
          });
        } else {
          showToast(result.error || 'Error assigning trap', 'error');
        }
      })
      .withFailureHandler(function(err) {
        showToast('Error assigning trap', 'error');
      })
      .assignTrapsByIp(deviceIp, state.currentTechName);
  }

  if (!state.currentTechName) {
    showInputCard({
      title: 'Assign Alert',
      message: 'Please enter your name to assign this alert:',
      placeholder: 'Your name',
      confirmText: 'Assign',
      onConfirm: function(name) {
        if (!name || !name.trim()) {
          showToast('Please enter your name', 'warning');
          return;
        }
        state.currentTechName = name.trim();
        localStorage.setItem('currentTechName', name.trim());
        doAssign();
      }
    });
  } else {
    doAssign();
  }
}

function assignToTech(deviceIp, deviceId) {
  var selectEl = document.getElementById('tech-select-' + deviceId);
  if (!selectEl || !selectEl.value) {
    showToast('Please select a technician', 'warning');
    return;
  }

  var techName = selectEl.value;

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        showToast(result.message, 'success');
        loadTraps().then(function() {
          renderTrapsList();
          renderDashboard();
          updateAllStats();
          renderDeviceMarkers();
          var device = state.devices.find(function(d) { return d.ip === deviceIp; });
          if (device) {
            showEnhancedDeviceModal(device.id);
          }
        });
      } else {
        showToast(result.error || 'Error assigning trap', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error assigning trap', 'error');
    })
    .assignTrapsByIp(deviceIp, techName);
}

function unassignDeviceTraps(deviceIp) {
  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        showToast('Assignment removed', 'success');
        loadTraps().then(function() {
          renderTrapsList();
          renderDashboard();
          updateAllStats();
          renderDeviceMarkers();
          var device = state.devices.find(function(d) { return d.ip === deviceIp; });
          if (device) {
            showEnhancedDeviceModal(device.id);
          }
        });
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error removing assignment', 'error');
    })
    .assignTrapsByIp(deviceIp, '');
}

// ============================================
// Technician Management Functions
// ============================================

function showAddTechModal() {
  var modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'add-tech-modal';
  modal.innerHTML = '<div class="modal-backdrop" onclick="closeAddTechModal()"></div>' +
    '<div class="modal-content" style="max-width: 450px;">' +
    '<div class="modal-header">' +
    '<h3><i data-lucide="user-plus"></i> Add Technician</h3>' +
    '<button class="modal-close" onclick="closeAddTechModal()"><i data-lucide="x"></i></button>' +
    '</div>' +
    '<div class="modal-body">' +
    '<div class="form-group">' +
    '<label>Technician Name *</label>' +
    '<input type="text" id="tech-name" placeholder="John Doe" required>' +
    '</div>' +
    '<div class="form-group">' +
    '<label>Email</label>' +
    '<input type="email" id="tech-email" placeholder="john@school.edu">' +
    '</div>' +
    '<div class="form-group">' +
    '<label>Phone</label>' +
    '<input type="tel" id="tech-phone" placeholder="555-123-4567">' +
    '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-ghost" onclick="closeAddTechModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveTechnicianFromModal()">' +
    '<i data-lucide="save"></i> Save Technician</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(modal);
  lucide.createIcons();
}

function closeAddTechModal() {
  var modal = document.getElementById('add-tech-modal');
  if (modal) modal.remove();
}

function saveTechnicianFromModal() {
  var name = document.getElementById('tech-name').value;
  var email = document.getElementById('tech-email').value;
  var phone = document.getElementById('tech-phone').value;

  if (!name || !name.trim()) {
    showToast('Please enter a name', 'warning');
    return;
  }

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        closeAddTechModal();
        showToast('Technician added successfully', 'success');
        loadTechnicians().then(function() {
          renderTechniciansList();
        });
      } else {
        showToast(result.error || 'Error adding technician', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error adding technician', 'error');
    })
    .saveTechnician({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      active: true
    });
}

function renderTechniciansList() {
  var container = document.getElementById('technicians-list');
  if (!container) return;

  if (state.technicians.length === 0) {
    container.innerHTML = '<div class="empty-state">' +
      '<i data-lucide="users"></i>' +
      '<p>No technicians added yet</p>' +
      '</div>';
  } else {
    var html = '';
    state.technicians.forEach(function(tech) {
      html += '<div class="tech-card">' +
        '<div class="tech-avatar">' + (tech.name.charAt(0).toUpperCase()) + '</div>' +
        '<div class="tech-info">' +
        '<span class="tech-name">' + tech.name + '</span>' +
        '<span class="tech-contact">' + (tech.email || tech.phone || 'No contact info') + '</span>' +
        '</div>' +
        '<button class="btn btn-ghost btn-sm" onclick="deleteTechnicianConfirm(\'' + tech.id + '\')">' +
        '<i data-lucide="trash-2"></i></button>' +
        '</div>';
    });
    container.innerHTML = html;
  }
  lucide.createIcons();
}

function deleteTechnicianConfirm(techId) {
  showConfirmCard({
    title: 'Remove Technician',
    message: 'Are you sure you want to remove this technician?',
    type: 'danger',
    confirmText: 'Remove',
    onConfirm: function() {
      google.script.run
        .withSuccessHandler(function(result) {
          if (result.success) {
            showToast('Technician removed', 'success');
            loadTechnicians().then(function() {
              renderTechniciansList();
            });
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error removing technician', 'error');
        })
        .deleteTechnician(techId);
    }
  });
}

// ============================================
// Security Password Functions
// ============================================

function showPasswordModal() {
  var modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'password-modal';
  modal.innerHTML = '<div class="modal-backdrop"></div>' +
    '<div class="modal-content" style="max-width: 400px;">' +
    '<div class="modal-header">' +
    '<h3><i data-lucide="lock"></i> Enter Password</h3>' +
    '</div>' +
    '<div class="modal-body">' +
    '<div class="form-group">' +
    '<label>Password</label>' +
    '<input type="password" id="auth-password" placeholder="Enter password" onkeypress="if(event.key===\'Enter\')verifyPassword()">' +
    '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-primary" onclick="verifyPassword()">' +
    '<i data-lucide="unlock"></i> Unlock</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(modal);
  document.getElementById('auth-password').focus();
  lucide.createIcons();
}

function verifyPassword() {
  var password = document.getElementById('auth-password').value;

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.valid) {
        state.isAuthenticated = true;
        sessionStorage.setItem('authenticated', 'true');
        var modal = document.getElementById('password-modal');
        if (modal) modal.remove();
        showToast('Access granted', 'success');
      } else {
        showToast('Incorrect password', 'error');
        document.getElementById('auth-password').value = '';
        document.getElementById('auth-password').focus();
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error verifying password', 'error');
    })
    .verifySecurityPassword(password);
}

function showChangePasswordModal() {
  var modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'change-password-modal';

  var needsOldPassword = state.passwordProtected;
  var oldPasswordField = needsOldPassword ?
    '<div class="form-group">' +
    '<label>Current Password</label>' +
    '<input type="password" id="old-password" placeholder="Enter current password">' +
    '</div>' : '';

  modal.innerHTML = '<div class="modal-backdrop" onclick="closeChangePasswordModal()"></div>' +
    '<div class="modal-content" style="max-width: 450px;">' +
    '<div class="modal-header">' +
    '<h3><i data-lucide="key"></i> ' + (needsOldPassword ? 'Change' : 'Set') + ' Password</h3>' +
    '<button class="modal-close" onclick="closeChangePasswordModal()"><i data-lucide="x"></i></button>' +
    '</div>' +
    '<div class="modal-body">' +
    oldPasswordField +
    '<div class="form-group">' +
    '<label>New Password</label>' +
    '<input type="password" id="new-password" placeholder="Enter new password">' +
    '</div>' +
    '<div class="form-group">' +
    '<label>Confirm New Password</label>' +
    '<input type="password" id="confirm-password" placeholder="Confirm new password">' +
    '</div>' +
    '<p style="font-size: 0.8125rem; color: var(--text-muted);">Leave blank to disable password protection.</p>' +
    '</div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-ghost" onclick="closeChangePasswordModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveNewPassword()">' +
    '<i data-lucide="save"></i> Save Password</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(modal);
  lucide.createIcons();
}

function closeChangePasswordModal() {
  var modal = document.getElementById('change-password-modal');
  if (modal) modal.remove();
}

function saveNewPassword() {
  var oldPassword = document.getElementById('old-password') ? document.getElementById('old-password').value : '';
  var newPassword = document.getElementById('new-password').value;
  var confirmPassword = document.getElementById('confirm-password').value;

  if (newPassword && newPassword !== confirmPassword) {
    showToast('Passwords do not match', 'warning');
    return;
  }

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        closeChangePasswordModal();
        showToast(result.message, 'success');
        state.passwordProtected = !!newPassword;
        updatePasswordStatus();
      } else {
        showToast(result.error || 'Error setting password', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error setting password', 'error');
    })
    .setSecurityPassword(newPassword, oldPassword);
}

function updatePasswordStatus() {
  var statusEl = document.getElementById('password-status');
  var lockBtn = document.getElementById('lock-app-btn');

  if (statusEl) {
    if (state.passwordProtected) {
      statusEl.innerHTML = '<span class="status-badge online"><span class="dot"></span>Enabled</span>';
      if (lockBtn) lockBtn.style.display = 'inline-flex';
    } else {
      statusEl.innerHTML = '<span class="status-badge offline"><span class="dot"></span>Disabled</span>';
      if (lockBtn) lockBtn.style.display = 'none';
    }
  }

  // Update nav items with lock indicators for protected tabs
  updateNavLockIndicators();
}

// Lock the app immediately (require password again)
function lockAppNow() {
  state.isAuthenticated = false;
  sessionStorage.removeItem('authenticated');
  updateNavLockIndicators();
  showToast('App locked. Password required for protected areas.', 'info');

  // Switch to an open tab
  switchTab('blueprint');
}

// Remove password protection completely
function removePassword() {
  showConfirmCard({
    title: 'Remove Password',
    message: 'Are you sure you want to remove password protection? All areas will be accessible without a password.',
    type: 'warn',
    confirmText: 'Remove Password',
    onConfirm: function() {
      google.script.run
        .withSuccessHandler(function(result) {
          if (result.success) {
            state.passwordProtected = false;
            state.isAuthenticated = true;
            sessionStorage.removeItem('authenticated');
            updatePasswordStatus();
            showToast('Password protection removed', 'success');
          } else {
            showToast(result.error || 'Error removing password', 'error');
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error removing password', 'error');
        })
        .setSecurityPassword('', '');
    }
  });
}

function updateNavLockIndicators() {
  var allTabs = ['blueprint', 'dashboard', 'devices', 'traps', 'analytics', 'requests', 'repairs', 'settings'];

  allTabs.forEach(function(tabName) {
    var navItem = document.querySelector('.nav-item[data-tab="' + tabName + '"]');
    if (!navItem) return;

    // Remove existing lock indicator
    var existingLock = navItem.querySelector('.nav-lock-indicator');
    if (existingLock) existingLock.remove();

    // Add lock indicator if this tab is locked, password protected, and not authenticated
    var isLocked = lockedTabs.indexOf(tabName) !== -1;
    if (isLocked && state.passwordProtected && !state.isAuthenticated) {
      var lockSpan = document.createElement('span');
      lockSpan.className = 'nav-lock-indicator';
      lockSpan.innerHTML = '<i data-lucide="lock" style="width:12px;height:12px;"></i>';
      navItem.appendChild(lockSpan);
    }
  });

  // Refresh icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// ============================================
// Test Environment Management
// ============================================

// Test mode state
var testModeState = {
  enabled: false,
  simulateDevices: true,
  simulateTraps: true,
  simulateSupplies: false,
  testInterval: null
};

// Sample test problems for generating test traps
var TEST_PROBLEMS = [
  { message: 'Paper Jam', severity: 'critical' },
  { message: 'Toner Empty', severity: 'critical' },
  { message: 'Toner Low', severity: 'warning' },
  { message: 'Paper Empty', severity: 'critical' },
  { message: 'Paper Low', severity: 'warning' },
  { message: 'Cover Open', severity: 'warning' },
  { message: 'Door Open', severity: 'warning' },
  { message: 'Misfeed', severity: 'critical' },
  { message: 'Waste Toner Full', severity: 'critical' },
  { message: 'Drum Near End of Life', severity: 'warning' },
  { message: 'Staples Low', severity: 'warning' },
  { message: 'Output Tray Full', severity: 'warning' },
  { message: 'Service Required', severity: 'critical' },
  { message: 'Fuser Error', severity: 'critical' },
  { message: 'Black Toner Low (15%)', severity: 'warning' },
  { message: 'Cyan Toner Empty', severity: 'critical' },
  { message: 'Magenta Toner Low (8%)', severity: 'warning' },
  { message: 'Yellow Toner Empty', severity: 'critical' }
];

/**
 * Initialize test environment settings
 */
function initTestEnvironment() {
  // Load saved mode from localStorage
  var savedMode = localStorage.getItem('codemap-environment-mode');
  testModeState.enabled = savedMode === 'test';

  // Load test options
  testModeState.simulateDevices = localStorage.getItem('codemap-test-devices') !== 'false';
  testModeState.simulateTraps = localStorage.getItem('codemap-test-traps') !== 'false';
  testModeState.simulateSupplies = localStorage.getItem('codemap-test-supplies') === 'true';

  // Update UI
  updateEnvironmentUI();

  // Show global indicator if in test mode
  updateTestModeIndicator();
}

/**
 * Set environment mode (production or test)
 */
function setEnvironmentMode(mode) {
  testModeState.enabled = (mode === 'test');
  localStorage.setItem('codemap-environment-mode', mode);

  // Update UI
  updateEnvironmentUI();
  updateTestModeIndicator();

  // Show toast notification
  if (mode === 'test') {
    showToast('Test Mode activated - using simulated data', 'warning');
    startTestModeSimulation();
  } else {
    showToast('Production Mode activated - using live data', 'success');
    stopTestModeSimulation();
  }

  // Refresh data
  loadTraps();
  renderDashboard();
}

/**
 * Update environment settings UI
 */
function updateEnvironmentUI() {
  var modeProduction = document.getElementById('mode-production');
  var modeTest = document.getElementById('mode-test');
  var testOptions = document.getElementById('test-mode-options');
  var testBanner = document.getElementById('test-mode-banner');
  var statusCard = document.getElementById('environment-status-card');
  var statusContent = document.getElementById('environment-status-content');

  if (modeProduction && modeTest) {
    if (testModeState.enabled) {
      modeProduction.classList.remove('active');
      modeTest.classList.add('active');
    } else {
      modeProduction.classList.add('active');
      modeTest.classList.remove('active');
    }
  }

  if (testOptions) {
    testOptions.style.display = testModeState.enabled ? 'block' : 'none';
  }

  if (testBanner) {
    testBanner.style.display = testModeState.enabled ? 'flex' : 'none';
  }

  if (statusCard) {
    if (testModeState.enabled) {
      statusCard.classList.add('test-mode');
    } else {
      statusCard.classList.remove('test-mode');
    }
  }

  if (statusContent) {
    if (testModeState.enabled) {
      statusContent.innerHTML = '<p><strong style="color: var(--warning);">Test mode active</strong> - Data is simulated for testing purposes. Switch to Production mode when ready to use real SNMP data.</p>';
    } else {
      statusContent.innerHTML = '<p>Production mode active - Using live data from SNMP gateway. All alerts and device status are real.</p>';
    }
  }

  // Update checkbox states
  var chkDevices = document.getElementById('test-simulate-devices');
  var chkTraps = document.getElementById('test-simulate-traps');
  var chkSupplies = document.getElementById('test-simulate-supplies');

  if (chkDevices) chkDevices.checked = testModeState.simulateDevices;
  if (chkTraps) chkTraps.checked = testModeState.simulateTraps;
  if (chkSupplies) chkSupplies.checked = testModeState.simulateSupplies;

  // Add change listeners
  if (chkDevices && !chkDevices.dataset.listenerAdded) {
    chkDevices.addEventListener('change', function() {
      testModeState.simulateDevices = this.checked;
      localStorage.setItem('codemap-test-devices', this.checked);
    });
    chkDevices.dataset.listenerAdded = 'true';
  }

  if (chkTraps && !chkTraps.dataset.listenerAdded) {
    chkTraps.addEventListener('change', function() {
      testModeState.simulateTraps = this.checked;
      localStorage.setItem('codemap-test-traps', this.checked);
    });
    chkTraps.dataset.listenerAdded = 'true';
  }

  if (chkSupplies && !chkSupplies.dataset.listenerAdded) {
    chkSupplies.addEventListener('change', function() {
      testModeState.simulateSupplies = this.checked;
      localStorage.setItem('codemap-test-supplies', this.checked);
    });
    chkSupplies.dataset.listenerAdded = 'true';
  }

  lucide.createIcons();
}

/**
 * Update global test mode indicator
 */
function updateTestModeIndicator() {
  var existingIndicator = document.getElementById('global-test-indicator');

  if (testModeState.enabled) {
    if (!existingIndicator) {
      var indicator = document.createElement('div');
      indicator.id = 'global-test-indicator';
      indicator.className = 'test-mode-indicator';
      indicator.innerHTML = '<i data-lucide="flask-conical"></i> Test Mode';
      indicator.onclick = function() {
        // Go to settings and show environment panel
        switchTab('settings');
        setTimeout(function() {
          switchSettingsPanel('environment');
        }, 100);
      };
      document.body.appendChild(indicator);
      lucide.createIcons();
    }
  } else {
    if (existingIndicator) {
      existingIndicator.remove();
    }
  }
}

/**
 * Generate a single test trap
 */
function generateTestTrap() {
  if (state.devices.length === 0) {
    showToast('No devices available. Add devices first.', 'warning');
    return;
  }

  // Pick a random device
  var randomDevice = state.devices[Math.floor(Math.random() * state.devices.length)];

  // Pick a random problem
  var randomProblem = TEST_PROBLEMS[Math.floor(Math.random() * TEST_PROBLEMS.length)];

  // Create test trap
  var testTrap = {
    id: 'test-' + Date.now(),
    sourceIp: randomDevice.ip,
    parsedMessage: randomProblem.message,
    severity: randomProblem.severity,
    receivedAt: new Date().toISOString(),
    processed: 0,
    trapData: { type: 'test_trap', simulated: true }
  };

  // Add to state
  state.traps.unshift(testTrap);

  // Save to backend if needed
  if (testModeState.simulateTraps) {
    google.script.run
      .withSuccessHandler(function() {
        console.log('Test trap saved');
      })
      .withFailureHandler(function(err) {
        console.error('Error saving test trap:', err);
      })
      .addTrap({
        sourceIp: testTrap.sourceIp,
        trapData: testTrap.trapData,
        parsedMessage: testTrap.parsedMessage,
        severity: testTrap.severity
      });
  }

  // Update UI
  updateTrapBadge();
  renderTrapsList();
  renderDashboard();
  triggerDeviceAlert(randomDevice.ip);

  showToast('Test trap generated: ' + randomProblem.message + ' on ' + randomDevice.name, 'info');
}

/**
 * Generate multiple test traps
 */
function generateMultipleTestTraps() {
  if (state.devices.length === 0) {
    showToast('No devices available. Add devices first.', 'warning');
    return;
  }

  var count = 5;
  for (var i = 0; i < count; i++) {
    setTimeout(function() {
      generateTestTrapSilent();
    }, i * 300); // Stagger by 300ms
  }

  setTimeout(function() {
    updateTrapBadge();
    renderTrapsList();
    renderDashboard();
    showToast(count + ' test traps generated', 'info');
  }, count * 300 + 100);
}

/**
 * Generate test trap without notification
 */
function generateTestTrapSilent() {
  if (state.devices.length === 0) return;

  var randomDevice = state.devices[Math.floor(Math.random() * state.devices.length)];
  var randomProblem = TEST_PROBLEMS[Math.floor(Math.random() * TEST_PROBLEMS.length)];

  var testTrap = {
    id: 'test-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    sourceIp: randomDevice.ip,
    parsedMessage: randomProblem.message,
    severity: randomProblem.severity,
    receivedAt: new Date().toISOString(),
    processed: 0,
    trapData: { type: 'test_trap', simulated: true }
  };

  state.traps.unshift(testTrap);

  google.script.run
    .addTrap({
      sourceIp: testTrap.sourceIp,
      trapData: testTrap.trapData,
      parsedMessage: testTrap.parsedMessage,
      severity: testTrap.severity
    });
}

/**
 * Clear all test data
 */
function clearTestData() {
  showConfirmCard({
    title: 'Clear Test Data',
    message: 'Are you sure you want to clear all test traps? This will remove all traps marked as simulated.',
    type: 'warn',
    confirmText: 'Clear Test Data',
    onConfirm: function() {
      google.script.run
        .withSuccessHandler(function(result) {
          if (result.success) {
            state.traps = state.traps.filter(function(trap) {
              return !trap.trapData || !trap.trapData.simulated;
            });
            updateTrapBadge();
            renderTrapsList();
            renderDashboard();
            showToast('Test data cleared', 'success');
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error clearing test data', 'error');
        })
        .clearAllTraps();
    }
  });
}

/**
 * Start test mode simulation (auto-generate traps periodically)
 */
function startTestModeSimulation() {
  stopTestModeSimulation(); // Clear any existing interval

  if (testModeState.simulateTraps) {
    // Generate a random trap every 30-60 seconds in test mode
    testModeState.testInterval = setInterval(function() {
      if (testModeState.enabled && testModeState.simulateTraps && Math.random() > 0.5) {
        generateTestTrapSilent();
        updateTrapBadge();
        renderTrapsList();
      }
    }, 30000 + Math.random() * 30000);
  }
}

/**
 * Stop test mode simulation
 */
function stopTestModeSimulation() {
  if (testModeState.testInterval) {
    clearInterval(testModeState.testInterval);
    testModeState.testInterval = null;
  }
}

/**
 * Check if in test mode
 */
function isTestMode() {
  return testModeState.enabled;
}

// ============================================
// Teachers Management
// ============================================

// Add teachers array to state
if (!state.teachers) {
  state.teachers = [];
}

// CSV data for import preview
var pendingCSVData = [];

/**
 * Load teachers from server
 */
async function loadTeachers() {
  return new Promise(function(resolve, reject) {
    google.script.run
      .withSuccessHandler(function(teachers) {
        state.teachers = teachers || [];
        renderTeachersTable();
        updateTeachersCount();
        resolve();
      })
      .withFailureHandler(function(err) {
        console.error('Error loading teachers:', err);
        state.teachers = [];
        resolve();
      })
      .getTeachers();
  });
}

/**
 * Update teachers count display
 */
function updateTeachersCount() {
  var countEl = document.getElementById('teachers-count');
  if (countEl) {
    var count = state.teachers.length;
    countEl.textContent = count + ' teacher' + (count !== 1 ? 's' : '');
  }
}

/**
 * Render teachers table
 */
function renderTeachersTable() {
  var tbody = document.getElementById('teachers-table-body');
  if (!tbody) return;

  var teachers = getFilteredTeachers();

  if (teachers.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">' +
      '<div class="empty-state">' +
      '<i data-lucide="users"></i>' +
      '<p>No teachers found</p>' +
      '</div></td></tr>';
    lucide.createIcons();
    return;
  }

  var html = '';
  teachers.forEach(function(teacher) {
    html += '<tr data-id="' + teacher.id + '">';
    html += '<td><span class="emp-id-badge">' + escapeHtml(teacher.empId || '-') + '</span></td>';
    html += '<td><strong>' + escapeHtml(teacher.name || '-') + '</strong></td>';
    html += '<td><a href="mailto:' + escapeHtml(teacher.email || '') + '">' + escapeHtml(teacher.email || '-') + '</a></td>';
    html += '<td>' + escapeHtml(teacher.roomNumber || '-') + '</td>';
    html += '<td class="actions-cell">';
    html += '<button class="btn btn-ghost btn-sm" onclick="editTeacher(\'' + teacher.id + '\')" title="Edit">';
    html += '<i data-lucide="edit-2"></i></button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="confirmDeleteTeacher(\'' + teacher.id + '\')" title="Delete">';
    html += '<i data-lucide="trash-2"></i></button>';
    html += '</td>';
    html += '</tr>';
  });

  tbody.innerHTML = html;
  lucide.createIcons();
}

/**
 * Get filtered teachers based on search input
 */
function getFilteredTeachers() {
  var searchInput = document.getElementById('teacher-search');
  var searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

  if (!searchTerm) {
    return state.teachers;
  }

  return state.teachers.filter(function(teacher) {
    // Convert all fields to strings safely before searching
    var name = (teacher.name || '').toString().toLowerCase();
    var email = (teacher.email || '').toString().toLowerCase();
    var roomNumber = (teacher.roomNumber || '').toString().toLowerCase();
    var empId = (teacher.empId || '').toString().toLowerCase();

    return name.includes(searchTerm) ||
           email.includes(searchTerm) ||
           roomNumber.includes(searchTerm) ||
           empId.includes(searchTerm);
  });
}

/**
 * Filter teachers based on search input
 */
function filterTeachers() {
  renderTeachersTable();
}

/**
 * Show add teacher modal
 */
function showAddTeacherModal() {
  var modal = document.getElementById('add-teacher-modal');
  var title = document.getElementById('add-teacher-title');
  var form = document.getElementById('teacher-form');

  title.textContent = 'Add New Teacher';
  form.reset();
  document.getElementById('teacher-id').value = '';

  modal.classList.add('active');
  lucide.createIcons();
  document.getElementById('teacher-emp-id').focus();
}

/**
 * Edit teacher
 */
function editTeacher(teacherId) {
  var teacher = state.teachers.find(function(t) { return t.id === teacherId; });
  if (!teacher) return;

  var modal = document.getElementById('add-teacher-modal');
  var title = document.getElementById('add-teacher-title');

  title.textContent = 'Edit Teacher';

  document.getElementById('teacher-id').value = teacher.id;
  document.getElementById('teacher-emp-id').value = teacher.empId || '';
  document.getElementById('teacher-name').value = teacher.name || '';
  document.getElementById('teacher-email').value = teacher.email || '';
  document.getElementById('teacher-room').value = teacher.roomNumber || '';

  modal.classList.add('active');
  lucide.createIcons();
}

/**
 * Close add teacher modal
 */
function closeAddTeacherModal() {
  document.getElementById('add-teacher-modal').classList.remove('active');
}

/**
 * Save teacher form
 */
function saveTeacherForm(event) {
  event.preventDefault();

  var teacher = {
    id: document.getElementById('teacher-id').value || undefined,
    empId: document.getElementById('teacher-emp-id').value.trim(),
    name: document.getElementById('teacher-name').value.trim(),
    email: document.getElementById('teacher-email').value.trim(),
    roomNumber: document.getElementById('teacher-room').value.trim()
  };

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        closeAddTeacherModal();
        showToast('Teacher saved successfully', 'success');
        loadTeachers();
      } else {
        showToast(result.error || 'Error saving teacher', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error saving teacher', 'error');
    })
    .saveTeacher(teacher);
}

/**
 * Confirm delete teacher
 */
function confirmDeleteTeacher(teacherId) {
  var teacher = state.teachers.find(function(t) { return t.id === teacherId; });
  if (!teacher) return;

  showConfirmCard({
    title: 'Delete Teacher',
    message: 'Are you sure you want to delete "<strong>' + teacher.name + '</strong>"?',
    type: 'danger',
    confirmText: 'Delete',
    onConfirm: function() {
      google.script.run
        .withSuccessHandler(function(result) {
          if (result.success) {
            showToast('Teacher deleted', 'success');
            loadTeachers();
          } else {
            showToast(result.error || 'Error deleting teacher', 'error');
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error deleting teacher', 'error');
        })
        .deleteTeacher(teacherId);
    }
  });
}

/**
 * Trigger CSV file upload dialog
 */
function triggerCSVUpload() {
  var input = document.getElementById('csv-upload');
  if (input) {
    input.click();
  } else {
    console.error('CSV upload input not found');
    showToast('Error: File input not found', 'error');
  }
}

/**
 * Handle CSV file upload
 */
function handleCSVUpload(event) {
  console.log('handleCSVUpload called', event);
  var file = event.target.files[0];
  if (!file) {
    console.log('No file selected');
    return;
  }
  console.log('File selected:', file.name);
  showToast('Processing CSV file...', 'info');

  var reader = new FileReader();
  reader.onload = function(e) {
    var csvText = e.target.result;
    var parsedData = parseCSV(csvText);

    if (parsedData.length === 0) {
      showToast('No valid data found in CSV', 'warning');
      return;
    }

    pendingCSVData = parsedData;
    showCSVPreviewModal(parsedData);
  };
  reader.readAsText(file);

  // Reset file input
  event.target.value = '';
}

/**
 * Parse CSV text to array of objects
 */
function parseCSV(csvText) {
  var lines = csvText.split(/\r?\n/).filter(function(line) { return line.trim(); });
  if (lines.length < 2) return [];

  // Parse header
  var headers = parseCSVLine(lines[0]).map(function(h) { return h.trim().toLowerCase(); });

  // Parse data rows
  var data = [];
  for (var i = 1; i < lines.length; i++) {
    var values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;

    var row = {};
    headers.forEach(function(header, idx) {
      row[header] = values[idx] ? values[idx].trim() : '';
    });
    data.push(row);
  }

  return data;
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line) {
  var result = [];
  var current = '';
  var inQuotes = false;

  for (var i = 0; i < line.length; i++) {
    var char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);

  return result;
}

/**
 * Show CSV preview modal
 */
function showCSVPreviewModal(data) {
  var modal = document.getElementById('csv-preview-modal');
  var thead = document.getElementById('csv-preview-head');
  var tbody = document.getElementById('csv-preview-body');
  var countEl = document.getElementById('csv-rows-count');

  countEl.textContent = data.length + ' row' + (data.length !== 1 ? 's' : '') + ' found';

  // Build header
  var headerHtml = '<tr>';
  var sampleRow = data[0] || {};
  var headers = Object.keys(sampleRow);
  headers.forEach(function(header) {
    headerHtml += '<th>' + escapeHtml(header) + '</th>';
  });
  headerHtml += '</tr>';
  thead.innerHTML = headerHtml;

  // Build body (show first 10 rows)
  var bodyHtml = '';
  var previewData = data.slice(0, 10);
  previewData.forEach(function(row) {
    bodyHtml += '<tr>';
    headers.forEach(function(header) {
      bodyHtml += '<td>' + escapeHtml(row[header] || '') + '</td>';
    });
    bodyHtml += '</tr>';
  });

  if (data.length > 10) {
    bodyHtml += '<tr class="more-rows"><td colspan="' + headers.length + '">... and ' + (data.length - 10) + ' more rows</td></tr>';
  }

  tbody.innerHTML = bodyHtml;

  modal.classList.add('active');
  lucide.createIcons();
}

/**
 * Close CSV preview modal
 */
function closeCSVPreviewModal() {
  document.getElementById('csv-preview-modal').classList.remove('active');
  pendingCSVData = [];
}

/**
 * Confirm CSV import
 */
function confirmCSVImport() {
  if (pendingCSVData.length === 0) {
    showToast('No data to import', 'warning');
    return;
  }

  // Disable button to prevent double-click
  var importBtn = document.querySelector('#csv-preview-modal .btn-primary');
  if (importBtn) {
    importBtn.disabled = true;
    importBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Importing...';
    lucide.createIcons();
  }

  showToast('Importing ' + pendingCSVData.length + ' teachers... Please wait.', 'info');
  console.log('Starting import of', pendingCSVData.length, 'teachers');

  google.script.run
    .withSuccessHandler(function(result) {
      console.log('Import result:', result);

      // Re-enable button
      if (importBtn) {
        importBtn.disabled = false;
        importBtn.innerHTML = '<i data-lucide="upload"></i> Import Teachers';
        lucide.createIcons();
      }

      if (result && result.success) {
        closeCSVPreviewModal();
        showToast('Success! Imported ' + (result.imported || 0) + ' new, updated ' + (result.updated || 0) + ' existing teachers', 'success');
        loadTeachers();
      } else {
        showToast(result ? result.error : 'Error importing teachers - no response', 'error');
      }
    })
    .withFailureHandler(function(err) {
      console.error('Import failed:', err);

      // Re-enable button
      if (importBtn) {
        importBtn.disabled = false;
        importBtn.innerHTML = '<i data-lucide="upload"></i> Import Teachers';
        lucide.createIcons();
      }

      showToast('Error importing teachers: ' + (err.message || err), 'error');
    })
    .importTeachers(pendingCSVData);
}

/**
 * Export teachers to CSV
 */
function exportTeachersCSV() {
  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success && result.data) {
        downloadCSV(result.data, 'teachers_export.csv');
        showToast('Teachers exported successfully', 'success');
      } else {
        showToast(result.error || 'Error exporting teachers', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error exporting teachers', 'error');
    })
    .exportTeachers();
}

/**
 * Confirm and delete all teachers
 */
function confirmDeleteAllTeachers() {
  var teacherCount = state.teachers ? state.teachers.length : 0;

  if (teacherCount === 0) {
    showToast('No teachers to delete', 'info');
    return;
  }

  showConfirmCard({
    title: 'Delete All Teachers?',
    message: 'Are you sure you want to delete ALL ' + teacherCount + ' teachers?<br><br>This action cannot be undone.',
    type: 'danger',
    confirmText: 'Delete All',
    onConfirm: function() {
      // Double confirmation for safety
      showConfirmCard({
        title: 'Final Warning',
        message: 'This will permanently delete all ' + teacherCount + ' teacher records.',
        type: 'danger',
        confirmText: 'Yes, Delete All',
        onConfirm: function() {
          showToast('Deleting all teachers...', 'info');
          google.script.run
            .withSuccessHandler(function(result) {
              if (result.success) {
                state.teachers = [];
                renderTeachersTable();
                updateTeachersCount();
                showToast('All teachers deleted successfully (' + (result.deleted || 0) + ' removed)', 'success');
              } else {
                showToast(result.error || 'Error deleting teachers', 'error');
              }
            })
            .withFailureHandler(function(err) {
              showToast('Error deleting teachers: ' + err.message, 'error');
            })
            .deleteAllTeachers();
        }
      });
    }
  });
}

/**
 * Download data as CSV file
 */
function downloadCSV(data, filename) {
  if (!data || data.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }

  // Build CSV content
  var headers = ['empId', 'name', 'email', 'roomNumber'];
  var csvContent = headers.join(',') + '\n';

  data.forEach(function(row) {
    var values = headers.map(function(header) {
      var value = row[header] || '';
      // Escape quotes and wrap in quotes if contains comma
      if (value.includes(',') || value.includes('"')) {
        value = '"' + value.replace(/"/g, '""') + '"';
      }
      return value;
    });
    csvContent += values.join(',') + '\n';
  });

  // Create and trigger download
  var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  var url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Escape HTML characters
 */
// Extract meaningful description from SNMP trap data
function extractTrapDescription(trap) {
  // Standard Printer MIB Alert Codes (RFC 3805)
  var ALERT_CODES = {
    1: 'Other Alert',
    3: 'Cover Open',
    5: 'Interlock Open',
    8: 'Paper Jam',
    10: 'Toner Empty',
    11: 'Toner Low',
    12: 'Waste Toner Full',
    13: 'Paper Empty',
    14: 'Paper Low',
    16: 'Door Open',
    20: 'Device Offline',
    25: 'Output Tray Full',
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
    46: 'Misfeed'
  };

  var message = 'SNMP Alert';

  try {
    var data = trap.trapData;
    if (!data) return message;

    // If trapData is a string, try to parse it
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return message; }
    }

    // Check for alert code
    if (data.alertCode && ALERT_CODES[data.alertCode]) {
      return ALERT_CODES[data.alertCode];
    }

    // Check for direct message
    if (data.message && typeof data.message === 'string') {
      return data.message;
    }

    // Check polled_alert type
    if (data.type === 'polled_alert') {
      if (data.supply) {
        var level = data.supply.percentage || 0;
        var name = data.supply.name || 'Supply';
        if (level <= 5) return name + ' Empty (' + level + '%)';
        if (level <= 20) return name + ' Low (' + level + '%)';
      }
      if (data.alert && data.alert.text) {
        return data.alert.text;
      }
    }

    // Check for PDU varbinds
    if (data.pdu && data.pdu.varbinds && Array.isArray(data.pdu.varbinds)) {
      for (var i = 0; i < data.pdu.varbinds.length; i++) {
        var vb = data.pdu.varbinds[i];
        if (!vb.oid) continue;

        // Printer Alert Code OID
        if (vb.oid.indexOf('1.3.6.1.2.1.43.18.1.1.7') !== -1) {
          var code = parseInt(vb.value, 10);
          if (ALERT_CODES[code]) return ALERT_CODES[code];
        }

        // Supply level OID
        if (vb.oid.indexOf('1.3.6.1.2.1.43.11.1.1.9') !== -1 && typeof vb.value === 'number') {
          if (vb.value <= 5) return 'Supply Empty (' + vb.value + '%)';
          if (vb.value <= 20) return 'Supply Low (' + vb.value + '%)';
        }

        // Alert description OID
        if (vb.oid.indexOf('1.3.6.1.2.1.43.18.1.1.8') !== -1 && vb.value) {
          var desc = String(vb.value).trim();
          if (desc.length > 3) return desc;
        }
      }
    }

    // Check for varbinds array directly (some formats)
    if (data.varbinds && Array.isArray(data.varbinds)) {
      for (var j = 0; j < data.varbinds.length; j++) {
        var vb2 = data.varbinds[j];
        if (vb2.value && typeof vb2.value === 'string' && vb2.value.length > 3) {
          // Check if it looks like a meaningful message
          if (!/^[\d\.]+$/.test(vb2.value) && !/^[0-9a-f]+$/i.test(vb2.value)) {
            return vb2.value.substring(0, 100);
          }
        }
      }
    }

    // Try to get any readable info from rawData
    if (data.rawData && typeof data.rawData === 'string') {
      var readable = data.rawData.match(/[A-Za-z\s]{5,}/g);
      if (readable && readable.length > 0) {
        return readable[0].trim().substring(0, 50);
      }
    }

    // Check for OID and show simplified version
    if (data.oid) {
      // Map common OIDs to descriptions
      if (data.oid.indexOf('43.18') !== -1) return 'Printer Alert';
      if (data.oid.indexOf('43.11') !== -1) return 'Supply Alert';
      if (data.oid.indexOf('25.3.5') !== -1) return 'Printer Status Change';
    }

    // NOTE: Raw hex parsing was removed - it was incorrectly interpreting
    // OID bytes (like .43. in 1.3.6.1.2.1.43.18) as alert codes.
    // The gateway's parsedMessage is more reliable.

  } catch (e) {
    console.log('Error extracting trap description:', e);
  }

  return message;
}

function escapeHtml(text) {
  if (!text) return '';
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Load teachers on init
document.addEventListener('DOMContentLoaded', function() {
  // Render icons immediately for static HTML elements
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // Defer loading teachers to after main init
  setTimeout(function() {
    loadTeachers();
    loadDeviceTypes();
    loadIssueButtons();
    loadServiceRequests();
    // Render icons again after dynamic content
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }, 100);
});

// ============================================
// Device Types Management
// ============================================
let deviceTypesData = [];

function loadDeviceTypes() {
  google.script.run
    .withSuccessHandler(function(data) {
      deviceTypesData = data || [];
      console.log('Loaded device types:', JSON.stringify(deviceTypesData, null, 2));
      state.deviceTypes = deviceTypesData; // Also update state
      renderDeviceTypesTable();
      populateDeviceTypeSelects();
      renderDeviceTypeIcons(); // Update icon customization section
      renderDeviceTypeTabs(); // Render device type tabs on map view
      renderManageDeviceTypesList(); // Update manage modal if open
    })
    .withFailureHandler(function(error) {
      console.error('Failed to load device types:', error);
    })
    .getDeviceTypes();
}

// ============================================
// Device Type Dropdown for Map View
// ============================================

/**
 * Toggle device type dropdown menu
 */
function toggleDeviceTypeDropdown() {
  var btn = document.getElementById('device-type-dropdown-btn');
  var menu = document.getElementById('device-type-dropdown-menu');
  if (!btn || !menu) return;

  var isOpen = menu.classList.contains('open');

  if (isOpen) {
    menu.classList.remove('open');
    btn.classList.remove('open');
  } else {
    menu.classList.add('open');
    btn.classList.add('open');
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  var dropdown = document.querySelector('.device-type-dropdown-wrapper');
  if (dropdown && !dropdown.contains(e.target)) {
    var btn = document.getElementById('device-type-dropdown-btn');
    var menu = document.getElementById('device-type-dropdown-menu');
    if (btn) btn.classList.remove('open');
    if (menu) menu.classList.remove('open');
  }
});

/**
 * Render device type dropdown menu
 * Each item corresponds to a device type with its own map
 */
function renderDeviceTypeTabs() {
  var menu = document.getElementById('device-type-dropdown-menu');
  var btnName = document.getElementById('active-device-type-name');
  var btnCount = document.getElementById('active-device-type-count');
  var btnIcon = document.querySelector('#device-type-dropdown-btn .dropdown-icon-wrapper');

  if (!menu) return;

  // Count devices per type
  var deviceCounts = {};
  state.devices.forEach(function(d) {
    var typeKey = (d.type || 'unknown').toLowerCase();
    deviceCounts[typeKey] = (deviceCounts[typeKey] || 0) + 1;
  });

  // Build dropdown HTML
  var html = '';
  var allCount = state.devices.length;
  var isAllActive = state.activeDeviceType === 'all';

  // "All Devices" option
  html += '<div class="device-type-dropdown-item' + (isAllActive ? ' active' : '') + '" data-type-id="all" onclick="selectDeviceTypeTab(\'all\'); toggleDeviceTypeDropdown();">';
  html += '<div class="item-icon"><i data-lucide="layers"></i></div>';
  html += '<div class="item-info"><div class="item-name">All Devices</div><div class="item-count">Show all device types</div></div>';
  html += '<span class="item-badge">' + allCount + '</span>';
  html += '</div>';

  // Update button if All Devices is active
  if (isAllActive && btnName && btnCount && btnIcon) {
    btnName.textContent = 'All Devices';
    btnCount.textContent = allCount;
    btnIcon.innerHTML = '<i data-lucide="layers"></i>';
  }

  // Option for each device type
  deviceTypesData.forEach(function(dt) {
    if (dt.active === false) return; // Skip inactive types

    var isActive = state.activeDeviceType === dt.id;
    var count = 0;

    // Count devices matching this type (by ID or name, case-insensitive)
    var typeIdLower = (dt.id || '').toLowerCase();
    var typeNameLower = (dt.name || '').toLowerCase();
    state.devices.forEach(function(d) {
      var deviceTypeLower = (d.type || '').toLowerCase();
      if (deviceTypeLower === typeIdLower || deviceTypeLower === typeNameLower) {
        count++;
      }
    });

    var iconHtml = '<i data-lucide="' + (dt.icon || 'box') + '"></i>';
    if (dt.icon && dt.icon.startsWith('custom-')) {
      var customIcon = (iconSettings.customIcons || []).find(function(ci) { return ci.id === dt.icon; });
      if (customIcon) {
        iconHtml = '<img src="' + customIcon.dataUrl + '" style="width:18px;height:18px;">';
      }
    }

    html += '<div class="device-type-dropdown-item' + (isActive ? ' active' : '') + '" data-type-id="' + dt.id + '" onclick="selectDeviceTypeTab(\'' + dt.id + '\'); toggleDeviceTypeDropdown();" style="border-left-color: ' + (dt.color || '#6b7280') + ';">';
    html += '<div class="item-icon" style="' + (isActive ? '' : 'background: ' + (dt.color || '#6b7280') + '20; color: ' + (dt.color || '#6b7280') + ';') + '">' + iconHtml + '</div>';
    html += '<div class="item-info"><div class="item-name">' + escapeHtml(dt.name) + '</div><div class="item-count">' + count + ' device' + (count !== 1 ? 's' : '') + '</div></div>';
    html += '<span class="item-badge">' + count + '</span>';
    html += '</div>';

    // Update button if this type is active
    if (isActive && btnName && btnCount && btnIcon) {
      btnName.textContent = dt.name;
      btnCount.textContent = count;
      btnIcon.innerHTML = iconHtml;
    }
  });

  menu.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Select a device type - switches to that type's map and filters devices
 */
async function selectDeviceTypeTab(typeId) {
  state.activeDeviceType = typeId;

  // Update dropdown UI
  var items = document.querySelectorAll('.device-type-dropdown-item');
  items.forEach(function(item) {
    item.classList.toggle('active', item.dataset.typeId === typeId);
  });

  // Update button display
  renderDeviceTypeTabs();

  if (typeId === 'all') {
    // Show ALL devices on the "All Devices" master map
    // Use special blueprint ID 'all-devices-map'
    state.activeBlueprint = 'all-devices-map';
    await updateBlueprintDisplay();
    renderDeviceMarkers();
  } else {
    // Find the device type
    var deviceType = deviceTypesData.find(function(dt) { return dt.id === typeId; });

    if (deviceType && deviceType.blueprintId) {
      // Switch to this device type's blueprint/map
      console.log('Device type has blueprintId:', deviceType.blueprintId);
      state.activeBlueprint = deviceType.blueprintId;
      await updateBlueprintDisplay();
    } else if (deviceType) {
      // Device type exists but no blueprint assigned - show warning and keep current map
      console.log('Device type "' + deviceType.name + '" has no blueprint assigned (blueprintId:', deviceType.blueprintId, ')');
      showToast('No map assigned to "' + deviceType.name + '". Go to Manage Types to assign a map.', 'warning');
      await updateBlueprintDisplay();
    }

    // Re-render markers (filtered by type) after blueprint is loaded
    renderDeviceMarkers();
  }

  console.log('Switched to device type:', typeId, 'activeBlueprint:', state.activeBlueprint, 'deviceTypesData:', deviceTypesData);
}

/**
 * Navigate to a device's type map and zoom to the device
 * Used by QR alerts and SNMP traps
 */
function navigateToDeviceOnMap(deviceId, showAlert) {
  var device = state.devices.find(function(d) { return d.id === deviceId; });
  if (!device) {
    console.log('Device not found:', deviceId);
    return;
  }

  // Find the device's type (case-insensitive)
  var deviceTypeLower = (device.type || '').toLowerCase();
  var deviceType = deviceTypesData.find(function(dt) {
    return (dt.id || '').toLowerCase() === deviceTypeLower ||
           (dt.name || '').toLowerCase() === deviceTypeLower;
  });

  // Switch to the correct device type tab
  if (deviceType) {
    selectDeviceTypeTab(deviceType.id);
  } else {
    selectDeviceTypeTab('all');
  }

  // Zoom to the device
  setTimeout(function() {
    zoomToDevice(deviceId, 2.5, showAlert !== false);
  }, 300);
}

/**
 * Show manage device types modal
 */
function showManageDeviceTypesModal() {
  renderManageDeviceTypesList();
  var modal = document.getElementById('manage-device-types-modal');
  if (modal) modal.classList.add('active');
}

/**
 * Close manage device types modal
 */
function closeManageDeviceTypesModal() {
  var modal = document.getElementById('manage-device-types-modal');
  if (modal) modal.classList.remove('active');
}

/**
 * Render the list of device types in the management modal
 */
function renderManageDeviceTypesList() {
  var container = document.getElementById('device-types-list');
  if (!container) return;

  if (!deviceTypesData || deviceTypesData.length === 0) {
    container.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">No device types configured yet.</div>';
    return;
  }

  var html = deviceTypesData.map(function(dt) {
    // Find the blueprint name
    var blueprintName = 'No map assigned';
    var mapClass = 'no-map';
    if (dt.blueprintId && state.blueprints[dt.blueprintId]) {
      blueprintName = state.blueprints[dt.blueprintId].name || dt.blueprintId;
      mapClass = '';
    }

    // Count devices of this type
    var deviceCount = state.devices.filter(function(d) {
      return d.type === dt.id || d.type === dt.name;
    }).length;

    // Icon HTML
    var iconHtml = '<i data-lucide="' + (dt.icon || 'box') + '"></i>';
    if (dt.icon && dt.icon.startsWith('custom-')) {
      var customIcon = (iconSettings.customIcons || []).find(function(ci) { return ci.id === dt.icon; });
      if (customIcon) {
        iconHtml = '<img src="' + customIcon.dataUrl + '" style="width:24px;height:24px;">';
      }
    }

    return '<div class="device-type-list-item">' +
      '<div class="type-icon" style="background: ' + (dt.color || '#6b7280') + '20; color: ' + (dt.color || '#6b7280') + ';">' + iconHtml + '</div>' +
      '<div class="type-info">' +
        '<div class="type-name">' + escapeHtml(dt.name) + '</div>' +
        '<div class="type-details">' +
          '<span class="type-map ' + mapClass + '"><i data-lucide="map" style="width:12px;height:12px;"></i> ' + escapeHtml(blueprintName) + '</span>' +
          '<span><i data-lucide="cpu" style="width:12px;height:12px;"></i> ' + deviceCount + ' device' + (deviceCount !== 1 ? 's' : '') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="type-actions">' +
        '<button class="btn btn-sm btn-outline" onclick="editDeviceType(\'' + dt.id + '\'); closeManageDeviceTypesModal();" title="Edit">' +
          '<i data-lucide="edit-2"></i>' +
        '</button>' +
        '<button class="btn btn-sm btn-outline btn-danger" onclick="confirmDeleteDeviceType(\'' + dt.id + '\')" title="Delete">' +
          '<i data-lucide="trash-2"></i>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');

  container.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Confirm delete device type
 */
function confirmDeleteDeviceType(typeId) {
  var dt = deviceTypesData.find(function(t) { return t.id === typeId; });
  if (!dt) return;

  showConfirmCard({
    title: 'Delete Device Type?',
    message: 'Delete device type "' + escapeHtml(dt.name) + '"?<br><br>Devices of this type will not be deleted but will need to be reassigned.',
    type: 'warn',
    confirmText: 'Delete',
    onConfirm: function() {
      deleteDeviceType(typeId);
    }
  });
}

/**
 * Show add device type modal
 */
function showAddDeviceTypeModal() {
  closeManageDeviceTypesModal();
  showDeviceTypeModal();
}

/**
 * Populate blueprint dropdown in device type modal
 */
function populateDeviceTypeBlueprintSelect() {
  var select = document.getElementById('device-type-blueprint');
  if (!select) return;

  console.log('Populating blueprint select. state.blueprints:', state.blueprints);

  var html = '<option value="">-- Select Map --</option>';
  Object.keys(state.blueprints).forEach(function(bpId) {
    var bp = state.blueprints[bpId];
    console.log('Blueprint option:', bpId, '->', bp.name);
    html += '<option value="' + bpId + '">' + escapeHtml(bp.name || bpId) + '</option>';
  });

  select.innerHTML = html;
}

function renderDeviceTypesTable() {
  var tbody = document.getElementById('device-types-table-body');
  if (!tbody) return;

  if (!deviceTypesData || deviceTypesData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-message">No device types configured. Add your first device type.</td></tr>';
    return;
  }

  var html = deviceTypesData.map(function(dt) {
    var statusClass = dt.active !== false ? 'status-active' : 'status-inactive';
    var statusText = dt.active !== false ? 'Active' : 'Inactive';
    var iconName = dt.icon || 'printer';

    // Check if it's a custom icon
    var iconHtml;
    if (iconName.startsWith('custom-')) {
      var customIcon = iconSettings.customIcons.find(function(ci) { return ci.id === iconName; });
      if (customIcon) {
        iconHtml = '<img src="' + customIcon.dataUrl + '" alt="' + escapeHtml(customIcon.name) + '" style="width: 24px; height: 24px;">';
      } else {
        iconHtml = '<i data-lucide="printer"></i>';
      }
    } else {
      iconHtml = '<i data-lucide="' + iconName + '"></i>';
    }

    var colorDot = dt.color ? '<span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:' + dt.color + '; margin-left:6px; vertical-align:middle; border:1px solid rgba(0,0,0,0.15);"></span><span style="font-family:monospace; font-size:11px; color:var(--text-muted); margin-left:4px; vertical-align:middle;">' + dt.color + '</span>' : '';

    return '<tr>' +
      '<td class="icon-cell"><div class="device-type-icon-cell">' + iconHtml + colorDot + '</div></td>' +
      '<td>' + escapeHtml(dt.name) + '</td>' +
      '<td>' + escapeHtml(dt.description || '-') + '</td>' +
      '<td><span class="status-badge ' + statusClass + '">' + statusText + '</span></td>' +
      '<td class="actions-cell">' +
        '<button class="btn btn-icon btn-ghost" onclick="editDeviceType(\'' + dt.id + '\')" title="Edit">' +
          '<i data-lucide="edit-2"></i>' +
        '</button>' +
        '<button class="btn btn-icon btn-ghost btn-danger" onclick="deleteDeviceType(\'' + dt.id + '\')" title="Delete">' +
          '<i data-lucide="trash-2"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  tbody.innerHTML = html;
  lucide.createIcons();
}

function getDeviceTypeEmoji(icon) {
  var iconMap = {
    'printer': '🖨️',
    'copier': '📠',
    'projector': '📽️',
    'computer': '💻',
    'router': '🌐',
    'switch': '🔌',
    'ap': '📶',
    'camera': '📷',
    'display': '🖥️',
    'phone': '📞',
    'other': '⚙️'
  };
  return iconMap[icon] || '⚙️';
}

/**
 * Get the icon for a device based on its type
 * Uses the icon configured in Device Types settings
 */
function getDeviceIcon(deviceType) {
  // Find the device type configuration
  var deviceTypeConfig = deviceTypesData.find(function(dt) {
    return dt.name && dt.name.toLowerCase() === (deviceType || '').toLowerCase();
  });

  if (deviceTypeConfig && deviceTypeConfig.icon) {
    var iconName = deviceTypeConfig.icon;

    // Check if it's a custom icon (has dataUrl in iconSettings)
    if (iconSettings && iconSettings.customIcons) {
      var customIcon = iconSettings.customIcons.find(function(i) { return i.id === iconName; });
      if (customIcon) {
        return '<img src="' + customIcon.dataUrl + '" alt="' + escapeHtml(deviceTypeConfig.name) + '" class="marker-custom-icon">';
      }
    }

    // Check if it's an emoji (single character or emoji)
    if (iconName.length <= 2 || /\p{Emoji}/u.test(iconName)) {
      return iconName;
    }

    // It's a Lucide icon name - return as icon element
    return '<i data-lucide="' + iconName + '" class="marker-lucide-icon"></i>';
  }

  // Fallback to default emoji based on type
  var defaultIcons = {
    'printer': '🖨️',
    'copier': '🖨️',
    'router': '🌐',
    'switch': '🔌',
    'access point': '📶',
    'camera': '📷',
    'computer': '💻',
    'display': '🖥️'
  };

  return defaultIcons[(deviceType || '').toLowerCase()] || '📡';
}

function populateDeviceTypeSelects() {
  // Populate the issue button device type select
  var issueButtonSelect = document.getElementById('issue-button-device-type');
  if (issueButtonSelect) {
    var options = '<option value="">Select device type...</option>';
    deviceTypesData.forEach(function(dt) {
      if (dt.active !== false) {
        options += '<option value="' + dt.id + '">' + escapeHtml(dt.name) + '</option>';
      }
    });
    issueButtonSelect.innerHTML = options;
  }

  // Also update the device type filter in Issue Buttons section
  var filterSelect = document.getElementById('issue-buttons-filter-type');
  if (filterSelect) {
    var options = '<option value="">All Device Types</option>';
    deviceTypesData.forEach(function(dt) {
      options += '<option value="' + dt.id + '">' + escapeHtml(dt.name) + '</option>';
    });
    filterSelect.innerHTML = options;
  }

  // Populate device type dropdown in Add/Edit Device modal
  var deviceTypeSelect = document.getElementById('device-type');
  if (deviceTypeSelect) {
    var currentValue = deviceTypeSelect.value;
    var options = '<option value="">Select type...</option>';
    deviceTypesData.forEach(function(dt) {
      if (dt.active !== false) {
        var mapInfo = dt.blueprintId ? ' (has map)' : '';
        options += '<option value="' + dt.id + '">' + escapeHtml(dt.name) + mapInfo + '</option>';
      }
    });
    deviceTypeSelect.innerHTML = options;
    if (currentValue) deviceTypeSelect.value = currentValue;
  }
}

function openAddDeviceTypeModal() {
  document.getElementById('device-type-modal-title').textContent = 'Add Device Type';
  document.getElementById('device-type-form').reset();
  document.getElementById('device-type-id').value = '';
  document.getElementById('device-type-active').checked = true;
  // Reset icon to default
  updateDeviceTypeIconPreview('printer');
  // Reset color to default blue
  var colorInput = document.getElementById('device-type-color');
  var colorHex = document.getElementById('device-type-color-hex');
  var colorPreview = document.getElementById('device-type-color-preview');
  if (colorInput) {
    colorInput.value = '#3b82f6';
    if (colorHex) colorHex.value = '#3b82f6';
    if (colorPreview) colorPreview.style.background = '#3b82f6';
  }
  document.getElementById('device-type-modal').classList.add('active');
  if (typeof lucide !== 'undefined') {
    setTimeout(function() { lucide.createIcons(); }, 50);
  }
}

function editDeviceType(id) {
  var dt = deviceTypesData.find(function(d) { return d.id === id; });
  if (!dt) return;

  // Populate blueprint dropdown first
  populateDeviceTypeBlueprintSelect();

  document.getElementById('device-type-modal-title').textContent = 'Edit Device Type';
  document.getElementById('device-type-id').value = dt.id;
  document.getElementById('device-type-name').value = dt.name || '';
  updateDeviceTypeIconPreview(dt.icon || 'printer');
  document.getElementById('device-type-description').value = dt.description || '';
  document.getElementById('device-type-blueprint').value = dt.blueprintId || '';
  document.getElementById('device-type-active').checked = dt.active !== false;

  // Set the marker color
  var colorInput = document.getElementById('device-type-color');
  var colorHex = document.getElementById('device-type-color-hex');
  var colorPreview = document.getElementById('device-type-color-preview');
  var typeColor = dt.color || '#3b82f6';
  if (colorInput) {
    colorInput.value = typeColor;
    if (colorHex) colorHex.value = typeColor;
    if (colorPreview) colorPreview.style.background = typeColor;
  }

  document.getElementById('device-type-modal').classList.add('active');
  if (typeof lucide !== 'undefined') {
    setTimeout(function() { lucide.createIcons(); }, 50);
  }
}

function showDeviceTypeModal() {
  // Populate blueprint dropdown
  populateDeviceTypeBlueprintSelect();

  document.getElementById('device-type-modal-title').textContent = 'Add Device Type';
  document.getElementById('device-type-form').reset();
  document.getElementById('device-type-id').value = '';
  document.getElementById('device-type-blueprint').value = '';
  updateDeviceTypeIconPreview('printer');
  document.getElementById('device-type-active').checked = true;

  // Reset color to default blue
  var colorInput = document.getElementById('device-type-color');
  var colorHex = document.getElementById('device-type-color-hex');
  var colorPreview = document.getElementById('device-type-color-preview');
  if (colorInput) {
    colorInput.value = '#3b82f6';
    if (colorHex) colorHex.value = '#3b82f6';
    if (colorPreview) colorPreview.style.background = '#3b82f6';
  }

  document.getElementById('device-type-modal').classList.add('active');
  if (typeof lucide !== 'undefined') {
    setTimeout(function() { lucide.createIcons(); }, 50);
  }
}

function closeDeviceTypeModal() {
  document.getElementById('device-type-modal').classList.remove('active');
}

function saveDeviceTypeForm(event) {
  event.preventDefault();

  var blueprintSelect = document.getElementById('device-type-blueprint');
  var selectedBlueprintId = blueprintSelect.value;
  console.log('Saving device type - blueprintId:', selectedBlueprintId);
  console.log('Blueprint select element value:', blueprintSelect.value);
  console.log('Blueprint select selectedIndex:', blueprintSelect.selectedIndex);
  if (blueprintSelect.selectedIndex >= 0) {
    console.log('Selected option text:', blueprintSelect.options[blueprintSelect.selectedIndex].text);
  }

  var data = {
    id: document.getElementById('device-type-id').value || null,
    name: document.getElementById('device-type-name').value.trim(),
    icon: document.getElementById('device-type-icon').value,
    color: document.getElementById('device-type-color').value || '#3b82f6',
    description: document.getElementById('device-type-description').value.trim(),
    blueprintId: selectedBlueprintId,
    active: document.getElementById('device-type-active').checked
  };

  console.log('Data to save:', JSON.stringify(data));

  if (!data.name) {
    showToast('Please enter a type name', 'error');
    return;
  }

  showToast('Saving device type...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      console.log('Save device type result:', JSON.stringify(result));
      showToast('Device type saved successfully', 'success');
      closeDeviceTypeModal();
      loadDeviceTypes();
    })
    .withFailureHandler(function(error) {
      console.error('Save device type error:', error);
      showToast('Error saving device type: ' + error.message, 'error');
    })
    .saveDeviceType(data);
}

function deleteDeviceType(id) {
  var dt = deviceTypesData.find(function(d) { return d.id === id; });
  if (!dt) return;

  showConfirmCard({
    title: 'Delete Device Type',
    message: 'Are you sure you want to delete the device type "<strong>' + dt.name + '</strong>"?',
    type: 'danger',
    confirmText: 'Delete',
    onConfirm: function() {
      showToast('Deleting device type...', 'info');
      google.script.run
        .withSuccessHandler(function(result) {
          showToast('Device type deleted', 'success');
          loadDeviceTypes();
          loadIssueButtons();
        })
        .withFailureHandler(function(error) {
          showToast('Error deleting device type: ' + error.message, 'error');
        })
        .deleteDeviceType(id);
    }
  });
}

// Device Type Icon Picker
var deviceTypeIconPickerTarget = null;

function updateDeviceTypeIconPreview(iconName) {
  var input = document.getElementById('device-type-icon');
  var preview = document.getElementById('device-type-icon-preview');
  var label = document.getElementById('device-type-icon-label');

  if (input) input.value = iconName;
  if (label) label.textContent = iconName;

  if (preview) {
    // Check if it's a custom icon
    var customIcon = iconSettings.customIcons.find(function(i) { return i.id === iconName; });
    if (customIcon) {
      preview.innerHTML = '<img src="' + customIcon.dataUrl + '" alt="' + escapeHtml(customIcon.name) + '" style="width: 20px; height: 20px;">';
    } else {
      preview.innerHTML = '<i data-lucide="' + iconName + '"></i>';
      if (typeof lucide !== 'undefined') {
        setTimeout(function() { lucide.createIcons(); }, 10);
      }
    }
  }
}

// Sync device type color from color picker to hex input + preview swatch
function syncDeviceTypeColor(value) {
  var hexInput = document.getElementById('device-type-color-hex');
  var preview = document.getElementById('device-type-color-preview');
  if (hexInput) hexInput.value = value;
  if (preview) preview.style.background = value;
}

// Sync device type color from hex text input to color picker + preview swatch
function syncDeviceTypeColorFromHex(value) {
  if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
    var colorInput = document.getElementById('device-type-color');
    var preview = document.getElementById('device-type-color-preview');
    if (colorInput) colorInput.value = value;
    if (preview) preview.style.background = value;
  }
}

function showDeviceTypeIconPicker() {
  deviceTypeIconPickerTarget = 'device-type';
  var modal = document.getElementById('device-type-icon-picker-modal');
  if (modal) {
    modal.style.display = 'flex';
    renderDeviceTypeIconPickerGrid('lucide');
  }
}

function closeDeviceTypeIconPicker() {
  var modal = document.getElementById('device-type-icon-picker-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  deviceTypeIconPickerTarget = null;
}

function switchDeviceTypePickerTab(tab) {
  document.querySelectorAll('#device-type-icon-picker-modal .picker-tab').forEach(function(t) {
    t.classList.toggle('active', t.textContent.toLowerCase().includes(tab));
  });
  renderDeviceTypeIconPickerGrid(tab);
}

function renderDeviceTypeIconPickerGrid(tab) {
  var grid = document.getElementById('device-type-icon-picker-grid');
  if (!grid) return;

  var currentIcon = document.getElementById('device-type-icon').value || '';

  if (tab === 'custom') {
    if (iconSettings.customIcons.length === 0) {
      grid.innerHTML = '<div class="no-icons-message">No custom icons. Upload some in Settings → Icon Management!</div>';
      return;
    }

    grid.innerHTML = iconSettings.customIcons.map(function(icon) {
      var selected = currentIcon === icon.id ? ' selected' : '';
      return '<div class="icon-picker-item' + selected + '" data-icon="' + icon.id + '" onclick="selectDeviceTypeIcon(\'' + icon.id + '\')">' +
        '<img src="' + icon.dataUrl + '" alt="' + escapeHtml(icon.name) + '">' +
        '<span>' + escapeHtml(icon.name) + '</span>' +
        '</div>';
    }).join('');
  } else {
    // Lucide icons - show device-related icons first
    var deviceIcons = ['printer', 'monitor', 'laptop', 'smartphone', 'tablet', 'server', 'hard-drive', 'cpu',
      'wifi', 'router', 'network', 'projector', 'camera', 'video', 'mic', 'headphones', 'speaker',
      'phone', 'phone-call', 'tv', 'display', 'airplay', 'cast', 'bluetooth', 'usb', 'cable',
      'plug', 'power', 'battery', 'zap', 'settings', 'cog', 'wrench', 'tool', 'scan', 'qr-code',
      'barcode', 'keyboard', 'mouse', 'gamepad', 'watch', 'radio', 'disc', 'archive', 'box',
      'package', 'truck', 'building', 'home', 'factory', 'warehouse'];

    // Get all icons and sort with device icons first
    var allIcons = [];
    Object.keys(lucideIconLibrary).forEach(function(category) {
      lucideIconLibrary[category].forEach(function(icon) {
        if (allIcons.indexOf(icon) === -1) {
          allIcons.push(icon);
        }
      });
    });

    // Sort: device icons first, then alphabetical
    allIcons.sort(function(a, b) {
      var aIsDevice = deviceIcons.indexOf(a) !== -1;
      var bIsDevice = deviceIcons.indexOf(b) !== -1;
      if (aIsDevice && !bIsDevice) return -1;
      if (!aIsDevice && bIsDevice) return 1;
      return a.localeCompare(b);
    });

    grid.innerHTML = allIcons.map(function(icon) {
      var selected = currentIcon === icon ? ' selected' : '';
      return '<div class="icon-picker-item' + selected + '" data-icon="' + icon + '" onclick="selectDeviceTypeIcon(\'' + icon + '\')">' +
        '<i data-lucide="' + icon + '"></i>' +
        '<span>' + icon + '</span>' +
        '</div>';
    }).join('');

    if (typeof lucide !== 'undefined') {
      setTimeout(function() { lucide.createIcons(); }, 50);
    }
  }
}

function filterDeviceTypePickerIcons(search) {
  var grid = document.getElementById('device-type-icon-picker-grid');
  if (!grid) return;

  var items = grid.querySelectorAll('.icon-picker-item');
  var searchLower = search.toLowerCase();

  items.forEach(function(item) {
    var iconName = item.dataset.icon;
    var label = item.querySelector('span');
    var matches = !search || iconName.toLowerCase().includes(searchLower) ||
      (label && label.textContent.toLowerCase().includes(searchLower));
    item.style.display = matches ? '' : 'none';
  });
}

function selectDeviceTypeIcon(iconName) {
  updateDeviceTypeIconPreview(iconName);
  closeDeviceTypeIconPicker();
}

// ============================================
// Issue Buttons Management
// ============================================
let issueButtonsData = [];

function loadIssueButtons() {
  google.script.run
    .withSuccessHandler(function(data) {
      issueButtonsData = data || [];
      renderIssueButtonsTable();
    })
    .withFailureHandler(function(error) {
      console.error('Failed to load issue buttons:', error);
    })
    .getIssueButtons();
}

function renderIssueButtonsTable(filterDeviceTypeId) {
  var tbody = document.getElementById('issue-buttons-table-body');
  if (!tbody) return;

  var filtered = issueButtonsData;
  if (filterDeviceTypeId) {
    filtered = issueButtonsData.filter(function(ib) {
      return ib.deviceTypeId === filterDeviceTypeId;
    });
  }

  if (!filtered || filtered.length === 0) {
    var msg = filterDeviceTypeId ? 'No issue buttons for this device type.' : 'No issue buttons configured. Add your first issue button.';
    tbody.innerHTML = '<tr><td colspan="5" class="empty-message">' + msg + '</td></tr>';
    return;
  }

  var html = filtered.map(function(ib) {
    var deviceType = deviceTypesData.find(function(dt) { return dt.id === ib.deviceTypeId; });
    var deviceTypeName = deviceType ? deviceType.name : 'Unknown';
    var iconHtml = getIssueButtonIconHtml(ib.icon);
    var priorityClass = 'priority-' + (ib.priority || 'medium');
    var statusClass = ib.active !== false ? 'status-active' : 'status-inactive';
    var statusText = ib.active !== false ? 'Active' : 'Inactive';

    return '<tr>' +
      '<td>' + escapeHtml(deviceTypeName) + '</td>' +
      '<td><span class="issue-icon">' + iconHtml + '</span> ' + escapeHtml(ib.label) + '</td>' +
      '<td><span class="priority-badge ' + priorityClass + '">' + escapeHtml(ib.priority || 'medium') + '</span></td>' +
      '<td><span class="status-badge ' + statusClass + '">' + statusText + '</span></td>' +
      '<td class="actions-cell">' +
        '<button class="btn btn-icon btn-ghost" onclick="editIssueButton(\'' + ib.id + '\')" title="Edit">' +
          '<i data-lucide="edit-2"></i>' +
        '</button>' +
        '<button class="btn btn-icon btn-ghost btn-danger" onclick="deleteIssueButton(\'' + ib.id + '\')" title="Delete">' +
          '<i data-lucide="trash-2"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  tbody.innerHTML = html;
  lucide.createIcons();
}

function getIssueButtonIconHtml(icon) {
  if (!icon) return '<i data-lucide="alert-circle"></i>';

  // Check if it's an emoji (starts with emoji: prefix or is an actual emoji)
  if (icon.startsWith('emoji:')) {
    return '<span class="emoji-icon">' + icon.substring(6) + '</span>';
  }

  // Check if it's already an emoji character
  var emojiRegex = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  if (emojiRegex.test(icon)) {
    return '<span class="emoji-icon">' + icon + '</span>';
  }

  // Check if it's a custom icon
  if (icon.startsWith('custom:') || (typeof iconSettings !== 'undefined' && iconSettings.customIcons)) {
    var iconId = icon.startsWith('custom:') ? icon.substring(7) : icon;
    var customIcon = typeof iconSettings !== 'undefined' && iconSettings.customIcons ?
      iconSettings.customIcons.find(function(i) { return i.id === iconId; }) : null;
    if (customIcon) {
      return '<img src="' + customIcon.dataUrl + '" alt="' + escapeHtml(customIcon.name) + '" class="custom-icon-img">';
    }
  }

  // Default to Lucide icon
  return '<i data-lucide="' + escapeHtml(icon) + '"></i>';
}

// Legacy function for backward compatibility
function getIssueButtonEmoji(icon) {
  var iconMap = {
    'alert-circle': '⚠️',
    'file-text': '📄',
    'droplet': '💧',
    'settings': '⚙️',
    'power': '🔌',
    'wifi': '📶',
    'refresh-cw': '🔄',
    'thermometer': '🌡️',
    'volume-x': '🔇',
    'monitor': '🖥️',
    'help-circle': '❓'
  };
  return iconMap[icon] || '⚠️';
}

function filterIssueButtons() {
  var filterValue = document.getElementById('issue-buttons-filter-type').value;
  renderIssueButtonsTable(filterValue || null);
}

function openAddIssueButtonModal() {
  document.getElementById('issue-button-modal-title').textContent = 'Add Issue Button';
  document.getElementById('issue-button-form').reset();
  document.getElementById('issue-button-id').value = '';
  document.getElementById('issue-button-active').checked = true;
  document.getElementById('issue-button-order').value = '0';
  document.getElementById('issue-button-priority').value = 'medium';
  updateIssueButtonIconPreview('alert-circle');
  populateDeviceTypeSelects();
  document.getElementById('issue-button-modal').classList.add('active');
}

function editIssueButton(id) {
  var ib = issueButtonsData.find(function(i) { return i.id === id; });
  if (!ib) return;

  populateDeviceTypeSelects();

  document.getElementById('issue-button-modal-title').textContent = 'Edit Issue Button';
  document.getElementById('issue-button-id').value = ib.id;
  document.getElementById('issue-button-device-type').value = ib.deviceTypeId || '';
  document.getElementById('issue-button-label').value = ib.label || '';
  updateIssueButtonIconPreview(ib.icon || 'alert-circle');
  document.getElementById('issue-button-priority').value = ib.priority || 'medium';
  document.getElementById('issue-button-order').value = ib.displayOrder || 0;
  document.getElementById('issue-button-active').checked = ib.active !== false;
  document.getElementById('issue-button-modal').classList.add('active');
}

function closeIssueButtonModal() {
  document.getElementById('issue-button-modal').classList.remove('active');
}

function saveIssueButtonForm(event) {
  event.preventDefault();

  var data = {
    id: document.getElementById('issue-button-id').value || null,
    deviceTypeId: document.getElementById('issue-button-device-type').value,
    label: document.getElementById('issue-button-label').value.trim(),
    icon: document.getElementById('issue-button-icon').value,
    priority: document.getElementById('issue-button-priority').value,
    displayOrder: parseInt(document.getElementById('issue-button-order').value) || 0,
    active: document.getElementById('issue-button-active').checked
  };

  if (!data.deviceTypeId) {
    showToast('Please select a device type', 'error');
    return;
  }

  if (!data.label) {
    showToast('Please enter a button label', 'error');
    return;
  }

  showToast('Saving issue button...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      showToast('Issue button saved successfully', 'success');
      closeIssueButtonModal();
      loadIssueButtons();
    })
    .withFailureHandler(function(error) {
      showToast('Error saving issue button: ' + error.message, 'error');
    })
    .saveIssueButton(data);
}

function deleteIssueButton(id) {
  var ib = issueButtonsData.find(function(i) { return i.id === id; });
  if (!ib) return;

  showConfirmCard({
    title: 'Delete Issue Button',
    message: 'Are you sure you want to delete the issue button "<strong>' + ib.label + '</strong>"?',
    type: 'danger',
    confirmText: 'Delete',
    onConfirm: function() {
      showToast('Deleting issue button...', 'info');
      google.script.run
        .withSuccessHandler(function(result) {
          showToast('Issue button deleted', 'success');
          loadIssueButtons();
        })
        .withFailureHandler(function(error) {
          showToast('Error deleting issue button: ' + error.message, 'error');
        })
        .deleteIssueButton(id);
    }
  });
}

// Issue Button Icon Picker
var issueButtonIconPickerTarget = null;

function updateIssueButtonIconPreview(iconName) {
  var input = document.getElementById('issue-button-icon');
  var preview = document.getElementById('issue-button-icon-preview');
  var label = document.getElementById('issue-button-icon-label');

  if (input) input.value = iconName;

  // Determine display label
  var displayLabel = iconName;
  if (iconName.startsWith('emoji:')) {
    displayLabel = iconName.substring(6) + ' (emoji)';
  } else if (iconName.startsWith('custom:')) {
    var customIcon = typeof iconSettings !== 'undefined' && iconSettings.customIcons ?
      iconSettings.customIcons.find(function(i) { return i.id === iconName.substring(7); }) : null;
    displayLabel = customIcon ? customIcon.name : iconName.substring(7);
  }
  if (label) label.textContent = displayLabel;

  if (preview) {
    // Check if it's an emoji
    if (iconName.startsWith('emoji:')) {
      preview.innerHTML = '<span class="emoji-icon" style="font-size: 20px;">' + iconName.substring(6) + '</span>';
    }
    // Check if it's a custom icon
    else if (iconName.startsWith('custom:')) {
      var iconId = iconName.substring(7);
      var customIcon = typeof iconSettings !== 'undefined' && iconSettings.customIcons ?
        iconSettings.customIcons.find(function(i) { return i.id === iconId; }) : null;
      if (customIcon) {
        preview.innerHTML = '<img src="' + customIcon.dataUrl + '" alt="' + escapeHtml(customIcon.name) + '" style="width: 20px; height: 20px;">';
      } else {
        preview.innerHTML = '<i data-lucide="alert-circle"></i>';
      }
    }
    // Check if custom icon without prefix
    else if (typeof iconSettings !== 'undefined' && iconSettings.customIcons) {
      var customIcon = iconSettings.customIcons.find(function(i) { return i.id === iconName; });
      if (customIcon) {
        preview.innerHTML = '<img src="' + customIcon.dataUrl + '" alt="' + escapeHtml(customIcon.name) + '" style="width: 20px; height: 20px;">';
      } else {
        preview.innerHTML = '<i data-lucide="' + iconName + '"></i>';
        if (typeof lucide !== 'undefined') {
          setTimeout(function() { lucide.createIcons(); }, 10);
        }
      }
    } else {
      // Lucide icon
      preview.innerHTML = '<i data-lucide="' + iconName + '"></i>';
      if (typeof lucide !== 'undefined') {
        setTimeout(function() { lucide.createIcons(); }, 10);
      }
    }
  }
}

function showIssueButtonIconPicker() {
  issueButtonIconPickerTarget = 'issue-button';
  var modal = document.getElementById('issue-button-icon-picker-modal');
  if (modal) {
    modal.style.display = 'flex';
    renderIssueButtonIconPickerGrid('lucide');
  }
}

function closeIssueButtonIconPicker() {
  var modal = document.getElementById('issue-button-icon-picker-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  issueButtonIconPickerTarget = null;
}

function switchIssueButtonPickerTab(tab) {
  document.querySelectorAll('#issue-button-icon-picker-modal .picker-tab').forEach(function(t) {
    t.classList.toggle('active', t.textContent.toLowerCase().includes(tab));
  });
  renderIssueButtonIconPickerGrid(tab);
}

function renderIssueButtonIconPickerGrid(tab) {
  var grid = document.getElementById('issue-button-icon-picker-grid');
  if (!grid) return;

  var currentIcon = document.getElementById('issue-button-icon').value || '';

  if (tab === 'custom') {
    if (typeof iconSettings === 'undefined' || !iconSettings.customIcons || iconSettings.customIcons.length === 0) {
      grid.innerHTML = '<div class="no-icons-message">No custom icons. Upload some in Settings → Icon Management!</div>';
      return;
    }

    grid.innerHTML = iconSettings.customIcons.map(function(icon) {
      var iconValue = 'custom:' + icon.id;
      var selected = currentIcon === iconValue || currentIcon === icon.id ? ' selected' : '';
      return '<div class="icon-picker-item' + selected + '" data-icon="' + iconValue + '" onclick="selectIssueButtonIcon(\'' + iconValue + '\')">' +
        '<img src="' + icon.dataUrl + '" alt="' + escapeHtml(icon.name) + '">' +
        '<span>' + escapeHtml(icon.name) + '</span>' +
        '</div>';
    }).join('');
  } else if (tab === 'emoji') {
    // Common issue-related emojis
    var issueEmojis = [
      { emoji: '⚠️', name: 'Warning' },
      { emoji: '🔴', name: 'Red Circle' },
      { emoji: '🟡', name: 'Yellow Circle' },
      { emoji: '🟢', name: 'Green Circle' },
      { emoji: '❌', name: 'X Mark' },
      { emoji: '✅', name: 'Check Mark' },
      { emoji: '❓', name: 'Question' },
      { emoji: '❗', name: 'Exclamation' },
      { emoji: '🔧', name: 'Wrench' },
      { emoji: '🔨', name: 'Hammer' },
      { emoji: '⚙️', name: 'Gear' },
      { emoji: '🔌', name: 'Power Plug' },
      { emoji: '💡', name: 'Light Bulb' },
      { emoji: '🔋', name: 'Battery' },
      { emoji: '📶', name: 'Signal' },
      { emoji: '📡', name: 'Antenna' },
      { emoji: '🖥️', name: 'Monitor' },
      { emoji: '💻', name: 'Laptop' },
      { emoji: '🖨️', name: 'Printer' },
      { emoji: '📄', name: 'Document' },
      { emoji: '📝', name: 'Memo' },
      { emoji: '📋', name: 'Clipboard' },
      { emoji: '💧', name: 'Water Drop' },
      { emoji: '🌡️', name: 'Thermometer' },
      { emoji: '🔥', name: 'Fire' },
      { emoji: '❄️', name: 'Snowflake' },
      { emoji: '🔇', name: 'Mute' },
      { emoji: '🔊', name: 'Sound' },
      { emoji: '🎵', name: 'Music' },
      { emoji: '📸', name: 'Camera' },
      { emoji: '🔒', name: 'Lock' },
      { emoji: '🔓', name: 'Unlock' },
      { emoji: '🗑️', name: 'Trash' },
      { emoji: '📦', name: 'Package' },
      { emoji: '⏱️', name: 'Timer' },
      { emoji: '⏰', name: 'Alarm' },
      { emoji: '🔄', name: 'Refresh' },
      { emoji: '⬆️', name: 'Up Arrow' },
      { emoji: '⬇️', name: 'Down Arrow' },
      { emoji: '👆', name: 'Point Up' },
      { emoji: '✋', name: 'Stop Hand' },
      { emoji: '👍', name: 'Thumbs Up' },
      { emoji: '👎', name: 'Thumbs Down' },
      { emoji: '💬', name: 'Speech Bubble' },
      { emoji: '📢', name: 'Megaphone' },
      { emoji: '🚫', name: 'Prohibited' },
      { emoji: '⛔', name: 'No Entry' },
      { emoji: '🆘', name: 'SOS' },
      { emoji: '🆕', name: 'New' }
    ];

    grid.innerHTML = issueEmojis.map(function(item) {
      var iconValue = 'emoji:' + item.emoji;
      var selected = currentIcon === iconValue ? ' selected' : '';
      return '<div class="icon-picker-item' + selected + '" data-icon="' + iconValue + '" onclick="selectIssueButtonIcon(\'' + iconValue + '\')">' +
        '<span class="emoji-icon" style="font-size: 24px;">' + item.emoji + '</span>' +
        '<span>' + escapeHtml(item.name) + '</span>' +
        '</div>';
    }).join('');
  } else {
    // Lucide icons - show issue-related icons first
    var issueIcons = ['alert-circle', 'alert-triangle', 'alert-octagon', 'info', 'help-circle',
      'x-circle', 'check-circle', 'minus-circle', 'plus-circle', 'ban',
      'power', 'power-off', 'plug', 'zap', 'zap-off', 'battery', 'battery-low', 'battery-warning',
      'wifi', 'wifi-off', 'signal', 'signal-low', 'signal-medium', 'signal-high',
      'monitor', 'monitor-off', 'tv', 'smartphone', 'tablet', 'laptop',
      'printer', 'file-text', 'file-warning', 'files', 'folder', 'clipboard',
      'droplet', 'droplets', 'thermometer', 'flame', 'snowflake', 'sun', 'moon',
      'volume-x', 'volume-1', 'volume-2', 'mic', 'mic-off', 'speaker', 'headphones',
      'settings', 'settings-2', 'wrench', 'hammer', 'tool', 'scissors',
      'refresh-cw', 'refresh-ccw', 'rotate-cw', 'rotate-ccw', 'loader',
      'lock', 'unlock', 'key', 'shield', 'shield-alert', 'shield-check',
      'clock', 'timer', 'alarm-clock', 'hourglass', 'calendar',
      'trash', 'trash-2', 'archive', 'package', 'box', 'inbox',
      'eye', 'eye-off', 'camera', 'image', 'video', 'video-off',
      'message-circle', 'message-square', 'mail', 'bell', 'bell-off',
      'cloud', 'cloud-off', 'upload', 'download', 'server', 'database',
      'cpu', 'hard-drive', 'memory-stick', 'usb',
      'hand', 'thumbs-up', 'thumbs-down', 'flag', 'bookmark', 'star'];

    // Get all icons and sort with issue icons first
    var allIcons = [];
    if (typeof lucideIconLibrary !== 'undefined') {
      Object.keys(lucideIconLibrary).forEach(function(category) {
        lucideIconLibrary[category].forEach(function(icon) {
          if (allIcons.indexOf(icon) === -1) {
            allIcons.push(icon);
          }
        });
      });
    } else {
      allIcons = issueIcons;
    }

    // Sort: issue icons first, then alphabetical
    allIcons.sort(function(a, b) {
      var aIsIssue = issueIcons.indexOf(a) !== -1;
      var bIsIssue = issueIcons.indexOf(b) !== -1;
      if (aIsIssue && !bIsIssue) return -1;
      if (!aIsIssue && bIsIssue) return 1;
      return a.localeCompare(b);
    });

    grid.innerHTML = allIcons.map(function(icon) {
      var selected = currentIcon === icon ? ' selected' : '';
      return '<div class="icon-picker-item' + selected + '" data-icon="' + icon + '" onclick="selectIssueButtonIcon(\'' + icon + '\')">' +
        '<i data-lucide="' + icon + '"></i>' +
        '<span>' + icon + '</span>' +
        '</div>';
    }).join('');

    if (typeof lucide !== 'undefined') {
      setTimeout(function() { lucide.createIcons(); }, 50);
    }
  }
}

function filterIssueButtonPickerIcons(search) {
  var grid = document.getElementById('issue-button-icon-picker-grid');
  if (!grid) return;

  var items = grid.querySelectorAll('.icon-picker-item');
  var searchLower = search.toLowerCase();

  items.forEach(function(item) {
    var iconName = item.dataset.icon || '';
    var label = item.querySelector('span:last-child');
    var labelText = label ? label.textContent : '';
    var matches = !search || iconName.toLowerCase().includes(searchLower) ||
      labelText.toLowerCase().includes(searchLower);
    item.style.display = matches ? '' : 'none';
  });
}

function selectIssueButtonIcon(iconName) {
  updateIssueButtonIconPreview(iconName);
  closeIssueButtonIconPicker();
}

// ============================================
// Service Requests Management
// ============================================
let serviceRequestsData = [];
let currentServiceRequestId = null;

/**
 * Apply an optimistic update to local serviceRequestsData and re-render UI instantly.
 * Returns the previous data snapshot for rollback on failure.
 */
function applyOptimisticUpdate(requestId, changes) {
  // Save snapshot for rollback
  var snapshot = serviceRequestsData.map(function(sr) { return Object.assign({}, sr); });

  // Find and update the request locally
  var sr = serviceRequestsData.find(function(s) { return s.id === requestId; });
  if (sr) {
    Object.keys(changes).forEach(function(key) { sr[key] = changes[key]; });
  }

  // Re-render UI immediately (no server wait)
  renderServiceRequestsTable();
  updateServiceRequestStats();
  updateServiceRequestsBadge();
  updateMarkerBadges();

  return snapshot;
}

/**
 * Revert serviceRequestsData to a previous snapshot (on server failure).
 */
function revertOptimisticUpdate(snapshot) {
  serviceRequestsData = snapshot;
  renderServiceRequestsTable();
  updateServiceRequestStats();
  updateServiceRequestsBadge();
  updateMarkerBadges();
}

/**
 * Merge server-returned updatedRequest into local serviceRequestsData
 * without a full reload from server.
 */
function mergeServerUpdate(updatedRequest) {
  if (!updatedRequest || !updatedRequest.id) return;
  var sr = serviceRequestsData.find(function(s) { return s.id === updatedRequest.id; });
  if (sr) {
    Object.keys(updatedRequest).forEach(function(key) { sr[key] = updatedRequest[key]; });
  }
  // Light re-render to reflect any corrections from server
  renderServiceRequestsTable();
  updateServiceRequestStats();
  updateServiceRequestsBadge();
  updateMarkerBadges();
}

/**
 * Lightweight badge-only update for map markers.
 * Updates existing marker badges and classes without full DOM rebuild.
 * Use this instead of renderDeviceMarkers() after service request changes.
 */
function updateMarkerBadges() {
  var container = document.getElementById('device-markers');
  if (!container) return;

  var markers = container.querySelectorAll('.device-marker');
  markers.forEach(function(marker) {
    var deviceId = (marker.id || '').replace('marker-', '');
    if (!deviceId) return;

    var device = state.devices.find(function(d) { return d.id === deviceId; });
    if (!device) return;

    // Count pending/in-progress service requests for this device
    var deviceSRs = (serviceRequestsData || []).filter(function(sr) {
      return (sr.status === 'pending' || sr.status === 'in-progress') && serviceRequestMatchesDevice(sr, device);
    });
    var pendingSRs = deviceSRs.length;

    // Count unresolved traps
    var unresolvedTraps = state.traps.filter(function(t) {
      return t.sourceIp === device.ip && t.processed === 0;
    }).length;

    var totalAlerts = unresolvedTraps + pendingSRs;

    // Update badge
    var badge = marker.querySelector('.trap-badge');
    if (totalAlerts > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'trap-badge';
        marker.appendChild(badge);
      }
      badge.textContent = totalAlerts;
      badge.classList.toggle('service-request-badge', pendingSRs > 0);
      marker.classList.add('has-active-alert');
      marker.classList.toggle('has-service-request', pendingSRs > 0);
      marker.classList.toggle('has-alert', unresolvedTraps > 0);
    } else {
      if (badge) badge.remove();
      marker.classList.remove('has-active-alert', 'has-service-request', 'has-alert');
    }
  });

  // Update tooltip overlay
  updateAlertTooltipOverlay();
}

/**
 * Check if a service request matches a specific device.
 * Primary match: by deviceId. Fallback: by name + location (or unique name).
 * This prevents a request from matching ALL devices with the same name.
 */
function serviceRequestMatchesDevice(sr, device) {
  // Primary match: by deviceId (most reliable)
  if (sr.deviceId && device.id && String(sr.deviceId) === String(device.id)) {
    return true;
  }
  // Fallback: only match by name if service request has no deviceId
  if (!sr.deviceId && sr.deviceName && device.name && sr.deviceName === device.name) {
    // Require location match if both have location info
    if (sr.location && device.location) {
      return sr.location === device.location;
    }
    // If no location to compare, only match if there's exactly one device with this name
    var sameNameCount = state.devices.filter(function(d) { return d.name === device.name; }).length;
    return sameNameCount === 1;
  }
  return false;
}

function loadServiceRequests() {
  // Prevent overlapping loads
  if (state.serviceRequestsLoading) return;
  state.serviceRequestsLoading = true;

  google.script.run
    .withSuccessHandler(function(data) {
      state.serviceRequestsLoading = false;
      var newRequests = data || [];
      var previousIds = state.previousServiceRequestIds || [];
      var isFirstLoad = state.serviceRequestsInitialized !== true;

      console.log('📋 Service requests loaded:', newRequests.length, 'Previous IDs:', previousIds.length, 'First load:', isFirstLoad);

      // Detect new service requests by comparing IDs (more reliable)
      var newPendingRequests = newRequests.filter(function(sr) {
        return sr.status === 'pending' && previousIds.indexOf(sr.id) === -1;
      });

      console.log('🆕 New pending requests found:', newPendingRequests.length);

      // Trigger alert for each genuinely new request (skip on first load to avoid false alerts)
      if (newPendingRequests.length > 0 && !isFirstLoad) {
        console.log('🔔 Triggering alerts for new requests:', newPendingRequests);
        newPendingRequests.forEach(function(sr) {
          triggerServiceRequestAlert(sr);
        });

        // Show notification
        var newCount = newPendingRequests.length;
        showToast('🔔 ' + newCount + ' new service request' + (newCount > 1 ? 's' : '') + ' received!', 'warning');
      }

      // Mark as initialized and store current IDs for next comparison
      state.serviceRequestsInitialized = true;
      state.previousServiceRequestCount = newRequests.length;
      state.previousServiceRequestIds = newRequests.map(function(sr) { return sr.id; });

      serviceRequestsData = newRequests;
      renderServiceRequestsTable();
      updateServiceRequestStats();
      updateServiceRequestsBadge();
      loadAlertCards(); // Update dashboard alert cards
      updateMarkerBadges(); // Lightweight badge update (not full renderDeviceMarkers rebuild)
    })
    .withFailureHandler(function(error) {
      state.serviceRequestsLoading = false;
      console.error('Failed to load service requests:', error);
    })
    .getServiceRequests();
}

// Auto-refresh service requests every 30 seconds (was 15s — reduced server load)
function setupServiceRequestAutoRefresh() {
  // Initial load
  loadServiceRequests();

  // Set up interval with visibility check
  state.serviceRequestRefreshInterval = setInterval(function() {
    // Skip refresh when tab is hidden (saves server resources)
    if (document.hidden) return;
    loadServiceRequests();
  }, 30000); // 30 seconds
}

// Trigger alert for new service request
function triggerServiceRequestAlert(serviceRequest) {
  log('🔔 New service request alert:', serviceRequest);

  // Find the device associated with this request
  // IMPORTANT: Match primarily by deviceId, only use deviceName as fallback if deviceId is empty
  var device = state.devices.find(function(d) {
    // Primary match: by deviceId (most reliable)
    if (serviceRequest.deviceId && d.id && serviceRequest.deviceId === d.id) {
      return true;
    }
    // Fallback: only match by name if service request has no deviceId
    if (!serviceRequest.deviceId && serviceRequest.deviceName && d.name && serviceRequest.deviceName === d.name) {
      return true;
    }
    return false;
  });

  if (device) {
    state.serviceRequestAlertingDevices.add(device.id);

    // Find device marker and add service-request-alert class
    var marker = document.getElementById('marker-' + device.id);
    if (marker) {
      marker.classList.add('service-request-alert');
      marker.classList.add('new-service-request');
      setTimeout(function() {
        marker.classList.remove('service-request-alert');
        marker.classList.remove('new-service-request');
      }, 3000);
    }

    // Auto-navigate to device's map (device type tab) and zoom to it
    var autoZoomEnabled = localStorage.getItem('codemap-auto-zoom-alerts') !== 'false';
    var hasPosition = device.x !== undefined && device.x !== null && device.x !== '' &&
                      device.y !== undefined && device.y !== null && device.y !== '';
    var hasBlueprint = state.blueprints && Object.keys(state.blueprints).length > 0;

    if (autoZoomEnabled && hasPosition && hasBlueprint) {
      // Small delay to let the user see the notification first
      // Use navigateToDeviceOnMap to switch to correct device type tab and zoom
      setTimeout(function() {
        navigateToDeviceOnMap(device.id, true);
      }, 500);
    }

    // Remove alerting state after 15 seconds
    setTimeout(function() {
      state.serviceRequestAlertingDevices.delete(device.id);
      renderDeviceMarkers();
    }, 15000);
  }

  // Play distinct service request alert tone
  AudioAlert.playServiceRequestAlert();

  // Show visual flash on screen
  showServiceRequestFlash(serviceRequest);

  // Re-render markers
  renderDeviceMarkers();
}

// Show a visual flash notification for new service requests
function showServiceRequestFlash(sr) {
  var issueDisplay = sr.issueLabel || sr.issueType || 'New Request';
  var deviceName = sr.deviceName || 'Unknown Device';
  var reporter = sr.employeeName || sr.submitterName || 'Someone';

  // Create flash notification
  var flash = document.createElement('div');
  flash.className = 'service-request-flash';
  var deviceId = sr.deviceId || '';
  flash.innerHTML = '<div class="flash-icon">🔔</div>' +
    '<div class="flash-content">' +
    '<div class="flash-title">New Service Request</div>' +
    '<div class="flash-device">' + escapeHtml(deviceName) + '</div>' +
    '<div class="flash-issue">' + escapeHtml(issueDisplay) + '</div>' +
    '<div class="flash-reporter">Reported by: ' + escapeHtml(reporter) + '</div>' +
    '</div>' +
    '<button class="flash-close" onclick="event.stopPropagation(); this.parentElement.remove()">×</button>';

  // Clicking the flash opens the device detail and dismisses
  if (deviceId) {
    flash.style.cursor = 'pointer';
    flash.onclick = function() {
      showEnhancedDeviceModal(deviceId);
      flash.classList.add('hiding');
      setTimeout(function() { flash.remove(); }, 300);
    };
  }

  document.body.appendChild(flash);

  // Stay on screen until user clicks the device alert icon or closes manually
  // No auto-dismiss — the X button or clicking the marker removes it
}

function renderServiceRequestsTable() {
  var tbody = document.getElementById('service-requests-table-body');
  if (!tbody) return;

  var filterStatus = (document.getElementById('sr-filter-status') || {}).value || '';
  var filterSource = (document.getElementById('sr-filter-source') || {}).value || '';

  var filtered = serviceRequestsData;
  if (filterStatus) {
    filtered = filtered.filter(function(sr) { return sr.status === filterStatus; });
  }
  if (filterSource) {
    filtered = filtered.filter(function(sr) { return sr.source === filterSource; });
  }

  if (!filtered || filtered.length === 0) {
    var msg = (filterStatus || filterSource) ? 'No requests matching the selected filters.' : 'No service requests found.';
    tbody.innerHTML = '<tr><td colspan="7" class="empty-message">' + msg + '</td></tr>';
    return;
  }

  var html = filtered.map(function(sr) {
    var statusClass = 'status-' + (sr.status || 'pending').toLowerCase().replace(/\s/g, '-');
    var date = sr.submittedAt || sr.createdAt;
    var dateStr = date ? new Date(date).toLocaleString() : '-';
    var sourceBadge = sr.source === 'helpdesk'
      ? '<span class="source-badge source-helpdesk">Help Desk</span>'
      : '<span class="source-badge source-qr">QR Scan</span>';
    var requester = sr.employeeName || '-';
    var issue = sr.issueLabel || sr.issueType || sr.category || '-';

    return '<tr>' +
      '<td style="white-space:nowrap; font-size:12px;">' + dateStr + '</td>' +
      '<td>' + sourceBadge + '</td>' +
      '<td style="font-size:13px;">' + escapeHtml(requester) + '</td>' +
      '<td style="font-size:13px;">' + escapeHtml(sr.location || '-') + '</td>' +
      '<td style="font-size:13px;">' + escapeHtml(issue) + '</td>' +
      '<td><span class="status-badge ' + statusClass + '">' + escapeHtml(sr.status || 'pending') + '</span></td>' +
      '<td class="actions-cell">' +
        '<button class="btn btn-icon btn-ghost" onclick="viewServiceRequest(\'' + sr.id + '\')" title="View Details">' +
          '<i data-lucide="eye"></i>' +
        '</button>' +
        '<button class="btn btn-icon btn-ghost btn-danger" onclick="deleteServiceRequest(\'' + sr.id + '\')" title="Delete">' +
          '<i data-lucide="trash-2"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  tbody.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function updateServiceRequestStats() {
  var pending = serviceRequestsData.filter(function(sr) { return sr.status === 'pending'; }).length;
  var inProgress = serviceRequestsData.filter(function(sr) { return sr.status === 'in-progress'; }).length;
  var completed = serviceRequestsData.filter(function(sr) { return sr.status === 'completed'; }).length;

  var pendingEl = document.getElementById('sr-stat-pending');
  var inProgressEl = document.getElementById('sr-stat-in-progress');
  var completedEl = document.getElementById('sr-stat-completed');

  if (pendingEl) pendingEl.textContent = pending;
  if (inProgressEl) inProgressEl.textContent = inProgress;
  if (completedEl) completedEl.textContent = completed;
}

function updateServiceRequestsBadge() {
  var pending = serviceRequestsData.filter(function(sr) { return sr.status === 'pending'; }).length;
  var badge = document.getElementById('requests-badge');
  if (badge) {
    if (pending > 0) {
      badge.textContent = pending;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

function loadAlertCards() {
  var container = document.getElementById('alert-cards-container');
  if (!container) return;

  // Filter for pending and in-progress requests only
  var activeAlerts = serviceRequestsData.filter(function(sr) {
    return sr.status === 'pending' || sr.status === 'in-progress';
  });

  // Sort by priority (critical first) then by date
  var priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 };
  activeAlerts.sort(function(a, b) {
    var pA = priorityOrder[a.priority] || 2;
    var pB = priorityOrder[b.priority] || 2;
    if (pA !== pB) return pA - pB;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  if (activeAlerts.length === 0) {
    container.innerHTML = '<div class="empty-state"><i data-lucide="check-circle"></i><p>No pending alerts</p></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  // Show up to 6 alerts on dashboard
  var displayAlerts = activeAlerts.slice(0, 6);

  var html = displayAlerts.map(function(sr) {
    var priorityClass = 'priority-' + (sr.priority || 'medium');
    var statusClass = 'status-' + (sr.status || 'pending');
    var timeAgo = getTimeAgo(sr.createdAt);

    return '<div class="alert-card ' + priorityClass + ' ' + statusClass + '">' +
      '<div class="alert-card-header">' +
        '<span class="alert-priority-badge ' + priorityClass + '">' + (sr.priority || 'medium').toUpperCase() + '</span>' +
        '<span class="alert-time">' + timeAgo + '</span>' +
      '</div>' +
      '<div class="alert-card-body">' +
        '<h4 class="alert-issue">' + escapeHtml(sr.issueLabel || sr.issueType || 'Unknown Issue') + '</h4>' +
        '<p class="alert-device"><i data-lucide="monitor"></i> ' + escapeHtml(sr.deviceName || 'Unknown Device') + '</p>' +
        '<p class="alert-location"><i data-lucide="map-pin"></i> ' + escapeHtml(sr.location || 'No location') + '</p>' +
        '<p class="alert-submitter"><i data-lucide="user"></i> ' + escapeHtml(sr.submitterName || 'Unknown') + '</p>' +
      '</div>' +
      '<div class="alert-card-footer">' +
        (sr.status === 'pending' ?
          '<button class="btn btn-sm btn-warning assign-to-me-btn" onclick="claimAlert(\'' + sr.id + '\')"><i data-lucide="user-plus"></i> Assign to Me</button>' :
          '<span class="assigned-to"><i data-lucide="user-check"></i> ' + escapeHtml(sr.assignedTo || 'Assigned') + '</span>'
        ) +
        '<button class="btn btn-sm btn-ghost" onclick="viewServiceRequest(\'' + sr.id + '\')"><i data-lucide="eye"></i></button>' +
      '</div>' +
    '</div>';
  }).join('');

  // Add "View All" link if there are more alerts
  if (activeAlerts.length > 6) {
    html += '<div class="alert-card view-all-card" onclick="switchTab(\'requests\')">' +
      '<div class="view-all-content">' +
        '<i data-lucide="arrow-right"></i>' +
        '<span>View all ' + activeAlerts.length + ' alerts</span>' +
      '</div>' +
    '</div>';
  }

  container.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function getTimeAgo(dateString) {
  if (!dateString) return 'Unknown';
  var date = new Date(dateString);
  var now = new Date();
  var seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
  return date.toLocaleDateString();
}

function claimAlert(requestId) {
  var techName = state.currentTechName || localStorage.getItem('currentTechName');

  function doClaim(name) {
    // Optimistic UI update — instant feedback
    var snapshot = applyOptimisticUpdate(requestId, {
      status: 'in-progress',
      technicianName: name,
      assignedAt: new Date().toISOString()
    });
    showToast('Claiming alert...', 'info');
    google.script.run
      .withSuccessHandler(function(result) {
        showToast('Alert claimed by ' + name, 'success');
        if (result && result.updatedRequest) {
          mergeServerUpdate(result.updatedRequest);
        }
      })
      .withFailureHandler(function(error) {
        revertOptimisticUpdate(snapshot);
        showToast('Error claiming alert: ' + error.message, 'error');
      })
      .assignServiceRequest(requestId, name);
  }

  if (!techName) {
    showInputCard({
      title: 'Claim Alert',
      message: 'Enter your name to claim this alert:',
      placeholder: 'Your name',
      confirmText: 'Claim',
      onConfirm: function(name) {
        if (!name || !name.trim()) {
          showToast('Please enter your name to claim alerts', 'warning');
          return;
        }
        name = name.trim();
        state.currentTechName = name;
        localStorage.setItem('currentTechName', name);
        doClaim(name);
      }
    });
  } else {
    doClaim(techName);
  }
}

function filterServiceRequests() {
  renderServiceRequestsTable();
}

function viewServiceRequest(id) {
  var sr = serviceRequestsData.find(function(s) { return s.id === id; });
  if (!sr) return;

  currentServiceRequestId = id;

  // Determine display values based on source
  var sourceLabel = sr.source === 'helpdesk' ? 'Help Desk' : 'QR Scan';
  var requester = sr.employeeName || sr.submitterName || 'Unknown';
  if (sr.employeeId) requester += ' (' + sr.employeeId + ')';
  var issue = sr.issueLabel || sr.issueType || sr.shortDescription || sr.category || '-';
  var deviceOrRoom = sr.deviceName || sr.location || '-';

  document.getElementById('sr-detail-id').textContent = (sr.snowIncidentNumber || sr.id || '-');
  document.getElementById('sr-detail-device').textContent = deviceOrRoom;
  document.getElementById('sr-detail-location').textContent = sr.location || '-';
  document.getElementById('sr-detail-issue').textContent = issue;
  document.getElementById('sr-detail-priority').innerHTML = '<span class="source-badge source-' + (sr.source || 'qr') + '">' + sourceLabel + '</span>';
  document.getElementById('sr-detail-status').innerHTML = '<span class="status-badge status-' + (sr.status || 'pending') + '">' + (sr.status || 'pending') + '</span>';
  document.getElementById('sr-detail-submitter').textContent = requester;
  document.getElementById('sr-detail-submitted').textContent = sr.createdAt ? new Date(sr.createdAt).toLocaleString() : '-';
  document.getElementById('sr-detail-notes').textContent = sr.notes || sr.description || 'No notes';

  document.getElementById('sr-assign-technician').value = sr.technicianName || sr.assignedTo || '';
  document.getElementById('sr-resolution-notes').value = sr.resolutionNotes || '';

  // Update button visibility based on status
  var assignBtn = document.getElementById('sr-btn-assign');
  var completeBtn = document.getElementById('sr-btn-complete');

  if (sr.status === 'completed') {
    assignBtn.style.display = 'none';
    completeBtn.style.display = 'none';
  } else if (sr.status === 'in-progress') {
    assignBtn.style.display = 'inline-flex';
    assignBtn.innerHTML = '<i data-lucide="user-check"></i> Update Assignment';
    completeBtn.style.display = 'inline-flex';
  } else {
    assignBtn.style.display = 'inline-flex';
    assignBtn.innerHTML = '<i data-lucide="user-plus"></i> Assign';
    completeBtn.style.display = 'inline-flex';
  }

  // Load email history for this device
  var emailHistoryEl = document.getElementById('sr-email-history');
  if (emailHistoryEl) {
    emailHistoryEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Loading emails...</p>';
    google.script.run
      .withSuccessHandler(function(result) {
        if (result && result.success && result.emails && result.emails.length > 0) {
          var html = result.emails.map(function(em) {
            var date = em.sentAt ? new Date(em.sentAt).toLocaleString() : '-';
            return '<div class="sr-email-card">' +
              '<div class="sr-email-card-header">' +
                '<span class="sr-email-card-to" title="' + escapeHtml(em.recipient) + '"><strong>To:</strong> ' + escapeHtml(em.recipient) + (em.cc ? ' <span style="color:var(--text-secondary);">CC: ' + escapeHtml(em.cc) + '</span>' : '') + '</span>' +
                '<span class="sr-email-card-date">' + date + '</span>' +
              '</div>' +
              '<div class="sr-email-card-subject">' + escapeHtml(em.subject) + '</div>' +
              '<span class="status-badge status-' + (em.status || 'sent') + '" style="font-size:11px;">' + (em.status || 'sent') + '</span>' +
            '</div>';
          }).join('');
          emailHistoryEl.innerHTML = html;
        } else {
          emailHistoryEl.innerHTML = '<p class="text-muted" style="font-size:13px;">No emails sent for this device.</p>';
        }
      })
      .withFailureHandler(function() {
        emailHistoryEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Could not load email history.</p>';
      })
      .getEmailHistory(sr.deviceId || '');
  }

  document.getElementById('service-request-modal').classList.add('active');
  lucide.createIcons();
}

function closeServiceRequestModal() {
  document.getElementById('service-request-modal').classList.remove('active');
  currentServiceRequestId = null;
}

// ============================================
// EMAIL LOG (Service Requests Page)
// ============================================

function toggleEmailLog() {
  var body = document.getElementById('email-log-body');
  var chevron = document.getElementById('email-log-chevron');
  if (!body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  if (!isOpen) loadEmailLog();
}

var emailLogData = [];

function loadEmailLog() {
  var tbody = document.getElementById('email-log-table-body');
  var countBadge = document.getElementById('email-log-count');
  if (!tbody) return;

  google.script.run
    .withSuccessHandler(function(result) {
      if (!result || !result.success || !result.emails || result.emails.length === 0) {
        emailLogData = [];
        tbody.innerHTML = '<tr><td colspan="6" class="empty-message">No emails sent yet.</td></tr>';
        if (countBadge) countBadge.textContent = '0';
        return;
      }
      emailLogData = result.emails;
      if (countBadge) countBadge.textContent = result.emails.length;

      var html = result.emails.map(function(em) {
        var date = em.sentAt ? new Date(em.sentAt).toLocaleString() : '-';
        return '<tr>' +
          '<td style="white-space:nowrap; font-size:12px;">' + date + '</td>' +
          '<td style="font-size:12px;">' + escapeHtml(em.recipient || '-') + '</td>' +
          '<td style="font-size:12px; color:var(--text-secondary);">' + escapeHtml(em.cc || '-') + '</td>' +
          '<td style="font-size:12px;">' + escapeHtml(em.subject || '-') + '</td>' +
          '<td><span class="status-badge status-' + (em.status || 'sent') + '" style="font-size:11px;">' + (em.status || 'sent') + '</span></td>' +
          '<td style="text-align:center; white-space:nowrap;">' +
            '<button class="btn btn-sm btn-ghost" onclick="viewEmailBody(\'' + em.id + '\')" title="View Email"><i data-lucide="eye" style="width:14px;height:14px;"></i></button>' +
            '<button class="btn btn-sm btn-ghost text-danger" onclick="deleteEmailLogEntry(\'' + em.id + '\')" title="Delete"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>' +
          '</td>' +
        '</tr>';
      }).join('');
      tbody.innerHTML = html;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    })
    .withFailureHandler(function() {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-message">Error loading email log.</td></tr>';
    })
    .getEmailHistory();
}

function viewEmailBody(emailId) {
  showToast('Loading email...', 'info');
  google.script.run
    .withSuccessHandler(function(result) {
      if (!result || !result.success || !result.email) {
        showToast('Could not load email', 'error');
        return;
      }
      var em = result.email;
      if (em.htmlBody) {
        showEmailPreview(em.htmlBody);
      } else if (em.body) {
        showEmailPreview('<html><body style="font-family:sans-serif;padding:20px;white-space:pre-wrap;">' + escapeHtml(em.body) + '</body></html>');
      } else {
        showToast('No email body available', 'warning');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error loading email: ' + err.message, 'error');
    })
    .getEmailById(emailId);
}

function deleteEmailLogEntry(emailId) {
  showConfirmCard({
    title: 'Delete Email Record',
    message: 'Are you sure you want to delete this email record? This cannot be undone.',
    type: 'danger',
    confirmText: 'Delete',
    onConfirm: function() {
      showToast('Deleting...', 'info');
      google.script.run
        .withSuccessHandler(function(result) {
          if (result && result.success) {
            showToast('Email record deleted', 'success');
            loadEmailLog();
          } else {
            showToast('Failed to delete: ' + (result ? result.error : 'Unknown error'), 'error');
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error: ' + err.message, 'error');
        })
        .deleteEmailHistoryRecord(emailId);
    }
  });
}

function deleteAllEmailLog() {
  showConfirmCard({
    title: 'Delete All Email Records',
    message: 'Are you sure you want to delete ALL sent email records? This cannot be undone.',
    type: 'danger',
    confirmText: 'Delete All',
    onConfirm: function() {
      showToast('Deleting all records...', 'info');
      google.script.run
        .withSuccessHandler(function(result) {
          if (result && result.success) {
            showToast('All email records deleted (' + (result.deleted || 0) + ' records)', 'success');
            loadEmailLog();
          } else {
            showToast('Failed: ' + (result ? result.error : 'Unknown error'), 'error');
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error: ' + err.message, 'error');
        })
        .deleteAllEmailHistory();
    }
  });
}

function exportEmailLog() {
  if (!emailLogData || emailLogData.length === 0) {
    showToast('No email records to export', 'warning');
    return;
  }
  var headers = ['Date', 'To', 'CC', 'Subject', 'Status', 'Body'];
  var csvRows = [headers.join(',')];
  emailLogData.forEach(function(em) {
    var row = [
      em.sentAt ? new Date(em.sentAt).toLocaleString() : '',
      em.recipient || '',
      em.cc || '',
      em.subject || '',
      em.status || '',
      em.body || ''
    ].map(function(val) {
      var str = String(val).replace(/"/g, '""');
      return '"' + str + '"';
    });
    csvRows.push(row.join(','));
  });
  var csv = csvRows.join('\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'EmailHistory_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Email log exported', 'success');
}

function assignServiceRequestFromModal() {
  if (!currentServiceRequestId) return;

  var technician = document.getElementById('sr-assign-technician').value.trim();
  if (!technician) {
    showToast('Please enter a technician name', 'error');
    return;
  }

  // Optimistic UI update
  var snapshot = applyOptimisticUpdate(currentServiceRequestId, {
    status: 'in-progress',
    technicianName: technician,
    assignedAt: new Date().toISOString()
  });
  showToast('Assigning request...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      showToast('Request assigned to ' + technician, 'success');
      closeServiceRequestModal();
      if (result && result.updatedRequest) {
        mergeServerUpdate(result.updatedRequest);
      }
    })
    .withFailureHandler(function(error) {
      revertOptimisticUpdate(snapshot);
      showToast('Error assigning request: ' + error.message, 'error');
    })
    .assignServiceRequest(currentServiceRequestId, technician);
}

function completeServiceRequestFromModal() {
  if (!currentServiceRequestId) return;

  var notes = document.getElementById('sr-resolution-notes').value.trim();

  // Optimistic UI update
  var snapshot = applyOptimisticUpdate(currentServiceRequestId, {
    status: 'completed',
    completedAt: new Date().toISOString()
  });
  showToast('Completing request...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      showToast('Request marked as completed', 'success');
      closeServiceRequestModal();
      if (result && result.updatedRequest) {
        mergeServerUpdate(result.updatedRequest);
      }
    })
    .withFailureHandler(function(error) {
      revertOptimisticUpdate(snapshot);
      showToast('Error completing request: ' + error.message, 'error');
    })
    .completeServiceRequest(currentServiceRequestId, notes);
}

function deleteServiceRequest(id) {
  var sr = serviceRequestsData.find(function(s) { return s.id === id; });
  if (!sr) return;

  showConfirmCard({
    title: 'Delete Service Request',
    message: 'Are you sure you want to delete this service request?',
    type: 'danger',
    confirmText: 'Delete',
    onConfirm: function() {
      showToast('Deleting request...', 'info');
      google.script.run
        .withSuccessHandler(function(result) {
          showToast('Service request deleted', 'success');
          loadServiceRequests();
        })
        .withFailureHandler(function(error) {
          showToast('Error deleting request: ' + error.message, 'error');
        })
        .deleteServiceRequest(id);
    }
  });
}

function exportServiceRequests() {
  if (!serviceRequestsData || serviceRequestsData.length === 0) {
    showToast('No service requests to export', 'warning');
    return;
  }
  var headers = ['Date', 'Source', 'Requester', 'Employee ID', 'Location', 'Issue', 'Category', 'Status', 'Technician', 'Notes'];
  var csvRows = [headers.join(',')];
  serviceRequestsData.forEach(function(sr) {
    var row = [
      sr.submittedAt || sr.createdAt || '',
      sr.source === 'helpdesk' ? 'Help Desk' : 'QR Scan',
      sr.employeeName || '',
      sr.employeeId || '',
      sr.location || '',
      sr.issueLabel || sr.issueType || '',
      sr.category || sr.issueType || '',
      sr.status || '',
      sr.technicianName || '',
      sr.notes || ''
    ].map(function(val) {
      var str = String(val).replace(/"/g, '""');
      return '"' + str + '"';
    });
    csvRows.push(row.join(','));
  });
  var csv = csvRows.join('\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'service_requests_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Export completed', 'success');
}

function deleteAllServiceRequests() {
  showConfirmCard({
    title: 'Delete All Service Requests',
    message: 'Are you sure you want to delete <strong>ALL</strong> service requests? This action cannot be undone.',
    type: 'danger',
    confirmText: 'Delete All',
    onConfirm: function() {
      // Double confirmation for safety
      showConfirmCard({
        title: 'Final Confirmation',
        message: 'This will <strong>permanently delete all service requests</strong>. Are you absolutely sure?',
        type: 'danger',
        confirmText: 'Yes, Delete Everything',
        onConfirm: function() {
          showToast('Deleting all service requests...', 'info');
          google.script.run
            .withSuccessHandler(function(result) {
              if (result.success) {
                showToast('All service requests deleted', 'success');
                loadServiceRequests();
              } else {
                showToast(result.error || 'Error deleting requests', 'error');
              }
            })
            .withFailureHandler(function(error) {
              showToast('Error deleting requests: ' + error.message, 'error');
            })
            .deleteAllServiceRequests();
        }
      });
    }
  });
}

// ============================================
// QR Code Management
// ============================================
let currentQRDeviceId = null;
let currentLabelLayout = null;
var selectedElementId = null;
var labelDragState = { active: false, resizing: false, elId: null, startX: 0, startY: 0, origX: 0, origY: 0, origW: 0, origH: 0 };

// Label size presets: key → { width, height (px at 96 DPI), name, inchW, inchH }
var LABEL_SIZES = {
  '4x2.125':   { width: 384, height: 204, name: '4" x 2.125"', inchW: 4, inchH: 2.125 },
  '3.5x1.125': { width: 336, height: 108, name: '3.5" x 1.125"', inchW: 3.5, inchH: 1.125 },
  '2.125x4':   { width: 204, height: 384, name: '2.125" x 4"', inchW: 2.125, inchH: 4 },
  '1x2.125':   { width: 96,  height: 204, name: '1" x 2.125"', inchW: 1, inchH: 2.125 }
};

function getDefaultV2Layout() {
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

function migrateV1Layout(v1) {
  var v2 = getDefaultV2Layout();
  v2.fontFamily = v1.fontFamily || 'Arial, sans-serif';
  var qrLeft = (v1.qrPosition || 'left') === 'left';
  var qrSize = v1.qrSize || 150;
  var textX = qrLeft ? (qrSize + 15) : 6;
  var qrX = qrLeft ? 6 : (v1.labelWidth || 384) - qrSize - 6;
  var qrEl = v2.elements.find(function(e) { return e.id === 'qr'; });
  if (qrEl) { qrEl.x = qrX; qrEl.width = qrSize - 10; qrEl.height = qrSize - 10; }
  if (v1.fields) {
    var yPos = 10;
    var fieldKeys = Object.keys(v1.fields).sort(function(a, b) { return (v1.fields[a].order || 99) - (v1.fields[b].order || 99); });
    fieldKeys.forEach(function(key) {
      var f = v1.fields[key];
      var el = v2.elements.find(function(e) { return e.type === 'field' && e.fieldKey === key; });
      if (el) {
        el.x = textX; el.y = yPos; el.label = f.label || key;
        el.fontSize = f.fontSize || 12; el.bold = f.bold || false;
        el.hidden = !f.enabled;
        yPos += (f.fontSize || 12) + 8;
      }
    });
  }
  if (v1.showScanText === false) {
    var se = v2.elements.find(function(e) { return e.id === 'scanText'; });
    if (se) se.hidden = true;
  }
  if (v1.scanText) {
    var se2 = v2.elements.find(function(e) { return e.id === 'scanText'; });
    if (se2) se2.text = v1.scanText;
  }
  return v2;
}

// ---- Load & Init ----

function loadLabelLayout() {
  google.script.run
    .withSuccessHandler(function(layout) {
      if (!layout) {
        currentLabelLayout = getDefaultV2Layout();
      } else if (!layout.version) {
        currentLabelLayout = migrateV1Layout(layout);
      } else {
        currentLabelLayout = layout;
      }
      initLabelEditor();
    })
    .withFailureHandler(function(error) {
      console.error('Error loading label layout:', error);
      currentLabelLayout = getDefaultV2Layout();
      initLabelEditor();
    })
    .getLabelLayout();
}

function initLabelEditor() {
  var layout = currentLabelLayout;
  if (!layout) return;

  // Toolbar
  var sizeSelect = document.getElementById('label-size-select');
  if (sizeSelect) sizeSelect.value = layout.labelSize || '4x2.125';
  var customDiv = document.getElementById('label-custom-size');
  if (customDiv) customDiv.style.display = (layout.labelSize === 'custom') ? 'flex' : 'none';
  var customW = document.getElementById('label-custom-w');
  if (customW) customW.value = layout.labelWidth || 384;
  var customH = document.getElementById('label-custom-h');
  if (customH) customH.value = layout.labelHeight || 204;
  var padInput = document.getElementById('label-padding');
  if (padInput) padInput.value = layout.padding || 6;
  var fontSel = document.getElementById('label-font-family');
  if (fontSel) fontSel.value = layout.fontFamily || 'Arial, sans-serif';
  var snapCb = document.getElementById('label-snap-grid');
  if (snapCb) snapCb.checked = layout.snapToGrid !== false;

  renderElementList();
  renderPreviewCanvas();
  clearPropertiesPanel();
  initCanvasDragDrop();
}

// ---- Label Size ----

function onLabelSizeChange() {
  var sel = document.getElementById('label-size-select');
  if (!sel || !currentLabelLayout) return;
  var key = sel.value;
  var customDiv = document.getElementById('label-custom-size');
  if (key === 'custom') {
    if (customDiv) customDiv.style.display = 'flex';
    currentLabelLayout.labelSize = 'custom';
    onCustomLabelSize();
  } else {
    if (customDiv) customDiv.style.display = 'none';
    var preset = LABEL_SIZES[key];
    if (preset) {
      currentLabelLayout.labelSize = key;
      currentLabelLayout.labelWidth = preset.width;
      currentLabelLayout.labelHeight = preset.height;
    }
  }
  renderPreviewCanvas();
  updateSizeHint();
}

function onCustomLabelSize() {
  if (!currentLabelLayout) return;
  var w = parseInt(document.getElementById('label-custom-w').value) || 384;
  var h = parseInt(document.getElementById('label-custom-h').value) || 204;
  currentLabelLayout.labelWidth = Math.max(50, Math.min(600, w));
  currentLabelLayout.labelHeight = Math.max(50, Math.min(600, h));
  renderPreviewCanvas();
  updateSizeHint();
}

function updateSizeHint() {
  var hint = document.getElementById('label-size-hint');
  if (hint && currentLabelLayout) {
    hint.textContent = currentLabelLayout.labelWidth + ' x ' + currentLabelLayout.labelHeight + ' px (96 DPI)';
  }
}

function onLayoutToolbarChange() {
  if (!currentLabelLayout) return;
  var padInput = document.getElementById('label-padding');
  if (padInput) currentLabelLayout.padding = parseInt(padInput.value) || 0;
  var fontSel = document.getElementById('label-font-family');
  if (fontSel) currentLabelLayout.fontFamily = fontSel.value;
  var snapCb = document.getElementById('label-snap-grid');
  if (snapCb) currentLabelLayout.snapToGrid = snapCb.checked;
  renderPreviewCanvas();
}

function resetLabelLayout() {
  showConfirmCard({
    title: 'Reset Layout',
    message: 'Reset label layout to defaults?',
    type: 'warn',
    confirmText: 'Reset',
    onConfirm: function() {
      currentLabelLayout = getDefaultV2Layout();
      selectedElementId = null;
      initLabelEditor();
      showToast('Layout reset to defaults', 'info');
    }
  });
}

// ---- Element List ----

function renderElementList() {
  var container = document.getElementById('label-element-items');
  if (!container || !currentLabelLayout) return;

  var html = currentLabelLayout.elements.map(function(el) {
    var name = getElementDisplayName(el);
    var icon = el.type === 'qr' ? 'qr-code' : el.type === 'logo' ? 'image' : el.type === 'customText' ? 'type' : 'text';
    var isHidden = el.hidden;
    var isDeletable = el.type === 'customText' || el.type === 'logo';
    var selectedClass = (el.id === selectedElementId) ? ' selected' : '';
    return '<div class="label-element-item' + selectedClass + '" data-el-id="' + el.id + '" onclick="selectElement(\'' + el.id + '\')">' +
      '<input type="checkbox" ' + (!isHidden ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleElementVisibility(\'' + el.id + '\', this.checked)" title="Show/hide">' +
      '<i data-lucide="' + icon + '" class="el-type-icon"></i>' +
      '<span class="el-name">' + escapeHtml(name) + '</span>' +
      (isDeletable ? '<button class="el-delete" onclick="event.stopPropagation(); removeElement(\'' + el.id + '\')" title="Delete"><i data-lucide="x" style="width:12px;height:12px"></i></button>' : '') +
    '</div>';
  }).join('');

  container.innerHTML = html;
  lucide.createIcons();
}

function getElementDisplayName(el) {
  if (el.type === 'qr') return 'QR Code';
  if (el.type === 'field') return el.label || el.fieldKey || 'Field';
  if (el.type === 'logo') return 'Logo';
  if (el.type === 'customText') return el.text ? (el.text.length > 18 ? el.text.substring(0, 18) + '...' : el.text) : 'Custom Text';
  return 'Element';
}

function toggleElementVisibility(elId, visible) {
  var el = currentLabelLayout.elements.find(function(e) { return e.id === elId; });
  if (el) {
    el.hidden = !visible;
    renderPreviewCanvas();
    renderElementList();
  }
}

function addCustomTextField() {
  if (!currentLabelLayout) return;
  var id = 'custom-' + Date.now();
  currentLabelLayout.elements.push({
    id: id, type: 'customText',
    x: 10, y: 10, width: 160, height: 18,
    text: 'Custom Text', fontSize: 10, bold: false, align: 'left', locked: false
  });
  selectedElementId = id;
  renderElementList();
  renderPreviewCanvas();
  renderPropertiesPanel(id);
  showToast('Custom text added', 'success');
}

function uploadLabelLogo(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Please upload an image file', 'warning');
    return;
  }
  if (file.size > 500 * 1024) {
    showToast('File too large (max 500KB)', 'warning');
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var w = Math.min(img.width, 120);
      var h = Math.round(w * (img.height / img.width));
      var id = 'logo-' + Date.now();
      currentLabelLayout.elements.push({
        id: id, type: 'logo',
        x: 10, y: 10, width: w, height: h,
        dataUrl: e.target.result, locked: false
      });
      selectedElementId = id;
      renderElementList();
      renderPreviewCanvas();
      renderPropertiesPanel(id);
      showToast('Logo added', 'success');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function removeElement(elId) {
  if (!currentLabelLayout) return;
  var idx = currentLabelLayout.elements.findIndex(function(e) { return e.id === elId; });
  if (idx === -1) return;
  var el = currentLabelLayout.elements[idx];
  if (el.type !== 'customText' && el.type !== 'logo') {
    showToast('Cannot delete built-in elements', 'warning');
    return;
  }
  currentLabelLayout.elements.splice(idx, 1);
  if (selectedElementId === elId) {
    selectedElementId = null;
    clearPropertiesPanel();
  }
  renderElementList();
  renderPreviewCanvas();
  showToast('Element removed', 'info');
}

// ---- Preview Canvas Rendering ----

function getPreviewSampleData() {
  return {
    device: {
      name: 'HP LaserJet Pro',
      machineId: 'MID-12345',
      location: 'Room 204',
      serialNumber: 'SN-ABC9876',
      model: 'LaserJet Pro M404n',
      ip: '192.168.1.100'
    },
    qrUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://example.com/request?device=sample'
  };
}

function renderPreviewCanvas() {
  var canvas = document.getElementById('label-preview-canvas');
  if (!canvas || !currentLabelLayout) return;
  var l = currentLabelLayout;
  canvas.style.width = l.labelWidth + 'px';
  canvas.style.height = l.labelHeight + 'px';
  canvas.style.fontFamily = l.fontFamily || 'Arial, sans-serif';

  var sample = getPreviewSampleData();
  var html = '';

  l.elements.forEach(function(el) {
    var hiddenClass = el.hidden ? ' hidden-el' : '';
    var selectedClass = (el.id === selectedElementId) ? ' selected' : '';
    var baseStyle = 'left:' + el.x + 'px; top:' + el.y + 'px; width:' + el.width + 'px; height:' + el.height + 'px;';

    html += '<div class="label-canvas-element' + hiddenClass + selectedClass + '" data-el-id="' + el.id + '" style="' + baseStyle + '">';

    if (el.type === 'qr') {
      html += '<img src="' + sample.qrUrl + '" style="width:100%;height:100%;image-rendering:pixelated;" draggable="false">';
    } else if (el.type === 'logo') {
      html += '<img src="' + (el.dataUrl || '') + '" style="width:100%;height:100%;object-fit:contain;" draggable="false">';
    } else if (el.type === 'field') {
      var val = sample.device[el.fieldKey] || '';
      var textContent = (el.showLabel !== false && el.label) ? el.label + ': ' + val : val;
      html += '<div style="font-size:' + (el.fontSize || 12) + 'px; font-weight:' + (el.bold ? 'bold' : 'normal') + '; text-align:' + (el.align || 'left') + '; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:' + el.height + 'px;">' + escapeHtml(textContent) + '</div>';
    } else if (el.type === 'customText') {
      html += '<div style="font-size:' + (el.fontSize || 10) + 'px; font-weight:' + (el.bold ? 'bold' : 'normal') + '; text-align:' + (el.align || 'left') + '; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:' + el.height + 'px; color:#555;">' + escapeHtml(el.text || '') + '</div>';
    }

    // Resize handle for QR, logo, and text elements
    html += '<div class="resize-handle"></div>';
    html += '</div>';
  });

  canvas.innerHTML = html;
  updateSizeHint();
}

// ---- Drag & Drop Engine ----

function initCanvasDragDrop() {
  var canvas = document.getElementById('label-preview-canvas');
  if (!canvas) return;

  // Remove old listeners by replacing node
  var newCanvas = canvas.cloneNode(false);
  canvas.parentNode.replaceChild(newCanvas, canvas);

  newCanvas.addEventListener('mousedown', onCanvasMouseDown);
  newCanvas.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      e.preventDefault();
      var touch = e.touches[0];
      onCanvasMouseDown({ clientX: touch.clientX, clientY: touch.clientY, target: document.elementFromPoint(touch.clientX, touch.clientY), preventDefault: function(){} });
    }
  }, { passive: false });

  document.addEventListener('mousemove', onCanvasMouseMove);
  document.addEventListener('mouseup', onCanvasMouseUp);
  document.addEventListener('touchmove', function(e) {
    if (labelDragState.active && e.touches.length === 1) {
      e.preventDefault();
      onCanvasMouseMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    }
  }, { passive: false });
  document.addEventListener('touchend', function() {
    if (labelDragState.active) onCanvasMouseUp();
  });

  // Re-render with the new canvas node
  renderPreviewCanvas();
}

function onCanvasMouseDown(e) {
  var target = e.target;
  if (!target || !currentLabelLayout) return;

  // Check if clicking a resize handle
  if (target.classList.contains('resize-handle')) {
    var elDiv = target.parentElement;
    var elId = elDiv ? elDiv.getAttribute('data-el-id') : null;
    if (elId) {
      var el = currentLabelLayout.elements.find(function(el) { return el.id === elId; });
      if (el && !el.locked) {
        e.preventDefault();
        labelDragState = { active: true, resizing: true, elId: elId, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y, origW: el.width, origH: el.height };
        selectElement(elId);
        return;
      }
    }
  }

  // Find clicked element
  var elDiv = target.closest('.label-canvas-element');
  if (!elDiv) {
    deselectElement();
    return;
  }

  var elId = elDiv.getAttribute('data-el-id');
  var el = currentLabelLayout.elements.find(function(el) { return el.id === elId; });
  if (!el) return;

  e.preventDefault();
  selectElement(elId);

  if (!el.locked) {
    labelDragState = { active: true, resizing: false, elId: elId, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y, origW: el.width, origH: el.height };
  }
}

function onCanvasMouseMove(e) {
  if (!labelDragState.active || !currentLabelLayout) return;
  var el = currentLabelLayout.elements.find(function(el) { return el.id === labelDragState.elId; });
  if (!el) return;

  var dx = e.clientX - labelDragState.startX;
  var dy = e.clientY - labelDragState.startY;
  var snap = currentLabelLayout.snapToGrid ? currentLabelLayout.gridSize || 4 : 1;

  if (labelDragState.resizing) {
    var newW = Math.max(20, snapVal(labelDragState.origW + dx, snap));
    var newH = Math.max(12, snapVal(labelDragState.origH + dy, snap));
    // Keep QR aspect ratio
    if (el.type === 'qr') { newH = newW; }
    el.width = newW;
    el.height = newH;
  } else {
    el.x = Math.max(0, snapVal(labelDragState.origX + dx, snap));
    el.y = Math.max(0, snapVal(labelDragState.origY + dy, snap));
    // Clamp within label bounds
    el.x = Math.min(el.x, currentLabelLayout.labelWidth - 10);
    el.y = Math.min(el.y, currentLabelLayout.labelHeight - 10);
  }

  // Update DOM directly for performance (no full re-render)
  var canvas = document.getElementById('label-preview-canvas');
  if (canvas) {
    var elDiv = canvas.querySelector('[data-el-id="' + el.id + '"]');
    if (elDiv) {
      elDiv.style.left = el.x + 'px';
      elDiv.style.top = el.y + 'px';
      elDiv.style.width = el.width + 'px';
      elDiv.style.height = el.height + 'px';
    }
  }

  // Update properties panel position values
  updatePropsPositionValues(el);
}

function onCanvasMouseUp() {
  if (labelDragState.active) {
    labelDragState.active = false;
  }
}

function snapVal(val, grid) {
  return Math.round(val / grid) * grid;
}

function selectElement(elId) {
  selectedElementId = elId;
  renderElementList();
  renderPreviewCanvas();
  renderPropertiesPanel(elId);
}

function deselectElement() {
  selectedElementId = null;
  renderElementList();
  renderPreviewCanvas();
  clearPropertiesPanel();
}

// ---- Properties Panel ----

function clearPropertiesPanel() {
  var content = document.getElementById('label-props-content');
  if (content) {
    content.innerHTML = '<div class="props-placeholder"><i data-lucide="mouse-pointer"></i> Click an element in the preview to edit its properties</div>';
    lucide.createIcons();
  }
}

function renderPropertiesPanel(elId) {
  var content = document.getElementById('label-props-content');
  if (!content || !currentLabelLayout) return;
  var el = currentLabelLayout.elements.find(function(e) { return e.id === elId; });
  if (!el) { clearPropertiesPanel(); return; }

  var html = '';

  // Position section
  html += '<div class="props-section"><div class="props-section-title">Position</div>';
  html += '<div class="props-row"><label>X</label><input type="number" id="prop-x" value="' + el.x + '" onchange="onPropChange(\'' + elId + '\', \'x\', this.value)">';
  html += '<label>Y</label><input type="number" id="prop-y" value="' + el.y + '" onchange="onPropChange(\'' + elId + '\', \'y\', this.value)"></div>';
  html += '<div class="props-row"><label>W</label><input type="number" id="prop-w" value="' + el.width + '" onchange="onPropChange(\'' + elId + '\', \'width\', this.value)">';
  html += '<label>H</label><input type="number" id="prop-h" value="' + el.height + '" onchange="onPropChange(\'' + elId + '\', \'height\', this.value)"></div>';
  html += '<div class="props-row"><label class="checkbox-label"><input type="checkbox" ' + (el.locked ? 'checked' : '') + ' onchange="onPropChange(\'' + elId + '\', \'locked\', this.checked)"><span>Locked</span></label></div>';
  html += '</div>';

  // Type-specific properties
  if (el.type === 'field') {
    html += '<div class="props-separator"></div>';
    html += '<div class="props-section"><div class="props-section-title">Field</div>';
    html += '<div class="props-row"><label>Label</label><input type="text" class="form-input" value="' + escapeHtml(el.label || '') + '" onchange="onPropChange(\'' + elId + '\', \'label\', this.value)"></div>';
    html += '<div class="props-row"><label class="checkbox-label"><input type="checkbox" ' + (el.showLabel !== false ? 'checked' : '') + ' onchange="onPropChange(\'' + elId + '\', \'showLabel\', this.checked)"><span>Show label</span></label></div>';
    html += '<div class="props-row"><label>Size</label><input type="number" min="8" max="24" value="' + (el.fontSize || 12) + '" onchange="onPropChange(\'' + elId + '\', \'fontSize\', this.value)">';
    html += '<label>px</label></div>';
    html += '<div class="props-row"><label class="checkbox-label"><input type="checkbox" ' + (el.bold ? 'checked' : '') + ' onchange="onPropChange(\'' + elId + '\', \'bold\', this.checked)"><span><b>Bold</b></span></label></div>';
    html += '<div class="props-row"><label>Align</label><div class="label-align-btns">';
    html += '<button class="btn btn-xs ' + (el.align === 'left' ? 'active' : '') + '" onclick="onPropChange(\'' + elId + '\', \'align\', \'left\')">L</button>';
    html += '<button class="btn btn-xs ' + (el.align === 'center' ? 'active' : '') + '" onclick="onPropChange(\'' + elId + '\', \'align\', \'center\')">C</button>';
    html += '<button class="btn btn-xs ' + (el.align === 'right' ? 'active' : '') + '" onclick="onPropChange(\'' + elId + '\', \'align\', \'right\')">R</button>';
    html += '</div></div>';
    html += '</div>';
  } else if (el.type === 'customText') {
    html += '<div class="props-separator"></div>';
    html += '<div class="props-section"><div class="props-section-title">Text</div>';
    html += '<div class="props-row"><label>Text</label><input type="text" class="form-input" value="' + escapeHtml(el.text || '') + '" oninput="onPropChange(\'' + elId + '\', \'text\', this.value)"></div>';
    html += '<div class="props-row"><label>Size</label><input type="number" min="6" max="24" value="' + (el.fontSize || 10) + '" onchange="onPropChange(\'' + elId + '\', \'fontSize\', this.value)">';
    html += '<label>px</label></div>';
    html += '<div class="props-row"><label class="checkbox-label"><input type="checkbox" ' + (el.bold ? 'checked' : '') + ' onchange="onPropChange(\'' + elId + '\', \'bold\', this.checked)"><span><b>Bold</b></span></label></div>';
    html += '<div class="props-row"><label>Align</label><div class="label-align-btns">';
    html += '<button class="btn btn-xs ' + (el.align === 'left' ? 'active' : '') + '" onclick="onPropChange(\'' + elId + '\', \'align\', \'left\')">L</button>';
    html += '<button class="btn btn-xs ' + (el.align === 'center' ? 'active' : '') + '" onclick="onPropChange(\'' + elId + '\', \'align\', \'center\')">C</button>';
    html += '<button class="btn btn-xs ' + (el.align === 'right' ? 'active' : '') + '" onclick="onPropChange(\'' + elId + '\', \'align\', \'right\')">R</button>';
    html += '</div></div>';
    html += '</div>';
  } else if (el.type === 'qr') {
    html += '<div class="props-separator"></div>';
    html += '<div class="props-section"><div class="props-section-title">QR Code</div>';
    html += '<p class="form-hint">Drag the resize handle to change QR code size. Width and height are locked to maintain a square.</p>';
    html += '</div>';
  } else if (el.type === 'logo') {
    html += '<div class="props-separator"></div>';
    html += '<div class="props-section"><div class="props-section-title">Logo</div>';
    html += '<p class="form-hint">Drag the resize handle to change logo size.</p>';
    html += '<button class="btn btn-ghost btn-sm" style="margin-top:6px;" onclick="document.getElementById(\'label-logo-input\').click()"><i data-lucide="replace"></i> Replace Image</button>';
    html += '</div>';
  }

  content.innerHTML = html;
  lucide.createIcons();
}

function updatePropsPositionValues(el) {
  var px = document.getElementById('prop-x');
  var py = document.getElementById('prop-y');
  var pw = document.getElementById('prop-w');
  var ph = document.getElementById('prop-h');
  if (px) px.value = el.x;
  if (py) py.value = el.y;
  if (pw) pw.value = el.width;
  if (ph) ph.value = el.height;
}

function onPropChange(elId, prop, value) {
  if (!currentLabelLayout) return;
  var el = currentLabelLayout.elements.find(function(e) { return e.id === elId; });
  if (!el) return;

  if (prop === 'x' || prop === 'y' || prop === 'width' || prop === 'height' || prop === 'fontSize') {
    el[prop] = parseInt(value) || 0;
    // Keep QR square
    if (el.type === 'qr' && (prop === 'width' || prop === 'height')) {
      el.width = el.height = parseInt(value) || 100;
    }
  } else if (prop === 'locked' || prop === 'bold' || prop === 'showLabel') {
    el[prop] = !!value;
  } else {
    el[prop] = value;
  }

  renderPreviewCanvas();
  // Re-render element list if label changed
  if (prop === 'label' || prop === 'text') {
    renderElementList();
  }
  // Re-render properties for alignment buttons
  if (prop === 'align') {
    renderPropertiesPanel(elId);
  }
}

// ---- Save & Backend ----

function saveLabelLayoutSettings() {
  if (!currentLabelLayout) return;
  // Read toolbar values into layout
  var fontSel = document.getElementById('label-font-family');
  if (fontSel) currentLabelLayout.fontFamily = fontSel.value;
  var padInput = document.getElementById('label-padding');
  if (padInput) currentLabelLayout.padding = parseInt(padInput.value) || 0;
  var snapCb = document.getElementById('label-snap-grid');
  if (snapCb) currentLabelLayout.snapToGrid = snapCb.checked;

  var layoutJson = JSON.stringify(currentLabelLayout);
  showToast('Saving label layout...', 'info');
  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        showToast('Label layout saved', 'success');
      } else {
        showToast('Error saving layout', 'error');
      }
    })
    .withFailureHandler(function(error) {
      showToast('Error saving layout: ' + error.message, 'error');
    })
    .saveLabelLayout(layoutJson);
}

// ---- Build Label HTML (for print) ----

function buildLabelHTML(device, qrUrl, layout) {
  var l = layout || currentLabelLayout || getDefaultV2Layout();
  var containerStyle = 'position:relative; width:' + l.labelWidth + 'px; height:' + l.labelHeight + 'px; ' +
    'background:white; overflow:hidden; box-sizing:border-box; font-family:' + (l.fontFamily || 'Arial, sans-serif') + ';';

  var inner = '';
  l.elements.forEach(function(el) {
    if (el.hidden) return;
    var style = 'position:absolute; left:' + el.x + 'px; top:' + el.y + 'px; width:' + el.width + 'px; height:' + el.height + 'px; overflow:hidden;';

    if (el.type === 'qr') {
      inner += '<div style="' + style + '"><img src="' + qrUrl + '" style="width:100%;height:100%;image-rendering:pixelated;"></div>';
    } else if (el.type === 'logo' && el.dataUrl) {
      inner += '<div style="' + style + '"><img src="' + el.dataUrl + '" style="width:100%;height:100%;object-fit:contain;"></div>';
    } else if (el.type === 'field') {
      var val = device[el.fieldKey] || '';
      if (!val) return;
      var text = (el.showLabel !== false && el.label) ? el.label + ': ' + val : val;
      var ts = 'font-size:' + (el.fontSize || 12) + 'px; font-weight:' + (el.bold ? 'bold' : 'normal') + '; text-align:' + (el.align || 'left') + '; line-height:' + el.height + 'px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
      inner += '<div style="' + style + ts + '">' + escapeHtml(text) + '</div>';
    } else if (el.type === 'customText') {
      var ts2 = 'font-size:' + (el.fontSize || 10) + 'px; font-weight:' + (el.bold ? 'bold' : 'normal') + '; text-align:' + (el.align || 'left') + '; line-height:' + el.height + 'px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#555;';
      inner += '<div style="' + style + ts2 + '">' + escapeHtml(el.text || '') + '</div>';
    }
  });

  return '<div style="' + containerStyle + '">' + inner + '</div>';
}

// ---- Print Functions ----

function printSingleLabel(deviceId) {
  var device = state.devices.find(function(d) { return d.id === deviceId; });
  if (!device) { showToast('Device not found', 'error'); return; }
  showToast('Preparing label for ' + device.name + '...', 'info');
  google.script.run
    .withSuccessHandler(function(result) {
      if (!result || !result.success) { showToast('Failed to generate QR code', 'error'); return; }
      var qrUrl = result.qrCode ? result.qrCode.qrData : result.url || result;
      var qrImageUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(qrUrl);
      var layout = currentLabelLayout || getDefaultV2Layout();
      openPrintWindow([{ device: device, qrUrl: qrImageUrl }], layout);
    })
    .withFailureHandler(function(error) { showToast('Error: ' + error.message, 'error'); })
    .generateQRCode(deviceId);
}

function printAllLabels() {
  if (!state.devices || state.devices.length === 0) { showToast('No devices to print', 'error'); return; }
  showToast('Generating QR codes for all devices...', 'info');
  var completed = 0, labelData = [], total = state.devices.length;
  state.devices.forEach(function(device) {
    google.script.run
      .withSuccessHandler(function(result) {
        completed++;
        if (result && result.success) {
          var qrUrl = result.qrCode ? result.qrCode.qrData : result.url || result;
          var qrImageUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(qrUrl);
          labelData.push({ device: device, qrUrl: qrImageUrl });
        }
        if (completed >= total) {
          if (labelData.length === 0) { showToast('No labels to print', 'error'); return; }
          labelData.sort(function(a, b) { return (a.device.name || '').localeCompare(b.device.name || ''); });
          openPrintWindow(labelData, currentLabelLayout || getDefaultV2Layout());
          showToast(labelData.length + ' labels ready to print', 'success');
        }
      })
      .withFailureHandler(function(error) {
        completed++;
        console.error('Error generating QR for device:', error);
        if (completed >= total && labelData.length > 0) {
          labelData.sort(function(a, b) { return (a.device.name || '').localeCompare(b.device.name || ''); });
          openPrintWindow(labelData, currentLabelLayout || getDefaultV2Layout());
        }
      })
      .generateQRCode(device.id);
  });
}

function openPrintWindow(labelDataArray, layout) {
  var l = layout || getDefaultV2Layout();
  var printWindow = window.open('', '_blank', 'width=500,height=400');
  if (!printWindow) { showToast('Please allow pop-ups for printing', 'error'); return; }

  // Calculate inches from pixels (96 DPI)
  var inW = (l.labelWidth / 96).toFixed(3);
  var inH = (l.labelHeight / 96).toFixed(3);
  var preset = LABEL_SIZES[l.labelSize];
  if (preset) { inW = preset.inchW; inH = preset.inchH; }

  var labelsHtml = labelDataArray.map(function(item, index) {
    var pageBreak = index < labelDataArray.length - 1 ? 'page-break-after: always;' : '';
    return '<div class="label-page" style="' + pageBreak + '">' + buildLabelHTML(item.device, item.qrUrl, l) + '</div>';
  }).join('');

  var html = '<!DOCTYPE html><html><head><title>Print Labels</title>' +
    '<style>' +
    '* { margin: 0; padding: 0; box-sizing: border-box; }' +
    '@page { size: ' + inW + 'in ' + inH + 'in; margin: 0; }' +
    'body { margin: 0; padding: 0; }' +
    '.label-page { width: ' + inW + 'in; height: ' + inH + 'in; overflow: hidden; }' +
    '.label-page > div { border: none !important; width: 100% !important; height: 100% !important; }' +
    '@media screen { body { padding: 20px; background: #f0f0f0; } .label-page { margin: 10px auto; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.15); } }' +
    '</style></head><body>' + labelsHtml + '</body></html>';

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onload = function() { setTimeout(function() { printWindow.print(); }, 800); };
}

function generateQRForDevice(deviceId) {
  var device = state.devices.find(function(d) { return d.id === deviceId; });
  if (!device) {
    showToast('Device not found', 'error');
    return;
  }

  currentQRDeviceId = deviceId;

  showToast('Generating QR code...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      displayQRCode(result, device);
    })
    .withFailureHandler(function(error) {
      showToast('Error generating QR code: ' + error.message, 'error');
    })
    .generateQRCode(deviceId);
}

function displayQRCode(result, device) {
  if (!result || !result.success) {
    showToast('Failed to generate QR code', 'error');
    return;
  }

  var qrDisplay = document.getElementById('qr-code-display');
  var qrDeviceName = document.getElementById('qr-device-name');
  var qrDeviceLocation = document.getElementById('qr-device-location');

  // Get the QR data URL from the result
  var qrUrl = result.qrCode ? result.qrCode.qrData : result.url || result;
  var qrImageUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(qrUrl);

  qrDisplay.innerHTML = '<img src="' + qrImageUrl + '" alt="QR Code" class="qr-code-image">';
  qrDeviceName.textContent = device.name || 'Unknown Device';
  qrDeviceLocation.textContent = device.location || 'No location';

  document.getElementById('qr-code-modal-title').textContent = 'QR Code: ' + (device.name || 'Device');
  document.getElementById('qr-code-modal').classList.add('active');
  showToast('QR code generated', 'success');
}

function closeQRCodeModal() {
  document.getElementById('qr-code-modal').classList.remove('active');
  currentQRDeviceId = null;
}

function downloadQRCode() {
  var img = document.querySelector('#qr-code-display img');
  if (!img) return;

  var device = state.devices.find(function(d) { return d.id === currentQRDeviceId; });
  var filename = 'qr_' + (device ? device.name.replace(/\s+/g, '_') : 'device') + '.png';

  // Create a link to download the image
  var link = document.createElement('a');
  link.href = img.src;
  link.download = filename;
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('QR code download started', 'success');
}

function printQRLabel() {
  var device = state.devices.find(function(d) { return d.id === currentQRDeviceId; });
  if (!device) return;

  var img = document.querySelector('#qr-code-display img');
  if (!img) return;

  var layout = currentLabelLayout || getDefaultV2Layout();
  openPrintWindow([{ device: device, qrUrl: img.src }], layout);
}

function getFilteredQRDevices() {
  var searchInput = document.getElementById('qr-codes-search');
  var searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

  if (!state.devices) return [];
  if (!searchTerm) return state.devices;

  return state.devices.filter(function(d) {
    return (d.name && d.name.toLowerCase().includes(searchTerm)) ||
           (d.machineId && String(d.machineId).toLowerCase().includes(searchTerm)) ||
           (d.location && d.location.toLowerCase().includes(searchTerm)) ||
           (d.serialNumber && String(d.serialNumber).toLowerCase().includes(searchTerm)) ||
           (d.type && d.type.toLowerCase().includes(searchTerm));
  });
}

function filterQRCodes() {
  loadQRCodesTable();
}

function loadQRCodesTable() {
  var tbody = document.getElementById('qr-codes-table-body');
  if (!tbody) return;

  var filtered = getFilteredQRDevices();

  // Update device count
  var countEl = document.getElementById('qr-codes-count');
  var searchInput = document.getElementById('qr-codes-search');
  var isFiltering = searchInput && searchInput.value.trim() !== '';
  if (countEl) {
    if (isFiltering) {
      countEl.textContent = filtered.length + ' of ' + (state.devices ? state.devices.length : 0) + ' devices';
    } else {
      countEl.textContent = (state.devices ? state.devices.length : 0) + ' devices';
    }
  }

  if (!state.devices || state.devices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-message">No devices available. Add devices first.</td></tr>';
    return;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-message">No devices match your search</td></tr>';
    return;
  }

  var html = filtered.map(function(device) {
    return '<tr>' +
      '<td>' + escapeHtml(device.name) + '</td>' +
      '<td>' + escapeHtml(device.machineId || '-') + '</td>' +
      '<td>' + escapeHtml(device.location || '-') + '</td>' +
      '<td>' + escapeHtml(device.serialNumber || '-') + '</td>' +
      '<td>' + escapeHtml(device.type || '-') + '</td>' +
      '<td class="actions-cell">' +
        '<button class="btn btn-sm btn-ghost" onclick="generateQRForDevice(\'' + device.id + '\')" title="View QR Code">' +
          '<i data-lucide="qr-code"></i>' +
        '</button>' +
        '<button class="btn btn-sm btn-secondary" onclick="printSingleLabel(\'' + device.id + '\')" title="Print Label">' +
          '<i data-lucide="printer"></i> Print' +
        '</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  tbody.innerHTML = html;
  lucide.createIcons();
}

function generateAllQRCodes() {
  showToast('Generating all QR codes...', 'info');

  // For each device, generate a QR code (this would be batched in production)
  var promises = state.devices.map(function(device) {
    return new Promise(function(resolve) {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(resolve)
        .generateQRCode(device.id);
    });
  });

  Promise.all(promises).then(function() {
    showToast('All QR codes generated', 'success');
  });
}

function updateAllQRCodeUrls() {
  showToast('Updating QR code URLs to current deployment...', 'info');
  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        showToast('Updated ' + result.updated + ' QR code URLs!', 'success');
        loadQRCodesTable();
      } else {
        showToast('Failed: ' + (result ? result.error : 'Unknown'), 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error: ' + err.message, 'error');
    })
    .updateAllQRCodeUrls();
}

// Refresh QR codes table and label layout when settings tab is loaded
var originalSwitchTab = typeof switchTab === 'function' ? switchTab : null;
if (originalSwitchTab) {
  window.switchTab = function(tab) {
    originalSwitchTab(tab);
    if (tab === 'settings') {
      setTimeout(function() {
        loadQRCodesTable();
        loadLabelLayout();
      }, 100);
    }
  };
}

// Also hook into settings panel switching for lazy loading
var originalSwitchSettingsPanel = typeof switchSettingsPanel === 'function' ? switchSettingsPanel : null;
if (originalSwitchSettingsPanel) {
  window.switchSettingsPanel = function(sectionName) {
    originalSwitchSettingsPanel(sectionName);
    if (sectionName === 'qr-codes') {
      loadQRCodesTable();
      if (!currentLabelLayout) {
        loadLabelLayout();
      } else {
        initLabelEditor();
      }
    }
  };
}

// ============================================
// EMAIL TEMPLATES MANAGEMENT
// ============================================

var emailTemplatesData = [];
var currentEmailTemplate = null;

function loadEmailTemplates() {
  google.script.run
    .withSuccessHandler(function(templates) {
      emailTemplatesData = templates || [];
      renderEmailTemplatesList();
    })
    .withFailureHandler(function(error) {
      console.error('Error loading email templates:', error);
      showToast('Error loading email templates', 'error');
    })
    .getEmailTemplates();
}

function renderEmailTemplatesList() {
  var container = document.getElementById('email-templates-list');
  if (!container) return;

  if (!emailTemplatesData || emailTemplatesData.length === 0) {
    container.innerHTML = '<div class="empty-state"><i data-lucide="mail"></i><p>No email templates configured</p><p style="font-size: 12px; opacity: 0.7;">Click "Add New Template" to create one</p></div>';
    lucide.createIcons();
    return;
  }

  var html = '<div class="template-cards">';
  emailTemplatesData.forEach(function(template) {
    var isActive = template.active !== false && template.active !== 'false';
    html += '<div class="template-card ' + (isActive ? '' : 'inactive') + '">';
    html += '<div class="template-card-header">';
    html += '<div class="template-info">';
    html += '<h4>' + escapeHtml(template.name || 'Unnamed Template') + '</h4>';
    html += '<span class="template-type-badge">' + getTemplateTypeLabel(template.type) + '</span>';
    html += '</div>';
    html += '<div class="template-status">';
    html += isActive ? '<span class="status-badge status-online">Active</span>' : '<span class="status-badge status-offline">Inactive</span>';
    html += '</div>';
    html += '</div>';
    html += '<div class="template-card-body">';
    html += '<p class="template-subject"><strong>Subject:</strong> ' + escapeHtml(template.subject || '') + '</p>';
    html += '</div>';
    html += '<div class="template-card-footer">';
    html += '<button class="btn btn-sm btn-outline" onclick="editEmailTemplate(\'' + template.id + '\')"><i data-lucide="edit-2"></i> Edit</button>';
    html += '<button class="btn btn-sm btn-outline" onclick="previewSavedTemplate(\'' + template.id + '\')"><i data-lucide="eye"></i> Preview</button>';
    html += '<button class="btn btn-sm btn-ghost text-danger" onclick="deleteEmailTemplate(\'' + template.id + '\')"><i data-lucide="trash-2"></i></button>';
    html += '</div>';
    html += '</div>';
  });
  html += '</div>';

  container.innerHTML = html;
  lucide.createIcons();
}

function getTemplateTypeLabel(type) {
  var labels = {
    'confirmation': 'Service Request Confirmation',
    'assignment': 'Technician Assignment',
    'completion': 'Request Completed',
    'manufacturer': 'Manufacturer Repair Request',
    'custom': 'Custom'
  };
  return labels[type] || type || 'Unknown';
}

function onTemplateTypeChange() {
  var type = document.getElementById('email-template-type').value;
  var srVars = document.getElementById('service-request-vars');
  var mfgVars = document.getElementById('manufacturer-vars');
  var srHint = document.getElementById('sr-vars-hint');
  var mfgHint = document.getElementById('mfg-vars-hint');
  if (type === 'manufacturer') {
    srVars.style.display = 'none';
    mfgVars.style.display = 'flex';
    if (srHint) srHint.style.display = 'none';
    if (mfgHint) mfgHint.style.display = 'block';
  } else {
    srVars.style.display = 'flex';
    mfgVars.style.display = 'none';
    if (srHint) srHint.style.display = 'block';
    if (mfgHint) mfgHint.style.display = 'none';
  }
}

function getManufacturerSampleData() {
  return {
    'message': 'The printer is producing streaky prints and making unusual grinding noises during operation. Toner levels are low and the drum unit may need replacement.',
    'deviceName': 'HP LaserJet Pro M404',
    'model': 'HP LaserJet Pro M404dn',
    'ip': '192.168.1.100',
    'location': 'Building A, Room 101',
    'machineId': 'MID-2024-0042',
    'serialNumber': 'VNB3K12345',
    'deviceType': 'printer',
    'status': 'warning',
    'statusColor': '#d97706',
    'supplyLevels': '<div style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;"><span>Black Toner</span><span style="font-weight:600;color:#dc2626;">12%</span></div><div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;"><div style="height:100%;border-radius:4px;width:12%;background:#dc2626;"></div></div></div><div style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;"><span>Drum Unit</span><span style="font-weight:600;color:#d97706;">35%</span></div><div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;"><div style="height:100%;border-radius:4px;width:35%;background:#d97706;"></div></div></div>',
    'dateTime': new Date().toLocaleString(),
    'schoolName': 'Smart School Monitor'
  };
}

function showEmailTemplateEditor(templateId) {
  currentEmailTemplate = null;
  document.getElementById('email-template-id').value = '';
  document.getElementById('email-template-name').value = '';
  document.getElementById('email-template-type').value = 'confirmation';
  document.getElementById('email-template-subject').value = '';
  document.getElementById('email-template-body').value = '';
  document.getElementById('email-template-active').checked = true;
  document.getElementById('email-template-modal-title').textContent = 'New Email Template';

  onTemplateTypeChange();
  document.getElementById('email-template-modal').classList.add('active');
  lucide.createIcons();
}

function editEmailTemplate(templateId) {
  var template = emailTemplatesData.find(function(t) { return t.id === templateId; });
  if (!template) {
    showToast('Template not found', 'error');
    return;
  }

  currentEmailTemplate = template;
  document.getElementById('email-template-id').value = template.id;
  document.getElementById('email-template-name').value = template.name || '';
  document.getElementById('email-template-type').value = template.type || 'confirmation';
  document.getElementById('email-template-subject').value = template.subject || '';
  document.getElementById('email-template-body').value = template.htmlBody || '';
  document.getElementById('email-template-active').checked = template.active !== false && template.active !== 'false';
  document.getElementById('email-template-modal-title').textContent = 'Edit Email Template';

  onTemplateTypeChange();
  document.getElementById('email-template-modal').classList.add('active');
  lucide.createIcons();
}

function closeEmailTemplateModal() {
  document.getElementById('email-template-modal').classList.remove('active');
  currentEmailTemplate = null;
}

function saveEmailTemplate() {
  var template = {
    id: document.getElementById('email-template-id').value || null,
    name: document.getElementById('email-template-name').value.trim(),
    type: document.getElementById('email-template-type').value,
    subject: document.getElementById('email-template-subject').value.trim(),
    htmlBody: document.getElementById('email-template-body').value,
    active: document.getElementById('email-template-active').checked
  };

  if (!template.name) {
    showToast('Please enter a template name', 'warning');
    return;
  }

  if (!template.subject) {
    showToast('Please enter an email subject', 'warning');
    return;
  }

  if (!template.htmlBody) {
    showToast('Please enter the HTML body', 'warning');
    return;
  }

  showToast('Saving template...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result.success) {
        showToast('Template saved successfully', 'success');
        closeEmailTemplateModal();
        loadEmailTemplates();
      } else {
        showToast('Error: ' + (result.error || 'Failed to save template'), 'error');
      }
    })
    .withFailureHandler(function(error) {
      showToast('Error saving template: ' + error.message, 'error');
    })
    .saveEmailTemplate(template);
}

function deleteEmailTemplate(templateId) {
  showConfirmCard({
    title: 'Delete Template',
    message: 'Are you sure you want to delete this email template?',
    type: 'danger',
    confirmText: 'Delete',
    onConfirm: function() {
      showToast('Deleting template...', 'info');
      google.script.run
        .withSuccessHandler(function(result) {
          if (result.success) {
            showToast('Template deleted', 'success');
            loadEmailTemplates();
          } else {
            showToast('Error: ' + (result.error || 'Failed to delete template'), 'error');
          }
        })
        .withFailureHandler(function(error) {
          showToast('Error deleting template: ' + error.message, 'error');
        })
        .deleteEmailTemplate(templateId);
    }
  });
}

function previewEmailTemplate() {
  var htmlBody = document.getElementById('email-template-body').value;
  if (!htmlBody) {
    showToast('No HTML content to preview', 'warning');
    return;
  }

  var templateType = document.getElementById('email-template-type').value;

  // Use appropriate sample data based on template type
  var sampleData;
  if (templateType === 'manufacturer') {
    sampleData = getManufacturerSampleData();
  } else {
    sampleData = {
      'employeeName': 'John Smith',
      'issueLabel': 'Paper Jam',
      'deviceName': 'Copier - Room 101',
      'location': 'Building A, Room 101',
      'submittedAt': new Date().toLocaleString(),
      'requestId': 'REQ-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      'afterHoursMessage': 'Your request has been submitted and will be addressed first thing during the next working hours.',
      'urgentEmail': 'itservicedesk@palmbeachschools.org',
      'urgentPhone': '(561) 242-6100',
      'footerMessage': 'A technician will be assigned to your request shortly.',
      'showAfterHours': true
    };
  }

  var previewHtml = htmlBody;
  for (var key in sampleData) {
    var placeholder = '{{' + key + '}}';
    previewHtml = previewHtml.split(placeholder).join(sampleData[key]);
  }

  // Handle conditional sections - show them in preview
  previewHtml = previewHtml.replace(/\{\{#afterHoursSection\}\}/g, '');
  previewHtml = previewHtml.replace(/\{\{\/afterHoursSection\}\}/g, '');

  showEmailPreview(previewHtml);
}

function previewSavedTemplate(templateId) {
  var template = emailTemplatesData.find(function(t) { return t.id === templateId; });
  if (!template || !template.htmlBody) {
    showToast('Template has no HTML content', 'warning');
    return;
  }

  var sampleData;
  if (template.type === 'manufacturer') {
    sampleData = getManufacturerSampleData();
  } else {
    sampleData = {
      'employeeName': 'John Smith',
      'issueLabel': 'Paper Jam',
      'deviceName': 'Copier - Room 101',
      'location': 'Building A, Room 101',
      'submittedAt': new Date().toLocaleString(),
      'requestId': 'REQ-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      'afterHoursMessage': 'Your request has been submitted and will be addressed first thing during the next working hours.',
      'urgentEmail': 'itservicedesk@palmbeachschools.org',
      'urgentPhone': '(561) 242-6100',
      'footerMessage': 'A technician will be assigned to your request shortly.'
    };
  }

  var previewHtml = template.htmlBody;
  for (var key in sampleData) {
    var placeholder = '{{' + key + '}}';
    previewHtml = previewHtml.split(placeholder).join(sampleData[key]);
  }

  previewHtml = previewHtml.replace(/\{\{#afterHoursSection\}\}/g, '');
  previewHtml = previewHtml.replace(/\{\{\/afterHoursSection\}\}/g, '');

  showEmailPreview(previewHtml);
}

function showEmailPreview(html) {
  var modal = document.getElementById('email-preview-modal');
  var iframe = document.getElementById('email-preview-frame');
  if (!modal || !iframe) return;
  var doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  modal.classList.add('active');
}

function closeEmailPreviewModal() {
  var modal = document.getElementById('email-preview-modal');
  if (modal) modal.classList.remove('active');
}

function insertVariable(varName) {
  var textarea = document.getElementById('email-template-body');
  var cursorPos = textarea.selectionStart;
  var textBefore = textarea.value.substring(0, cursorPos);
  var textAfter = textarea.value.substring(cursorPos);
  var insertText = '{{' + varName + '}}';

  textarea.value = textBefore + insertText + textAfter;
  textarea.selectionStart = textarea.selectionEnd = cursorPos + insertText.length;
  textarea.focus();

  showToast('Variable inserted', 'success');
}

function resetToDefaultTemplate() {
  showConfirmCard({
    title: 'Reset Template',
    message: 'Reset to the default template? Your current changes will be lost.',
    type: 'warn',
    confirmText: 'Reset',
    onConfirm: function() {
      var templateType = document.getElementById('email-template-type').value;
      var defaultTemplate;
      if (templateType === 'manufacturer') {
        defaultTemplate = getDefaultManufacturerEmailTemplate();
      } else {
        defaultTemplate = getDefaultEmailTemplate();
      }
      document.getElementById('email-template-subject').value = defaultTemplate.subject;
      document.getElementById('email-template-body').value = defaultTemplate.htmlBody;
      showToast('Template reset to default', 'info');
    }
  });
}

function getDefaultManufacturerEmailTemplate() {
  return {
    subject: 'Repair Request: {{deviceName}} - {{model}}',
    htmlBody: '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n</head>\n<body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; margin: 0; padding: 0;">\n  <div style="max-width: 600px; margin: 20px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">\n    <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 30px 20px; text-align: center;">\n      <h1 style="margin: 0; font-size: 24px;">&#128295; Repair Request</h1>\n      <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 14px;">Service Required for Device</p>\n      <span style="display: inline-block; background: #fef2f2; color: #dc2626; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-top: 10px;">&#9888;&#65039; REQUIRES ATTENTION</span>\n    </div>\n    <div style="padding: 30px 20px;">\n      <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin-bottom: 20px; border-radius: 0 8px 8px 0; white-space: pre-wrap; font-size: 14px;">{{message}}</div>\n\n      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px;">\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Device Name</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b;">{{deviceName}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Model</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b;">{{model}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">IP Address</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b; font-family: monospace;">{{ip}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Location</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b;">{{location}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Machine ID</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b; font-family: monospace;">{{machineId}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Serial Number</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b; font-family: monospace;">{{serialNumber}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Device Type</div>\n          <div style="font-size: 14px; font-weight: 600; color: #1e293b; text-transform: capitalize;">{{deviceType}}</div>\n        </div>\n        <div>\n          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Current Status</div>\n          <div style="font-size: 14px; font-weight: 600; color: {{statusColor}}; text-transform: capitalize;">{{status}}</div>\n        </div>\n      </div>\n\n      <div style="margin-top: 20px;">\n        <h3 style="margin-bottom: 15px; font-size: 16px; color: #374151;">&#128202; Current Supply Levels</h3>\n        {{supplyLevels}}\n      </div>\n\n      <div style="background: #f0f9ff; border: 1px solid #bae6fd; padding: 15px; border-radius: 8px; margin-top: 20px;">\n        <h4 style="margin: 0 0 10px 0; color: #0369a1; font-size: 14px;">&#128231; Contact Information</h4>\n        <p style="margin: 0; font-size: 13px; color: #475569;">Please respond to this email to coordinate repair/service scheduling.</p>\n      </div>\n    </div>\n    <div style="background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">\n      <p style="margin: 5px 0;"><strong>{{schoolName}}</strong></p>\n      <p style="margin: 5px 0;">Automated repair request generated on {{dateTime}}</p>\n      <p style="font-size: 11px; color: #94a3b8; margin: 5px 0;">This is an automated message from the school\'s network monitoring system.</p>\n    </div>\n  </div>\n</body>\n</html>'
  };
}

function getDefaultEmailTemplate() {
  return {
    subject: 'Service Request Received - {{issueLabel}}',
    htmlBody: '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n</head>\n<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, sans-serif;">\n  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">\n    <tr>\n      <td align="center">\n        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">\n          <!-- Header -->\n          <tr>\n            <td style="background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); padding: 30px; text-align: center;">\n              <h1 style="color: #ffffff; margin: 0; font-size: 24px;">🦈 SharkQuick</h1>\n              <p style="color: #93c5fd; margin: 5px 0 0 0; font-size: 14px;">Service Request System</p>\n            </td>\n          </tr>\n          <!-- Success Icon -->\n          <tr>\n            <td style="padding: 30px 30px 20px 30px; text-align: center;">\n              <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border-radius: 50%; margin: 0 auto; line-height: 60px;">\n                <span style="color: white; font-size: 30px;">✓</span>\n              </div>\n              <h2 style="color: #1e3a8a; margin: 20px 0 10px 0;">Request Received!</h2>\n              <p style="color: #64748b; margin: 0;">Your service request has been logged in our system.</p>\n            </td>\n          </tr>\n          <!-- Request Details -->\n          <tr>\n            <td style="padding: 0 30px 30px 30px;">\n              <table width="100%" cellpadding="15" cellspacing="0" style="background-color: #f8fafc; border-radius: 8px;">\n                <tr>\n                  <td style="border-bottom: 1px solid #e2e8f0;">\n                    <strong style="color: #64748b; font-size: 12px; text-transform: uppercase;">Issue</strong><br>\n                    <span style="color: #1e3a8a; font-size: 16px; font-weight: 600;">{{issueLabel}}</span>\n                  </td>\n                </tr>\n                <tr>\n                  <td style="border-bottom: 1px solid #e2e8f0;">\n                    <strong style="color: #64748b; font-size: 12px; text-transform: uppercase;">Device</strong><br>\n                    <span style="color: #1e3a8a; font-size: 16px;">{{deviceName}}</span>\n                  </td>\n                </tr>\n                <tr>\n                  <td style="border-bottom: 1px solid #e2e8f0;">\n                    <strong style="color: #64748b; font-size: 12px; text-transform: uppercase;">Location</strong><br>\n                    <span style="color: #1e3a8a; font-size: 16px;">{{location}}</span>\n                  </td>\n                </tr>\n                <tr>\n                  <td style="border-bottom: 1px solid #e2e8f0;">\n                    <strong style="color: #64748b; font-size: 12px; text-transform: uppercase;">Submitted</strong><br>\n                    <span style="color: #1e3a8a; font-size: 16px;">{{submittedAt}}</span>\n                  </td>\n                </tr>\n                <tr>\n                  <td>\n                    <strong style="color: #64748b; font-size: 12px; text-transform: uppercase;">Request ID</strong><br>\n                    <span style="color: #1e3a8a; font-size: 14px; font-family: monospace;">{{requestId}}</span>\n                  </td>\n                </tr>\n              </table>\n            </td>\n          </tr>\n          {{#afterHoursSection}}\n          <!-- After Hours Notice -->\n          <tr>\n            <td style="padding: 0 30px 30px 30px;">\n              <table width="100%" cellpadding="20" cellspacing="0" style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 8px;">\n                <tr>\n                  <td>\n                    <div style="text-align: center; font-size: 24px; margin-bottom: 10px;">⏰</div>\n                    <h3 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px;">After-Hours Notice</h3>\n                    <p style="color: #78350f; margin: 0 0 15px 0; font-size: 14px; line-height: 1.5;">{{afterHoursMessage}}</p>\n                    <div style="border-top: 1px solid rgba(120, 53, 15, 0.2); padding-top: 15px;">\n                      <p style="color: #78350f; margin: 0 0 5px 0; font-size: 14px;"><strong>For urgent issues:</strong></p>\n                      <p style="color: #1e40af; margin: 0; font-size: 14px;">📧 {{urgentEmail}}</p>\n                      <p style="color: #1e40af; margin: 5px 0 0 0; font-size: 14px;">📞 {{urgentPhone}}</p>\n                    </div>\n                  </td>\n                </tr>\n              </table>\n            </td>\n          </tr>\n          {{/afterHoursSection}}\n          <!-- Footer Message -->\n          <tr>\n            <td style="padding: 0 30px 20px 30px; text-align: center;">\n              <p style="color: #64748b; font-size: 14px; line-height: 1.5;">{{footerMessage}}</p>\n            </td>\n          </tr>\n          <!-- Footer -->\n          <tr>\n            <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0;">\n              <p style="color: #94a3b8; font-size: 12px; margin: 0;">This is an automated message from Smart School Monitor.</p>\n              <p style="color: #94a3b8; font-size: 12px; margin: 5px 0 0 0;">Please do not reply to this email.</p>\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>'
  };
}

// Load email templates when settings section is shown
var origShowSettingsSection = typeof showSettingsSection === 'function' ? showSettingsSection : null;
if (origShowSettingsSection) {
  window.showSettingsSection = function(section) {
    origShowSettingsSection(section);
    if (section === 'email-templates') {
      loadEmailTemplates();
    }
  };
}

// ============================================
// HELP DESK — INCIDENT MANAGEMENT
// ============================================

var helpdeskEmployee = null;
var helpdeskInitialized = false;

// Hook into switchTab to load data when Help Desk tab is shown
(function() {
  var origSwitchTab = window.switchTab;
  window.switchTab = function(tabName) {
    origSwitchTab(tabName);
    if (tabName === 'helpdesk') {
      initHelpDesk();
    }
  };
})();

function initHelpDesk() {
  if (!helpdeskInitialized) {
    helpdeskInitialized = true;
    // Allow Enter key on employee ID input
    var empInput = document.getElementById('helpdesk-emp-id');
    if (empInput) {
      empInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          lookupHelpdeskEmployee();
        }
      });
    }
    // Load saved site number from settings
    loadHelpdeskSettings();
    // Initialize AI classification input listener
    initAiInput();
  }
  loadIncidents();
  loadEmailQueueTable();
}

// --- Site Number Setting ---
var helpdeskSiteNumber = '';
var snLookupEmpId = '';
var snLookupShortDesc = '';

function loadHelpdeskSettings() {
  google.script.run
    .withSuccessHandler(function(settings) {
      if (settings) {
        if (settings.servicenowSiteNumber) {
          helpdeskSiteNumber = settings.servicenowSiteNumber;
          var input = document.getElementById('helpdesk-site-number');
          if (input) input.value = helpdeskSiteNumber;
          var status = document.getElementById('helpdesk-site-status');
          if (status) status.textContent = 'Saved';
        }
      }
    })
    .getSettings();
}

function saveHelpdeskSiteNumber() {
  var val = document.getElementById('helpdesk-site-number').value.trim();
  if (!val) {
    showToast('Enter a site number', 'warning');
    return;
  }
  helpdeskSiteNumber = val;
  google.script.run
    .withSuccessHandler(function() {
      var status = document.getElementById('helpdesk-site-status');
      if (status) { status.textContent = 'Saved'; status.style.color = '#22c55e'; }
      showToast('Site number saved', 'success');
    })
    .withFailureHandler(function(err) {
      showToast('Failed to save: ' + err.message, 'error');
    })
    .saveSetting('servicenowSiteNumber', val);
}


// --- AI Classification ---
var currentAiSuggestion = null;
var aiDebounceTimer = null;

function initAiInput() {
  var textarea = document.getElementById('helpdesk-ai-input');
  if (!textarea) return;
  textarea.addEventListener('input', function() {
    clearTimeout(aiDebounceTimer);
    var text = textarea.value.trim();
    if (text.length < 10) {
      hideAiSuggestions();
      return;
    }
    aiDebounceTimer = setTimeout(function() {
      runAiClassification(text);
    }, 600);
  });
}

function runAiClassification(text) {
  var spinner = document.getElementById('ai-spinner');
  var panel = document.getElementById('ai-suggestion-panel');
  spinner.style.display = 'block';
  panel.style.display = 'none';

  var empName = helpdeskEmployee ? helpdeskEmployee.name : '';
  var roomNumber = helpdeskEmployee ? helpdeskEmployee.roomNumber : '';

  google.script.run
    .withSuccessHandler(function(result) {
      spinner.style.display = 'none';
      if (result && result.category) {
        currentAiSuggestion = result;
        displayAiSuggestions(result);
      } else {
        hideAiSuggestions();
      }
    })
    .withFailureHandler(function(err) {
      spinner.style.display = 'none';
      console.error('AI classification error:', err);
      hideAiSuggestions();
    })
    .classifyIncident(text, empName, roomNumber);
}

function displayAiSuggestions(result) {
  var panel = document.getElementById('ai-suggestion-panel');
  panel.style.display = 'block';

  // Confidence badge
  var confBadge = document.getElementById('ai-confidence-badge');
  var confPct = Math.round((result.confidence || 0) * 100);
  confBadge.textContent = confPct + '%';
  confBadge.className = 'ai-confidence-badge';
  if (confPct >= 70) confBadge.classList.add('ai-conf-high');
  else if (confPct >= 50) confBadge.classList.add('ai-conf-medium');
  else confBadge.classList.add('ai-conf-low');

  // Source badge
  var srcBadge = document.getElementById('ai-source-badge');
  srcBadge.textContent = result.source || 'rules';

  // Field values
  document.getElementById('ai-suggest-category').textContent = result.category || '—';
  document.getElementById('ai-suggest-subcategory').textContent = result.subcategory || '—';
  document.getElementById('ai-suggest-channel').textContent = result.channel || '—';
  document.getElementById('ai-suggest-impact').textContent = result.impact || '—';
  document.getElementById('ai-suggest-service-offering').textContent = result.serviceOffering || '—';
  document.getElementById('ai-suggest-description').textContent = result.improvedDescription || '';

  // Re-render lucide icons in case any were added
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function hideAiSuggestions() {
  var panel = document.getElementById('ai-suggestion-panel');
  if (panel) panel.style.display = 'none';
  var spinner = document.getElementById('ai-spinner');
  if (spinner) spinner.style.display = 'none';
  currentAiSuggestion = null;
}

function acceptAiField(fieldName) {
  if (!currentAiSuggestion) return;

  if (fieldName === 'category') {
    var catSelect = document.getElementById('helpdesk-category');
    if (catSelect && currentAiSuggestion.category) {
      catSelect.value = currentAiSuggestion.category;
      onHelpdeskCategoryChange();
      // After subcategory options are populated, set subcategory too
      if (currentAiSuggestion.subcategory) {
        setTimeout(function() {
          var subSelect = document.getElementById('helpdesk-subcategory');
          if (subSelect) subSelect.value = currentAiSuggestion.subcategory;
        }, 50);
      }
    }
  } else if (fieldName === 'subcategory') {
    // Ensure category is set first so subcategory options exist
    var catSelect = document.getElementById('helpdesk-category');
    if (currentAiSuggestion.category && catSelect.value !== currentAiSuggestion.category) {
      catSelect.value = currentAiSuggestion.category;
      onHelpdeskCategoryChange();
    }
    setTimeout(function() {
      var subSelect = document.getElementById('helpdesk-subcategory');
      if (subSelect && currentAiSuggestion.subcategory) {
        subSelect.value = currentAiSuggestion.subcategory;
      }
    }, 50);
  } else if (fieldName === 'channel') {
    var chanSelect = document.getElementById('helpdesk-channel');
    if (chanSelect && currentAiSuggestion.channel) {
      chanSelect.value = currentAiSuggestion.channel;
    }
  } else if (fieldName === 'impact') {
    var impSelect = document.getElementById('helpdesk-impact');
    if (impSelect && currentAiSuggestion.impact) {
      impSelect.value = currentAiSuggestion.impact;
    }
  } else if (fieldName === 'serviceOffering') {
    // Service offering is used directly in sysparm_query from currentAiSuggestion — no form field to set.
    // Accepting just confirms the AI choice (visual feedback handled below).
  } else if (fieldName === 'description') {
    if (currentAiSuggestion.improvedDescription) {
      document.getElementById('helpdesk-short-desc').value = currentAiSuggestion.improvedDescription.split('.')[0] + '.';
      document.getElementById('helpdesk-full-desc').value = currentAiSuggestion.improvedDescription;
    }
  }

  // Visual feedback on accepted button
  var btn = event && event.target;
  if (btn) {
    btn.textContent = 'Accepted';
    btn.classList.add('ai-accepted');
    btn.disabled = true;
  }

  showToast('AI suggestion accepted for ' + fieldName, 'success');
}

function acceptAllAiSuggestions() {
  if (!currentAiSuggestion) return;

  // Set category first, then subcategory after options populate
  var catSelect = document.getElementById('helpdesk-category');
  if (catSelect && currentAiSuggestion.category) {
    catSelect.value = currentAiSuggestion.category;
    onHelpdeskCategoryChange();
  }

  // Channel
  var chanSelect = document.getElementById('helpdesk-channel');
  if (chanSelect && currentAiSuggestion.channel) {
    chanSelect.value = currentAiSuggestion.channel;
  }

  // Impact
  var impSelect = document.getElementById('helpdesk-impact');
  if (impSelect && currentAiSuggestion.impact) {
    impSelect.value = currentAiSuggestion.impact;
  }

  // Subcategory (after category options populate)
  setTimeout(function() {
    var subSelect = document.getElementById('helpdesk-subcategory');
    if (subSelect && currentAiSuggestion.subcategory) {
      subSelect.value = currentAiSuggestion.subcategory;
    }
  }, 50);

  // Description
  if (currentAiSuggestion.improvedDescription) {
    document.getElementById('helpdesk-short-desc').value = currentAiSuggestion.improvedDescription.split('.')[0] + '.';
    document.getElementById('helpdesk-full-desc').value = currentAiSuggestion.improvedDescription;
  }

  // Mark all accept buttons as accepted
  var btns = document.querySelectorAll('.ai-accept-btn');
  btns.forEach(function(btn) {
    btn.textContent = 'Accepted';
    btn.classList.add('ai-accepted');
    btn.disabled = true;
  });

  // Mark accept all button
  var allBtn = document.querySelector('.ai-accept-all-btn');
  if (allBtn) {
    allBtn.textContent = 'All Accepted';
    allBtn.classList.add('ai-accepted');
    allBtn.disabled = true;
  }

  showToast('All AI suggestions accepted', 'success');
}

// --- Employee Lookup ---
function lookupHelpdeskEmployee() {
  var empId = document.getElementById('helpdesk-emp-id').value.trim();
  if (!empId) {
    showToast('Please enter an Employee ID', 'warning');
    return;
  }

  var resultDiv = document.getElementById('helpdesk-employee-result');
  var errorDiv = document.getElementById('helpdesk-employee-error');
  resultDiv.classList.add('hidden');
  errorDiv.classList.add('hidden');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success && result.employee) {
        helpdeskEmployee = result.employee;
        document.getElementById('helpdesk-emp-name').textContent = result.employee.name;
        document.getElementById('helpdesk-emp-details').textContent =
          (result.employee.email || 'No email') + ' | Room ' + (result.employee.roomNumber || 'N/A');
        resultDiv.classList.remove('hidden');
        errorDiv.classList.add('hidden');
        lucide.createIcons();
      } else {
        helpdeskEmployee = null;
        resultDiv.classList.add('hidden');
        errorDiv.classList.remove('hidden');
        lucide.createIcons();
      }
    })
    .withFailureHandler(function(err) {
      helpdeskEmployee = null;
      resultDiv.classList.add('hidden');
      errorDiv.classList.remove('hidden');
      lucide.createIcons();
      console.error('Employee lookup failed:', err);
    })
    .lookupEmployee(empId);
}

// --- ServiceNow ---
// Subcategory options per category (from ServiceNow)
var HELPDESK_SUBCATEGORIES = {
  'Hardware': ['Amplifier','Apple','Audio Enhancement','Camera','Cart','Chromebook','Copier','Digital Signage','Document Camera','Intercom','Microphone','Mobile Device','Phone','Printer','Projector Bulb','Projector LCD','Scanner','Server','Smart Panel','Sound System','Stage Lighting','TEN','Time Clock','Windows Desktop','Windows Laptop'],
  'Network': ['Core Switch','Data Port','District WiFi Access Key','Extreme Switch','Fiber','Internet','LAN','Loop','Router','SDPBC Wireless','Slowness','UPS','Wireless Access Point'],
  'Software': ['Account Lockout','Active Directory','Antivirus','Business Application','Database','ERP / PeopleSoft','File Backup','Google Apps (Mail, Calendar, etc.)','Instructional Application','Identity Management','MFA Bypass','Multi Factor Authentication','Operating System','Password Reset','Portal','SIS','TEN','TRIRIGA','VPN']
};

function onHelpdeskCategoryChange() {
  var category = document.getElementById('helpdesk-category').value;
  var subSelect = document.getElementById('helpdesk-subcategory');
  subSelect.innerHTML = '';

  if (!category) {
    subSelect.innerHTML = '<option value="">-- Select Category first --</option>';
    return;
  }

  var subs = HELPDESK_SUBCATEGORIES[category] || [];
  subSelect.innerHTML = '<option value="">-- None --</option>';
  subs.forEach(function(sub) {
    var opt = document.createElement('option');
    opt.value = sub;
    opt.textContent = sub;
    subSelect.appendChild(opt);
  });
}

function openServiceNow() {
  if (!helpdeskEmployee) {
    showToast('Look up an employee first (Step 1)', 'warning');
    return;
  }
  var shortDesc = document.getElementById('helpdesk-short-desc').value.trim();
  var fullDesc = document.getElementById('helpdesk-full-desc').value.trim();
  var category = document.getElementById('helpdesk-category').value;
  var subcategory = document.getElementById('helpdesk-subcategory').value;
  var channel = document.getElementById('helpdesk-channel').value;
  var impact = document.getElementById('helpdesk-impact').value;

  if (!shortDesc) {
    showToast('Enter a short description first (Step 3)', 'warning');
    return;
  }

  // Build sysparm_query with ^ separator (works on incident.do)
  var qParts = [];

  // Set Requester, Site Number, Local Support, and Assignment Group via server-side GlideRecord
  // NOTE: ServiceNow sysparm_query JavaScript only supports ONE GlideRecord per reference field.
  // So each reference field gets its own single-GlideRecord expression.
  if (helpdeskEmployee.empId) {
    var empId = helpdeskEmployee.empId;
    // Requester — look up sys_user by employee_number, return sys_id
    qParts.push("caller_id=javascript:var u=new GlideRecord('sys_user');u.addQuery('employee_number','" + empId + "');u.query();u.next();u.sys_id");
    // Site Number — the user's department field on sys_user maps to u_site_number on incident (cmn_department reference)
    qParts.push("u_site_number=javascript:var u=new GlideRecord('sys_user');u.addQuery('employee_number','" + empId + "');u.query();u.next();u.department");
    // Req Email Address — plain text field, use employee email from lookup
    if (helpdeskEmployee.email) {
      qParts.push("u_req_email_address=" + helpdeskEmployee.email);
    }
    // Local Support checkbox
    qParts.push("u_local_support=true");
    // Assignment Group — look up sys_user_group by name using the saved site number setting
    if (helpdeskSiteNumber) {
      qParts.push("assignment_group=javascript:var g=new GlideRecord('sys_user_group');g.get('name','" + helpdeskSiteNumber + " Local Support');g.sys_id");
    }
  }

  // Service offering — reference field, auto-detected from AI classification
  var soName = currentAiSuggestion ? (currentAiSuggestion.serviceOffering || '') : '';
  if (soName) {
    qParts.push("service_offering=javascript:var s=new GlideRecord('service_offering');s.get('name','" + soName + "');s.sys_id");
  }

  qParts.push('short_description=' + shortDesc);
  if (fullDesc) qParts.push('description=' + fullDesc);
  if (category) qParts.push('category=' + category);
  if (subcategory) qParts.push('subcategory=' + subcategory);
  if (channel) qParts.push('contact_type=' + channel);
  if (impact) qParts.push('impact=' + impact);
  var userType = document.getElementById('helpdesk-user-type').value;
  if (userType) qParts.push('u_user_type=' + userType);

  var query = qParts.join('^');
  var url = 'https://pbcsd.service-now.com/incident.do?sys_id=-1&sysparm_query=' + encodeURIComponent(query);

  // Save context for API lookup after submission
  snLookupEmpId = helpdeskEmployee.empId;
  snLookupShortDesc = shortDesc;

  // Open ServiceNow
  window.open(url, '_blank');

  // Start auto-polling for INC number after a delay
  var incStatus = document.getElementById('helpdesk-inc-status');
  if (incStatus) {
    incStatus.textContent = 'ServiceNow opened — INC number will be captured automatically after you submit.';
    incStatus.style.color = '#7c3aed';
  }
  showToast('ServiceNow opened — INC number will be captured automatically', 'info');

  // Start auto-fetch: wait 15s initial delay, then poll every 5s for up to 2 minutes
  startIncAutoFetch();
}

// --- Auto-Fetch INC Number ---
var snAutoFetchTimer = null;
var snAutoFetchAttempt = 0;
var SN_INITIAL_DELAY = 15000;  // Wait 15s before first poll (give user time to submit)
var SN_POLL_INTERVAL = 5000;   // Poll every 5 seconds
var SN_MAX_ATTEMPTS = 24;      // Up to ~2 minutes of polling

function startIncAutoFetch() {
  // Clear any existing timer
  stopIncAutoFetch();
  snAutoFetchAttempt = 0;

  var incStatus = document.getElementById('helpdesk-inc-status');
  if (incStatus) {
    incStatus.textContent = 'Waiting for you to submit in ServiceNow...';
    incStatus.style.color = '#7c3aed';
  }

  // Initial delay before polling starts
  snAutoFetchTimer = setTimeout(function() {
    pollForIncNumber();
  }, SN_INITIAL_DELAY);
}

function stopIncAutoFetch() {
  if (snAutoFetchTimer) {
    clearTimeout(snAutoFetchTimer);
    snAutoFetchTimer = null;
  }
}

function pollForIncNumber() {
  if (!snLookupEmpId) {
    stopIncAutoFetch();
    return;
  }

  snAutoFetchAttempt++;
  var incStatus = document.getElementById('helpdesk-inc-status');

  if (incStatus) {
    incStatus.textContent = 'Searching for INC number... (poll ' + snAutoFetchAttempt + '/' + SN_MAX_ATTEMPTS + ')';
    incStatus.style.color = '#7c3aed';
  }

  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success && result.incidentNumber) {
        // Found it — auto-fill
        var incInput = document.getElementById('helpdesk-inc-number');
        if (incInput) incInput.value = result.incidentNumber;
        if (incStatus) {
          incStatus.textContent = result.incidentNumber + ' captured automatically!';
          incStatus.style.color = '#22c55e';
        }
        showToast('Incident ' + result.incidentNumber + ' captured!', 'success');
        stopIncAutoFetch();
      } else if (snAutoFetchAttempt < SN_MAX_ATTEMPTS) {
        // Not found yet — keep polling
        snAutoFetchTimer = setTimeout(function() {
          pollForIncNumber();
        }, SN_POLL_INTERVAL);
      } else {
        // Exhausted retries
        var errMsg = (result && result.error) ? result.error : 'Could not find incident. You can enter the INC number manually.';
        if (incStatus) {
          incStatus.textContent = errMsg;
          incStatus.style.color = '#ef4444';
        }
        showToast('Auto-capture timed out. Enter INC number manually if needed.', 'warning');
        stopIncAutoFetch();
      }
    })
    .withFailureHandler(function(err) {
      if (snAutoFetchAttempt < SN_MAX_ATTEMPTS) {
        // Network error — keep trying
        snAutoFetchTimer = setTimeout(function() {
          pollForIncNumber();
        }, SN_POLL_INTERVAL);
      } else {
        if (incStatus) {
          incStatus.textContent = 'API error: ' + err.message;
          incStatus.style.color = '#ef4444';
        }
        stopIncAutoFetch();
      }
    })
    .getLatestSnIncident(snLookupEmpId, snLookupShortDesc);
}

// --- Save Incident ---
function saveAndSendNow() {
  saveIncident(true);
}

function saveAndQueueEmail() {
  saveIncident(false);
}

function saveIncident(sendNow) {
  if (!helpdeskEmployee) {
    showToast('Look up an employee first (Step 1)', 'warning');
    return;
  }
  var shortDesc = document.getElementById('helpdesk-short-desc').value.trim();
  if (!shortDesc) {
    showToast('Enter a short description (Step 3)', 'warning');
    return;
  }

  var category = document.getElementById('helpdesk-category').value;
  if (!category) {
    showToast('Select a category (Step 3)', 'warning');
    return;
  }

  var data = {
    employeeId: helpdeskEmployee.empId,
    employeeName: helpdeskEmployee.name,
    employeeEmail: helpdeskEmployee.email,
    roomNumber: helpdeskEmployee.roomNumber,
    shortDescription: shortDesc,
    description: document.getElementById('helpdesk-full-desc').value.trim(),
    category: category,
    subcategory: document.getElementById('helpdesk-subcategory').value,
    channel: document.getElementById('helpdesk-channel').value,
    impact: document.getElementById('helpdesk-impact').value,
    userType: document.getElementById('helpdesk-user-type').value,
    snowIncidentNumber: document.getElementById('helpdesk-inc-number').value.trim(),
    emailStatus: sendNow ? 'sending' : 'queued'
  };

  showToast('Saving incident...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        showToast('Incident saved!', 'success');
        var incidentId = result.incident.id;

        if (sendNow) {
          showToast('Sending email...', 'info');
          google.script.run
            .withSuccessHandler(function(emailResult) {
              if (emailResult && emailResult.success) {
                showToast('Email sent!', 'success');
              } else {
                showToast('Email failed: ' + (emailResult ? emailResult.error : 'Unknown'), 'error');
              }
              loadIncidents();
              loadEmailQueueTable();
            })
            .withFailureHandler(function(err) {
              showToast('Email error: ' + err.message, 'error');
              loadIncidents();
            })
            .sendIncidentEmail(incidentId);
        } else {
          google.script.run
            .withSuccessHandler(function(queueResult) {
              if (queueResult && queueResult.success) {
                showToast('Email queued!', 'success');
              } else {
                showToast('Queue failed: ' + (queueResult ? queueResult.error : 'Unknown'), 'error');
              }
              loadIncidents();
              loadEmailQueueTable();
            })
            .withFailureHandler(function(err) {
              showToast('Queue error: ' + err.message, 'error');
              loadIncidents();
            })
            .queueIncidentEmail(incidentId);
        }

        // Save AI training data if AI was used
        saveAiTrainingData(incidentId, data);

        // Reset form
        resetHelpdeskForm();
      } else {
        showToast('Save failed: ' + (result ? result.error : 'Unknown'), 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Save error: ' + err.message, 'error');
    })
    .createIncident(data);
}

function saveAiTrainingData(incidentId, data) {
  var aiInput = document.getElementById('helpdesk-ai-input');
  var rawText = aiInput ? aiInput.value.trim() : '';
  if (!rawText) return; // Only save training data if AI input was used

  // Determine if the user accepted AI suggestions or corrected them
  var aiAccepted = false;
  if (currentAiSuggestion) {
    aiAccepted = (
      data.category === currentAiSuggestion.category &&
      data.subcategory === currentAiSuggestion.subcategory &&
      data.channel === currentAiSuggestion.channel &&
      data.impact === currentAiSuggestion.impact
    );
  }

  var trainingData = {
    rawDescription: rawText,
    improvedDescription: data.description || data.shortDescription,
    category: data.category,
    subcategory: data.subcategory,
    channel: data.channel,
    impact: data.impact,
    serviceOffering: currentAiSuggestion ? currentAiSuggestion.serviceOffering : '',
    aiAccepted: aiAccepted,
    confidence: currentAiSuggestion ? currentAiSuggestion.confidence : 0,
    source: currentAiSuggestion ? currentAiSuggestion.source : 'none',
    incidentId: incidentId
  };

  google.script.run
    .withSuccessHandler(function() {
      console.log('AI training data saved');
    })
    .withFailureHandler(function(err) {
      console.error('Failed to save AI training data:', err);
    })
    .saveTrainingEntry(trainingData);
}

function resetHelpdeskForm() {
  helpdeskEmployee = null;
  document.getElementById('helpdesk-emp-id').value = '';
  document.getElementById('helpdesk-employee-result').classList.add('hidden');
  document.getElementById('helpdesk-employee-error').classList.add('hidden');
  document.getElementById('helpdesk-channel').value = 'walk-in';
  document.getElementById('helpdesk-category').value = '';
  document.getElementById('helpdesk-subcategory').innerHTML = '<option value="">-- Select Category first --</option>';
  document.getElementById('helpdesk-impact').value = '4';
  document.getElementById('helpdesk-user-type').value = '';
  document.getElementById('helpdesk-short-desc').value = '';
  document.getElementById('helpdesk-full-desc').value = '';
  document.getElementById('helpdesk-inc-number').value = '';
  // Reset SN fetch state
  snLookupEmpId = '';
  snLookupShortDesc = '';
  stopIncAutoFetch();
  var incStatus = document.getElementById('helpdesk-inc-status');
  if (incStatus) { incStatus.textContent = ''; incStatus.style.color = '#888'; }
  // Reset AI fields
  var aiInput = document.getElementById('helpdesk-ai-input');
  if (aiInput) aiInput.value = '';
  hideAiSuggestions();
  // Reset accept button states
  var btns = document.querySelectorAll('.ai-accept-btn, .ai-accept-all-btn');
  btns.forEach(function(btn) {
    btn.classList.remove('ai-accepted');
    btn.disabled = false;
    btn.textContent = btn.classList.contains('ai-accept-all-btn') ? 'Accept All Suggestions' : 'Accept';
  });
}

// --- Incidents Table ---
function loadIncidents() {
  google.script.run
    .withSuccessHandler(function(result) {
      var container = document.getElementById('helpdesk-incidents-table');
      if (!result || !result.success || !result.incidents || result.incidents.length === 0) {
        container.innerHTML = '<p class="text-muted">No incidents recorded yet.</p>';
        return;
      }
      var rows = result.incidents.slice(0, 50).map(function(inc) {
        var incNum = inc.snowIncidentNumber || '—';
        var empName = inc.employeeName || 'Unknown';
        var issue = inc.shortDescription || '—';
        var emailCls = (inc.emailStatus || 'not-sent').replace(/\s/g, '-');
        var statusCls = (inc.status || 'open');
        var date = inc.createdAt ? new Date(inc.createdAt).toLocaleDateString() : '—';
        return '<tr>' +
          '<td>' + escapeHtml(incNum) + '</td>' +
          '<td>' + escapeHtml(empName) + '</td>' +
          '<td>' + escapeHtml(issue) + '</td>' +
          '<td><span class="inc-status ' + emailCls + '">' + escapeHtml(inc.emailStatus || 'not-sent') + '</span></td>' +
          '<td><span class="inc-status ' + statusCls + '">' + escapeHtml(inc.status || 'open') + '</span></td>' +
          '<td>' + date + '</td>' +
        '</tr>';
      }).join('');

      container.innerHTML = '<table>' +
        '<thead><tr><th>INC #</th><th>Employee</th><th>Issue</th><th>Email</th><th>Status</th><th>Date</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
    })
    .withFailureHandler(function(err) {
      document.getElementById('helpdesk-incidents-table').innerHTML =
        '<p class="text-muted">Error loading incidents.</p>';
      console.error('Load incidents error:', err);
    })
    .getIncidents(50);
}

// --- Email Queue Table ---
function loadEmailQueueTable() {
  google.script.run
    .withSuccessHandler(function(result) {
      var container = document.getElementById('helpdesk-queue-table');
      var badge = document.getElementById('helpdesk-queue-count');

      if (!result || !result.success || !result.items || result.items.length === 0) {
        container.innerHTML = '<p class="text-muted">Email queue is empty.</p>';
        badge.style.display = 'none';
        return;
      }

      var pendingCount = result.items.filter(function(i) { return i.status === 'pending'; }).length;
      if (pendingCount > 0) {
        badge.textContent = pendingCount + ' pending';
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }

      var rows = result.items.slice(0, 30).map(function(item) {
        var statusCls = (item.status || 'pending');
        var date = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—';
        var sentDate = item.sentAt ? new Date(item.sentAt).toLocaleDateString() : '—';
        return '<tr>' +
          '<td>' + escapeHtml(item.to || '') + '</td>' +
          '<td>' + escapeHtml(item.subject || '') + '</td>' +
          '<td><span class="inc-status ' + statusCls + '">' + escapeHtml(item.status || 'pending') + '</span></td>' +
          '<td>' + date + '</td>' +
          '<td>' + sentDate + '</td>' +
        '</tr>';
      }).join('');

      container.innerHTML = '<table>' +
        '<thead><tr><th>To</th><th>Subject</th><th>Status</th><th>Created</th><th>Sent</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
    })
    .withFailureHandler(function(err) {
      document.getElementById('helpdesk-queue-table').innerHTML =
        '<p class="text-muted">Error loading queue.</p>';
      console.error('Load queue error:', err);
    })
    .getEmailQueue();
}

function processEmailQueueNow() {
  showToast('Processing email queue...', 'info');
  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        showToast(result.message || 'Queue processed!', 'success');
      } else {
        showToast('Queue error: ' + (result ? result.error : 'Unknown'), 'error');
      }
      loadIncidents();
      loadEmailQueueTable();
    })
    .withFailureHandler(function(err) {
      showToast('Queue processing error: ' + err.message, 'error');
    })
    .processEmailQueue();
}

// ============================================
// DATA MANAGEMENT — Settings Panel
// ============================================

// Sheet descriptions for the overview table
var SHEET_DESCRIPTIONS = {
  'Devices': 'All monitored printers, copiers, and network devices',
  'SupplyHistory': 'Historical supply level data (toner, drums, etc.)',
  'SNMPTraps': 'SNMP trap events received from devices',
  'EmailConfig': 'Email notification configuration settings',
  'EmailHistory': 'Log of all sent email notifications',
  'Settings': 'Application settings and preferences',
  'Blueprints': 'Floor plan images and metadata',
  'Technicians': 'Technician staff contact information',
  'Teachers': 'Teacher contact information',
  'DeviceTypes': 'Device type definitions with colors and icons',
  'IssueButtons': 'Quick issue buttons for service requests',
  'ServiceRequests': 'Service request tickets from users',
  'QRCodes': 'QR code label assignments for devices',
  'EmailTemplates': 'Email notification templates',
  'Incidents': 'Device incident and alert history',
  'EmailQueue': 'Pending emails waiting to be sent',
  'AITraining': 'AI training data for service request routing',
  'ComputerRepairs': 'Computer repair tickets and tracking',
  'CRTraining': 'Computer repair AI training data'
};

// Track last backup time
var lastBackupTime = null;

function loadDataManagement() {
  loadSheetStats();
}

function loadSheetStats() {
  var tableBody = document.getElementById('sheets-table-body');
  var gridContainer = document.getElementById('data-mgmt-grid');

  if (tableBody) {
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Loading sheet statistics...</td></tr>';
  }
  if (gridContainer) {
    gridContainer.innerHTML = '<p class="text-muted">Loading sheet statistics...</p>';
  }

  google.script.run
    .withSuccessHandler(function(result) {
      if (!result || !result.success) {
        if (tableBody) {
          tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Failed to load sheet stats.</td></tr>';
        }
        return;
      }
      renderSheetsTable(result.stats);
      renderDataManagementCards(result.stats);
      // Update cell count info
      var cellInfo = document.getElementById('cell-count-info');
      if (cellInfo && result.totalCells !== undefined) {
        var pct = ((result.totalCells / result.cellLimit) * 100).toFixed(1);
        var color = pct > 80 ? 'var(--danger)' : pct > 50 ? 'var(--warning)' : 'var(--success)';
        cellInfo.innerHTML = 'Cell usage: <strong style="color:' + color + '">' + formatNumber(result.totalCells) + '</strong> / ' + formatNumber(result.cellLimit) + ' (' + pct + '%)';
      }
    })
    .withFailureHandler(function(err) {
      if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Error: ' + err.message + '</td></tr>';
      }
    })
    .getSheetStats();
}

function compactDatabase() {
  showToast('Compacting database...', 'info');
  google.script.run
    .withSuccessHandler(function(result) {
      showToast('Database compacted! ~' + formatNumber(result.reclaimed || 0) + ' cells reclaimed', 'success');
      // Reload stats to show updated cell counts
      loadSheetStats();
    })
    .withFailureHandler(function(error) {
      showToast('Error compacting: ' + error.message, 'error');
    })
    .compactAllSheets();
}

function renderSheetsTable(stats) {
  var tableBody = document.getElementById('sheets-table-body');
  if (!tableBody) return;

  var html = '';
  var totalRecords = 0;
  var totalCells = 0;

  for (var i = 0; i < stats.length; i++) {
    var s = stats[i];
    totalRecords += s.rowCount;
    totalCells += (s.cellCount || 0);
    var description = SHEET_DESCRIPTIONS[s.sheetName] || 'System data sheet';
    var recordsClass = s.rowCount > 0 ? 'sheet-records-badge has-data' : 'sheet-records-badge empty';
    var cellStr = s.cellCount ? formatNumber(s.cellCount) : '—';
    var dimStr = s.maxRows && s.maxCols ? s.maxRows + '×' + s.maxCols : '';

    html += '<tr>' +
      '<td>' +
        '<div class="sheet-name-cell">' +
          '<div class="sheet-icon"><i data-lucide="file-spreadsheet"></i></div>' +
          '<a href="#" class="sheet-name-link" onclick="openGoogleSheet(\'' + escapeHtml(s.sheetName) + '\'); return false;">' + escapeHtml(s.sheetName) + '</a>' +
        '</div>' +
      '</td>' +
      '<td><span class="sheet-key-badge">' + escapeHtml(s.sheetKey) + '</span></td>' +
      '<td><span class="' + recordsClass + '">' + formatNumber(s.rowCount) + '</span></td>' +
      '<td><span style="font-family:monospace; font-size:12px; color:var(--text-secondary);" title="' + dimStr + '">' + cellStr + '</span></td>' +
      '<td><span class="sheet-description">' + escapeHtml(description) + '</span></td>' +
      '<td>' +
        '<div class="sheet-actions">' +
          '<button class="btn btn-outline btn-sm" onclick="exportSheetCSV(\'' + escapeHtml(s.sheetName) + '\')" title="Export CSV">' +
            '<i data-lucide="download"></i>' +
          '</button>' +
          '<button class="btn btn-outline btn-sm" onclick="openGoogleSheet(\'' + escapeHtml(s.sheetName) + '\')" title="Open in Google Sheets">' +
            '<i data-lucide="external-link"></i>' +
          '</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  // Add summary row
  html += '<tr class="summary-row" style="background: var(--bg-secondary); font-weight: 600;">' +
    '<td colspan="2" style="text-align: right;">Total:</td>' +
    '<td><span class="sheet-records-badge has-data">' + formatNumber(totalRecords) + '</span></td>' +
    '<td><span style="font-family:monospace; font-size:12px;">' + formatNumber(totalCells) + '</span></td>' +
    '<td colspan="2" style="color: var(--text-secondary);">' + stats.length + ' sheets in database</td>' +
  '</tr>';

  tableBody.innerHTML = html;
  setTimeout(function() { lucide.createIcons(); }, 50);
}

function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function openGoogleSheet(sheetName) {
  // Get the spreadsheet ID from server and construct URL
  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.spreadsheetId) {
        var url = 'https://docs.google.com/spreadsheets/d/' + result.spreadsheetId + '/edit#gid=' + (result.sheetId || '0');
        window.open(url, '_blank');
        showToast('Opening ' + sheetName + ' in Google Sheets...', 'info');
      } else {
        showToast('Could not get spreadsheet URL', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error: ' + err.message, 'error');
    })
    .getSpreadsheetInfo(sheetName);
}

function createFullBackup() {
  showToast('Creating full backup... Please wait.', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      if (!result || !result.success) {
        showToast('Backup failed: ' + (result ? result.error : 'Unknown error'), 'error');
        return;
      }

      // Create and download the backup file
      var backupData = {
        backupDate: new Date().toISOString(),
        appVersion: '1.0',
        sheets: result.data
      };

      var blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = 'SmartSchoolMonitor_Backup_' + dateStr + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Update last backup time
      lastBackupTime = new Date();
      updateLastBackupDisplay();

      showToast('Full backup created successfully!', 'success');
    })
    .withFailureHandler(function(err) {
      showToast('Backup failed: ' + err.message, 'error');
    })
    .createFullBackup();
}

function updateLastBackupDisplay() {
  var display = document.getElementById('last-backup-time');
  if (display && lastBackupTime) {
    display.textContent = 'Last backup: ' + lastBackupTime.toLocaleString();
  }
}

// ============================================
// SNMP TRAPS TABLE (Settings)
// ============================================

function loadSnmpTrapsTable() {
  var tableBody = document.getElementById('snmp-traps-table-body');
  var countBadge = document.getElementById('snmp-traps-count');

  if (tableBody) {
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted"><i data-lucide="loader" class="spin"></i> Loading traps...</td></tr>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  google.script.run
    .withSuccessHandler(function(traps) {
      renderSnmpTrapsTable(traps || []);
    })
    .withFailureHandler(function(err) {
      if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Error loading traps: ' + err.message + '</td></tr>';
      }
    })
    .getTraps(200); // Get more traps for the settings view
}

// Reprocess all traps to fix "Device Alert" messages
function reprocessTrapsFromUI() {
  showConfirmCard({
    title: 'Fix Alert Messages',
    message: 'This will reprocess all SNMP traps and update any showing "Device Alert" with the actual alert message (Paper Jam, Cover Open, etc.). Continue?',
    type: 'info',
    confirmText: 'Fix Messages',
    onConfirm: function() {
      showToast('Reprocessing traps...', 'info');

      google.script.run
        .withSuccessHandler(function(result) {
          if (result.success) {
            showToast('Updated ' + result.updated + ' of ' + result.total + ' traps', 'success');
            // Reload the table and traps list
            loadSnmpTrapsTable();
            loadTraps().then(function() {
              renderTrapsList();
              renderDashboard();
              renderDeviceMarkers();
            });
          } else {
            showToast('Error: ' + (result.error || 'Unknown error'), 'error');
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error reprocessing traps: ' + err.message, 'error');
        })
        .reprocessAllTraps();
    }
  });
}

function renderSnmpTrapsTable(traps) {
  var tableBody = document.getElementById('snmp-traps-table-body');
  var countBadge = document.getElementById('snmp-traps-count');

  if (!tableBody) return;

  if (countBadge) {
    countBadge.textContent = traps.length + ' traps';
  }

  if (traps.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No SNMP traps recorded yet.</td></tr>';
    return;
  }

  var html = '';
  for (var i = 0; i < traps.length; i++) {
    var trap = traps[i];
    var severityClass = 'badge-info';
    var severityIcon = 'info';

    if (trap.severity === 'critical' || trap.severity === 'error') {
      severityClass = 'badge-danger';
      severityIcon = 'alert-circle';
    } else if (trap.severity === 'warning') {
      severityClass = 'badge-warning';
      severityIcon = 'alert-triangle';
    }

    var statusBadge = trap.processed === 1 || trap.processed === '1' || trap.processed === true
      ? '<span class="badge badge-success">Resolved</span>'
      : '<span class="badge badge-warning">Active</span>';

    var receivedDate = trap.receivedAt ? new Date(trap.receivedAt).toLocaleString() : '—';

    // Build varbind detail content from trapData
    var detailRowId = 'trap-detail-' + i;
    var varbindHtml = '';
    if (trap.trapData && trap.trapData.decodedVarbinds) {
      var vb = trap.trapData.decodedVarbinds;
      varbindHtml = '<table class="sheets-table" style="font-size:0.8em;margin:0;"><thead><tr><th>OID</th><th>Value</th></tr></thead><tbody>';
      for (var oid in vb) {
        if (vb.hasOwnProperty(oid)) {
          varbindHtml += '<tr><td style="font-family:monospace;font-size:0.85em;word-break:break-all;">' + escapeHtml(oid) + '</td><td>' + escapeHtml(String(vb[oid])) + '</td></tr>';
        }
      }
      varbindHtml += '</tbody></table>';
    } else if (trap.trapData && trap.trapData.varbindSummary) {
      varbindHtml = '<pre style="font-size:0.85em;margin:0;white-space:pre-wrap;word-break:break-all;">' + escapeHtml(trap.trapData.varbindSummary) + '</pre>';
    } else if (trap.trapData && trap.trapData.raw) {
      varbindHtml = '<div style="font-size:0.8em;"><strong>Raw hex:</strong><pre style="margin:0.25rem 0;word-break:break-all;white-space:pre-wrap;font-size:0.85em;">' + escapeHtml(trap.trapData.raw.substring(0, 500)) + '</pre></div>';
    } else {
      varbindHtml = '<em class="text-muted">No decoded data available</em>';
    }

    html += '<tr>' +
      '<td><span class="badge ' + severityClass + '"><i data-lucide="' + severityIcon + '" style="width:12px;height:12px;"></i> ' + escapeHtml(trap.severity || 'info') + '</span></td>' +
      '<td><code style="font-size: 0.85em;">' + escapeHtml(trap.sourceIp || '—') + '</code></td>' +
      '<td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' + escapeHtml(trap.message || '') + '">' + escapeHtml(trap.message || '—') + '</td>' +
      '<td style="font-size: 0.85em; color: var(--text-secondary);">' + receivedDate + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td><button class="btn btn-outline btn-sm" onclick="document.getElementById(\'' + detailRowId + '\').style.display = document.getElementById(\'' + detailRowId + '\').style.display === \'none\' ? \'table-row\' : \'none\'" title="View raw trap data"><i data-lucide="code-2" style="width:14px;height:14px;"></i></button></td>' +
    '</tr>';

    // Hidden detail row with varbind data
    html += '<tr id="' + detailRowId + '" style="display:none;"><td colspan="6" style="background:var(--bg-secondary);padding:0.5rem 1rem;border-left:3px solid var(--primary);">' + varbindHtml + '</td></tr>';
  }

  tableBody.innerHTML = html;
  setTimeout(function() { lucide.createIcons(); }, 50);
}

function openSnmpTrapsSheet() {
  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.spreadsheetId) {
        var url = 'https://docs.google.com/spreadsheets/d/' + result.spreadsheetId + '/edit#gid=' + (result.sheetId || '0');
        window.open(url, '_blank');
        showToast('Opening SNMP Traps sheet in Google Sheets...', 'info');
      } else {
        showToast('Could not get spreadsheet URL', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error: ' + err.message, 'error');
    })
    .getSpreadsheetInfo('SNMPTraps');
}

function exportSnmpTrapsCSV() {
  var traps = state.traps || [];
  if (traps.length === 0) {
    showToast('No traps to export. Click Refresh first.', 'warning');
    return;
  }

  // Build CSV content
  var headers = ['ID', 'Source IP', 'Message', 'Severity', 'Received At', 'Status', 'Resolved At', 'Resolved By'];
  var csvContent = headers.join(',') + '\n';

  for (var i = 0; i < traps.length; i++) {
    var trap = traps[i];
    var row = [
      '"' + (trap.id || '') + '"',
      '"' + (trap.sourceIp || '') + '"',
      '"' + (trap.message || '').replace(/"/g, '""') + '"',
      '"' + (trap.severity || '') + '"',
      '"' + (trap.receivedAt || '') + '"',
      '"' + (trap.processed ? 'Resolved' : 'Active') + '"',
      '"' + (trap.resolvedAt || '') + '"',
      '"' + (trap.resolvedBy || '') + '"'
    ];
    csvContent += row.join(',') + '\n';
  }

  // Download the file
  var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  var dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = 'SNMP_Traps_Export_' + dateStr + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('SNMP Traps exported to CSV', 'success');
}

function renderDataManagementCards(stats) {
  var container = document.getElementById('data-mgmt-grid');
  if (!container) return;

  var html = '';
  for (var i = 0; i < stats.length; i++) {
    var s = stats[i];
    var badgeClass = s.rowCount === 0 ? 'data-mgmt-badge empty' : 'data-mgmt-badge';
    var clearDisabled = s.rowCount === 0 ? 'disabled' : '';

    html += '<div class="data-mgmt-card">' +
      '<div class="data-mgmt-card-header">' +
        '<span class="data-mgmt-card-name">' + escapeHtml(s.sheetName) + '</span>' +
        '<span class="' + badgeClass + '">' + s.rowCount + ' rows</span>' +
      '</div>' +
      '<div class="data-mgmt-actions">' +
        '<button class="btn btn-outline btn-sm" onclick="exportSheetCSV(\'' + escapeHtml(s.sheetName) + '\')">' +
          '<i data-lucide="download"></i> Export' +
        '</button>' +
        '<button class="btn btn-outline btn-sm" onclick="showCsvImportModal(\'' + escapeHtml(s.sheetName) + '\')">' +
          '<i data-lucide="upload"></i> Import' +
        '</button>' +
        '<button class="btn btn-danger btn-sm" onclick="clearSheetData(\'' + escapeHtml(s.sheetName) + '\', ' + s.rowCount + ')" ' + clearDisabled + '>' +
          '<i data-lucide="trash-2"></i> Clear' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  container.innerHTML = html;
  setTimeout(function() { lucide.createIcons(); }, 50);
}

function exportSheetCSV(sheetName) {
  showToast('Exporting ' + sheetName + '...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      if (!result || !result.success) {
        showToast('Export failed: ' + (result ? result.error : 'Unknown error'), 'error');
        return;
      }
      if (!result.csv) {
        showToast(sheetName + ' is empty — nothing to export.', 'warning');
        return;
      }
      // Trigger browser download
      var blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = result.filename || (sheetName + '.csv');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(sheetName + ' exported successfully!', 'success');
    })
    .withFailureHandler(function(err) {
      showToast('Export error: ' + err.message, 'error');
    })
    .exportSheetAsCSV(sheetName);
}

var csvImportTargetSheet = '';

function showCsvImportModal(sheetName) {
  csvImportTargetSheet = sheetName;
  var label = document.getElementById('csv-import-sheet-label');
  if (label) label.textContent = sheetName;
  var fileInput = document.getElementById('csv-import-file');
  if (fileInput) fileInput.value = '';
  var status = document.getElementById('csv-import-status');
  if (status) status.style.display = 'none';
  document.getElementById('csv-import-modal').classList.add('active');
  setTimeout(function() { lucide.createIcons(); }, 50);
}

function closeCsvImportModal() {
  document.getElementById('csv-import-modal').classList.remove('active');
  csvImportTargetSheet = '';
}

function submitCsvImport() {
  var fileInput = document.getElementById('csv-import-file');
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    showToast('Please select a CSV file.', 'warning');
    return;
  }

  var file = fileInput.files[0];
  var reader = new FileReader();
  var statusEl = document.getElementById('csv-import-status');
  var btn = document.getElementById('csv-import-btn');

  if (btn) btn.disabled = true;
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.background = '#eff6ff';
    statusEl.style.color = '#2563eb';
    statusEl.textContent = 'Uploading and importing...';
  }

  reader.onload = function(e) {
    var csvData = e.target.result;
    google.script.run
      .withSuccessHandler(function(result) {
        if (btn) btn.disabled = false;
        if (!result || !result.success) {
          if (statusEl) {
            statusEl.style.background = '#fef2f2';
            statusEl.style.color = '#dc2626';
            statusEl.textContent = 'Error: ' + (result ? result.error : 'Unknown error');
          }
          return;
        }
        if (statusEl) {
          statusEl.style.background = '#f0fdf4';
          statusEl.style.color = '#16a34a';
          statusEl.textContent = 'Successfully imported ' + result.rowsImported + ' rows!';
        }
        showToast('Imported ' + result.rowsImported + ' rows into ' + csvImportTargetSheet, 'success');
        // Refresh the relevant views after import
        setTimeout(function() {
          loadDataManagement();
          // If devices were imported, refresh device list/table/markers
          if (csvImportTargetSheet === 'Devices') {
            loadDevices().then(function() {
              updateAllStats();
              renderDeviceMarkers();
              renderDeviceTable();
              renderDashboard();
            });
          }
        }, 500);
      })
      .withFailureHandler(function(err) {
        if (btn) btn.disabled = false;
        if (statusEl) {
          statusEl.style.background = '#fef2f2';
          statusEl.style.color = '#dc2626';
          statusEl.textContent = 'Error: ' + err.message;
        }
      })
      .importSheetFromCSV(csvImportTargetSheet, csvData);
  };

  reader.readAsText(file);
}

function clearSheetData(sheetName, rowCount) {
  showConfirmCard({
    type: 'danger',
    title: 'Clear ' + sheetName,
    message: 'This will permanently delete all ' + rowCount + ' data rows from the <strong>' + sheetName + '</strong> sheet. The header row will be preserved. This action cannot be undone.',
    confirmText: 'Clear All Data',
    onConfirm: function() {
      showToast('Clearing ' + sheetName + '...', 'info');
      google.script.run
        .withSuccessHandler(function(result) {
          if (!result || !result.success) {
            showToast('Clear failed: ' + (result ? result.error : 'Unknown error'), 'error');
            return;
          }
          showToast('Cleared ' + result.rowsDeleted + ' rows from ' + sheetName, 'success');
          loadDataManagement();
        })
        .withFailureHandler(function(err) {
          showToast('Clear error: ' + err.message, 'error');
        })
        .clearSheet(sheetName);
    }
  });
}

// ============================================
// DEVICE IMPORT (simplified CSV)
// ============================================

function showDeviceImportModal() {
  var fileInput = document.getElementById('device-import-file');
  if (fileInput) fileInput.value = '';
  var status = document.getElementById('device-import-status');
  if (status) status.style.display = 'none';
  var btn = document.getElementById('device-import-btn');
  if (btn) btn.disabled = false;
  document.getElementById('device-import-modal').classList.add('active');
  setTimeout(function() { lucide.createIcons(); }, 50);
}

function closeDeviceImportModal() {
  document.getElementById('device-import-modal').classList.remove('active');
}

function downloadDeviceTemplate() {
  var csv = 'IP Address,Model,Machine ID,Serial Number,Location\n';
  csv += '10.0.1.100,HP LaserJet Pro M404,MFP-001,VNC3R12345,Room 204\n';
  csv += '10.0.1.101,Xerox WorkCentre 6515,MFP-002,XRX9876543,Media Center\n';
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'device-import-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Template downloaded', 'success');
}

function submitDeviceImport() {
  var fileInput = document.getElementById('device-import-file');
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    showToast('Please select a CSV file.', 'warning');
    return;
  }

  var file = fileInput.files[0];
  var reader = new FileReader();
  var statusEl = document.getElementById('device-import-status');
  var btn = document.getElementById('device-import-btn');

  if (btn) btn.disabled = true;
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.background = '#eff6ff';
    statusEl.style.color = '#2563eb';
    statusEl.textContent = 'Importing devices...';
  }

  reader.onload = function(e) {
    var csvData = e.target.result;
    google.script.run
      .withSuccessHandler(function(result) {
        if (btn) btn.disabled = false;
        if (!result || !result.success) {
          if (statusEl) {
            statusEl.style.background = '#fef2f2';
            statusEl.style.color = '#dc2626';
            statusEl.textContent = 'Error: ' + (result ? result.error : 'Unknown error');
          }
          return;
        }
        if (statusEl) {
          statusEl.style.background = '#f0fdf4';
          statusEl.style.color = '#16a34a';
          statusEl.textContent = 'Successfully imported ' + result.devicesImported + ' devices!';
        }
        showToast('Imported ' + result.devicesImported + ' devices', 'success');
        // Refresh device views
        loadDevices().then(function() {
          updateAllStats();
          renderDeviceMarkers();
          renderDeviceTable();
          renderDashboard();
        });
      })
      .withFailureHandler(function(err) {
        if (btn) btn.disabled = false;
        if (statusEl) {
          statusEl.style.background = '#fef2f2';
          statusEl.style.color = '#dc2626';
          statusEl.textContent = 'Error: ' + err.message;
        }
      })
      .importDevicesFromCSV(csvData);
  };

  reader.readAsText(file);
}

// ============================================
// ANALYTICS DASHBOARD
// ============================================

var CHART_COLORS = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#8b5cf6'];

function loadAnalytics() {
  // Show loading state in all chart containers
  var chartIds = ['chart-top-requesters', 'chart-categories', 'chart-monthly', 'chart-channels', 'chart-top-issues', 'chart-ai-perf'];
  chartIds.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<p class="text-muted">Loading...</p>';
  });

  google.script.run
    .withSuccessHandler(function(result) {
      if (!result || !result.success) {
        chartIds.forEach(function(id) {
          var el = document.getElementById(id);
          if (el) el.innerHTML = '<p class="text-muted">Failed to load analytics data.</p>';
        });
        return;
      }
      renderAnalyticsSummary(result.summary);
      renderTopRequesters(result.topRequesters);
      renderCategoryDonut(result.categories);
      renderMonthlyChart(result.monthly);
      renderChannelChart(result.channels);
      renderTopIssues(result.subcategories);
      renderAiPerformance(result.ai);
      setTimeout(function() { lucide.createIcons(); }, 100);
    })
    .withFailureHandler(function(err) {
      showToast('Analytics error: ' + err.message, 'error');
    })
    .getAnalyticsData();
}

function renderAnalyticsSummary(summary) {
  var el;
  el = document.getElementById('stat-total');
  if (el) el.textContent = summary.total || 0;
  el = document.getElementById('stat-open');
  if (el) el.textContent = summary.open || 0;
  el = document.getElementById('stat-closed');
  if (el) el.textContent = summary.closed || 0;
  el = document.getElementById('stat-ai-accuracy');
  if (el) el.textContent = (summary.aiAccuracy || 0) + '%';
}

function renderTopRequesters(data) {
  var container = document.getElementById('chart-top-requesters');
  if (!container) return;

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="analytics-empty"><p>No incident data yet.</p></div>';
    return;
  }

  var max = data[0].count;
  var html = '<div class="bar-chart-h">';
  for (var i = 0; i < data.length; i++) {
    var pct = max > 0 ? Math.round((data[i].count / max) * 100) : 0;
    html += '<div class="bar-row">' +
      '<span class="bar-label" title="' + escapeHtml(data[i].name) + '">' + escapeHtml(data[i].name) + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%; background:' + CHART_COLORS[i % CHART_COLORS.length] + ';"></div></div>' +
      '<span class="bar-value">' + data[i].count + '</span>' +
    '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

function renderCategoryDonut(data) {
  var container = document.getElementById('chart-categories');
  if (!container) return;

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="analytics-empty"><p>No category data yet.</p></div>';
    return;
  }

  var total = 0;
  for (var i = 0; i < data.length; i++) total += data[i].count;

  // Build SVG donut
  var radius = 60;
  var circumference = 2 * Math.PI * radius;
  var offset = 0;
  var segments = '';

  for (var j = 0; j < data.length; j++) {
    var pct = total > 0 ? data[j].count / total : 0;
    var dashLen = pct * circumference;
    var dashGap = circumference - dashLen;
    var color = CHART_COLORS[j % CHART_COLORS.length];

    segments += '<circle cx="80" cy="80" r="' + radius + '" fill="none" stroke="' + color + '" stroke-width="20" ' +
      'stroke-dasharray="' + dashLen + ' ' + dashGap + '" ' +
      'stroke-dashoffset="-' + offset + '" />';
    offset += dashLen;
  }

  var svg = '<svg class="donut-svg" viewBox="0 0 160 160">' + segments +
    '<text x="80" y="76" text-anchor="middle" font-size="22" font-weight="800" fill="var(--text-primary, #1e293b)">' + total + '</text>' +
    '<text x="80" y="94" text-anchor="middle" font-size="11" fill="var(--text-secondary, #64748b)">Total</text></svg>';

  var legend = '<div class="donut-legend">';
  for (var k = 0; k < data.length; k++) {
    legend += '<div class="donut-legend-item">' +
      '<span class="donut-legend-dot" style="background:' + CHART_COLORS[k % CHART_COLORS.length] + ';"></span>' +
      '<span class="donut-legend-label">' + escapeHtml(data[k].name) + '</span>' +
      '<span class="donut-legend-value">' + data[k].pct + '%</span>' +
    '</div>';
  }
  legend += '</div>';

  container.innerHTML = '<div class="donut-chart-wrap">' + svg + legend + '</div>';
}

function renderMonthlyChart(data) {
  var container = document.getElementById('chart-monthly');
  if (!container) return;

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="analytics-empty"><p>No monthly data yet.</p></div>';
    return;
  }

  var max = 0;
  for (var i = 0; i < data.length; i++) {
    if (data[i].count > max) max = data[i].count;
  }

  var html = '<div class="bar-chart-v">';
  for (var j = 0; j < data.length; j++) {
    var heightPct = max > 0 ? Math.round((data[j].count / max) * 100) : 0;
    var height = Math.max(2, Math.round(heightPct * 1.8)); // scale to px (max ~180px)
    html += '<div class="bar-col">' +
      '<span class="bar-col-count">' + (data[j].count > 0 ? data[j].count : '') + '</span>' +
      '<div class="bar-col-fill" style="height:' + height + 'px;"></div>' +
      '<span class="bar-col-label">' + escapeHtml(data[j].label) + '</span>' +
    '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

function renderChannelChart(data) {
  var container = document.getElementById('chart-channels');
  if (!container) return;

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="analytics-empty"><p>No channel data yet.</p></div>';
    return;
  }

  var max = data[0].count;
  var html = '<div class="bar-chart-h">';
  for (var i = 0; i < data.length; i++) {
    var pct = max > 0 ? Math.round((data[i].count / max) * 100) : 0;
    html += '<div class="bar-row">' +
      '<span class="bar-label" title="' + escapeHtml(data[i].name) + '">' + escapeHtml(data[i].name) + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%; background:' + CHART_COLORS[i % CHART_COLORS.length] + ';"></div></div>' +
      '<span class="bar-value">' + data[i].count + ' (' + data[i].pct + '%)</span>' +
    '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

function renderTopIssues(data) {
  var container = document.getElementById('chart-top-issues');
  if (!container) return;

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="analytics-empty"><p>No issue data yet.</p></div>';
    return;
  }

  var html = '<table class="analytics-table"><thead><tr><th>#</th><th>Subcategory</th><th>Count</th><th>%</th></tr></thead><tbody>';
  for (var i = 0; i < data.length; i++) {
    html += '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(data[i].name) + '</td><td>' + data[i].count + '</td><td>' + data[i].pct + '%</td></tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

function renderAiPerformance(ai) {
  var container = document.getElementById('chart-ai-perf');
  if (!container) return;

  if (!ai || ai.total === 0) {
    container.innerHTML = '<div class="analytics-empty"><p>No AI classification data yet. Use the Help Desk AI to start building training data.</p></div>';
    return;
  }

  var html = '<div class="ai-stat-row"><span class="ai-stat-label">Total Classifications</span><span class="ai-stat-value">' + ai.total + '</span></div>' +
    '<div class="ai-stat-row"><span class="ai-stat-label">Accepted by User</span><span class="ai-stat-value green">' + ai.accepted + ' (' + ai.accuracy + '%)</span></div>' +
    '<div class="ai-stat-row"><span class="ai-stat-label">Avg Confidence</span><span class="ai-stat-value purple">' + ai.avgConfidence + '%</span></div>' +
    '<div class="ai-stat-row"><span class="ai-stat-label">Exact Matches (Tier 1)</span><span class="ai-stat-value">' + ai.sources.exact + '</span></div>' +
    '<div class="ai-stat-row"><span class="ai-stat-label">Similarity Matches (Tier 2)</span><span class="ai-stat-value">' + ai.sources.similarity + '</span></div>' +
    '<div class="ai-stat-row"><span class="ai-stat-label">Keyword Rules (Tier 3)</span><span class="ai-stat-value amber">' + ai.sources.rules + '</span></div>';

  container.innerHTML = html;
}


// ============================================
// COMPUTER REPAIR MODULE
// ============================================

var crEmployee = null;
var crSiteNumber = '';
var crWebcamStream = null;
var crTesseractReady = false;
var crSnLookupEmpId = '';
var crSnLookupShortDesc = '';
var crInitialized = false;
var crAutoFetchTimer = null;
var crAutoFetchAttempt = 0;

// Hook into switchTab for Computer Repair tab
(function() {
  var origSwitch = window.switchTab;
  window.switchTab = function(tabName) {
    origSwitch(tabName);
    if (tabName === 'computer-repair') {
      initComputerRepair();
    }
  };
})();

function initComputerRepair() {
  if (!crInitialized) {
    crInitialized = true;
    // Enter key on employee ID input
    var empInput = document.getElementById('cr-emp-id');
    if (empInput) {
      empInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          computerRepairLookupEmployee();
        }
      });
    }
    // Warranty date change listener
    var warrantyInput = document.getElementById('cr-warranty-date');
    if (warrantyInput) {
      warrantyInput.addEventListener('change', computerRepairUpdateWarrantyBadge);
    }
    // Load saved site number
    loadCrSettings();
  }
  loadComputerRepairs();
}

// --- Site Number ---
function loadCrSettings() {
  google.script.run
    .withSuccessHandler(function(settings) {
      if (settings && settings.servicenowSiteNumber) {
        crSiteNumber = settings.servicenowSiteNumber;
        var input = document.getElementById('cr-site-number');
        if (input) input.value = crSiteNumber;
        var status = document.getElementById('cr-site-status');
        if (status) status.textContent = 'Saved';
      }
    })
    .getSettings();
}

function saveCrSiteNumber() {
  var val = document.getElementById('cr-site-number').value.trim();
  if (!val) { showToast('Enter a site number', 'warning'); return; }
  crSiteNumber = val;
  google.script.run
    .withSuccessHandler(function() {
      var status = document.getElementById('cr-site-status');
      if (status) { status.textContent = 'Saved'; status.style.color = '#22c55e'; }
      showToast('Site number saved', 'success');
    })
    .withFailureHandler(function(err) { showToast('Failed to save: ' + err.message, 'error'); })
    .saveSetting('servicenowSiteNumber', val);
}

// --- Employee Lookup ---
function computerRepairLookupEmployee() {
  var empId = document.getElementById('cr-emp-id').value.trim();
  if (!empId) { showToast('Please enter an Employee ID', 'warning'); return; }

  var resultDiv = document.getElementById('cr-employee-result');
  var errorDiv = document.getElementById('cr-employee-error');
  resultDiv.classList.add('hidden');
  errorDiv.classList.add('hidden');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success && result.employee) {
        crEmployee = result.employee;
        document.getElementById('cr-emp-name').textContent = result.employee.name;
        document.getElementById('cr-emp-details').textContent =
          (result.employee.email || 'No email') + ' | Room ' + (result.employee.roomNumber || 'N/A');
        resultDiv.classList.remove('hidden');
        errorDiv.classList.add('hidden');
        lucide.createIcons();
      } else {
        crEmployee = null;
        resultDiv.classList.add('hidden');
        errorDiv.classList.remove('hidden');
        lucide.createIcons();
      }
    })
    .withFailureHandler(function(err) {
      crEmployee = null;
      resultDiv.classList.add('hidden');
      errorDiv.classList.remove('hidden');
      lucide.createIcons();
      console.error('CR Employee lookup failed:', err);
    })
    .lookupEmployee(empId);
}

// --- Serial Number Mode Toggle ---
function computerRepairSetSerialMode(mode) {
  var manualBtn = document.getElementById('cr-mode-manual-btn');
  var scanBtn = document.getElementById('cr-mode-scan-btn');
  var manualDiv = document.getElementById('cr-manual-entry');
  var webcamDiv = document.getElementById('cr-webcam-entry');

  if (mode === 'manual') {
    manualBtn.classList.add('active');
    scanBtn.classList.remove('active');
    manualDiv.style.display = '';
    webcamDiv.style.display = 'none';
    // Stop webcam if running
    computerRepairStopWebcam();
  } else {
    scanBtn.classList.add('active');
    manualBtn.classList.remove('active');
    manualDiv.style.display = 'none';
    webcamDiv.style.display = '';
    // Preload Tesseract
    loadTesseractJs();
  }
}

// --- Tesseract.js Dynamic Loader ---
function loadTesseractJs(callback) {
  if (crTesseractReady) {
    if (callback) callback();
    return;
  }
  if (document.getElementById('tesseract-script')) {
    // Already loading
    var checkInterval = setInterval(function() {
      if (typeof Tesseract !== 'undefined') {
        crTesseractReady = true;
        clearInterval(checkInterval);
        if (callback) callback();
      }
    }, 200);
    return;
  }
  var script = document.createElement('script');
  script.id = 'tesseract-script';
  script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  script.onload = function() {
    crTesseractReady = true;
    console.log('Tesseract.js loaded');
    if (callback) callback();
  };
  script.onerror = function() {
    showToast('Failed to load OCR library. Try again.', 'error');
  };
  document.head.appendChild(script);
}

// --- Webcam Functions ---
function computerRepairStartWebcam() {
  if (crWebcamStream) return; // Already running

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Camera not supported in this browser', 'error');
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
    .then(function(stream) {
      crWebcamStream = stream;
      var video = document.getElementById('cr-webcam-video');
      video.srcObject = stream;
      video.play();
      showToast('Camera started', 'success');
    })
    .catch(function(err) {
      showToast('Camera access denied: ' + err.message, 'error');
      console.error('Webcam error:', err);
    });
}

function computerRepairCapturePhoto() {
  if (!crWebcamStream) {
    showToast('Start the camera first', 'warning');
    return;
  }

  var video = document.getElementById('cr-webcam-video');
  var canvas = document.getElementById('cr-webcam-canvas');
  var ctx = canvas.getContext('2d');

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);

  var dataUrl = canvas.toDataURL('image/png');

  // Show preview
  var preview = document.getElementById('cr-captured-preview');
  var previewImg = document.getElementById('cr-captured-image');
  previewImg.src = dataUrl;
  preview.style.display = '';

  // Run OCR
  computerRepairRunOcr(dataUrl);
}

function computerRepairStopWebcam() {
  if (crWebcamStream) {
    crWebcamStream.getTracks().forEach(function(track) { track.stop(); });
    crWebcamStream = null;
    var video = document.getElementById('cr-webcam-video');
    if (video) video.srcObject = null;
  }
}

// --- OCR Processing ---
function computerRepairRunOcr(dataUrl) {
  var statusDiv = document.getElementById('cr-ocr-status');
  var statusText = document.getElementById('cr-ocr-status-text');
  var resultDiv = document.getElementById('cr-ocr-result');

  statusDiv.style.display = 'flex';
  statusText.textContent = 'Loading OCR engine...';
  resultDiv.style.display = 'none';

  loadTesseractJs(function() {
    statusText.textContent = 'Recognizing text...';

    Tesseract.recognize(dataUrl, 'eng', {
      logger: function(m) {
        if (m.status === 'recognizing text') {
          var pct = Math.round((m.progress || 0) * 100);
          statusText.textContent = 'Recognizing text... ' + pct + '%';
        }
      }
    }).then(function(result) {
      statusDiv.style.display = 'none';
      var text = result.data.text || '';

      if (!text.trim()) {
        showToast('No text detected. Try repositioning the sticker.', 'warning');
        return;
      }

      // Extract serial & warranty date
      var serial = computerRepairExtractSerial(text);
      var warrantyDate = computerRepairExtractDate(text);

      // Extract model info from OCR text
      var modelInfo = computerRepairExtractModel(text);

      // Populate OCR results panel
      document.getElementById('cr-ocr-serial').value = serial || '';
      document.getElementById('cr-ocr-warranty').value = warrantyDate || '';
      document.getElementById('cr-ocr-raw').value = text;
      resultDiv.style.display = '';

      // Auto-fill model and manufacturer if detected
      if (modelInfo.model) {
        var modelField = document.getElementById('cr-model');
        if (modelField && !modelField.value.trim()) {
          modelField.value = modelInfo.model;
        }
      }
      if (modelInfo.manufacturer) {
        var mfgField = document.getElementById('cr-manufacturer');
        if (mfgField && !mfgField.value) {
          mfgField.value = modelInfo.manufacturer;
        }
      }

      // Track scan in AI database
      trackOcrScan(!!serial);

      if (serial) {
        showToast('Serial number detected: ' + serial, 'success');
      } else {
        showToast('Could not auto-detect serial. Check raw text below.', 'info');
      }
    }).catch(function(err) {
      statusDiv.style.display = 'none';
      showToast('OCR error: ' + err.message, 'error');
      console.error('OCR error:', err);
    });
  });
}

// ============================================
// AI Intelligence Database
// ============================================
var aiLearningDB = {
  corrections: [],
  stats: {
    totalScans: 0,
    successfulExtractions: 0,
    userCorrections: 0
  }
};

// Load AI database from localStorage
function loadAiDatabase() {
  try {
    var saved = localStorage.getItem('aiLearningDB');
    if (saved) {
      aiLearningDB = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Error loading AI database:', e);
  }
  // Only update display if the AI panel exists (user is viewing settings)
  if (document.getElementById('ai-stat-corrections')) {
    updateAiStatsDisplay();
  }
}

// Save AI database to localStorage
function saveAiDatabase() {
  try {
    localStorage.setItem('aiLearningDB', JSON.stringify(aiLearningDB));
  } catch (e) {
    console.error('Error saving AI database:', e);
  }
}

// Update AI stats display
function updateAiStatsDisplay() {
  var correctionsEl = document.getElementById('ai-stat-corrections');
  var accuracyEl = document.getElementById('ai-stat-accuracy');

  if (correctionsEl) {
    correctionsEl.textContent = aiLearningDB.corrections.length;
  }

  if (accuracyEl && aiLearningDB.stats.totalScans > 0) {
    var accuracy = Math.round((aiLearningDB.stats.successfulExtractions / aiLearningDB.stats.totalScans) * 100);
    accuracyEl.textContent = accuracy + '%';
  }

  renderAiCorrectionsList();
}

// Add an AI correction
function addAiCorrection() {
  var wrongEl = document.getElementById('ai-ocr-wrong');
  var correctEl = document.getElementById('ai-ocr-correct');
  var typeEl = document.getElementById('ai-ocr-type');

  if (!wrongEl || !correctEl || !typeEl) return;

  var wrong = wrongEl.value.trim().toUpperCase();
  var correct = correctEl.value.trim().toUpperCase();
  var type = typeEl.value;

  if (!wrong || !correct) {
    showToast('Please enter both wrong and correct values', 'warning');
    return;
  }

  if (wrong === correct) {
    showToast('Wrong and correct values cannot be the same', 'warning');
    return;
  }

  // Check for duplicates
  var exists = aiLearningDB.corrections.some(function(c) {
    return c.wrong === wrong;
  });

  if (exists) {
    showToast('This correction already exists', 'warning');
    return;
  }

  // Add correction
  aiLearningDB.corrections.push({
    wrong: wrong,
    correct: correct,
    type: type,
    addedAt: new Date().toISOString()
  });

  aiLearningDB.stats.userCorrections++;
  saveAiDatabase();
  updateAiStatsDisplay();

  // Clear form
  wrongEl.value = '';
  correctEl.value = '';

  showToast('Correction added to AI database', 'success');
}

// Remove an AI correction
function removeAiCorrection(index) {
  aiLearningDB.corrections.splice(index, 1);
  saveAiDatabase();
  updateAiStatsDisplay();
  showToast('Correction removed', 'info');
}

// Render corrections list
function renderAiCorrectionsList() {
  var container = document.getElementById('ai-corrections-list');
  if (!container) return;

  if (aiLearningDB.corrections.length === 0) {
    container.innerHTML = '<div class="empty-state small">' +
      '<i data-lucide="check-circle"></i>' +
      '<p>No corrections added yet</p>' +
      '</div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  var html = '';
  aiLearningDB.corrections.forEach(function(c, index) {
    html += '<div class="ai-correction-item">';
    html += '<div class="ai-correction-values">';
    html += '<span class="ai-correction-wrong">' + c.wrong + '</span>';
    html += '<i data-lucide="arrow-right"></i>';
    html += '<span class="ai-correction-correct">' + c.correct + '</span>';
    html += '<span class="ai-correction-type">' + c.type.toUpperCase() + '</span>';
    html += '</div>';
    html += '<button class="btn btn-sm btn-ghost" onclick="removeAiCorrection(' + index + ')">';
    html += '<i data-lucide="x"></i>';
    html += '</button>';
    html += '</div>';
  });

  container.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Apply AI corrections to OCR text
function applyAiCorrections(text) {
  if (!text || aiLearningDB.corrections.length === 0) return text;

  var result = text.toUpperCase();

  aiLearningDB.corrections.forEach(function(c) {
    // Replace exact matches
    if (result === c.wrong) {
      result = c.correct;
    }
    // Also try to find and replace within the text
    result = result.replace(new RegExp(c.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), c.correct);
  });

  return result;
}

// Export AI database
function exportAiDatabase() {
  var dataStr = JSON.stringify(aiLearningDB, null, 2);
  var blob = new Blob([dataStr], { type: 'application/json' });
  var url = URL.createObjectURL(blob);

  var a = document.createElement('a');
  a.href = url;
  a.download = 'ai-learning-database-' + new Date().toISOString().split('T')[0] + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('AI database exported', 'success');
}

// Import AI database
function importAiDatabase() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function(event) {
      try {
        var imported = JSON.parse(event.target.result);

        // Merge corrections
        if (imported.corrections && Array.isArray(imported.corrections)) {
          imported.corrections.forEach(function(c) {
            var exists = aiLearningDB.corrections.some(function(existing) {
              return existing.wrong === c.wrong;
            });
            if (!exists) {
              aiLearningDB.corrections.push(c);
            }
          });
        }

        // Merge stats
        if (imported.stats) {
          aiLearningDB.stats.totalScans += imported.stats.totalScans || 0;
          aiLearningDB.stats.successfulExtractions += imported.stats.successfulExtractions || 0;
          aiLearningDB.stats.userCorrections += imported.stats.userCorrections || 0;
        }

        saveAiDatabase();
        updateAiStatsDisplay();
        showToast('AI database imported successfully', 'success');
      } catch (err) {
        showToast('Error importing: Invalid JSON file', 'error');
      }
    };
    reader.readAsText(file);
  };

  input.click();
}

// Reset AI database
function resetAiDatabase() {
  showConfirmCard({
    title: 'Reset AI Database?',
    message: 'All OCR corrections will be lost. This cannot be undone.',
    type: 'danger',
    confirmText: 'Reset',
    onConfirm: function() {
      aiLearningDB = {
        corrections: [],
        stats: {
          totalScans: 0,
          successfulExtractions: 0,
          userCorrections: 0
        }
      };
      saveAiDatabase();
      updateAiStatsDisplay();
      showToast('AI database reset to defaults', 'info');
    }
  });
}

// Track OCR scan for stats
function trackOcrScan(successful) {
  aiLearningDB.stats.totalScans++;
  if (successful) {
    aiLearningDB.stats.successfulExtractions++;
  }
  saveAiDatabase();
}

// Initialize AI database on page load
document.addEventListener('DOMContentLoaded', function() {
  loadAiDatabase();
});

// --- Serial Number Extraction (Enhanced OCR-aware) ---
function computerRepairExtractSerial(text) {
  if (!text) return '';

  // Apply user corrections from AI database first
  text = applyAiCorrections(text);

  // Clean OCR text - fix common mistakes but preserve original structure
  var cleanedText = text
    .replace(/PO\s*Number\s*[:\-=]?\s*[0-9]+/gi, '') // Remove PO numbers
    .replace(/Warranty\s*End\s*Date\s*[:\-=]?\s*[\d\/]+/gi, '') // Remove warranty dates
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  // Also create a version with OCR letter-to-number fixes for serial matching
  var ocrFixedText = cleanedText
    .replace(/[l|]/g, '1')  // l, | -> 1
    .replace(/O/g, '0');    // O -> 0 (uppercase O to zero)

  // ============ PALM BEACH COUNTY SCHOOL DISTRICT ASSET TAGS ============
  // Format: 7 alphanumeric characters like "5RS3P94", often on property stickers
  // The label shows "Property of the School District of Palm Beach County" followed by the asset tag

  // Look for the pattern after "Palm Beach County" or on a line by itself
  var pbcPatterns = [
    // Direct match after county name - the asset number on its own line
    /(?:Palm\s*Beach\s*County|School\s*District)[^A-Z0-9]*([0-9][A-Z0-9]{6})\b/i,
    // Match standalone 7-char alphanumeric starting with digit (common PBC format)
    /\b([0-9][A-Z]{2}[0-9][A-Z][0-9]{2})\b/i,  // Format: 5RS3P94
    /\b([0-9][A-Z][A-Z0-9]{5})\b/i,  // Generic: digit + letter + 5 alphanumeric
    // Look for barcode-adjacent text (asset tag is often above barcode)
    /\b([0-9][A-Z]{1,2}[0-9A-Z]{4,5})\b(?=.*(?:barcode|\|\||III))/i
  ];

  for (var i = 0; i < pbcPatterns.length; i++) {
    var pbcMatch = cleanedText.match(pbcPatterns[i]);
    if (pbcMatch && pbcMatch[1]) {
      var tag = pbcMatch[1].toUpperCase();
      // Validate: should be exactly 7 chars, start with number, have letters and numbers
      if (tag.length === 7 && /^[0-9]/.test(tag) && /[A-Z]/.test(tag) && /[0-9]/.test(tag)) {
        return tag;
      }
    }
  }

  // Also check if OCR misread first digit as "S" + digit (common error: "5" -> "S5")
  var misreadMatch = cleanedText.match(/\bS([0-9][A-Z0-9]{6})\b/i);
  if (misreadMatch && misreadMatch[1]) {
    var fixedTag = misreadMatch[1].toUpperCase();
    if (fixedTag.length === 7 && /[A-Z]/.test(fixedTag) && /[0-9]/.test(fixedTag)) {
      return fixedTag;
    }
  }

  // ============ MANUFACTURER-SPECIFIC PATTERNS (Highest Priority) ============

  // DELL Service Tags (exactly 7 alphanumeric characters)
  // Dell tags look like: "24TFN64", "HXYZ123", "9876ABC"
  var dellPatterns = [
    /(?:service\s*tag|express\s*(?:service\s*)?code)\s*[:\-=\s]*([A-Z0-9]{7})\b/i,
    /(?:tag|s\.?t\.?)\s*[:\-=\s]*([A-Z0-9]{7})\b/i,
    /\bDELL[^A-Z0-9]*([A-Z0-9]{7})\b/i
  ];

  for (var i = 0; i < dellPatterns.length; i++) {
    var dellMatch = ocrFixedText.match(dellPatterns[i]);
    if (dellMatch && dellMatch[1]) {
      return dellMatch[1].toUpperCase();
    }
  }

  // HP Serial Numbers (typically 10 characters, mix of letters and numbers)
  // HP serials look like: "5CG1234567", "2UA1234567"
  var hpPatterns = [
    /(?:s\/n|serial\s*(?:number)?|sn)\s*[:\-=\s]*([A-Z0-9]{10})\b/i,
    /\b([2-9][A-Z]{2}\d{7})\b/i, // HP format: digit + 2 letters + 7 digits
    /\b([A-Z]{3}\d{7})\b/i // Alternative HP format
  ];

  for (var i = 0; i < hpPatterns.length; i++) {
    var hpMatch = ocrFixedText.match(hpPatterns[i]);
    if (hpMatch && hpMatch[1] && /[A-Z]/i.test(hpMatch[1]) && /\d/.test(hpMatch[1])) {
      return hpMatch[1].toUpperCase();
    }
  }

  // LENOVO Serial Numbers (typically 8-10 characters)
  // Lenovo looks like: "PF0XXXXX", "MP1XXXXX"
  var lenovoPatterns = [
    /(?:s\/n|serial|sn)\s*[:\-=\s]*([A-Z]{2}\d[A-Z0-9]{4,7})\b/i,
    /\b(PF[0-9][A-Z0-9]{5,7})\b/i, // Lenovo ThinkPad format
    /\b(MP[0-9][A-Z0-9]{5,7})\b/i,
    /\b(R9[0-9][A-Z0-9]{5,7})\b/i
  ];

  for (var i = 0; i < lenovoPatterns.length; i++) {
    var lenovoMatch = ocrFixedText.match(lenovoPatterns[i]);
    if (lenovoMatch && lenovoMatch[1]) {
      return lenovoMatch[1].toUpperCase();
    }
  }

  // APPLE Serial Numbers (12 characters alphanumeric)
  var appleMatch = ocrFixedText.match(/(?:serial|s\/n)\s*[:\-=\s]*([A-Z0-9]{12})\b/i);
  if (appleMatch && appleMatch[1] && /[A-Z]/.test(appleMatch[1]) && /\d/.test(appleMatch[1])) {
    return appleMatch[1].toUpperCase();
  }

  // ACER / ASUS Serial Numbers (varies, typically 10-12 alphanumeric)
  var acerAsusPatterns = [
    /(?:s\/n|serial|snid)\s*[:\-=\s]*([A-Z0-9]{10,12})\b/i,
    /\bSNID\s*[:\-=\s]*(\d{11,12})\b/i // ACER SNID format
  ];

  for (var i = 0; i < acerAsusPatterns.length; i++) {
    var match = ocrFixedText.match(acerAsusPatterns[i]);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }

  // ============ GENERIC LABELED PATTERNS ============
  var labeledPatterns = [
    /(?:s\/n|serial\s*(?:number|no\.?|#)?|ser\.?\s*no\.?)\s*[:\-=\s]+([A-Z0-9\-]{5,15})/i,
    /(?:service\s*tag)\s*[:\-=\s]+([A-Z0-9]{5,15})/i,
    /(?:asset\s*(?:tag|id|#)?)\s*[:\-=\s]+([A-Z0-9\-]{5,15})/i
  ];

  for (var i = 0; i < labeledPatterns.length; i++) {
    var match = ocrFixedText.match(labeledPatterns[i]);
    if (match && match[1]) {
      var serial = match[1].trim().toUpperCase();
      // Must have both letters and numbers for a valid serial
      if (/[A-Z]/.test(serial) && /[0-9]/.test(serial)) {
        return serial;
      }
    }
  }

  // ============ FALLBACK: SCORE ALL TOKENS ============
  // Extract all alphanumeric tokens 5-15 characters long
  var allTokens = ocrFixedText.match(/\b[A-Za-z0-9]{5,15}\b/g) || [];

  // Words to exclude (common OCR misreads and labels)
  var excludeWords = [
    'WARRANTY', 'COUNTY', 'BEACH', 'PROPERTY', 'SCHOOL', 'DISTRICT',
    'NUMBER', 'PLEASE', 'REMOVE', 'MISSING', 'MODEL', 'DELL', 'LENOVO',
    'HEWLETT', 'PACKARD', 'COMPUTER', 'LAPTOP', 'DESKTOP', 'EXPRESS',
    'SERVICE', 'SUPPORT', 'WINDOWS', 'SYSTEM', 'INFORMATION', 'PRODUCT',
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'JUNE', 'JULY', 'AUGUST',
    'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER', 'MONDAY', 'TUESDAY',
    'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY', 'SERIAL',
    'ASSET', 'CHROMEBOOK', 'CHROME', 'BASIC', 'PROSUPPORT', 'PREMIUM',
    'EXPIRED', 'EXPIRES', 'VALID', 'UNTIL', 'THROUGH', 'COVERAGE',
    'BUSINESS', 'RETURN', 'INCLUDED', 'OWNER', 'REGISTERED'
  ];

  // Score each token
  var scoredTokens = allTokens.map(function(token) {
    var score = 0;
    var upper = token.toUpperCase();

    // Exclude common words
    if (excludeWords.indexOf(upper) !== -1) return { token: upper, score: -100 };

    // Must have both letters and numbers
    var hasLetters = /[A-Z]/i.test(token);
    var hasNumbers = /\d/.test(token);
    if (!hasLetters || !hasNumbers) return { token: upper, score: -100 };

    // Penalize pure dates (6-8 consecutive digits)
    if (/^\d{6,8}$/.test(token)) return { token: upper, score: -100 };

    // Palm Beach County asset tags: digit + alphanumeric (7 chars starting with number)
    // Format like 5RS3P94 - very high priority
    if (/^[0-9][A-Z]{1,2}[0-9A-Z]{4,5}$/.test(upper) && token.length === 7) {
      score += 70; // Highest priority for PBC format
    }

    // Dell service tags are exactly 7 chars - high score
    if (token.length === 7) score += 50;

    // HP serials are typically 10 chars
    if (token.length === 10) score += 40;

    // Lenovo serials are 8-10 chars
    if (token.length >= 8 && token.length <= 10) score += 35;

    // Apple serials are 12 chars
    if (token.length === 12) score += 30;

    // General serial length preference (7-12 chars)
    if (token.length >= 7 && token.length <= 12) score += 20;

    // Starts with digit then letters - PBC/asset tag pattern
    if (/^[0-9][A-Z]/.test(upper)) score += 30;

    // Starts with letter(s) followed by numbers - very common serial pattern
    if (/^[A-Z]{1,3}\d/.test(upper)) score += 25;

    // Has good mix of letters and numbers (at least 2 of each)
    var letterCount = (upper.match(/[A-Z]/g) || []).length;
    var digitCount = (upper.match(/\d/g) || []).length;
    if (letterCount >= 2 && digitCount >= 2) score += 15;
    if (letterCount >= 1 && digitCount >= 3) score += 10;

    // Bonus for patterns that look like manufacturer formats
    if (/^[2-9][A-Z]{2}\d{7}$/.test(upper)) score += 60; // HP
    if (/^[A-Z]{2}\d[A-Z0-9]{4,7}$/.test(upper)) score += 55; // Lenovo

    return { token: upper, score: score };
  });

  // Sort by score descending
  scoredTokens.sort(function(a, b) { return b.score - a.score; });

  // Return best match if score is positive
  if (scoredTokens.length > 0 && scoredTokens[0].score > 0) {
    // Check if the best match has extra chars from OCR error (like S5RS3P94G9)
    // Try to extract the valid 7-char PBC asset tag from it
    var bestToken = scoredTokens[0].token;

    // If token is longer than expected and contains a valid 7-char PBC pattern, extract it
    if (bestToken.length > 7) {
      var pbcExtract = bestToken.match(/([0-9][A-Z]{1,2}[0-9A-Z]{4,5})/);
      if (pbcExtract && pbcExtract[1] && pbcExtract[1].length === 7) {
        return pbcExtract[1];
      }
      // Also check if it starts with S followed by the pattern (OCR misread)
      var misreadExtract = bestToken.match(/^S([0-9][A-Z0-9]{6})/);
      if (misreadExtract && misreadExtract[1]) {
        return misreadExtract[1];
      }
    }

    return bestToken;
  }

  return '';
}

// --- Model/Manufacturer Extraction (Enhanced) ---
function computerRepairExtractModel(text) {
  var result = { model: '', manufacturer: '' };
  if (!text) return result;

  var upperText = text.toUpperCase();

  // ============ DELL PATTERNS ============
  // Dell Chromebook patterns (very common in schools)
  if (/CHROMEBOOK|CHROME\s*BOOK/i.test(text)) {
    result.manufacturer = 'Dell';
    // Try to get specific model number
    var chromebookMatch = text.match(/CHROMEBOOK\s*(\d{4})/i);
    if (chromebookMatch) {
      result.model = 'Chromebook ' + chromebookMatch[1];
    } else if (/3120/i.test(text)) {
      result.model = 'Chromebook 3120';
    } else if (/3100/i.test(text)) {
      result.model = 'Chromebook 3100';
    } else if (/3110/i.test(text)) {
      result.model = 'Chromebook 3110';
    } else if (/3180/i.test(text)) {
      result.model = 'Chromebook 3180';
    } else if (/3189/i.test(text)) {
      result.model = 'Chromebook 3189';
    } else if (/3400/i.test(text)) {
      result.model = 'Chromebook 3400';
    } else {
      result.model = 'Chromebook';
    }
    // Add 2-in-1 if detected
    if (/2[\-\s]*in[\-\s]*1|2IN1|CONVERTIBLE|TOUCH/i.test(text)) {
      result.model += ' 2-in-1';
    }
    return result;
  }

  // Dell Latitude patterns
  var latitudeMatch = text.match(/LATITUDE\s*(\d{4})/i);
  if (latitudeMatch) {
    result.model = 'Latitude ' + latitudeMatch[1];
    result.manufacturer = 'Dell';
    return result;
  }

  // Dell Inspiron patterns
  var inspironMatch = text.match(/INSPIRON\s*(\d{4})/i);
  if (inspironMatch) {
    result.model = 'Inspiron ' + inspironMatch[1];
    result.manufacturer = 'Dell';
    return result;
  }

  // Dell OptiPlex patterns
  var optiplexMatch = text.match(/OPTIPLEX\s*(\d{4})/i);
  if (optiplexMatch) {
    result.model = 'OptiPlex ' + optiplexMatch[1];
    result.manufacturer = 'Dell';
    return result;
  }

  // Dell Precision patterns
  var precisionMatch = text.match(/PRECISION\s*(\d{4})/i);
  if (precisionMatch) {
    result.model = 'Precision ' + precisionMatch[1];
    result.manufacturer = 'Dell';
    return result;
  }

  // Dell XPS patterns
  var xpsMatch = text.match(/XPS\s*(\d{2,4})/i);
  if (xpsMatch && /DELL/i.test(text)) {
    result.model = 'XPS ' + xpsMatch[1];
    result.manufacturer = 'Dell';
    return result;
  }

  // Generic Dell detection
  if (/\bDELL\b/i.test(text)) {
    result.manufacturer = 'Dell';
    // Try to find any model pattern
    var dellModelMatch = text.match(/DELL\s+([A-Za-z]+)\s*(\d{4})/i);
    if (dellModelMatch) {
      result.model = dellModelMatch[1] + ' ' + dellModelMatch[2];
    }
  }

  // ============ HP PATTERNS ============
  if (/\bHP\b|HEWLETT[\-\s]*PACKARD/i.test(text)) {
    result.manufacturer = 'HP';
  }

  // HP ProBook patterns
  var proBookMatch = text.match(/PROBOOK\s*(\d{3,4})/i);
  if (proBookMatch) {
    result.model = 'ProBook ' + proBookMatch[1];
    result.manufacturer = 'HP';
    return result;
  }

  // HP EliteBook patterns
  var eliteBookMatch = text.match(/ELITEBOOK\s*(\d{3,4})/i);
  if (eliteBookMatch) {
    result.model = 'EliteBook ' + eliteBookMatch[1];
    result.manufacturer = 'HP';
    return result;
  }

  // HP Pavilion patterns
  var pavilionMatch = text.match(/PAVILION\s*(\d{2,4})/i);
  if (pavilionMatch) {
    result.model = 'Pavilion ' + pavilionMatch[1];
    result.manufacturer = 'HP';
    return result;
  }

  // HP Chromebook patterns
  if (/HP.*CHROMEBOOK|CHROMEBOOK.*HP/i.test(text)) {
    result.manufacturer = 'HP';
    var hpChromebookMatch = text.match(/CHROMEBOOK\s*(\d{2,4})/i);
    result.model = hpChromebookMatch ? 'Chromebook ' + hpChromebookMatch[1] : 'Chromebook';
    return result;
  }

  // ============ LENOVO PATTERNS ============
  if (/LENOVO/i.test(text)) {
    result.manufacturer = 'Lenovo';
  }

  // Lenovo ThinkPad patterns
  var thinkpadMatch = text.match(/THINKPAD\s*([A-Z]?\d{2,4}[A-Z]?)/i);
  if (thinkpadMatch) {
    result.model = 'ThinkPad ' + thinkpadMatch[1].toUpperCase();
    result.manufacturer = 'Lenovo';
    return result;
  }

  // Lenovo ThinkCentre patterns
  var thinkcentreMatch = text.match(/THINKCENTRE\s*([A-Z]?\d{2,4})/i);
  if (thinkcentreMatch) {
    result.model = 'ThinkCentre ' + thinkcentreMatch[1];
    result.manufacturer = 'Lenovo';
    return result;
  }

  // Lenovo IdeaPad patterns
  var ideapadMatch = text.match(/IDEAPAD\s*(\d{3,4})/i);
  if (ideapadMatch) {
    result.model = 'IdeaPad ' + ideapadMatch[1];
    result.manufacturer = 'Lenovo';
    return result;
  }

  // Lenovo Chromebook patterns
  if (/LENOVO.*CHROMEBOOK|CHROMEBOOK.*LENOVO/i.test(text)) {
    result.manufacturer = 'Lenovo';
    result.model = 'Chromebook';
    return result;
  }

  // ============ APPLE PATTERNS ============
  if (/MACBOOK|IMAC|MAC\s*MINI|MAC\s*PRO|APPLE/i.test(text)) {
    result.manufacturer = 'Apple';
    if (/MACBOOK\s*PRO/i.test(text)) {
      result.model = 'MacBook Pro';
      var proInchMatch = text.match(/(\d{2})[\-\s]*(?:INCH|")/i);
      if (proInchMatch) result.model += ' ' + proInchMatch[1] + '"';
    } else if (/MACBOOK\s*AIR/i.test(text)) {
      result.model = 'MacBook Air';
    } else if (/MACBOOK/i.test(text)) {
      result.model = 'MacBook';
    } else if (/IMAC/i.test(text)) {
      result.model = 'iMac';
    } else if (/MAC\s*MINI/i.test(text)) {
      result.model = 'Mac Mini';
    } else if (/MAC\s*PRO/i.test(text)) {
      result.model = 'Mac Pro';
    }
    return result;
  }

  // ============ ACER PATTERNS ============
  if (/\bACER\b/i.test(text)) {
    result.manufacturer = 'Acer';
    var acerMatch = text.match(/(?:ASPIRE|NITRO|SWIFT|SPIN|CHROMEBOOK)\s*(\d{1,4})/i);
    if (acerMatch) {
      var prefix = text.match(/(ASPIRE|NITRO|SWIFT|SPIN|CHROMEBOOK)/i);
      result.model = (prefix ? prefix[1] + ' ' : '') + acerMatch[1];
    }
    return result;
  }

  // ============ ASUS PATTERNS ============
  if (/\bASUS\b/i.test(text)) {
    result.manufacturer = 'ASUS';
    var asusMatch = text.match(/(?:ZENBOOK|VIVOBOOK|ROG|TUF|CHROMEBOOK)\s*([A-Z]?\d{2,4})/i);
    if (asusMatch) {
      var prefix = text.match(/(ZENBOOK|VIVOBOOK|ROG|TUF|CHROMEBOOK)/i);
      result.model = (prefix ? prefix[1] + ' ' : '') + asusMatch[1];
    }
    return result;
  }

  // ============ SAMSUNG PATTERNS ============
  if (/SAMSUNG/i.test(text)) {
    result.manufacturer = 'Samsung';
    if (/CHROMEBOOK/i.test(text)) {
      result.model = 'Chromebook';
    } else if (/GALAXY\s*BOOK/i.test(text)) {
      result.model = 'Galaxy Book';
    }
    return result;
  }

  // If manufacturer detected but no model, that's still useful
  if (result.manufacturer && !result.model) {
    return result;
  }

  // Default to Dell Chromebook if nothing detected (common in school environments)
  if (!result.model && !result.manufacturer) {
    // Don't auto-fill - let user select
    return result;
  }

  return result;
}

// --- Date Extraction (Enhanced OCR-aware) ---
function computerRepairExtractDate(text) {
  if (!text) return '';

  // Clean OCR text - fix common OCR mistakes
  var cleanedText = text
    .replace(/[lI|]/g, '1')  // l, I, | often misread as 1 in dates
    .replace(/[oO]/g, '0')   // o, O often misread as 0 in dates
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .replace(/[,\.]+(\d)/g, '/$1') // Fix comma/period before digit -> slash
    .replace(/(\d)[,\.](\d)/g, '$1/$2'); // Fix comma/period between digits

  // Month name mapping
  var monthMap = {
    'jan': '01', 'january': '01',
    'feb': '02', 'february': '02',
    'mar': '03', 'march': '03',
    'apr': '04', 'april': '04',
    'may': '05',
    'jun': '06', 'june': '06',
    'jul': '07', 'july': '07',
    'aug': '08', 'august': '08',
    'sep': '09', 'sept': '09', 'september': '09',
    'oct': '10', 'october': '10',
    'nov': '11', 'november': '11',
    'dec': '12', 'december': '12'
  };

  // Helper to validate date components
  function isValidDate(year, month, day) {
    var y = parseInt(year, 10);
    var m = parseInt(month, 10);
    var d = parseInt(day, 10);
    if (y < 2015 || y > 2040) return false; // Reasonable warranty range
    if (m < 1 || m > 12) return false;
    if (d < 1 || d > 31) return false;
    return true;
  }

  // Helper to format date as YYYY-MM-DD
  function formatDate(year, month, day) {
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  // Parse a date match into ISO format
  function parseNumericDate(match, pattern) {
    var y, m, d;

    if (pattern === 'MDY') {
      m = match[1]; d = match[2]; y = match[3];
    } else if (pattern === 'YMD') {
      y = match[1]; m = match[2]; d = match[3];
    } else if (pattern === 'DMY') {
      d = match[1]; m = match[2]; y = match[3];
    }

    // Handle 2-digit years
    if (y && y.length === 2) {
      y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
    }

    if (isValidDate(y, m, d)) {
      return formatDate(y, m, d);
    }
    return null;
  }

  // Find warranty-related context lines
  var warrantyKeywords = /warranty|expire[sd]?|expir(?:y|ation)|end[\s\-]*date|valid[\s\-]*(?:until|through|thru)|coverage|support[\s\-]*(?:end|until)|next[\s\-]*business[\s\-]*day|pro[\s\-]*support|basic[\s\-]*warranty/i;

  var lines = cleanedText.split(/[\n\r]+/);
  var warrantyContext = '';
  var allDates = [];

  // Gather warranty-related lines (including surrounding context)
  for (var i = 0; i < lines.length; i++) {
    if (warrantyKeywords.test(lines[i])) {
      // Get this line and 2 lines before/after
      var start = Math.max(0, i - 1);
      var end = Math.min(lines.length - 1, i + 2);
      for (var j = start; j <= end; j++) {
        warrantyContext += lines[j] + ' ';
      }
    }
  }

  // Search in warranty context first, then full text
  var searchTexts = warrantyContext ? [warrantyContext, cleanedText] : [cleanedText];

  for (var t = 0; t < searchTexts.length; t++) {
    var searchText = searchTexts[t];

    // Pattern 1: Month name formats (most reliable for warranty stickers)
    // "January 15, 2026" or "Jan 15 2026" or "15 January 2026"
    var monthNames = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';

    // Month DD, YYYY
    var monthFirstRegex = new RegExp('(' + monthNames + ')[\\.\\s,]+(\\d{1,2})[\\s,]+(\\d{4})', 'gi');
    var monthMatch;
    while ((monthMatch = monthFirstRegex.exec(searchText)) !== null) {
      var mm = monthMap[monthMatch[1].toLowerCase().substring(0, 3)];
      var dd = monthMatch[2];
      var yyyy = monthMatch[3];
      if (isValidDate(yyyy, mm, dd)) {
        allDates.push({ date: formatDate(yyyy, mm, dd), priority: t === 0 ? 10 : 5 });
      }
    }

    // DD Month YYYY
    var dayFirstRegex = new RegExp('(\\d{1,2})[\\.\\s,]+(' + monthNames + ')[\\.\\s,]+(\\d{4})', 'gi');
    while ((monthMatch = dayFirstRegex.exec(searchText)) !== null) {
      var dd = monthMatch[1];
      var mm = monthMap[monthMatch[2].toLowerCase().substring(0, 3)];
      var yyyy = monthMatch[3];
      if (isValidDate(yyyy, mm, dd)) {
        allDates.push({ date: formatDate(yyyy, mm, dd), priority: t === 0 ? 10 : 5 });
      }
    }

    // Pattern 2: YYYY-MM-DD (ISO format)
    var isoRegex = /\b(20[1-4]\d)[\-\/\.](\d{1,2})[\-\/\.](\d{1,2})\b/g;
    var isoMatch;
    while ((isoMatch = isoRegex.exec(searchText)) !== null) {
      var result = parseNumericDate(isoMatch, 'YMD');
      if (result) {
        allDates.push({ date: result, priority: t === 0 ? 9 : 4 });
      }
    }

    // Pattern 3: MM/DD/YYYY or MM-DD-YYYY (US format - common on Dell/HP)
    var usRegex = /\b(\d{1,2})[\-\/\.](\d{1,2})[\-\/\.](20[1-4]\d)\b/g;
    var usMatch;
    while ((usMatch = usRegex.exec(searchText)) !== null) {
      // Try MDY first (US format)
      var result = parseNumericDate(usMatch, 'MDY');
      if (result) {
        allDates.push({ date: result, priority: t === 0 ? 8 : 3 });
      } else {
        // Try DMY (European format)
        result = parseNumericDate(usMatch, 'DMY');
        if (result) {
          allDates.push({ date: result, priority: t === 0 ? 7 : 2 });
        }
      }
    }

    // Pattern 4: DD/MM/YY or MM/DD/YY (2-digit year)
    var shortYearRegex = /\b(\d{1,2})[\-\/\.](\d{1,2})[\-\/\.](\d{2})\b/g;
    var shortMatch;
    while ((shortMatch = shortYearRegex.exec(searchText)) !== null) {
      var year2d = shortMatch[3];
      var fullYear = (parseInt(year2d, 10) > 50 ? '19' : '20') + year2d;

      // Try MDY
      if (isValidDate(fullYear, shortMatch[1], shortMatch[2])) {
        allDates.push({ date: formatDate(fullYear, shortMatch[1], shortMatch[2]), priority: t === 0 ? 6 : 1 });
      }
    }
  }

  // Sort by priority (higher = better) and return the best match
  if (allDates.length > 0) {
    allDates.sort(function(a, b) { return b.priority - a.priority; });

    // For warranty, prefer future dates (likely warranty END dates)
    var today = new Date();
    var futureDates = allDates.filter(function(d) {
      return new Date(d.date) > today;
    });

    if (futureDates.length > 0) {
      return futureDates[0].date;
    }

    // If no future dates, return the most recent past date (might still be useful)
    return allDates[0].date;
  }

  return '';
}

// --- Accept OCR Values ---
function computerRepairAcceptOcrSerial() {
  var val = document.getElementById('cr-ocr-serial').value.trim();
  if (!val) { showToast('No serial number detected', 'warning'); return; }
  document.getElementById('cr-serial-number').value = val;

  // Also apply model/manufacturer if not already set
  var rawText = document.getElementById('cr-ocr-raw').value || '';
  var modelInfo = computerRepairExtractModel(rawText);

  var modelField = document.getElementById('cr-model');
  var mfgField = document.getElementById('cr-manufacturer');

  if (modelInfo.model && modelField && !modelField.value.trim()) {
    modelField.value = modelInfo.model;
  }
  if (modelInfo.manufacturer && mfgField && !mfgField.value) {
    mfgField.value = modelInfo.manufacturer;
  }

  showToast('Serial number applied: ' + val, 'success');
}

function computerRepairAcceptOcrWarranty() {
  var val = document.getElementById('cr-ocr-warranty').value.trim();
  if (!val) { showToast('No warranty date detected', 'warning'); return; }
  document.getElementById('cr-warranty-date').value = val;
  computerRepairUpdateWarrantyBadge();
  showToast('Warranty date applied', 'success');
}

// --- Warranty Badge ---
function computerRepairUpdateWarrantyBadge() {
  var dateInput = document.getElementById('cr-warranty-date');
  var display = document.getElementById('cr-warranty-status-display');
  var badge = document.getElementById('cr-warranty-badge');

  if (!dateInput || !dateInput.value) {
    display.style.display = 'none';
    return;
  }

  var warrantyDate = new Date(dateInput.value + 'T23:59:59');
  var today = new Date();
  display.style.display = '';

  if (warrantyDate >= today) {
    badge.textContent = '✓ In Warranty';
    badge.className = 'inc-status in-warranty';
  } else {
    badge.textContent = '✗ Out of Warranty';
    badge.className = 'inc-status out-of-warranty';
  }
}

// --- Category / Subcategory ---
var CR_SUBCATEGORIES = {
  'Hardware': ['Screen/Display', 'Keyboard', 'Trackpad/Mouse', 'Battery', 'Charging Port', 'USB Port', 'HDMI Port', 'Speakers/Audio', 'Camera/Webcam', 'Motherboard', 'RAM/Memory', 'Hard Drive/SSD', 'Fan/Overheating', 'Physical Damage', 'Other Hardware'],
  'Software': ['Operating System', 'Driver Issue', 'Blue Screen/BSOD', 'Slow Performance', 'Software Installation', 'Virus/Malware', 'Update Issue', 'Login/Password', 'Other Software'],
  'Network': ['WiFi Connectivity', 'Ethernet Port', 'Bluetooth', 'VPN', 'Other Network']
};

function onComputerRepairCategoryChange() {
  var category = document.getElementById('cr-category').value;
  var subSelect = document.getElementById('cr-subcategory');
  subSelect.innerHTML = '';

  if (!category) {
    subSelect.innerHTML = '<option value="">-- Select Category first --</option>';
    return;
  }

  var subs = CR_SUBCATEGORIES[category] || [];
  subSelect.innerHTML = '<option value="">-- None --</option>';
  subs.forEach(function(sub) {
    var opt = document.createElement('option');
    opt.value = sub;
    opt.textContent = sub;
    subSelect.appendChild(opt);
  });
}

// --- ServiceNow ---
function computerRepairOpenServiceNow() {
  if (!crEmployee) {
    showToast('Look up an employee first (Step 1)', 'warning');
    return;
  }
  var serialNumber = document.getElementById('cr-serial-number').value.trim();
  var shortDesc = document.getElementById('cr-short-desc').value.trim();
  var fullDesc = document.getElementById('cr-full-desc').value.trim();
  var category = document.getElementById('cr-category').value;
  var subcategory = document.getElementById('cr-subcategory').value;
  var channel = document.getElementById('cr-channel').value;
  var impact = document.getElementById('cr-impact').value;
  var model = document.getElementById('cr-model').value.trim();
  var manufacturer = document.getElementById('cr-manufacturer').value;

  if (!shortDesc) {
    showToast('Enter a short description first (Step 3)', 'warning');
    return;
  }

  // Enrich description with device info
  var enrichedDesc = fullDesc || shortDesc;
  if (serialNumber || model || manufacturer) {
    var deviceInfo = [];
    if (serialNumber) deviceInfo.push('S/N: ' + serialNumber);
    if (model) deviceInfo.push('Model: ' + model);
    if (manufacturer) deviceInfo.push('Manufacturer: ' + manufacturer);
    enrichedDesc = '[' + deviceInfo.join(' | ') + ']\n' + enrichedDesc;
  }

  // Build sysparm_query
  var qParts = [];

  if (crEmployee.empId) {
    var empId = crEmployee.empId;
    qParts.push("caller_id=javascript:var u=new GlideRecord('sys_user');u.addQuery('employee_number','" + empId + "');u.query();u.next();u.sys_id");
    qParts.push("u_site_number=javascript:var u=new GlideRecord('sys_user');u.addQuery('employee_number','" + empId + "');u.query();u.next();u.department");
    if (crEmployee.email) {
      qParts.push("u_req_email_address=" + crEmployee.email);
    }
    qParts.push("u_local_support=true");
    if (crSiteNumber) {
      qParts.push("assignment_group=javascript:var g=new GlideRecord('sys_user_group');g.get('name','" + crSiteNumber + " Local Support');g.sys_id");
    }
  }

  // Service offering from AI suggestion (if available)
  var soName = crCurrentAiSuggestion ? (crCurrentAiSuggestion.serviceOffering || '') : '';
  if (soName) {
    qParts.push("service_offering=javascript:var s=new GlideRecord('service_offering');s.get('name','" + soName + "');s.sys_id");
  }

  qParts.push('short_description=' + shortDesc);
  if (enrichedDesc) qParts.push('description=' + enrichedDesc);
  if (category) qParts.push('category=' + category);
  if (subcategory) qParts.push('subcategory=' + subcategory);
  if (channel) qParts.push('contact_type=' + channel);
  if (impact) qParts.push('impact=' + impact);
  var userType = document.getElementById('cr-user-type').value;
  if (userType) qParts.push('u_user_type=' + userType);

  // End User Info tab fields (bottom of ServiceNow page)
  // Note: Field names may vary by ServiceNow instance - trying common variations
  if (serialNumber) {
    // Try multiple field names for Service Tag/Serial Number
    qParts.push('u_service_tag_serial_number=' + serialNumber);
    qParts.push('u_serial_number=' + serialNumber);
    qParts.push('serial_number=' + serialNumber);
  }

  // Manufacturer/Model - combine manufacturer and model
  var manufacturerModel = '';
  if (manufacturer && model) {
    manufacturerModel = manufacturer + ' ' + model;
  } else if (model) {
    manufacturerModel = model;
  } else if (manufacturer) {
    manufacturerModel = manufacturer;
  }
  if (manufacturerModel) {
    // Try multiple field names for Manufacturer/Model
    qParts.push('u_manufacturer_model=' + manufacturerModel);
    qParts.push('u_model=' + manufacturerModel);
  }

  // Asset Tag
  var assetTag = document.getElementById('cr-asset-tag').value.trim();
  if (assetTag) {
    qParts.push('u_asset_tag=' + assetTag);
  }

  // Warranty checkbox and date
  var warrantyDate = document.getElementById('cr-warranty-date').value;
  if (warrantyDate) {
    qParts.push('u_asset_under_warranty=true');
    qParts.push('u_warranty_end_date=' + warrantyDate);
  }

  // Asset Location - default to Techs Office
  qParts.push('u_asset_location=1-153-J Techs Office');

  var query = qParts.join('^');
  var url = 'https://pbcsd.service-now.com/incident.do?sys_id=-1&sysparm_query=' + encodeURIComponent(query);

  // Save context for API lookup
  crSnLookupEmpId = crEmployee.empId;
  crSnLookupShortDesc = shortDesc;

  window.open(url, '_blank');

  var incStatus = document.getElementById('cr-inc-status');
  if (incStatus) {
    incStatus.innerHTML = '<i data-lucide="clipboard-copy" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;"></i> ServiceNow opened! Copy the INC number after submitting and paste it above.';
    incStatus.style.color = '#0e7490';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  showToast('ServiceNow opened! Copy the INC number after submitting.', 'info');

  // Focus the INC input field to make it easy to paste
  var incInput = document.getElementById('cr-inc-number');
  if (incInput) {
    setTimeout(function() { incInput.focus(); }, 500);
  }
}

// --- Paste INC from Clipboard ---
function crPasteIncFromClipboard() {
  var incInput = document.getElementById('cr-inc-number');
  var incStatus = document.getElementById('cr-inc-status');

  // Check if Clipboard API is available
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    showToast('Clipboard access not available in this browser', 'error');
    if (incInput) incInput.focus();
    return;
  }

  navigator.clipboard.readText()
    .then(function(text) {
      if (!text || text.trim() === '') {
        showToast('Clipboard is empty', 'warning');
        return;
      }

      // Try to extract INC number from clipboard text
      var incNumber = extractIncNumber(text);

      if (incNumber) {
        incInput.value = incNumber;
        if (incStatus) {
          incStatus.innerHTML = '<i data-lucide="check-circle" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;color:#22c55e;"></i> ' + incNumber + ' pasted successfully!';
          incStatus.style.color = '#22c55e';
          if (typeof lucide !== 'undefined') lucide.createIcons();
        }
        showToast('INC number pasted: ' + incNumber, 'success');
      } else {
        // No INC pattern found, but still paste what was copied (maybe user copied just numbers)
        var cleaned = text.trim().toUpperCase();
        if (/^\d{7,10}$/.test(cleaned)) {
          // Just numbers - add INC prefix
          incInput.value = 'INC' + cleaned;
          if (incStatus) {
            incStatus.innerHTML = '<i data-lucide="check-circle" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;color:#22c55e;"></i> INC' + cleaned + ' pasted!';
            incStatus.style.color = '#22c55e';
            if (typeof lucide !== 'undefined') lucide.createIcons();
          }
          showToast('INC number pasted: INC' + cleaned, 'success');
        } else if (cleaned.length > 0 && cleaned.length < 20) {
          // Short text - just paste it
          incInput.value = cleaned;
          if (incStatus) {
            incStatus.innerHTML = '<i data-lucide="info" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;"></i> Pasted: ' + cleaned;
            incStatus.style.color = '#f59e0b';
            if (typeof lucide !== 'undefined') lucide.createIcons();
          }
          showToast('Pasted text (no INC pattern found)', 'warning');
        } else {
          showToast('Could not find INC number in clipboard', 'warning');
        }
      }
    })
    .catch(function(err) {
      console.error('Clipboard read failed:', err);
      // Permission denied or other error
      if (err.name === 'NotAllowedError') {
        showToast('Clipboard permission denied. Please use Ctrl+V / Cmd+V', 'error');
      } else {
        showToast('Could not read clipboard: ' + err.message, 'error');
      }
      if (incInput) incInput.focus();
    });
}

// Extract INC number from text (handles various formats)
function extractIncNumber(text) {
  if (!text) return null;

  // Normalize text
  var normalized = text.toUpperCase().trim();

  // Pattern 1: Direct INC number (INC0012345, INC0282215)
  var directMatch = normalized.match(/\b(INC\d{7,10})\b/);
  if (directMatch) return directMatch[1];

  // Pattern 2: From ServiceNow URL (?sysparm_query=number=INC...)
  var urlMatch = normalized.match(/NUMBER[=:]?\s*(INC\d{7,10})/i);
  if (urlMatch) return urlMatch[1];

  // Pattern 3: Just "INC" followed by numbers anywhere
  var looseMatch = normalized.match(/INC\s*(\d{7,10})/);
  if (looseMatch) return 'INC' + looseMatch[1];

  // Pattern 4: Number field value (from ServiceNow page copy)
  var numberFieldMatch = normalized.match(/NUMBER\s*[:=]?\s*(\d{7,10})/);
  if (numberFieldMatch) return 'INC' + numberFieldMatch[1];

  return null;
}

// --- Listen for Chrome Extension INC Capture ---
// The extension sends postMessage when it captures an INC from ServiceNow
window.addEventListener('message', function(event) {
  // Only accept messages from our extension
  if (event.data && event.data.type === 'SSM_INC_CAPTURED' && event.data.incNumber) {
    var incInput = document.getElementById('cr-inc-number');
    var incStatus = document.getElementById('cr-inc-status');

    if (incInput) {
      incInput.value = event.data.incNumber;

      if (incStatus) {
        incStatus.innerHTML = '<i data-lucide="check-circle" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;color:#22c55e;"></i> ' + event.data.incNumber + ' captured automatically from ServiceNow!';
        incStatus.style.color = '#22c55e';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }

      showToast('INC ' + event.data.incNumber + ' captured from ServiceNow!', 'success');
      console.log('[Smart School Monitor] INC received from extension:', event.data.incNumber);
    }
  }
});

// Extension detection and INC auto-fill
var crExtensionDetected = false;

function startExtensionIncCheck() {
  // The Chrome extension (ssm-receiver.js) will handle auto-filling
  // This function just sets up the UI state

  // Always show the Paste button as a fallback
  var pasteBtn = document.getElementById('cr-paste-btn');
  if (pasteBtn) {
    pasteBtn.style.display = 'inline-flex';
  }

  // Update status message
  var incStatus = document.getElementById('cr-inc-status');
  if (incStatus) {
    incStatus.innerHTML = '<i data-lucide="zap" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;color:#22c55e;"></i> <span id="cr-inc-status-text">INC auto-fills with Chrome extension, or click Paste</span>';
    incStatus.style.color = '#22c55e';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  console.log('[SSM] Extension check initialized - extension will auto-fill INC when captured');
}

function showManualPasteOption() {
  var pasteBtn = document.getElementById('cr-paste-btn');
  var incStatus = document.getElementById('cr-inc-status');

  if (pasteBtn) {
    pasteBtn.style.display = 'inline-flex';
  }
  if (incStatus) {
    incStatus.style.color = '#0e7490';
    incStatus.innerHTML = '<i data-lucide="info" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;"></i> <span id="cr-inc-status-text">Copy INC from ServiceNow, then click Paste (or Cmd+V)</span>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

function stopExtensionIncCheck() {
  if (crExtensionCheckInterval) {
    clearInterval(crExtensionCheckInterval);
    crExtensionCheckInterval = null;
  }
}

// --- Auto-Fetch INC Number ---
function computerRepairStartIncAutoFetch() {
  computerRepairStopIncAutoFetch();
  crAutoFetchAttempt = 0;

  var incStatus = document.getElementById('cr-inc-status');
  if (incStatus) {
    incStatus.textContent = 'Waiting for you to submit in ServiceNow...';
    incStatus.style.color = '#0e7490';
  }

  crAutoFetchTimer = setTimeout(function() {
    computerRepairPollForInc();
  }, 15000); // 15s initial delay
}

function computerRepairStopIncAutoFetch() {
  if (crAutoFetchTimer) {
    clearTimeout(crAutoFetchTimer);
    crAutoFetchTimer = null;
  }
}

function computerRepairPollForInc() {
  if (!crSnLookupEmpId) {
    computerRepairStopIncAutoFetch();
    return;
  }

  crAutoFetchAttempt++;
  var incStatus = document.getElementById('cr-inc-status');
  var maxAttempts = 24;

  if (incStatus) {
    incStatus.textContent = 'Searching for INC number... (poll ' + crAutoFetchAttempt + '/' + maxAttempts + ')';
    incStatus.style.color = '#0e7490';
  }

  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success && result.incidentNumber) {
        var incInput = document.getElementById('cr-inc-number');
        if (incInput) incInput.value = result.incidentNumber;
        if (incStatus) {
          incStatus.textContent = result.incidentNumber + ' captured automatically!';
          incStatus.style.color = '#22c55e';
        }
        showToast('Incident ' + result.incidentNumber + ' captured!', 'success');
        computerRepairStopIncAutoFetch();
      } else if (crAutoFetchAttempt < maxAttempts) {
        // Check if it's a credentials issue - stop early
        var errMsg = (result && result.error) ? result.error : '';
        if (errMsg.indexOf('credentials') !== -1 || errMsg.indexOf('setupSnCredentials') !== -1) {
          if (incStatus) {
            incStatus.textContent = 'ServiceNow API not configured. Enter INC manually.';
            incStatus.style.color = '#f59e0b';
          }
          computerRepairStopIncAutoFetch();
          return;
        }
        crAutoFetchTimer = setTimeout(function() {
          computerRepairPollForInc();
        }, 5000);
      } else {
        var errMsg = (result && result.error) ? result.error : 'Could not find incident';
        if (incStatus) {
          incStatus.textContent = errMsg + '. Enter INC number manually.';
          incStatus.style.color = '#ef4444';
        }
        showToast(errMsg, 'warning');
        computerRepairStopIncAutoFetch();
      }
    })
    .withFailureHandler(function(err) {
      console.error('INC fetch error:', err);
      if (crAutoFetchAttempt < maxAttempts) {
        crAutoFetchTimer = setTimeout(function() {
          computerRepairPollForInc();
        }, 5000);
      } else {
        if (incStatus) {
          incStatus.textContent = 'API error: ' + err.message;
          incStatus.style.color = '#ef4444';
        }
        computerRepairStopIncAutoFetch();
      }
    })
    .getLatestSnIncident(crSnLookupEmpId, crSnLookupShortDesc);
}

// --- Save Computer Repair ---
function computerRepairSaveAndSend() {
  computerRepairSave(true);
}

function computerRepairSaveAndQueue() {
  computerRepairSave(false);
}

function computerRepairSave(sendNow) {
  if (!crEmployee) {
    showToast('Look up an employee first (Step 1)', 'warning');
    return;
  }
  var serialNumber = document.getElementById('cr-serial-number').value.trim();
  if (!serialNumber) {
    showToast('Enter a serial number (Step 2)', 'warning');
    return;
  }
  var shortDesc = document.getElementById('cr-short-desc').value.trim();
  if (!shortDesc) {
    showToast('Enter a short description (Step 3)', 'warning');
    return;
  }
  var category = document.getElementById('cr-category').value;
  if (!category) {
    showToast('Select a category (Step 3)', 'warning');
    return;
  }

  // Get captured photo data URL if available (for OCR capture)
  var photoDataUrl = '';
  var capturedImg = document.getElementById('cr-captured-image');
  if (capturedImg && capturedImg.src && capturedImg.src.indexOf('data:') === 0) {
    photoDataUrl = capturedImg.src;
  }

  var data = {
    employeeId: crEmployee.empId,
    employeeName: crEmployee.name,
    employeeEmail: crEmployee.email,
    roomNumber: crEmployee.roomNumber,
    serialNumber: serialNumber,
    computerModel: document.getElementById('cr-model').value.trim(),
    manufacturer: document.getElementById('cr-manufacturer').value,
    warrantyDate: document.getElementById('cr-warranty-date').value,
    assetTag: document.getElementById('cr-asset-tag').value.trim(),
    shortDescription: shortDesc,
    description: document.getElementById('cr-full-desc').value.trim(),
    category: category,
    subcategory: document.getElementById('cr-subcategory').value,
    channel: document.getElementById('cr-channel').value,
    impact: document.getElementById('cr-impact').value,
    userType: document.getElementById('cr-user-type').value,
    snowIncidentNumber: document.getElementById('cr-inc-number').value.trim(),
    photoDataUrl: photoDataUrl,
    emailStatus: sendNow ? 'sending' : 'queued'
  };

  showToast('Saving computer repair...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        showToast('Computer repair saved successfully!', 'success');
        var repairId = result.repair.id;

        // Immediately refresh the repairs list
        loadComputerRepairs();

        if (sendNow) {
          showToast('Sending email notification...', 'info');
          google.script.run
            .withSuccessHandler(function(emailResult) {
              if (emailResult && emailResult.success) {
                showToast('Email sent to ' + (data.employeeEmail || 'employee') + '!', 'success');
              } else {
                showToast('Email failed: ' + (emailResult ? emailResult.error : 'Unknown'), 'error');
              }
              loadComputerRepairs(); // Refresh again after email status update
            })
            .withFailureHandler(function(err) {
              showToast('Email error: ' + err.message, 'error');
            })
            .sendComputerRepairEmail(repairId);
        } else {
          showToast('Queuing email for later...', 'info');
          google.script.run
            .withSuccessHandler(function(queueResult) {
              if (queueResult && queueResult.success) {
                showToast('Email queued successfully!', 'success');
              } else {
                showToast('Queue failed: ' + (queueResult ? queueResult.error : 'Unknown'), 'error');
              }
              loadComputerRepairs(); // Refresh again after queue status update
            })
            .withFailureHandler(function(err) {
              showToast('Queue error: ' + err.message, 'error');
            })
            .queueComputerRepairEmail(repairId);
        }

        // Save AI training data for learning
        saveCrAiTrainingData(repairId, data);

        // Reset form after short delay to let user see success message
        setTimeout(function() {
          resetComputerRepairForm();
        }, 500);
      } else {
        showToast('Save failed: ' + (result ? result.error : 'Unknown'), 'error');
        console.error('Save failed:', result);
      }
    })
    .withFailureHandler(function(err) {
      showToast('Save error: ' + err.message, 'error');
      console.error('Save error:', err);
    })
    .createComputerRepair(data);
}

// --- Reset Form ---
function resetComputerRepairForm() {
  crEmployee = null;
  document.getElementById('cr-emp-id').value = '';
  document.getElementById('cr-employee-result').classList.add('hidden');
  document.getElementById('cr-employee-error').classList.add('hidden');

  // Serial & device info
  document.getElementById('cr-serial-number').value = '';
  document.getElementById('cr-model').value = '';
  document.getElementById('cr-manufacturer').value = '';
  document.getElementById('cr-warranty-date').value = '';
  document.getElementById('cr-asset-tag').value = '';
  document.getElementById('cr-warranty-status-display').style.display = 'none';

  // Switch back to manual mode
  computerRepairSetSerialMode('manual');

  // Clear OCR results
  document.getElementById('cr-ocr-status').style.display = 'none';
  document.getElementById('cr-captured-preview').style.display = 'none';
  document.getElementById('cr-ocr-result').style.display = 'none';
  document.getElementById('cr-ocr-serial').value = '';
  document.getElementById('cr-ocr-warranty').value = '';
  document.getElementById('cr-ocr-raw').value = '';
  var capturedImg = document.getElementById('cr-captured-image');
  if (capturedImg) capturedImg.src = '';

  // Issue details
  document.getElementById('cr-channel').value = 'self-service';
  document.getElementById('cr-category').value = '';
  document.getElementById('cr-subcategory').innerHTML = '<option value="">-- Select Category first --</option>';
  document.getElementById('cr-impact').value = '4';
  document.getElementById('cr-user-type').value = 'school_staff';
  document.getElementById('cr-short-desc').value = '';
  document.getElementById('cr-full-desc').value = '';

  // ServiceNow
  document.getElementById('cr-inc-number').value = '';
  crSnLookupEmpId = '';
  crSnLookupShortDesc = '';
  var incStatus = document.getElementById('cr-inc-status');
  if (incStatus) {
    incStatus.innerHTML = '<i data-lucide="info" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;"></i> After submitting in ServiceNow, copy the INC number and paste it here';
    incStatus.style.color = '#0e7490';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

// --- Repairs Table ---
function loadComputerRepairs() {
  google.script.run
    .withSuccessHandler(function(result) {
      var container = document.getElementById('cr-repairs-table');
      if (!result || !result.success || !result.repairs || result.repairs.length === 0) {
        container.innerHTML = '<p class="text-muted">No computer repairs recorded yet.</p>';
        return;
      }
      var rows = result.repairs.slice(0, 50).map(function(r) {
        var incNum = r.snowIncidentNumber || '—';
        var empName = r.employeeName || 'Unknown';
        var serial = r.serialNumber || '—';
        var issue = r.shortDescription || '—';
        var repairCls = (r.repairStatus || 'open').replace(/\s/g, '-');
        var emailCls = (r.emailStatus || 'not-sent').replace(/\s/g, '-');
        var warCls = (r.warrantyStatus || 'unknown').replace(/\s/g, '-');
        var date = r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—';
        return '<tr>' +
          '<td>' + escapeHtml(incNum) + '</td>' +
          '<td>' + escapeHtml(empName) + '</td>' +
          '<td><code style="font-size:12px;">' + escapeHtml(serial) + '</code></td>' +
          '<td>' + escapeHtml(issue) + '</td>' +
          '<td><span class="inc-status ' + warCls + '">' + escapeHtml(r.warrantyStatus || 'unknown') + '</span></td>' +
          '<td><span class="inc-status ' + repairCls + '">' + escapeHtml(r.repairStatus || 'open') + '</span></td>' +
          '<td><span class="inc-status ' + emailCls + '">' + escapeHtml(r.emailStatus || 'not-sent') + '</span></td>' +
          '<td>' + date + '</td>' +
        '</tr>';
      }).join('');

      container.innerHTML = '<table>' +
        '<thead><tr><th>INC #</th><th>Employee</th><th>Serial #</th><th>Issue</th><th>Warranty</th><th>Repair Status</th><th>Email</th><th>Date</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
    })
    .withFailureHandler(function(err) {
      document.getElementById('cr-repairs-table').innerHTML =
        '<p class="text-muted">Error loading repairs.</p>';
      console.error('Load repairs error:', err);
    })
    .getComputerRepairs(50);
}

// Toggle repairs list visibility
function toggleCrRepairsList() {
  var container = document.getElementById('cr-repairs-list-container');
  var icon = document.getElementById('cr-repairs-toggle-icon');

  if (container.style.display === 'none') {
    container.style.display = '';
    if (icon) icon.style.transform = 'rotate(0deg)';
  } else {
    container.style.display = 'none';
    if (icon) icon.style.transform = 'rotate(-90deg)';
  }
}

// ============================================
// COMPUTER REPAIR - QUICK TICKET MODE
// ============================================

var crTicketMode = 'full'; // 'full' or 'quick'

function setCrTicketMode(mode) {
  crTicketMode = mode;
  var fullBtn = document.getElementById('cr-mode-full-btn');
  var quickBtn = document.getElementById('cr-mode-quick-btn');
  var templateBtn = document.getElementById('cr-mode-template-btn');
  var deviceStep = document.getElementById('cr-step-device-info');
  var mainForm = document.getElementById('cr-main-form');
  var maxcaseForm = document.getElementById('cr-maxcase-form');

  // Reset all mode buttons
  if (fullBtn) fullBtn.classList.remove('active');
  if (quickBtn) quickBtn.classList.remove('active');
  if (templateBtn) templateBtn.classList.remove('active');

  // Close template dropdown
  var dropdown = document.getElementById('cr-template-dropdown');
  if (dropdown) dropdown.classList.remove('open');

  if (mode === 'maxcase' || mode === 'template') {
    // Template / MAX Case mode - show the streamlined form
    if (templateBtn) templateBtn.classList.add('active');
    if (mainForm) mainForm.style.display = 'none';
    if (maxcaseForm) maxcaseForm.style.display = '';
  } else {
    // Full or Quick mode - show main form, hide template form
    if (mainForm) mainForm.style.display = '';
    if (maxcaseForm) maxcaseForm.style.display = 'none';

    if (mode === 'full') {
      if (fullBtn) fullBtn.classList.add('active');
      if (deviceStep) deviceStep.style.display = '';
      updateCrStepNumbers(false);
    } else {
      if (quickBtn) quickBtn.classList.add('active');
      if (deviceStep) deviceStep.style.display = 'none';
      updateCrStepNumbers(true);
    }
  }

  // Re-render lucide icons
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function updateCrStepNumbers(isQuickMode) {
  var aiStep = document.getElementById('cr-ai-step-num');
  var detailsStep = document.getElementById('cr-details-step-num');
  var snStep = document.getElementById('cr-sn-step-num');
  var saveStep = document.getElementById('cr-save-step-num');

  if (isQuickMode) {
    // Quick mode: 1 (Employee), 2 (AI), 3 (Details), 4 (SN), 5 (Save)
    if (aiStep) aiStep.textContent = '2';
    if (detailsStep) detailsStep.textContent = '3';
    if (snStep) snStep.textContent = '4';
    if (saveStep) saveStep.textContent = '5';
  } else {
    // Full mode: 1 (Employee), 2 (Device), 3 (AI), 4 (Details), 5 (SN), 6 (Save)
    if (aiStep) aiStep.textContent = '3';
    if (detailsStep) detailsStep.textContent = '4';
    if (snStep) snStep.textContent = '5';
    if (saveStep) saveStep.textContent = '6';
  }
}

// ============================================
// COMPUTER REPAIR - AI CLASSIFICATION
// ============================================

var crCurrentAiSuggestion = null;
var crAiDebounceTimer = null;

function initCrAiInput() {
  var textarea = document.getElementById('cr-ai-input');
  if (!textarea) return;
  textarea.addEventListener('input', function() {
    clearTimeout(crAiDebounceTimer);
    var text = textarea.value.trim();
    if (text.length < 8) {
      hideCrAiSuggestions();
      return;
    }
    crAiDebounceTimer = setTimeout(function() {
      runCrAiClassification(text);
    }, 500);
  });
}

function runCrAiClassification(text) {
  var spinner = document.getElementById('cr-ai-spinner');
  var panel = document.getElementById('cr-ai-suggestion-panel');
  spinner.style.display = 'flex';
  panel.style.display = 'none';

  google.script.run
    .withSuccessHandler(function(result) {
      spinner.style.display = 'none';
      if (result && result.category) {
        crCurrentAiSuggestion = result;
        displayCrAiSuggestions(result);
        // Also show similar past issues
        loadCrSimilarIssues(text);
      } else {
        hideCrAiSuggestions();
        // Still try to show similar issues
        loadCrSimilarIssues(text);
      }
    })
    .withFailureHandler(function(err) {
      spinner.style.display = 'none';
      console.error('CR AI classification error:', err);
      hideCrAiSuggestions();
      // Still try similar issues
      loadCrSimilarIssues(text);
    })
    .classifyComputerRepair(text);
}

function displayCrAiSuggestions(result) {
  var panel = document.getElementById('cr-ai-suggestion-panel');
  panel.style.display = '';

  // Confidence badge
  var confBadge = document.getElementById('cr-ai-confidence-badge');
  var confPct = Math.round((result.confidence || 0) * 100);
  confBadge.textContent = confPct + '%';
  confBadge.className = 'ai-confidence-badge';
  if (confPct >= 70) confBadge.classList.add('ai-conf-high');
  else if (confPct >= 50) confBadge.classList.add('ai-conf-medium');
  else confBadge.classList.add('ai-conf-low');

  // Source badge
  var srcBadge = document.getElementById('cr-ai-source-badge');
  srcBadge.textContent = result.source || 'ai-rules';

  // Field values
  document.getElementById('cr-ai-suggest-category').textContent = result.category || '—';
  document.getElementById('cr-ai-suggest-subcategory').textContent = result.subcategory || '—';
  document.getElementById('cr-ai-suggest-channel').textContent = result.channel || 'Self-service';
  document.getElementById('cr-ai-suggest-impact').textContent = result.impactLabel || 'Individual';
  document.getElementById('cr-ai-suggest-description').textContent = result.improvedDescription || '';

  // New fields: Priority, Estimated Time, Troubleshooting
  var priorityEl = document.getElementById('cr-ai-suggest-priority');
  if (priorityEl) {
    var priority = result.priority || 'Medium';
    priorityEl.textContent = priority;
    priorityEl.className = 'ai-priority-badge';
    if (priority === 'Critical') priorityEl.classList.add('priority-critical');
    else if (priority === 'High') priorityEl.classList.add('priority-high');
    else if (priority === 'Medium') priorityEl.classList.add('priority-medium');
    else priorityEl.classList.add('priority-low');
  }

  var timeEl = document.getElementById('cr-ai-suggest-time');
  if (timeEl) {
    timeEl.textContent = result.estimatedTime || '1-2 days';
  }

  var troubleshootingEl = document.getElementById('cr-ai-suggest-troubleshooting');
  var troubleshootingRow = document.getElementById('cr-ai-troubleshooting-row');
  if (troubleshootingEl && troubleshootingRow) {
    if (result.troubleshooting) {
      troubleshootingEl.textContent = result.troubleshooting;
      troubleshootingRow.style.display = '';
    } else {
      troubleshootingRow.style.display = 'none';
    }
  }

  // Re-render lucide icons
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function hideCrAiSuggestions() {
  var panel = document.getElementById('cr-ai-suggestion-panel');
  if (panel) panel.style.display = 'none';
  var spinner = document.getElementById('cr-ai-spinner');
  if (spinner) spinner.style.display = 'none';
  crCurrentAiSuggestion = null;
}

function crAcceptAiField(fieldName) {
  if (!crCurrentAiSuggestion) return;

  if (fieldName === 'category') {
    var catSelect = document.getElementById('cr-category');
    if (catSelect && crCurrentAiSuggestion.category) {
      catSelect.value = crCurrentAiSuggestion.category;
      onComputerRepairCategoryChange();
      if (crCurrentAiSuggestion.subcategory) {
        setTimeout(function() {
          var subSelect = document.getElementById('cr-subcategory');
          if (subSelect) subSelect.value = crCurrentAiSuggestion.subcategory;
        }, 50);
      }
    }
  } else if (fieldName === 'subcategory') {
    var catSelect = document.getElementById('cr-category');
    if (crCurrentAiSuggestion.category && catSelect.value !== crCurrentAiSuggestion.category) {
      catSelect.value = crCurrentAiSuggestion.category;
      onComputerRepairCategoryChange();
    }
    setTimeout(function() {
      var subSelect = document.getElementById('cr-subcategory');
      if (subSelect && crCurrentAiSuggestion.subcategory) {
        subSelect.value = crCurrentAiSuggestion.subcategory;
      }
    }, 50);
  } else if (fieldName === 'channel') {
    var chanSelect = document.getElementById('cr-channel');
    if (chanSelect && crCurrentAiSuggestion.channel) {
      chanSelect.value = crCurrentAiSuggestion.channel;
    }
  } else if (fieldName === 'impact') {
    var impSelect = document.getElementById('cr-impact');
    if (impSelect && crCurrentAiSuggestion.impact) {
      impSelect.value = crCurrentAiSuggestion.impact;
    }
  } else if (fieldName === 'description') {
    if (crCurrentAiSuggestion.improvedDescription) {
      // Extract first sentence for short description
      var shortDesc = crCurrentAiSuggestion.improvedDescription.split(':')[0];
      if (shortDesc.length > 80) shortDesc = shortDesc.substring(0, 77) + '...';
      document.getElementById('cr-short-desc').value = shortDesc;
      document.getElementById('cr-full-desc').value = crCurrentAiSuggestion.improvedDescription;
    }
  } else if (fieldName === 'priority') {
    // Priority field - just visual feedback, stored in suggestion
    showToast('Priority set to: ' + (crCurrentAiSuggestion.priority || 'Medium'), 'info');
  } else if (fieldName === 'troubleshooting') {
    // Copy troubleshooting steps to clipboard
    if (crCurrentAiSuggestion.troubleshooting) {
      navigator.clipboard.writeText(crCurrentAiSuggestion.troubleshooting).then(function() {
        showToast('Troubleshooting steps copied to clipboard!', 'success');
      }).catch(function() {
        // Fallback: append to full description
        var fullDesc = document.getElementById('cr-full-desc');
        if (fullDesc) {
          fullDesc.value += '\n\nTROUBLESHOOTING STEPS:\n' + crCurrentAiSuggestion.troubleshooting;
        }
        showToast('Troubleshooting steps added to description', 'success');
      });
    }
  }

  // Visual feedback
  var btn = event && event.target;
  if (btn) {
    btn.textContent = 'Accepted';
    btn.classList.add('ai-accepted');
    btn.disabled = true;
  }

  showToast('AI suggestion accepted for ' + fieldName, 'success');
}

function crAcceptAllAiSuggestions() {
  if (!crCurrentAiSuggestion) return;

  // Category
  var catSelect = document.getElementById('cr-category');
  if (catSelect && crCurrentAiSuggestion.category) {
    catSelect.value = crCurrentAiSuggestion.category;
    onComputerRepairCategoryChange();
  }

  // Channel
  var chanSelect = document.getElementById('cr-channel');
  if (chanSelect && crCurrentAiSuggestion.channel) {
    chanSelect.value = crCurrentAiSuggestion.channel;
  }

  // Impact
  var impSelect = document.getElementById('cr-impact');
  if (impSelect && crCurrentAiSuggestion.impact) {
    impSelect.value = crCurrentAiSuggestion.impact;
  }

  // Subcategory (after category populates)
  setTimeout(function() {
    var subSelect = document.getElementById('cr-subcategory');
    if (subSelect && crCurrentAiSuggestion.subcategory) {
      subSelect.value = crCurrentAiSuggestion.subcategory;
    }
  }, 50);

  // Description
  if (crCurrentAiSuggestion.improvedDescription) {
    document.getElementById('cr-short-desc').value = crCurrentAiSuggestion.improvedDescription.split('.')[0] + '.';
    document.getElementById('cr-full-desc').value = crCurrentAiSuggestion.improvedDescription;
  }

  // Mark all buttons
  var btns = document.querySelectorAll('#cr-ai-suggestion-panel .ai-accept-btn');
  btns.forEach(function(btn) {
    btn.textContent = 'Accepted';
    btn.classList.add('ai-accepted');
    btn.disabled = true;
  });

  var allBtn = document.querySelector('#cr-ai-suggestion-panel .ai-accept-all-btn');
  if (allBtn) {
    allBtn.textContent = 'All Accepted';
    allBtn.classList.add('ai-accepted');
    allBtn.disabled = true;
  }

  showToast('All AI suggestions accepted', 'success');
}

// ============================================
// COMPUTER REPAIR - SIMILAR PAST ISSUES
// ============================================

function loadCrSimilarIssues(text) {
  google.script.run
    .withSuccessHandler(function(result) {
      var container = document.getElementById('cr-similar-issues');
      var list = document.getElementById('cr-similar-list');

      if (!result || !result.success || !result.issues || result.issues.length === 0) {
        container.style.display = 'none';
        return;
      }

      container.style.display = '';
      list.innerHTML = result.issues.slice(0, 5).map(function(issue) {
        return '<div class="cr-similar-item" onclick="crUseSimilarIssue(\'' + escapeHtml(issue.id) + '\')">' +
          '<span class="cr-similar-item-text">' + escapeHtml(issue.shortDescription || issue.description.substring(0, 60)) + '</span>' +
          '<span class="cr-similar-item-meta">' + escapeHtml(issue.category || '') + '</span>' +
          '<span class="cr-similar-item-use">Use</span>' +
        '</div>';
      }).join('');
    })
    .withFailureHandler(function(err) {
      document.getElementById('cr-similar-issues').style.display = 'none';
      console.error('Similar issues error:', err);
    })
    .findSimilarComputerRepairs(text);
}

function crUseSimilarIssue(issueId) {
  google.script.run
    .withSuccessHandler(function(result) {
      if (!result || !result.success || !result.repair) return;

      var r = result.repair;

      // Fill form with past issue data
      if (r.category) {
        document.getElementById('cr-category').value = r.category;
        onComputerRepairCategoryChange();
        if (r.subcategory) {
          setTimeout(function() {
            document.getElementById('cr-subcategory').value = r.subcategory;
          }, 50);
        }
      }
      if (r.impact) document.getElementById('cr-impact').value = r.impact;
      if (r.channel) document.getElementById('cr-channel').value = r.channel;
      if (r.userType) document.getElementById('cr-user-type').value = r.userType;
      if (r.shortDescription) document.getElementById('cr-short-desc').value = r.shortDescription;
      if (r.description) document.getElementById('cr-full-desc').value = r.description;

      showToast('Form filled from similar issue', 'success');
    })
    .withFailureHandler(function(err) {
      showToast('Error loading issue: ' + err.message, 'error');
    })
    .getComputerRepairById(issueId);
}

// ============================================
// REPAIR TICKET TEMPLATES
// ============================================

var repairTemplatesData = [];
var selectedRepairTemplate = null; // currently active template defaults
var mcEmployee = null;
var mcWebcamStream = null;
var mcPhotoStream = null;

/**
 * Load repair templates from server.
 */
function loadRepairTemplates() {
  google.script.run
    .withSuccessHandler(function(data) {
      repairTemplatesData = (data || []).filter(function(t) {
        return t && t.active !== false && t.active !== 'FALSE';
      }).sort(function(a, b) {
        return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
      });
      renderTemplateDropdown();
      renderTemplateSettingsList();
    })
    .withFailureHandler(function(err) {
      console.error('Error loading repair templates:', err);
      repairTemplatesData = [];
    })
    .getRepairTemplates();
}

/**
 * Render the template dropdown menu in the ticket mode area.
 */
function renderTemplateDropdown() {
  var menu = document.getElementById('cr-template-dropdown-menu');
  if (!menu) return;

  if (repairTemplatesData.length === 0) {
    menu.innerHTML = '<div class="cr-template-empty">No templates yet. Add them in Settings.</div>';
    return;
  }

  var html = '';
  repairTemplatesData.forEach(function(t) {
    var iconName = t.icon || 'file-text';
    html += '<button type="button" class="cr-template-item" onclick="selectRepairTemplate(\'' + t.id + '\')">' +
      '<i data-lucide="' + iconName + '"></i>' +
      '<div class="cr-template-item-info">' +
        '<span class="cr-template-item-name">' + escapeHtml(t.name) + '</span>' +
        '<small>' + escapeHtml(t.shortDescription || '') + '</small>' +
      '</div>' +
    '</button>';
  });

  menu.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Toggle the template dropdown open/closed.
 */
function toggleTemplateDropdown() {
  var dropdown = document.getElementById('cr-template-dropdown');
  if (dropdown) {
    dropdown.classList.toggle('open');
  }
}

// Close template dropdown when clicking outside
document.addEventListener('click', function(e) {
  var dropdown = document.getElementById('cr-template-dropdown');
  if (dropdown && dropdown.classList.contains('open')) {
    if (!dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  }
});

/**
 * Select a repair template and switch to template mode.
 */
function selectRepairTemplate(templateId) {
  var template = repairTemplatesData.find(function(t) { return t.id === templateId; });
  if (!template) {
    showToast('Template not found', 'error');
    return;
  }

  // Store selected template as defaults
  selectedRepairTemplate = {
    id: template.id,
    name: template.name,
    shortDescription: template.shortDescription || '',
    description: template.description || '',
    channel: template.channel || 'self-service',
    category: template.category || 'Hardware',
    subcategory: template.subcategory || 'Chromebook',
    serviceOffering: template.serviceOffering || 'Other',
    manufacturer: template.manufacturer || '',
    model: template.model || '',
    manufacturerModel: (template.manufacturer && template.model)
      ? template.manufacturer + ' ' + template.model : (template.model || ''),
    assetLocation: template.assetLocation || '',
    impact: template.impact || '4',
    userType: template.userType || 'school_staff',
    requiresSerial: template.requiresSerial !== false && template.requiresSerial !== 'FALSE',
    requiresPhoto: template.requiresPhoto !== false && template.requiresPhoto !== 'FALSE'
  };

  // Close dropdown
  var dropdown = document.getElementById('cr-template-dropdown');
  if (dropdown) dropdown.classList.remove('open');

  // Update the template button label
  var btnLabel = document.getElementById('cr-template-btn-label');
  if (btnLabel) btnLabel.textContent = template.name;

  // Switch to template mode
  setCrTicketMode('template');

  // Update the form heading to show selected template
  var heading = document.getElementById('mc-form-heading');
  if (heading) heading.textContent = template.name;

  // Update the pre-filled summary display
  var summaryEl = document.getElementById('mc-prefilled-summary');
  if (summaryEl) {
    summaryEl.innerHTML =
      '<strong>Summary:</strong> ' + escapeHtml(selectedRepairTemplate.shortDescription) + '<br>' +
      '<strong>Category:</strong> ' + escapeHtml(selectedRepairTemplate.category) +
      ' &gt; ' + escapeHtml(selectedRepairTemplate.subcategory) + '<br>' +
      '<strong>Device:</strong> ' + escapeHtml(selectedRepairTemplate.manufacturerModel) + '<br>' +
      '<strong>Channel:</strong> ' + escapeHtml(selectedRepairTemplate.channel);
  }

  // Show/hide serial and photo steps based on template config
  var serialStep = document.getElementById('mc-step-device');
  var photoStep = document.getElementById('mc-step-photo');
  if (serialStep) serialStep.style.display = selectedRepairTemplate.requiresSerial ? '' : 'none';
  if (photoStep) photoStep.style.display = selectedRepairTemplate.requiresPhoto ? '' : 'none';

  showToast('Template: ' + template.name, 'info');
}

/**
 * Copy the captured photo to clipboard as a PNG blob.
 * Calls callback(copiedSuccessfully) when done.
 * If no photo exists, calls callback(false) immediately.
 */
function copyPhotoToClipboard(callback) {
  var photoImg = document.getElementById('mc-photo-image');
  if (!photoImg || !photoImg.src || photoImg.src.indexOf('data:') !== 0) {
    // No photo captured
    callback(false);
    return;
  }

  try {
    // Draw image onto a canvas to get a PNG blob for clipboard
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    canvas.width = photoImg.naturalWidth || photoImg.width;
    canvas.height = photoImg.naturalHeight || photoImg.height;
    ctx.drawImage(photoImg, 0, 0);

    canvas.toBlob(function(blob) {
      if (!blob) {
        console.error('Failed to create blob from photo');
        callback(false);
        return;
      }
      // Use Clipboard API to write the image
      navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]).then(function() {
        callback(true);
      }).catch(function(err) {
        console.error('Clipboard write failed:', err);
        callback(false);
      });
    }, 'image/png');
  } catch (err) {
    console.error('Photo clipboard copy error:', err);
    callback(false);
  }
}

/**
 * Open ServiceNow with the selected template's pre-filled fields.
 * Generalized version of maxCaseOpenServiceNow().
 * Automatically copies captured photo to clipboard before opening.
 */
function templateOpenServiceNow() {
  var d = selectedRepairTemplate;
  if (!d) {
    showToast('Select a template first', 'warning');
    return;
  }
  if (!mcEmployee) {
    showToast('Look up an employee first (Step 1)', 'warning');
    return;
  }

  var serialNumber = '';
  if (d.requiresSerial) {
    serialNumber = document.getElementById('mc-serial-number').value.trim();
    if (!serialNumber) {
      showToast('Enter a serial number (Step 2)', 'warning');
      return;
    }
  }

  var assetTag = document.getElementById('mc-asset-tag') ? document.getElementById('mc-asset-tag').value.trim() : '';
  var warrantyDate = document.getElementById('mc-warranty-date') ? document.getElementById('mc-warranty-date').value : '';

  // Build description with device info
  var enrichedDesc = '';
  if (serialNumber) {
    enrichedDesc = '[S/N: ' + serialNumber + ' | Model: ' + d.manufacturerModel + (assetTag ? ' | Asset: ' + assetTag : '') + ']\n';
  }
  enrichedDesc += d.description;

  // Build sysparm_query
  var qParts = [];

  // Employee info
  if (mcEmployee.empId) {
    var empId = mcEmployee.empId;
    qParts.push("caller_id=javascript:var u=new GlideRecord('sys_user');u.addQuery('employee_number','" + empId + "');u.query();u.next();u.sys_id");
    qParts.push("u_site_number=javascript:var u=new GlideRecord('sys_user');u.addQuery('employee_number','" + empId + "');u.query();u.next();u.department");
    if (mcEmployee.email) {
      qParts.push("u_req_email_address=" + mcEmployee.email);
    }
    qParts.push("u_local_support=true");
    if (crSiteNumber) {
      qParts.push("assignment_group=javascript:var g=new GlideRecord('sys_user_group');g.get('name','" + crSiteNumber + " Local Support');g.sys_id");
    }
  }

  // Service offering
  qParts.push("service_offering=javascript:var s=new GlideRecord('service_offering');s.get('name','" + d.serviceOffering + "');s.sys_id");

  // Ticket details
  qParts.push('short_description=' + d.shortDescription);
  qParts.push('description=' + enrichedDesc);
  qParts.push('category=' + d.category);
  qParts.push('subcategory=' + d.subcategory);
  qParts.push('contact_type=' + d.channel);
  qParts.push('impact=' + d.impact);
  qParts.push('u_user_type=' + d.userType);

  // Device info
  if (serialNumber) {
    qParts.push('u_service_tag_serial_number=' + serialNumber);
    qParts.push('u_serial_number=' + serialNumber);
    qParts.push('serial_number=' + serialNumber);
  }
  if (d.manufacturerModel) {
    qParts.push('u_manufacturer_model=' + d.manufacturerModel);
    qParts.push('u_model=' + d.manufacturerModel);
  }
  if (assetTag) {
    qParts.push('u_asset_tag=' + assetTag);
  }
  if (warrantyDate) {
    qParts.push('u_asset_under_warranty=true');
    qParts.push('u_warranty_end_date=' + warrantyDate);
  }
  if (d.assetLocation) {
    qParts.push('u_asset_location=' + d.assetLocation);
  }

  var query = qParts.join('^');
  var url = 'https://pbcsd.service-now.com/incident.do?sys_id=-1&sysparm_query=' + encodeURIComponent(query);

  // Copy photo to clipboard first, then open ServiceNow
  copyPhotoToClipboard(function(copied) {
    window.open(url, '_blank');
    if (copied) {
      showToast('Photo copied! Click the Image/Screenshot field in ServiceNow, then Ctrl+V to paste', 'success', 8000);
    } else {
      showToast('ServiceNow opened! Paste INC number after submitting.', 'info');
    }
    var incInput = document.getElementById('mc-inc-number');
    if (incInput) setTimeout(function() { incInput.focus(); }, 500);
  });
}

/**
 * Save the template-based repair ticket.
 */
function templateSave(sendNow) {
  var d = selectedRepairTemplate;
  if (!d) { showToast('No template selected', 'error'); return; }
  if (!mcEmployee) { showToast('Look up an employee first', 'warning'); return; }

  var serialNumber = d.requiresSerial ? (document.getElementById('mc-serial-number').value.trim() || '') : '';
  var incNumber = (document.getElementById('mc-inc-number') || {}).value || '';
  var assetTag = (document.getElementById('mc-asset-tag') || {}).value || '';
  var warrantyDate = (document.getElementById('mc-warranty-date') || {}).value || '';
  var photoImg = document.getElementById('mc-photo-image');
  var photoDataUrl = (photoImg && photoImg.src && photoImg.src.startsWith('data:')) ? photoImg.src : '';

  var repairData = {
    employeeId: mcEmployee.empId || '',
    employeeName: mcEmployee.name || '',
    employeeEmail: mcEmployee.email || '',
    roomNumber: mcEmployee.room || '',
    serialNumber: serialNumber,
    computerModel: d.model || '',
    manufacturer: d.manufacturer || '',
    warrantyDate: warrantyDate,
    assetTag: assetTag,
    shortDescription: d.shortDescription,
    description: d.description,
    category: d.category,
    subcategory: d.subcategory,
    channel: d.channel,
    impact: d.impact,
    userType: d.userType,
    snowIncidentNumber: incNumber,
    repairStatus: 'open',
    emailStatus: sendNow ? 'sending' : 'queued',
    photoDataUrl: photoDataUrl.substring(0, 45000),
    isQuickTicket: false,
    templateName: d.name
  };

  showToast('Saving ticket...', 'info');
  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        showToast('Ticket saved! ' + (result.id || ''), 'success');
        templateResetForm();
      } else {
        showToast('Error: ' + ((result && result.error) || 'Unknown'), 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error: ' + err.message, 'error');
    })
    .createComputerRepair(repairData);
}

function templateSaveAndSend() { templateSave(true); }
function templateSaveAndQueue() { templateSave(false); }

/**
 * Reset the template form.
 */
function templateResetForm() {
  mcEmployee = null;
  selectedRepairTemplate = null;

  var fields = ['mc-emp-id', 'mc-serial-number', 'mc-warranty-date', 'mc-asset-tag', 'mc-inc-number'];
  fields.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });

  var empResult = document.getElementById('mc-employee-result');
  if (empResult) empResult.classList.add('hidden');
  var empError = document.getElementById('mc-employee-error');
  if (empError) empError.classList.add('hidden');
  var photoImg = document.getElementById('mc-photo-image');
  if (photoImg) photoImg.src = '';
  var photoPreview = document.getElementById('mc-photo-preview');
  if (photoPreview) photoPreview.style.display = 'none';

  // Reset heading and summary
  var heading = document.getElementById('mc-form-heading');
  if (heading) heading.textContent = 'Template Ticket';
  var summary = document.getElementById('mc-prefilled-summary');
  if (summary) summary.innerHTML = '<em>Select a template to see pre-filled values</em>';

  // Reset template button label
  var btnLabel = document.getElementById('cr-template-btn-label');
  if (btnLabel) btnLabel.textContent = 'Templates';
}

// ---- Template Settings Management ----

function renderTemplateSettingsList() {
  var container = document.getElementById('repair-templates-list');
  if (!container) return;

  // Load ALL templates (including inactive) for settings
  google.script.run
    .withSuccessHandler(function(allTemplates) {
      if (!allTemplates || allTemplates.length === 0) {
        container.innerHTML = '<p class="text-muted" style="padding:12px;">No templates yet. Click "Add Template" to create one.</p>';
        return;
      }

      var html = '<table class="data-table" style="width:100%;"><thead><tr>' +
        '<th>Name</th><th>Category</th><th>Serial</th><th>Photo</th><th>Active</th><th>Actions</th>' +
        '</tr></thead><tbody>';

      allTemplates.forEach(function(t) {
        var isActive = t.active !== false && t.active !== 'FALSE';
        html += '<tr>' +
          '<td><i data-lucide="' + (t.icon || 'file-text') + '" style="width:16px;height:16px;vertical-align:middle;margin-right:4px;"></i> ' + escapeHtml(t.name || '') + '</td>' +
          '<td style="font-size:12px;">' + escapeHtml(t.category || '') + ' &gt; ' + escapeHtml(t.subcategory || '') + '</td>' +
          '<td>' + (t.requiresSerial === 'TRUE' || t.requiresSerial === true ? '✓' : '—') + '</td>' +
          '<td>' + (t.requiresPhoto === 'TRUE' || t.requiresPhoto === true ? '✓' : '—') + '</td>' +
          '<td>' + (isActive ? '<span style="color:var(--success);">Active</span>' : '<span style="color:#999;">Off</span>') + '</td>' +
          '<td style="white-space:nowrap;">' +
            '<button type="button" class="btn btn-icon btn-ghost btn-sm" onclick="openRepairTemplateEditor(\'' + t.id + '\')" title="Edit"><i data-lucide="edit-2"></i></button>' +
            '<button type="button" class="btn btn-icon btn-ghost btn-danger btn-sm" onclick="confirmDeleteRepairTemplate(\'' + t.id + '\')" title="Delete"><i data-lucide="trash-2"></i></button>' +
          '</td>' +
        '</tr>';
      });

      html += '</tbody></table>';
      container.innerHTML = html;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    })
    .withFailureHandler(function() {
      container.innerHTML = '<p class="text-muted">Error loading templates</p>';
    })
    .getRepairTemplates();
}

function openRepairTemplateEditor(templateId) {
  var modal = document.getElementById('repair-template-editor-modal');
  if (!modal) return;

  if (templateId) {
    // Fetch fresh data from server to ensure we get inactive templates too
    google.script.run
      .withSuccessHandler(function(allTemplates) {
        var template = (allTemplates || []).find(function(t) { return t.id === templateId; });
        populateTemplateEditorForm(modal, template);
      })
      .withFailureHandler(function() {
        // Fallback to local data
        var template = repairTemplatesData.find(function(t) { return t.id === templateId; });
        populateTemplateEditorForm(modal, template);
      })
      .getRepairTemplates();
  } else {
    populateTemplateEditorForm(modal, null);
  }
}

function populateTemplateEditorForm(modal, template) {
  document.getElementById('rt-edit-id').value = template ? template.id : '';
  document.getElementById('rt-edit-name').value = template ? template.name : '';
  document.getElementById('rt-edit-icon').value = template ? (template.icon || 'file-text') : 'file-text';
  document.getElementById('rt-edit-short-desc').value = template ? template.shortDescription : '';
  document.getElementById('rt-edit-description').value = template ? template.description : '';
  document.getElementById('rt-edit-channel').value = template ? template.channel : 'self-service';
  document.getElementById('rt-edit-category').value = template ? template.category : 'Hardware';
  document.getElementById('rt-edit-subcategory').value = template ? template.subcategory : '';
  document.getElementById('rt-edit-service-offering').value = template ? template.serviceOffering : 'Other';
  document.getElementById('rt-edit-manufacturer').value = template ? template.manufacturer : '';
  document.getElementById('rt-edit-model').value = template ? template.model : '';
  document.getElementById('rt-edit-asset-location').value = template ? template.assetLocation : '';
  document.getElementById('rt-edit-impact').value = template ? template.impact : '4';
  document.getElementById('rt-edit-user-type').value = template ? template.userType : 'school_staff';
  document.getElementById('rt-edit-requires-serial').checked = template ? (template.requiresSerial !== false && template.requiresSerial !== 'FALSE') : true;
  document.getElementById('rt-edit-requires-photo').checked = template ? (template.requiresPhoto !== false && template.requiresPhoto !== 'FALSE') : true;
  document.getElementById('rt-edit-sort-order').value = template ? (template.sortOrder || 0) : 0;
  document.getElementById('rt-edit-active').checked = template ? (template.active !== false && template.active !== 'FALSE') : true;

  var title = modal.querySelector('.modal-header h3');
  if (title) title.textContent = template ? 'Edit Template' : 'New Template';

  modal.classList.add('active');
}

function closeRepairTemplateEditor() {
  var modal = document.getElementById('repair-template-editor-modal');
  if (modal) modal.classList.remove('active');
}

function saveRepairTemplateFromEditor() {
  var data = {
    id: document.getElementById('rt-edit-id').value || '',
    name: document.getElementById('rt-edit-name').value.trim(),
    icon: document.getElementById('rt-edit-icon').value.trim() || 'file-text',
    shortDescription: document.getElementById('rt-edit-short-desc').value.trim(),
    description: document.getElementById('rt-edit-description').value.trim(),
    channel: document.getElementById('rt-edit-channel').value,
    category: document.getElementById('rt-edit-category').value,
    subcategory: document.getElementById('rt-edit-subcategory').value.trim(),
    serviceOffering: document.getElementById('rt-edit-service-offering').value.trim() || 'Other',
    manufacturer: document.getElementById('rt-edit-manufacturer').value.trim(),
    model: document.getElementById('rt-edit-model').value.trim(),
    assetLocation: document.getElementById('rt-edit-asset-location').value.trim(),
    impact: document.getElementById('rt-edit-impact').value,
    userType: document.getElementById('rt-edit-user-type').value,
    requiresSerial: document.getElementById('rt-edit-requires-serial').checked,
    requiresPhoto: document.getElementById('rt-edit-requires-photo').checked,
    sortOrder: parseInt(document.getElementById('rt-edit-sort-order').value) || 0,
    active: document.getElementById('rt-edit-active').checked
  };

  if (!data.name) { showToast('Template name is required', 'warning'); return; }
  if (!data.shortDescription) { showToast('Summary is required', 'warning'); return; }

  showToast('Saving template...', 'info');
  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        showToast('Template saved!', 'success');
        closeRepairTemplateEditor();
        loadRepairTemplates();
      } else {
        showToast('Error: ' + ((result && result.error) || 'Unknown'), 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error: ' + err.message, 'error');
    })
    .saveRepairTemplate(data);
}

function confirmDeleteRepairTemplate(templateId) {
  showConfirmCard({
    title: 'Delete Template?',
    message: 'This template will be permanently deleted. This cannot be undone.',
    type: 'danger',
    confirmText: 'Delete',
    onConfirm: function() {
      google.script.run
        .withSuccessHandler(function(result) {
          if (result && result.success) {
            showToast('Template deleted', 'success');
            loadRepairTemplates();
          } else {
            showToast('Error deleting template', 'error');
          }
        })
        .withFailureHandler(function(err) {
          showToast('Error: ' + err.message, 'error');
        })
        .deleteRepairTemplate(templateId);
    }
  });
}

// Keep MAX_CASE_DEFAULTS for backward compatibility — but templates system replaces it
var MAX_CASE_DEFAULTS = {
  shortDescription: 'SWAP Chromebook - Broken MAX Case',
  description: 'The MAX protective case for this Chromebook is broken. The bottom portion of the case (top-right corner) has snapped off and can no longer secure the device correctly.',
  channel: 'self-service',
  category: 'Hardware',
  subcategory: 'Chromebook',
  serviceOffering: 'Other',
  manufacturer: 'Dell',
  model: 'Chromebook 3120 2-in-1',
  manufacturerModel: 'Dell Chromebook 3120 2-in-1',
  assetLocation: '1-153-J Techs Office',
  impact: '4',
  userType: 'school_staff'
};

function maxCaseLookupEmployee() {
  var empId = document.getElementById('mc-emp-id').value.trim();
  if (!empId) {
    showToast('Enter an employee ID', 'warning');
    return;
  }
  var resultDiv = document.getElementById('mc-employee-result');
  var errorDiv = document.getElementById('mc-employee-error');
  resultDiv.classList.add('hidden');
  errorDiv.classList.add('hidden');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success && result.employee) {
        mcEmployee = result.employee;
        mcEmployee.empId = empId;
        document.getElementById('mc-emp-name').textContent = result.employee.name;
        document.getElementById('mc-emp-details').textContent =
          (result.employee.email || 'No email') + ' • Room ' + (result.employee.roomNumber || 'N/A');
        resultDiv.classList.remove('hidden');
        errorDiv.classList.add('hidden');
        if (typeof lucide !== 'undefined') lucide.createIcons();
      } else {
        resultDiv.classList.add('hidden');
        errorDiv.classList.remove('hidden');
        mcEmployee = null;
      }
    })
    .withFailureHandler(function(err) {
      resultDiv.classList.add('hidden');
      errorDiv.classList.remove('hidden');
      mcEmployee = null;
      console.error('MC employee lookup error:', err);
    })
    .lookupEmployee(empId);
}

function maxCaseSetSerialMode(mode) {
  var manualDiv = document.getElementById('mc-manual-entry');
  var webcamDiv = document.getElementById('mc-webcam-entry');
  var manualBtn = document.getElementById('mc-mode-manual-btn');
  var scanBtn = document.getElementById('mc-mode-scan-btn');

  if (mode === 'manual') {
    manualDiv.style.display = '';
    webcamDiv.style.display = 'none';
    manualBtn.classList.add('active');
    scanBtn.classList.remove('active');
    maxCaseStopWebcam();
  } else {
    manualDiv.style.display = 'none';
    webcamDiv.style.display = '';
    scanBtn.classList.add('active');
    manualBtn.classList.remove('active');
  }
}

function maxCaseStartWebcam() {
  var video = document.getElementById('mc-webcam-video');
  if (!video) return;
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })
    .then(function(stream) {
      mcWebcamStream = stream;
      video.srcObject = stream;
      video.play();
      showToast('Camera started. Position sticker and click Capture.', 'info');
    })
    .catch(function(err) {
      showToast('Camera error: ' + err.message, 'error');
    });
}

function maxCaseCapturePhoto() {
  var video = document.getElementById('mc-webcam-video');
  var canvas = document.getElementById('mc-webcam-canvas');
  if (!video || !canvas || !mcWebcamStream) {
    showToast('Start the camera first', 'warning');
    return;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  var dataUrl = canvas.toDataURL('image/jpeg', 0.9);

  // Show captured preview
  var preview = document.getElementById('mc-captured-preview');
  var img = document.getElementById('mc-captured-image');
  if (preview && img) {
    img.src = dataUrl;
    preview.style.display = 'block';
  }

  // Run OCR
  var statusDiv = document.getElementById('mc-ocr-status');
  if (statusDiv) statusDiv.style.display = 'flex';
  maxCaseRunOcr(dataUrl);
}

function maxCaseRunOcr(dataUrl) {
  var statusDiv = document.getElementById('mc-ocr-status');
  var statusText = document.getElementById('mc-ocr-status-text');
  if (statusDiv) statusDiv.style.display = 'flex';
  if (statusText) statusText.textContent = 'Loading OCR engine...';

  // Load Tesseract.js first (lazy-loaded from CDN), then run OCR
  loadTesseractJs(function() {
    if (statusText) statusText.textContent = 'Recognizing text...';

    Tesseract.recognize(dataUrl, 'eng', {
      logger: function(m) {
        if (statusText && m.status === 'recognizing text') {
          statusText.textContent = 'Recognizing... ' + Math.round(m.progress * 100) + '%';
        }
      }
    }).then(function(result) {
      if (statusDiv) statusDiv.style.display = 'none';
      maxCaseProcessOcrResult(result.data.text);
    }).catch(function(err) {
      if (statusDiv) statusDiv.style.display = 'none';
      showToast('OCR error: ' + err.message, 'error');
    });
  });
}

function maxCaseProcessOcrResult(text) {
  var resultDiv = document.getElementById('mc-ocr-result');
  var serialInput = document.getElementById('mc-ocr-serial');
  var warrantyInput = document.getElementById('mc-ocr-warranty');
  var rawText = document.getElementById('mc-ocr-raw');

  if (rawText) rawText.value = text;
  if (resultDiv) resultDiv.style.display = '';

  // Extract serial number using existing function
  if (typeof computerRepairExtractSerial === 'function') {
    var serial = computerRepairExtractSerial(text);
    if (serialInput) serialInput.value = serial || '';
  }

  // Extract warranty date using existing function
  if (typeof computerRepairExtractDate === 'function') {
    var date = computerRepairExtractDate(text);
    if (warrantyInput) warrantyInput.value = date || '';
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
  showToast('OCR complete! Review and accept results.', 'success');
}

function maxCaseStopWebcam() {
  if (mcWebcamStream) {
    mcWebcamStream.getTracks().forEach(function(t) { t.stop(); });
    mcWebcamStream = null;
  }
  var video = document.getElementById('mc-webcam-video');
  if (video) video.srcObject = null;
}

function maxCaseAcceptOcrSerial() {
  var detected = document.getElementById('mc-ocr-serial').value.trim();
  if (detected) {
    document.getElementById('mc-serial-number').value = detected;
    // Also set asset tag to same value if empty
    var assetTag = document.getElementById('mc-asset-tag');
    if (assetTag && !assetTag.value.trim()) {
      assetTag.value = detected;
    }
    showToast('Serial number accepted: ' + detected, 'success');
  }
}

function maxCaseAcceptOcrWarranty() {
  var detected = document.getElementById('mc-ocr-warranty').value.trim();
  if (detected) {
    // Try to convert to date format
    var dateInput = document.getElementById('mc-warranty-date');
    if (dateInput) {
      // Try parsing common formats
      var d = new Date(detected);
      if (!isNaN(d.getTime())) {
        dateInput.value = d.toISOString().split('T')[0];
      } else {
        dateInput.value = detected;
      }
    }
    showToast('Warranty date accepted', 'success');
  }
}

// --- Photo Evidence Camera ---
function maxCaseStartPhotoCamera() {
  var video = document.getElementById('mc-photo-video');
  if (!video) return;
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })
    .then(function(stream) {
      mcPhotoStream = stream;
      video.srcObject = stream;
      video.play();
      showToast('Camera ready. Take photo of broken case.', 'info');
    })
    .catch(function(err) {
      showToast('Camera error: ' + err.message, 'error');
    });
}

function maxCaseCapturePhotoEvidence() {
  var video = document.getElementById('mc-photo-video');
  var canvas = document.getElementById('mc-photo-canvas');
  if (!video || !canvas || !mcPhotoStream) {
    showToast('Start the camera first', 'warning');
    return;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  var dataUrl = canvas.toDataURL('image/jpeg', 0.9);

  var preview = document.getElementById('mc-photo-preview');
  var img = document.getElementById('mc-photo-image');
  if (preview && img) {
    img.src = dataUrl;
    preview.style.display = 'block';
  }
  showToast('Photo captured!', 'success');
  maxCaseStopPhotoCamera();
}

function maxCaseStopPhotoCamera() {
  if (mcPhotoStream) {
    mcPhotoStream.getTracks().forEach(function(t) { t.stop(); });
    mcPhotoStream = null;
  }
  var video = document.getElementById('mc-photo-video');
  if (video) video.srcObject = null;
}

// --- Open ServiceNow Pre-filled ---
function maxCaseOpenServiceNow() {
  if (!mcEmployee) {
    showToast('Look up an employee first (Step 1)', 'warning');
    return;
  }
  var serialNumber = document.getElementById('mc-serial-number').value.trim();
  if (!serialNumber) {
    showToast('Enter a serial number (Step 2)', 'warning');
    return;
  }

  var d = MAX_CASE_DEFAULTS;
  var assetTag = document.getElementById('mc-asset-tag').value.trim();
  var warrantyDate = document.getElementById('mc-warranty-date').value;

  // Build description with device info
  var enrichedDesc = '[S/N: ' + serialNumber + ' | Model: ' + d.manufacturerModel + (assetTag ? ' | Asset: ' + assetTag : '') + ']\n' + d.description;

  // Build sysparm_query
  var qParts = [];

  // Employee info
  if (mcEmployee.empId) {
    var empId = mcEmployee.empId;
    qParts.push("caller_id=javascript:var u=new GlideRecord('sys_user');u.addQuery('employee_number','" + empId + "');u.query();u.next();u.sys_id");
    qParts.push("u_site_number=javascript:var u=new GlideRecord('sys_user');u.addQuery('employee_number','" + empId + "');u.query();u.next();u.department");
    if (mcEmployee.email) {
      qParts.push("u_req_email_address=" + mcEmployee.email);
    }
    qParts.push("u_local_support=true");
    if (crSiteNumber) {
      qParts.push("assignment_group=javascript:var g=new GlideRecord('sys_user_group');g.get('name','" + crSiteNumber + " Local Support');g.sys_id");
    }
  }

  // Service offering
  qParts.push("service_offering=javascript:var s=new GlideRecord('service_offering');s.get('name','" + d.serviceOffering + "');s.sys_id");

  // Ticket details
  qParts.push('short_description=' + d.shortDescription);
  qParts.push('description=' + enrichedDesc);
  qParts.push('category=' + d.category);
  qParts.push('subcategory=' + d.subcategory);
  qParts.push('contact_type=' + d.channel);
  qParts.push('impact=' + d.impact);
  qParts.push('u_user_type=' + d.userType);

  // Device info
  qParts.push('u_service_tag_serial_number=' + serialNumber);
  qParts.push('u_serial_number=' + serialNumber);
  qParts.push('serial_number=' + serialNumber);
  qParts.push('u_manufacturer_model=' + d.manufacturerModel);
  qParts.push('u_model=' + d.manufacturerModel);
  if (assetTag) {
    qParts.push('u_asset_tag=' + assetTag);
  }
  if (warrantyDate) {
    qParts.push('u_asset_under_warranty=true');
    qParts.push('u_warranty_end_date=' + warrantyDate);
  }
  qParts.push('u_asset_location=' + d.assetLocation);

  var query = qParts.join('^');
  var url = 'https://pbcsd.service-now.com/incident.do?sys_id=-1&sysparm_query=' + encodeURIComponent(query);

  // Copy photo to clipboard first, then open ServiceNow
  copyPhotoToClipboard(function(copied) {
    window.open(url, '_blank');
    if (copied) {
      showToast('Photo copied! Click the Image/Screenshot field in ServiceNow, then Ctrl+V to paste', 'success', 8000);
    } else {
      showToast('ServiceNow opened! Submit and paste INC number.', 'info');
    }
    var incInput = document.getElementById('mc-inc-number');
    if (incInput) {
      setTimeout(function() { incInput.focus(); }, 500);
    }
  });
}

function maxCasePasteInc() {
  navigator.clipboard.readText().then(function(text) {
    var match = text.match(/INC\d{7,}/i);
    if (match) {
      document.getElementById('mc-inc-number').value = match[0].toUpperCase();
      showToast('INC pasted: ' + match[0].toUpperCase(), 'success');
    } else {
      document.getElementById('mc-inc-number').value = text.trim();
      showToast('Pasted (no INC pattern found)', 'info');
    }
  }).catch(function(err) {
    showToast('Paste error: ' + err.message, 'error');
  });
}

function maxCaseSaveAndSend() {
  maxCaseSave(true);
}

function maxCaseSaveAndQueue() {
  maxCaseSave(false);
}

function maxCaseSave(sendNow) {
  if (!mcEmployee) {
    showToast('Look up an employee first (Step 1)', 'warning');
    return;
  }
  var serialNumber = document.getElementById('mc-serial-number').value.trim();
  if (!serialNumber) {
    showToast('Enter a serial number (Step 2)', 'warning');
    return;
  }

  var d = MAX_CASE_DEFAULTS;

  // Get captured photo data URL if available
  var photoDataUrl = '';
  var capturedImg = document.getElementById('mc-photo-image');
  if (capturedImg && capturedImg.src && capturedImg.src.indexOf('data:') === 0) {
    photoDataUrl = capturedImg.src;
  }

  var data = {
    employeeId: mcEmployee.empId,
    employeeName: mcEmployee.name,
    employeeEmail: mcEmployee.email,
    roomNumber: mcEmployee.roomNumber,
    serialNumber: serialNumber,
    computerModel: d.model,
    manufacturer: d.manufacturer,
    warrantyDate: document.getElementById('mc-warranty-date').value,
    assetTag: document.getElementById('mc-asset-tag').value.trim(),
    shortDescription: d.shortDescription,
    description: d.description,
    category: d.category,
    subcategory: d.subcategory,
    channel: d.channel,
    impact: d.impact,
    userType: d.userType,
    snowIncidentNumber: document.getElementById('mc-inc-number').value.trim(),
    photoDataUrl: photoDataUrl,
    emailStatus: sendNow ? 'sending' : 'queued',
    ticketType: 'maxcase'
  };

  showToast('Saving MAX Case swap...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        showToast('MAX Case swap saved!', 'success');
        var repairId = result.repair.id;
        loadComputerRepairs();

        if (sendNow) {
          showToast('Sending email notification...', 'info');
          google.script.run
            .withSuccessHandler(function(emailResult) {
              if (emailResult && emailResult.success) {
                showToast('Email sent to ' + (data.employeeEmail || 'employee') + '!', 'success');
              } else {
                showToast('Email failed: ' + (emailResult ? emailResult.error : 'Unknown'), 'error');
              }
              loadComputerRepairs();
            })
            .withFailureHandler(function(err) {
              showToast('Email error: ' + err.message, 'error');
            })
            .sendComputerRepairEmail(repairId);
        } else {
          showToast('Queuing email for later...', 'info');
          google.script.run
            .withSuccessHandler(function(queueResult) {
              if (queueResult && queueResult.success) {
                showToast('Email queued!', 'success');
              } else {
                showToast('Queue failed: ' + (queueResult ? queueResult.error : 'Unknown'), 'error');
              }
              loadComputerRepairs();
            })
            .withFailureHandler(function(err) {
              showToast('Queue error: ' + err.message, 'error');
            })
            .queueComputerRepairEmail(repairId);
        }

        // Reset MAX Case form after short delay
        setTimeout(function() {
          maxCaseResetForm();
        }, 500);
      } else {
        showToast('Save failed: ' + (result ? result.error : 'Unknown'), 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Save error: ' + err.message, 'error');
    })
    .createComputerRepair(data);
}

function maxCaseResetForm() {
  mcEmployee = null;
  document.getElementById('mc-emp-id').value = '';
  document.getElementById('mc-employee-result').classList.add('hidden');
  document.getElementById('mc-employee-error').classList.add('hidden');
  document.getElementById('mc-serial-number').value = '';
  document.getElementById('mc-asset-tag').value = '';
  document.getElementById('mc-warranty-date').value = '';
  document.getElementById('mc-inc-number').value = '';

  // Reset OCR
  var ocrResult = document.getElementById('mc-ocr-result');
  if (ocrResult) ocrResult.style.display = 'none';
  var capturedPreview = document.getElementById('mc-captured-preview');
  if (capturedPreview) capturedPreview.style.display = 'none';

  // Reset photo
  var photoPreview = document.getElementById('mc-photo-preview');
  if (photoPreview) photoPreview.style.display = 'none';

  // Stop cameras
  maxCaseStopWebcam();
  maxCaseStopPhotoCamera();

  // Set back to manual mode
  maxCaseSetSerialMode('manual');
}

// ============================================
// COMPUTER REPAIR - SAVE AI TRAINING DATA
// ============================================

function saveCrAiTrainingData(repairId, data) {
  var aiInput = document.getElementById('cr-ai-input');
  var rawText = aiInput ? aiInput.value.trim() : '';
  if (!rawText) return;

  var aiAccepted = false;
  if (crCurrentAiSuggestion) {
    aiAccepted = (
      data.category === crCurrentAiSuggestion.category &&
      data.subcategory === crCurrentAiSuggestion.subcategory
    );
  }

  var trainingData = {
    rawDescription: rawText,
    improvedDescription: data.description || data.shortDescription,
    category: data.category,
    subcategory: data.subcategory,
    impact: data.impact,
    aiAccepted: aiAccepted,
    confidence: crCurrentAiSuggestion ? crCurrentAiSuggestion.confidence : 0,
    source: crCurrentAiSuggestion ? crCurrentAiSuggestion.source : 'none',
    repairId: repairId,
    isQuickTicket: crTicketMode === 'quick'
  };

  google.script.run
    .withSuccessHandler(function() {
      console.log('CR AI training data saved');
    })
    .withFailureHandler(function(err) {
      console.error('Failed to save CR AI training data:', err);
    })
    .saveCrTrainingEntry(trainingData);
}

// Update initComputerRepair to include AI input and INC auto-format
(function() {
  var origInit = window.initComputerRepair;
  window.initComputerRepair = function() {
    origInit();
    initCrAiInput();
    // Set initial step numbers for full mode
    updateCrStepNumbers(false);
    // Add auto-format listener for INC input
    initCrIncAutoFormat();
    // Start checking for INC from Chrome extension
    startExtensionIncCheck();
    // Load repair templates for the dropdown
    loadRepairTemplates();
  };
})();

// Auto-format INC number as user types or pastes
function initCrIncAutoFormat() {
  var incInput = document.getElementById('cr-inc-number');
  if (!incInput) return;

  // Format on input (typing)
  incInput.addEventListener('input', function(e) {
    var val = e.target.value.toUpperCase().trim();
    // Auto-add INC prefix if user types just numbers
    if (/^\d{7,10}$/.test(val)) {
      e.target.value = 'INC' + val;
    } else if (val && !val.startsWith('INC') && /^\d/.test(val)) {
      // If starts with number but not complete, leave as-is until complete
    }
  });

  // Format on paste (manual Ctrl+V/Cmd+V)
  incInput.addEventListener('paste', function(e) {
    e.preventDefault();
    var pastedText = (e.clipboardData || window.clipboardData).getData('text');
    var extracted = extractIncNumber(pastedText);

    if (extracted) {
      e.target.value = extracted;
      var incStatus = document.getElementById('cr-inc-status');
      if (incStatus) {
        incStatus.innerHTML = '<i data-lucide="check-circle" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;color:#22c55e;"></i> ' + extracted + ' pasted!';
        incStatus.style.color = '#22c55e';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    } else {
      // Just paste the raw text if no pattern found
      var cleaned = pastedText.toUpperCase().trim();
      if (/^\d{7,10}$/.test(cleaned)) {
        e.target.value = 'INC' + cleaned;
      } else {
        e.target.value = cleaned;
      }
    }
  });

  // Format on blur (when user leaves field)
  incInput.addEventListener('blur', function(e) {
    var val = e.target.value.toUpperCase().trim();
    if (/^\d{7,10}$/.test(val)) {
      e.target.value = 'INC' + val;
    } else if (val && !val.startsWith('INC') && /^0*\d{7,10}$/.test(val.replace(/\D/g, ''))) {
      // Extract numbers and add INC prefix
      var nums = val.replace(/\D/g, '');
      if (nums.length >= 7) {
        e.target.value = 'INC' + nums;
      }
    }
  });
}

// Update computerRepairSave to include training data save
(function() {
  var origSave = window.computerRepairSave;
  window.computerRepairSave = function(sendNow) {
    // In quick ticket mode, serial number is not required
    if (crTicketMode === 'quick') {
      if (!crEmployee) {
        showToast('Look up an employee first (Step 1)', 'warning');
        return;
      }
      var shortDesc = document.getElementById('cr-short-desc').value.trim();
      if (!shortDesc) {
        showToast('Enter a short description', 'warning');
        return;
      }
      var category = document.getElementById('cr-category').value;
      if (!category) {
        showToast('Select a category', 'warning');
        return;
      }

      var data = {
        employeeId: crEmployee.empId,
        employeeName: crEmployee.name,
        employeeEmail: crEmployee.email,
        roomNumber: crEmployee.roomNumber,
        serialNumber: '', // Not required in quick mode
        computerModel: '',
        manufacturer: '',
        warrantyDate: '',
        assetTag: '',
        shortDescription: shortDesc,
        description: document.getElementById('cr-full-desc').value.trim(),
        category: category,
        subcategory: document.getElementById('cr-subcategory').value,
        channel: document.getElementById('cr-channel').value,
        impact: document.getElementById('cr-impact').value,
        userType: document.getElementById('cr-user-type').value,
        snowIncidentNumber: document.getElementById('cr-inc-number').value.trim(),
        photoDataUrl: '',
        emailStatus: sendNow ? 'sending' : 'queued',
        isQuickTicket: true
      };

      showToast('Saving quick ticket...', 'info');

      google.script.run
        .withSuccessHandler(function(result) {
          if (result && result.success) {
            showToast('Quick ticket saved successfully!', 'success');
            var repairId = result.repair.id;

            // Immediately refresh the repairs list
            loadComputerRepairs();

            // Save AI training data
            saveCrAiTrainingData(repairId, data);

            if (sendNow) {
              showToast('Sending email notification...', 'info');
              google.script.run
                .withSuccessHandler(function(emailResult) {
                  if (emailResult && emailResult.success) {
                    showToast('Email sent!', 'success');
                  } else {
                    showToast('Email failed: ' + (emailResult ? emailResult.error : 'Unknown'), 'error');
                  }
                  loadComputerRepairs();
                })
                .withFailureHandler(function(err) {
                  showToast('Email error: ' + err.message, 'error');
                })
                .sendComputerRepairEmail(repairId);
            } else {
              showToast('Queuing email...', 'info');
              google.script.run
                .withSuccessHandler(function(queueResult) {
                  if (queueResult && queueResult.success) {
                    showToast('Email queued successfully!', 'success');
                  } else {
                    showToast('Queue failed: ' + (queueResult ? queueResult.error : 'Unknown'), 'error');
                  }
                  loadComputerRepairs();
                })
                .withFailureHandler(function(err) {
                  showToast('Queue error: ' + err.message, 'error');
                })
                .queueComputerRepairEmail(repairId);
            }

            // Reset form after short delay
            setTimeout(function() {
              resetComputerRepairForm();
            }, 500);
          } else {
            showToast('Save failed: ' + (result ? result.error : 'Unknown'), 'error');
            console.error('Quick ticket save failed:', result);
          }
        })
        .withFailureHandler(function(err) {
          showToast('Save error: ' + err.message, 'error');
          console.error('Quick ticket save error:', err);
        })
        .createComputerRepair(data);
    } else {
      // Full mode - call original save
      origSave(sendNow);
    }
  };
})();

// Update reset to clear AI fields
(function() {
  var origReset = window.resetComputerRepairForm;
  window.resetComputerRepairForm = function() {
    origReset();
    // Reset AI fields
    var aiInput = document.getElementById('cr-ai-input');
    if (aiInput) aiInput.value = '';
    hideCrAiSuggestions();
    document.getElementById('cr-similar-issues').style.display = 'none';
    // Reset accept button states
    var btns = document.querySelectorAll('#cr-ai-suggestion-panel .ai-accept-btn, #cr-ai-suggestion-panel .ai-accept-all-btn');
    btns.forEach(function(btn) {
      btn.classList.remove('ai-accepted');
      btn.disabled = false;
      btn.textContent = btn.classList.contains('ai-accept-all-btn') ? 'Accept All Suggestions' : 'Accept';
    });
  };
})();

// ============================================
// SPLASH SCREEN CUSTOMIZATION
// ============================================

var splashSettings = {
  icon: '🏫',
  customIconUrl: '',
  title: 'Smart School Monitor',
  subtitle: 'Loading your network dashboard...',
  color: '#7c6fdc',
  pattern: 'none'
};

function initSplashSettings() {
  loadSplashSettings();
  updateSplashSelectionStates();
  updateSplashPreview();

  // Set input values from saved settings
  var titleInput = document.getElementById('splash-title');
  var subtitleInput = document.getElementById('splash-subtitle');
  if (titleInput) titleInput.value = splashSettings.title;
  if (subtitleInput) subtitleInput.value = splashSettings.subtitle;

  // Update custom color input
  var customColor = document.getElementById('splash-custom-color');
  if (customColor) customColor.value = splashSettings.color;
}

function loadSplashSettings() {
  try {
    var saved = localStorage.getItem('splashSettings');
    if (saved) {
      var parsed = JSON.parse(saved);
      splashSettings = Object.assign({}, splashSettings, parsed);
    }
  } catch (e) {
    console.error('Error loading splash settings:', e);
  }
}

function saveSplashSettings() {
  try {
    // Get current values from inputs
    var titleInput = document.getElementById('splash-title');
    var subtitleInput = document.getElementById('splash-subtitle');
    if (titleInput) splashSettings.title = titleInput.value.trim() || 'Smart School Monitor';
    if (subtitleInput) splashSettings.subtitle = subtitleInput.value.trim() || 'Loading your network dashboard...';

    localStorage.setItem('splashSettings', JSON.stringify(splashSettings));
    showToast('Splash screen settings saved!', 'success');
    updateSplashPreview();
  } catch (e) {
    console.error('Error saving splash settings:', e);
    showToast('Error saving settings', 'error');
  }
}

function resetSplashSettings() {
  splashSettings = {
    icon: '🏫',
    customIconUrl: '',
    title: 'Smart School Monitor',
    subtitle: 'Loading your network dashboard...',
    color: '#7c6fdc',
    pattern: 'none'
  };

  localStorage.removeItem('splashSettings');

  // Update inputs
  var titleInput = document.getElementById('splash-title');
  var subtitleInput = document.getElementById('splash-subtitle');
  if (titleInput) titleInput.value = splashSettings.title;
  if (subtitleInput) subtitleInput.value = splashSettings.subtitle;

  // Update custom color input
  var customColor = document.getElementById('splash-custom-color');
  if (customColor) customColor.value = splashSettings.color;

  // Update selection states and preview
  updateSplashSelectionStates();
  updateSplashPreview();

  showToast('Splash screen reset to defaults', 'info');
}

function updateSplashSelectionStates() {
  // Update icon selection
  var iconBtns = document.querySelectorAll('.splash-icon-btn');
  iconBtns.forEach(function(btn) {
    var iconVal = btn.getAttribute('data-icon');
    if (iconVal === splashSettings.icon) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update color selection
  var colorBtns = document.querySelectorAll('.splash-color-btn');
  colorBtns.forEach(function(btn) {
    var colorVal = btn.getAttribute('data-color');
    if (colorVal === splashSettings.color) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update pattern selection
  var patternBtns = document.querySelectorAll('.splash-pattern-btn');
  patternBtns.forEach(function(btn) {
    var patternVal = btn.getAttribute('data-pattern');
    if (patternVal === splashSettings.pattern) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function selectSplashIcon(iconEmoji) {
  splashSettings.icon = iconEmoji;
  splashSettings.customIconUrl = '';
  updateSplashSelectionStates();
  updateSplashPreview();
}

function handleSplashIconUpload(event) {
  var input = event.target;
  if (!input.files || !input.files[0]) return;

  var file = input.files[0];
  if (!file.type.startsWith('image/')) {
    showToast('Please select an image file', 'warning');
    return;
  }

  // Show filename
  var filenameSpan = document.getElementById('splash-icon-filename');
  if (filenameSpan) filenameSpan.textContent = file.name;

  var reader = new FileReader();
  reader.onload = function(e) {
    splashSettings.icon = 'custom';
    splashSettings.customIconUrl = e.target.result;

    // Remove active from all icon buttons
    var iconBtns = document.querySelectorAll('.splash-icon-btn');
    iconBtns.forEach(function(btn) { btn.classList.remove('active'); });

    updateSplashPreview();
    showToast('Custom icon uploaded!', 'success');
  };
  reader.readAsDataURL(file);
}

function selectSplashColor(color) {
  splashSettings.color = color;

  // Update custom color input
  var customColor = document.getElementById('splash-custom-color');
  if (customColor) customColor.value = color;

  updateSplashSelectionStates();
  updateSplashPreview();

  // Update pattern preview backgrounds
  var patternPreviews = document.querySelectorAll('.pattern-preview');
  patternPreviews.forEach(function(preview) {
    preview.style.backgroundColor = color;
  });
}

function selectSplashPattern(patternId) {
  splashSettings.pattern = patternId;
  updateSplashSelectionStates();
  updateSplashPreview();
}

function updateSplashPreview() {
  var preview = document.getElementById('splash-preview');
  var previewIcon = document.getElementById('splash-preview-icon');
  var previewTitle = document.getElementById('splash-preview-title');
  var previewSubtitle = preview ? preview.querySelector('.splash-preview-subtitle') : null;

  if (!preview) return;

  // Set background color
  preview.style.backgroundColor = splashSettings.color;

  // Set pattern - remove old pattern classes first
  var patternClasses = ['pattern-none', 'pattern-dots', 'pattern-grid', 'pattern-waves',
                        'pattern-circles', 'pattern-diagonal', 'pattern-hexagon', 'pattern-gradient'];
  patternClasses.forEach(function(cls) {
    preview.classList.remove(cls);
  });
  if (splashSettings.pattern && splashSettings.pattern !== 'none') {
    preview.classList.add('pattern-' + splashSettings.pattern);
  }

  // Set icon
  if (previewIcon) {
    if (splashSettings.icon === 'custom' && splashSettings.customIconUrl) {
      previewIcon.innerHTML = '<img src="' + splashSettings.customIconUrl + '" alt="Custom Icon" style="width: 48px; height: 48px; object-fit: contain;">';
    } else {
      previewIcon.textContent = splashSettings.icon;
    }
  }

  // Set title and subtitle from inputs (live preview)
  var titleInput = document.getElementById('splash-title');
  var subtitleInput = document.getElementById('splash-subtitle');
  if (previewTitle) {
    previewTitle.textContent = titleInput ? (titleInput.value || 'Smart School Monitor') : splashSettings.title;
  }
  if (previewSubtitle) {
    previewSubtitle.textContent = subtitleInput ? (subtitleInput.value || 'Loading your network dashboard...') : splashSettings.subtitle;
  }
}

function applySplashSettingsToScreen() {
  // This function applies saved splash settings to the actual loading screen on page load
  var loadingScreen = document.getElementById('loading-screen');
  if (!loadingScreen) return;

  loadSplashSettings();

  // Apply background color
  loadingScreen.style.backgroundColor = splashSettings.color;

  // Apply pattern
  if (splashSettings.pattern && splashSettings.pattern !== 'none') {
    loadingScreen.classList.add('pattern-' + splashSettings.pattern);
  }

  // Apply icon
  var iconContainer = loadingScreen.querySelector('.school-icon');
  if (iconContainer) {
    if (splashSettings.icon === 'custom' && splashSettings.customIconUrl) {
      iconContainer.innerHTML = '<img src="' + splashSettings.customIconUrl + '" alt="Icon" style="width: 180px; height: 180px; object-fit: contain;">';
    } else {
      iconContainer.textContent = splashSettings.icon;
    }
  }

  // Apply title
  var titleEl = loadingScreen.querySelector('.loading-title');
  if (titleEl && splashSettings.title) {
    titleEl.textContent = splashSettings.title;
  }

  // Apply subtitle
  var subtitleEl = loadingScreen.querySelector('.loading-subtitle');
  if (subtitleEl && splashSettings.subtitle) {
    subtitleEl.textContent = splashSettings.subtitle;
  }

  // Also update the sidebar logo if it exists
  var logoIcon = document.querySelector('.logo-icon');
  if (logoIcon) {
    if (splashSettings.icon === 'custom' && splashSettings.customIconUrl) {
      logoIcon.innerHTML = '<img src="' + splashSettings.customIconUrl + '" alt="Icon" style="width: 24px; height: 24px; object-fit: contain;">';
    } else {
      logoIcon.textContent = splashSettings.icon;
    }
  }
}

// Initialize splash settings when settings panel is opened
(function() {
  var origSwitchTab = window.switchTab;
  window.switchTab = function(tabId) {
    origSwitchTab(tabId);
    if (tabId === 'settings') {
      // Check if splash screen panel exists and initialize
      setTimeout(function() {
        var splashPanel = document.getElementById('settings-panel-splash-screen');
        if (splashPanel) {
          initSplashSettings();
        }
      }, 100);
    }
    // Load Overview Dashboard when tab is opened
    if (tabId === 'overview') {
      setTimeout(function() {
        loadOverviewDashboard();
      }, 100);
    }
  };
})();

// ============================================
// OVERVIEW DASHBOARD - Modern Financial Style
// ============================================

function loadOverviewDashboard(showFeedback) {
  updateOverviewStats();
  updateOverviewChart();
  loadQuickAccessDevices();
  loadRecentActivity();
  renderOverviewGoals();
  if (showFeedback) showToast('Overview refreshed', 'success');
}

function updateOverviewStats() {
  var devices = state.devices || [];
  var total = devices.length;
  var online = devices.filter(function(d) { return d.status === 'online'; }).length;
  var offline = devices.filter(function(d) { return d.status === 'offline'; }).length;
  var issues = devices.filter(function(d) { return d.status === 'warning' || d.status === 'error'; }).length;

  // Update main stat
  var totalEl = document.getElementById('od-total-devices');
  if (totalEl) totalEl.textContent = total;

  // Update mini stats
  var onlineEl = document.getElementById('od-online-count');
  if (onlineEl) onlineEl.textContent = online;

  var issuesEl = document.getElementById('od-issues-count');
  if (issuesEl) issuesEl.textContent = issues;

  // Count resolved today (from service requests if available)
  var resolvedToday = 0;
  if (state.serviceRequests) {
    var today = new Date().toDateString();
    resolvedToday = state.serviceRequests.filter(function(r) {
      return r.status === 'completed' && new Date(r.completedAt).toDateString() === today;
    }).length;
  }
  var resolvedEl = document.getElementById('od-resolved-count');
  if (resolvedEl) resolvedEl.textContent = resolvedToday;

  // Update low supply devices
  var lowSupplyDevices = devices.filter(function(d) {
    var supplies = Array.isArray(d.supplies) ? d.supplies : [];
    for (var i = 0; i < supplies.length; i++) {
      var level = typeof supplies[i].percentage === 'number' ? supplies[i].percentage : (parseInt(supplies[i].percentage) || 0);
      if (level < 20) return true;
    }
    return false;
  });

  var lowSupplyCount = lowSupplyDevices.length;
  var lowSupplyBar = document.getElementById('od-low-supply-bar');
  var lowSupplyCountEl = document.getElementById('od-low-supply-count');
  var totalSupplyCountEl = document.getElementById('od-total-supply-count');

  if (lowSupplyBar) {
    var percent = total > 0 ? (lowSupplyCount / total) * 100 : 0;
    lowSupplyBar.style.width = percent + '%';
    lowSupplyBar.style.background = percent > 50 ? 'linear-gradient(90deg, #fca5a5 0%, #ef4444 100%)' :
                                    percent > 25 ? 'linear-gradient(90deg, #fde68a 0%, #f59e0b 100%)' :
                                    'linear-gradient(90deg, #86efac 0%, #22c55e 100%)';
  }
  if (lowSupplyCountEl) lowSupplyCountEl.textContent = lowSupplyCount;
  if (totalSupplyCountEl) totalSupplyCountEl.textContent = total;

  // Update device analysis
  updateDeviceAnalysis(devices);

  // Update health score
  updateHealthScore(devices, online, total);

  // Refresh lucide icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function updateOverviewChart() {
  // Generate sample data for the bar chart based on current device counts
  var devices = state.devices || [];
  var total = devices.length || 1;
  var online = devices.filter(function(d) { return d.status === 'online'; }).length;
  var warning = devices.filter(function(d) { return d.status === 'warning'; }).length;
  var offline = devices.filter(function(d) { return d.status === 'offline' || d.status === 'error'; }).length;

  // Calculate percentages
  var onlinePercent = Math.round((online / total) * 100);
  var warningPercent = Math.round((warning / total) * 100);
  var offlinePercent = Math.round((offline / total) * 100);

  // Update bars with slight variations for visual interest
  var barGroups = document.querySelectorAll('.od-bar-group');
  barGroups.forEach(function(group, index) {
    var variation = (Math.random() - 0.5) * 20;
    var onlineBar = group.querySelector('.od-bar-online');
    var warningBar = group.querySelector('.od-bar-warning');
    var offlineBar = group.querySelector('.od-bar-offline');

    if (onlineBar) onlineBar.style.height = Math.max(5, Math.min(95, onlinePercent + variation)) + '%';
    if (warningBar) warningBar.style.height = Math.max(2, warningPercent + (variation / 2)) + '%';
    if (offlineBar) offlineBar.style.height = Math.max(2, offlinePercent + (variation / 3)) + '%';
  });
}

function updateDeviceAnalysis(devices) {
  var deviceAnalysisEl = document.getElementById('od-device-analysis');
  if (deviceAnalysisEl) deviceAnalysisEl.textContent = devices.length;

  // Count device types
  var typeCounts = {};
  devices.forEach(function(d) {
    var type = (d.type || 'Other').toLowerCase();
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });

  var total = devices.length || 1;
  var breakdownEl = document.getElementById('od-device-breakdown');
  if (breakdownEl && Object.keys(typeCounts).length > 0) {
    var colors = ['#86efac', '#93c5fd', '#fde68a', '#d8b4fe', '#fca5a5', '#a5b4fc'];
    var html = '';
    var colorIndex = 0;
    for (var type in typeCounts) {
      var percent = Math.round((typeCounts[type] / total) * 100);
      var label = type.charAt(0).toUpperCase() + type.slice(1);
      html += '<div class="od-breakdown-item">' +
        '<span class="od-breakdown-dot" style="background:' + colors[colorIndex % colors.length] + '"></span>' +
        '<span class="od-breakdown-label">' + label + '</span>' +
        '<span class="od-breakdown-value">' + percent + '%</span>' +
        '</div>';
      colorIndex++;
    }
    breakdownEl.innerHTML = html;
  }
}

function updateHealthScore(devices, online, total) {
  var healthScoreEl = document.getElementById('od-health-score');
  var uptime = total > 0 ? Math.round((online / total) * 100) : 0;

  if (healthScoreEl) healthScoreEl.textContent = uptime + '%';

  // Update donut chart
  var donutFill = document.querySelector('.od-donut-fill');
  var donutValue = document.querySelector('.od-donut-value');

  if (donutFill) {
    var circumference = 2 * Math.PI * 40; // r = 40
    var offset = circumference - (uptime / 100) * circumference;
    donutFill.style.strokeDasharray = circumference;
    donutFill.style.strokeDashoffset = offset;
    donutFill.style.stroke = uptime > 75 ? '#86efac' : uptime > 50 ? '#fde68a' : '#fca5a5';
  }

  if (donutValue) donutValue.textContent = uptime + '%';
}

function loadQuickAccessDevices() {
  var container = document.getElementById('od-quick-device-list');
  if (!container) return;

  var devices = (state.devices || []).slice(0, 6);

  if (devices.length === 0) {
    container.innerHTML = '<p class="text-muted" style="font-size: 0.8rem;">No devices available</p>';
    return;
  }

  var html = devices.map(function(d) {
    var statusClass = d.status === 'online' ? 'online' : 'offline';
    var name = (d.name || d.id || 'Device').substring(0, 8);
    return '<div class="od-device-avatar" onclick="showDeviceModal(\'' + d.id + '\')">' +
      '<div class="od-device-avatar-img ' + statusClass + '">' +
      '<i data-lucide="printer"></i>' +
      '</div>' +
      '<span>' + name + '</span>' +
      '</div>';
  }).join('');

  container.innerHTML = html;

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function loadRecentActivity() {
  var container = document.getElementById('od-activity-list');
  if (!container) return;

  // Combine traps and service requests for activity
  var activities = [];

  // Add recent traps
  if (state.traps && state.traps.length > 0) {
    state.traps.slice(0, 3).forEach(function(trap) {
      activities.push({
        type: 'trap',
        title: trap.message || 'SNMP Alert',
        date: trap.timestamp || trap.receivedAt,
        status: trap.severity === 'critical' ? 'danger' : trap.severity === 'warning' ? 'warning' : 'success',
        icon: trap.severity === 'critical' ? 'alert-triangle' : 'bell',
        iconBg: trap.severity === 'critical' ? '#fee2e2' : trap.severity === 'warning' ? '#fef3c7' : '#dcfce7',
        iconColor: trap.severity === 'critical' ? '#dc2626' : trap.severity === 'warning' ? '#d97706' : '#16a34a'
      });
    });
  }

  // Add recent service requests
  if (state.serviceRequests && state.serviceRequests.length > 0) {
    state.serviceRequests.slice(0, 3).forEach(function(req) {
      activities.push({
        type: 'request',
        title: req.issueLabel || req.issueType || 'Service Request',
        date: req.createdAt,
        status: req.status === 'completed' ? 'success' : req.status === 'pending' ? 'warning' : 'danger',
        icon: req.status === 'completed' ? 'check-circle' : 'clipboard-list',
        iconBg: req.status === 'completed' ? '#dcfce7' : '#dbeafe',
        iconColor: req.status === 'completed' ? '#16a34a' : '#2563eb'
      });
    });
  }

  // Sort by date
  activities.sort(function(a, b) {
    return new Date(b.date) - new Date(a.date);
  });

  if (activities.length === 0) {
    container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 20px;">No recent activity</p>';
    return;
  }

  var html = activities.slice(0, 5).map(function(activity) {
    var timeAgo = getTimeAgo(activity.date);
    var statusLabel = activity.status === 'success' ? 'Completed' :
                      activity.status === 'warning' ? 'Pending' : 'Critical';

    return '<div class="od-activity-item">' +
      '<div class="od-activity-icon" style="background: ' + activity.iconBg + '; color: ' + activity.iconColor + '">' +
      '<i data-lucide="' + activity.icon + '"></i>' +
      '</div>' +
      '<div class="od-activity-info">' +
      '<span class="od-activity-title">' + escapeHtml(activity.title) + '</span>' +
      '<span class="od-activity-date">' + timeAgo + '</span>' +
      '</div>' +
      '<span class="od-activity-status ' + activity.status + '">' + statusLabel + '</span>' +
      '</div>';
  }).join('');

  container.innerHTML = html;

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function getTimeAgo(dateStr) {
  if (!dateStr) return 'Unknown';

  var date = new Date(dateStr);
  var now = new Date();
  var diffMs = now - date;
  var diffMins = Math.floor(diffMs / 60000);
  var diffHours = Math.floor(diffMs / 3600000);
  var diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
  if (diffDays < 7) return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago';

  return date.toLocaleDateString();
}

function setOverviewChartType(type, event) {
  var btns = document.querySelectorAll('.od-chart-type-btns button');
  btns.forEach(function(btn) { btn.classList.remove('active'); });
  if (event && event.target) {
    var btn = event.target.closest('button');
    if (btn) btn.classList.add('active');
  }

  // Could implement line chart view here
  updateOverviewChart();
}

// Overview Dashboard - Edit Low Supply Threshold
function editLowSupplyThreshold() {
  var currentThreshold = localStorage.getItem('lowSupplyThreshold') || '20';

  var modalHtml = '<div class="modal show" id="threshold-modal" onclick="if(event.target===this)closeThresholdModal()">' +
    '<div class="modal-container" style="max-width: 360px;">' +
    '<div class="modal-header">' +
    '<h3><i data-lucide="sliders"></i> Edit Threshold</h3>' +
    '<button class="modal-close" onclick="closeThresholdModal()"><i data-lucide="x"></i></button>' +
    '</div>' +
    '<div class="modal-body">' +
    '<div class="form-group">' +
    '<label>Low Supply Warning Threshold (%)</label>' +
    '<input type="number" id="threshold-input" class="form-control" value="' + currentThreshold + '" min="0" max="100" placeholder="Enter percentage...">' +
    '<small class="form-hint">Devices with supplies below this level will be flagged</small>' +
    '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-outline" onclick="closeThresholdModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveThreshold()"><i data-lucide="check"></i> Save</button>' +
    '</div>' +
    '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  document.getElementById('threshold-input').focus();
  document.getElementById('threshold-input').select();
}

function closeThresholdModal() {
  var modal = document.getElementById('threshold-modal');
  if (modal) modal.remove();
}

function saveThreshold() {
  var input = document.getElementById('threshold-input');
  var value = parseInt(input.value);

  if (!isNaN(value) && value >= 0 && value <= 100) {
    localStorage.setItem('lowSupplyThreshold', value);
    showToast('Low supply threshold set to ' + value + '%', 'success');
    closeThresholdModal();
    updateOverviewStats();
  } else {
    showToast('Please enter a valid percentage (0-100)', 'warning');
    input.focus();
  }
}

// Overview Dashboard - Add Goal Modal
function showAddGoalModal() {
  var modalHtml = '<div class="modal show" id="add-goal-modal" onclick="if(event.target===this)closeAddGoalModal()">' +
    '<div class="modal-container" style="max-width: 400px;">' +
    '<div class="modal-header">' +
    '<h3><i data-lucide="target"></i> Add New Goal</h3>' +
    '<button class="modal-close" onclick="closeAddGoalModal()"><i data-lucide="x"></i></button>' +
    '</div>' +
    '<div class="modal-body">' +
    '<div class="form-group">' +
    '<label>Goal Name</label>' +
    '<input type="text" id="goal-name-input" class="form-control" placeholder="e.g., Zero Downtime">' +
    '</div>' +
    '<div class="form-group">' +
    '<label>Target Value</label>' +
    '<input type="number" id="goal-target-input" class="form-control" placeholder="e.g., 30" min="1">' +
    '</div>' +
    '<div class="form-group">' +
    '<label>Current Progress</label>' +
    '<input type="number" id="goal-progress-input" class="form-control" placeholder="e.g., 18" min="0">' +
    '</div>' +
    '<div class="form-group">' +
    '<label>Category</label>' +
    '<select id="goal-category-input" class="form-control">' +
    '<option value="this-month">This Month</option>' +
    '<option value="long-term">Long Term</option>' +
    '</select>' +
    '</div>' +
    '<div class="form-group">' +
    '<label>Color</label>' +
    '<select id="goal-color-input" class="form-control">' +
    '<option value="#fbbf24">Yellow</option>' +
    '<option value="#3b82f6">Blue</option>' +
    '<option value="#22c55e">Green</option>' +
    '<option value="#ef4444">Red</option>' +
    '<option value="#8b5cf6">Purple</option>' +
    '</select>' +
    '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-outline" onclick="closeAddGoalModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveNewGoal()"><i data-lucide="plus"></i> Add Goal</button>' +
    '</div>' +
    '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  document.getElementById('goal-name-input').focus();
}

function closeAddGoalModal() {
  var modal = document.getElementById('add-goal-modal');
  if (modal) modal.remove();
}

function saveNewGoal() {
  var name = document.getElementById('goal-name-input').value.trim();
  var target = parseInt(document.getElementById('goal-target-input').value);
  var progress = parseInt(document.getElementById('goal-progress-input').value);
  var category = document.getElementById('goal-category-input').value;
  var color = document.getElementById('goal-color-input').value;

  if (!name) {
    showToast('Please enter a goal name', 'warning');
    return;
  }
  if (isNaN(target) || target < 1) {
    showToast('Please enter a valid target value', 'warning');
    return;
  }
  if (isNaN(progress)) progress = 0;

  // Load existing goals
  var goals = JSON.parse(localStorage.getItem('overviewGoals') || '[]');

  // Add new goal
  goals.push({
    id: Date.now(),
    name: name,
    target: target,
    progress: progress,
    category: category,
    color: color
  });

  // Save goals
  localStorage.setItem('overviewGoals', JSON.stringify(goals));

  closeAddGoalModal();
  showToast('Goal added successfully!', 'success');
  renderOverviewGoals();
}

function renderOverviewGoals() {
  var goalsContainer = document.querySelector('.od-goals-list');
  if (!goalsContainer) return;

  var goals = JSON.parse(localStorage.getItem('overviewGoals') || '[]');

  // Default goals if none exist
  if (goals.length === 0) {
    goals = [
      { id: 1, name: 'Zero Downtime', target: 30, progress: 18, category: 'this-month', color: '#fbbf24' },
      { id: 2, name: 'Maintenance', target: 20, progress: 12, category: 'long-term', color: '#3b82f6' },
      { id: 3, name: 'All Online', target: 24, progress: 22, category: 'long-term', color: '#22c55e' }
    ];
  }

  var thisMonthGoals = goals.filter(function(g) { return g.category === 'this-month'; });
  var longTermGoals = goals.filter(function(g) { return g.category === 'long-term'; });

  var html = '';

  if (thisMonthGoals.length > 0) {
    html += '<div class="od-goal-section"><span class="od-goal-period">This Month</span>';
    thisMonthGoals.forEach(function(goal) {
      var percent = Math.min(100, Math.round((goal.progress / goal.target) * 100));
      html += renderGoalItem(goal, percent);
    });
    html += '</div>';
  }

  if (longTermGoals.length > 0) {
    html += '<div class="od-goal-section"><span class="od-goal-period">Long Term</span>';
    longTermGoals.forEach(function(goal) {
      var percent = Math.min(100, Math.round((goal.progress / goal.target) * 100));
      html += renderGoalItem(goal, percent);
    });
    html += '</div>';
  }

  goalsContainer.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderGoalItem(goal, percent) {
  var iconBg = goal.color === '#fbbf24' ? '#fef3c7' :
               goal.color === '#3b82f6' ? '#dbeafe' :
               goal.color === '#22c55e' ? '#dcfce7' :
               goal.color === '#ef4444' ? '#fee2e2' : '#f3e8ff';

  return '<div class="od-goal-item" onclick="editGoal(' + goal.id + ')">' +
    '<div class="od-goal-icon" style="background:' + iconBg + '; color:' + goal.color + '"><i data-lucide="target"></i></div>' +
    '<div class="od-goal-info">' +
    '<span class="od-goal-name">' + escapeHtml(goal.name) + '</span>' +
    '<span class="od-goal-progress-text">' + goal.progress + '/' + goal.target + '</span>' +
    '</div>' +
    '<div class="od-goal-bar">' +
    '<div class="od-goal-fill" style="width: ' + percent + '%; background: ' + goal.color + '"></div>' +
    '</div>' +
    '</div>';
}

function editGoal(goalId) {
  var goals = JSON.parse(localStorage.getItem('overviewGoals') || '[]');
  var goal = goals.find(function(g) { return g.id === goalId; });

  if (!goal) {
    showToast('Goal not found', 'error');
    return;
  }

  var percent = Math.round((goal.progress / goal.target) * 100);

  var modalHtml = '<div class="modal show" id="edit-goal-modal" onclick="if(event.target===this)closeEditGoalModal()">' +
    '<div class="modal-container" style="max-width: 380px;">' +
    '<div class="modal-header">' +
    '<h3><i data-lucide="edit-3"></i> Edit Goal</h3>' +
    '<button class="modal-close" onclick="closeEditGoalModal()"><i data-lucide="x"></i></button>' +
    '</div>' +
    '<div class="modal-body">' +
    '<div class="od-goal-preview" style="background: var(--bg-tertiary); padding: 16px; border-radius: 12px; margin-bottom: 16px;">' +
    '<h4 style="margin: 0 0 8px; font-size: 1rem;">' + escapeHtml(goal.name) + '</h4>' +
    '<div style="display: flex; align-items: center; gap: 12px;">' +
    '<div style="flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;">' +
    '<div style="width: ' + percent + '%; height: 100%; background: ' + goal.color + '; border-radius: 4px;"></div>' +
    '</div>' +
    '<span style="font-size: 0.875rem; color: var(--text-secondary);">' + percent + '%</span>' +
    '</div>' +
    '</div>' +
    '<div class="form-group">' +
    '<label>Current Progress</label>' +
    '<input type="number" id="edit-goal-progress" class="form-control" value="' + goal.progress + '" min="0">' +
    '</div>' +
    '<div class="form-group">' +
    '<label>Target</label>' +
    '<input type="number" id="edit-goal-target" class="form-control" value="' + goal.target + '" min="1">' +
    '</div>' +
    '</div>' +
    '<div class="modal-footer" style="justify-content: space-between;">' +
    '<button class="btn btn-outline" style="color: var(--danger); border-color: var(--danger);" onclick="deleteGoal(' + goalId + ')"><i data-lucide="trash-2"></i> Delete</button>' +
    '<div style="display: flex; gap: 8px;">' +
    '<button class="btn btn-outline" onclick="closeEditGoalModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveEditedGoal(' + goalId + ')"><i data-lucide="check"></i> Save</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  document.getElementById('edit-goal-progress').focus();
  document.getElementById('edit-goal-progress').select();
}

function closeEditGoalModal() {
  var modal = document.getElementById('edit-goal-modal');
  if (modal) modal.remove();
}

function saveEditedGoal(goalId) {
  var goals = JSON.parse(localStorage.getItem('overviewGoals') || '[]');
  var goal = goals.find(function(g) { return g.id === goalId; });

  if (!goal) {
    showToast('Goal not found', 'error');
    closeEditGoalModal();
    return;
  }

  var newProgress = parseInt(document.getElementById('edit-goal-progress').value);
  var newTarget = parseInt(document.getElementById('edit-goal-target').value);

  if (isNaN(newProgress) || newProgress < 0) {
    showToast('Please enter a valid progress value', 'warning');
    return;
  }

  if (isNaN(newTarget) || newTarget < 1) {
    showToast('Please enter a valid target value', 'warning');
    return;
  }

  goal.progress = newProgress;
  goal.target = newTarget;
  localStorage.setItem('overviewGoals', JSON.stringify(goals));

  showToast('Goal updated!', 'success');
  closeEditGoalModal();
  renderOverviewGoals();
}

function deleteGoal(goalId) {
  showConfirmModal(
    'Delete Goal',
    'Are you sure you want to delete this goal? This cannot be undone.',
    function() {
      var goals = JSON.parse(localStorage.getItem('overviewGoals') || '[]');
      goals = goals.filter(function(g) { return g.id !== goalId; });
      localStorage.setItem('overviewGoals', JSON.stringify(goals));
      showToast('Goal deleted', 'info');
      closeEditGoalModal();
      renderOverviewGoals();
    },
    'Delete',
    'danger'
  );
}

// Overview Dashboard - More Actions Menu
function showOverviewMoreMenu(event) {
  event.stopPropagation();

  // Remove existing menu if any
  var existingMenu = document.getElementById('od-more-menu');
  if (existingMenu) {
    existingMenu.remove();
    return;
  }

  var menuHtml = '<div id="od-more-menu" class="od-dropdown-menu">' +
    '<button onclick="exportOverviewReport()"><i data-lucide="download"></i> Export Report</button>' +
    '<button onclick="switchTab(\'settings\')"><i data-lucide="settings"></i> Settings</button>' +
    '<button onclick="loadOverviewDashboard()"><i data-lucide="refresh-cw"></i> Refresh Data</button>' +
    '<button onclick="resetOverviewData()"><i data-lucide="trash-2"></i> Reset Goals</button>' +
    '</div>';

  event.target.closest('.od-card').insertAdjacentHTML('beforeend', menuHtml);

  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Close menu on outside click
  setTimeout(function() {
    document.addEventListener('click', closeOverviewMoreMenu, { once: true });
  }, 10);
}

function closeOverviewMoreMenu() {
  var menu = document.getElementById('od-more-menu');
  if (menu) menu.remove();
}

function exportOverviewReport() {
  closeOverviewMoreMenu();

  var devices = state.devices || [];
  var online = devices.filter(function(d) { return d.status === 'online'; }).length;
  var offline = devices.filter(function(d) { return d.status === 'offline'; }).length;
  var issues = devices.filter(function(d) { return d.status === 'warning' || d.status === 'error'; }).length;

  var report = 'SMART SCHOOL MONITOR - OVERVIEW REPORT\n';
  report += 'Generated: ' + new Date().toLocaleString() + '\n';
  report += '========================================\n\n';
  report += 'DEVICE STATUS\n';
  report += '-------------\n';
  report += 'Total Devices: ' + devices.length + '\n';
  report += 'Online: ' + online + '\n';
  report += 'Offline: ' + offline + '\n';
  report += 'Issues: ' + issues + '\n\n';

  // Add goals
  var goals = JSON.parse(localStorage.getItem('overviewGoals') || '[]');
  if (goals.length > 0) {
    report += 'GOALS\n';
    report += '-----\n';
    goals.forEach(function(goal) {
      var percent = Math.round((goal.progress / goal.target) * 100);
      report += goal.name + ': ' + goal.progress + '/' + goal.target + ' (' + percent + '%)\n';
    });
  }

  // Download as text file
  var blob = new Blob([report], { type: 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'overview-report-' + new Date().toISOString().split('T')[0] + '.txt';
  a.click();
  URL.revokeObjectURL(url);

  showToast('Report downloaded!', 'success');
}

function resetOverviewData() {
  closeOverviewMoreMenu();

  showConfirmModal(
    'Reset Goals',
    'Are you sure you want to reset all goals? This cannot be undone.',
    function() {
      localStorage.removeItem('overviewGoals');
      showToast('Goals have been reset', 'info');
      renderOverviewGoals();
    },
    'Reset',
    'danger'
  );
}

// Reusable Confirm Modal for Overview Dashboard
function showConfirmModal(title, message, onConfirm, confirmText, confirmStyle) {
  confirmText = confirmText || 'Confirm';
  confirmStyle = confirmStyle || 'primary';

  var btnClass = confirmStyle === 'danger' ? 'btn-danger' : 'btn-primary';

  var modalHtml = '<div class="modal show" id="confirm-modal" onclick="if(event.target===this)closeConfirmModal()">' +
    '<div class="modal-container" style="max-width: 380px;">' +
    '<div class="modal-header">' +
    '<h3><i data-lucide="alert-circle"></i> ' + escapeHtml(title) + '</h3>' +
    '<button class="modal-close" onclick="closeConfirmModal()"><i data-lucide="x"></i></button>' +
    '</div>' +
    '<div class="modal-body">' +
    '<p style="color: var(--text-secondary); margin: 0;">' + escapeHtml(message) + '</p>' +
    '</div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-outline" onclick="closeConfirmModal()">Cancel</button>' +
    '<button class="btn ' + btnClass + '" id="confirm-modal-btn">' + escapeHtml(confirmText) + '</button>' +
    '</div>' +
    '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Set up confirm button click handler
  document.getElementById('confirm-modal-btn').onclick = function() {
    closeConfirmModal();
    if (typeof onConfirm === 'function') {
      onConfirm();
    }
  };
}

function closeConfirmModal() {
  var modal = document.getElementById('confirm-modal');
  if (modal) modal.remove();
}

// Overview Dashboard - Add Quick Action
function showAddQuickAction() {
  showToast('Quick actions can be customized in Settings > Dashboard', 'info');
  // Could implement a modal to add custom quick actions here
}

// ============================================
// Live Activity - Real-time Device Status
// ============================================

// Live activity polling interval tracker
var liveActivityIntervals = {};

/**
 * Refresh live activity data for a device by polling the SNMP gateway
 * @param {string} deviceId - Device ID
 * @param {string} deviceIp - Device IP address
 * @param {boolean} isAutoRefresh - If true, don't show loading spinner (silent refresh)
 */
function refreshLiveActivity(deviceId, deviceIp, isAutoRefresh) {
  var contentEl = document.getElementById('live-activity-content-' + deviceId);
  var refreshBtn = document.getElementById('refresh-btn-' + deviceId);

  if (!contentEl) {
    // Modal was closed, stop polling
    stopLiveActivityPolling(deviceId);
    return;
  }

  // If gateway is not online (remote mode or offline), show cached data instead
  if (!state.gatewayOnline) {
    renderLiveActivityRemote(deviceId);
    if (refreshBtn) refreshBtn.classList.remove('spinning');
    return;
  }

  // Only show loading on first load, not auto-refresh
  if (!isAutoRefresh) {
    contentEl.innerHTML = '<div class="activity-loading"><i data-lucide="loader" class="spin"></i> Checking device status...</div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  if (refreshBtn) {
    refreshBtn.classList.add('spinning');
  }

  // Get gateway URL from settings
  var gatewayUrl = state.emailConfig.snmpGatewayUrl || 'http://localhost:5017';

  // Fetch live status from SNMP gateway
  fetch(gatewayUrl + '/device/' + deviceIp + '/status', {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  })
  .then(function(response) {
    if (!response.ok) throw new Error('Gateway returned ' + response.status);
    return response.json();
  })
  .then(function(data) {
    renderLiveActivity(deviceId, data);
    if (refreshBtn) refreshBtn.classList.remove('spinning');

    // Start auto-refresh polling if not already running
    startLiveActivityPolling(deviceId, deviceIp);
  })
  .catch(function(err) {
    console.error('Live activity fetch error:', err);
    // If fetch fails, show remote/cached view instead of a raw error
    if (state.isRemote) {
      renderLiveActivityRemote(deviceId);
    } else {
      renderLiveActivityError(deviceId, err.message);
    }
    if (refreshBtn) refreshBtn.classList.remove('spinning');
  });
}

/**
 * Start auto-refresh polling for live activity (every 3 seconds)
 */
function startLiveActivityPolling(deviceId, deviceIp) {
  // Don't start if already polling
  if (liveActivityIntervals[deviceId]) return;

  liveActivityIntervals[deviceId] = setInterval(function() {
    refreshLiveActivity(deviceId, deviceIp, true);
  }, 3000);
}

/**
 * Stop auto-refresh polling for a device
 */
function stopLiveActivityPolling(deviceId) {
  if (liveActivityIntervals[deviceId]) {
    clearInterval(liveActivityIntervals[deviceId]);
    delete liveActivityIntervals[deviceId];
  }
}

/**
 * Stop all live activity polling (call when modal closes)
 */
function stopAllLiveActivityPolling() {
  Object.keys(liveActivityIntervals).forEach(function(deviceId) {
    stopLiveActivityPolling(deviceId);
  });
}

/**
 * Render the live activity data in the modal
 * @param {string} deviceId - Device ID
 * @param {object} data - Status data from SNMP gateway
 */
function renderLiveActivity(deviceId, data) {
  var contentEl = document.getElementById('live-activity-content-' + deviceId);
  if (!contentEl) return;

  var html = '';

  // Device Status - Big Status Indicator
  var statusClass = 'idle';
  var statusText = 'Unknown';
  var statusIcon = 'circle';
  var isPrinting = false;

  if (data.printerStatus) {
    var status = parseInt(data.printerStatus);
    switch(status) {
      case 1: statusText = 'Other'; statusClass = 'unknown'; statusIcon = 'help-circle'; break;
      case 2: statusText = 'Unknown'; statusClass = 'unknown'; statusIcon = 'help-circle'; break;
      case 3: statusText = 'Idle'; statusClass = 'idle'; statusIcon = 'check-circle'; break;
      case 4: statusText = 'IN USE - PRINTING'; statusClass = 'printing'; statusIcon = 'printer'; isPrinting = true; break;
      case 5: statusText = 'Warming Up'; statusClass = 'warmup'; statusIcon = 'sun'; break;
      default: statusText = 'Status ' + status; statusClass = 'unknown'; statusIcon = 'circle';
    }
  } else if (data.statusMessage) {
    // Sharp proprietary status
    var msg = data.statusMessage.toLowerCase();
    if (msg.includes('normal') || msg.includes('idle') || msg.includes('ready')) {
      statusText = 'Idle';
      statusClass = 'idle';
      statusIcon = 'check-circle';
    } else if (msg.includes('print') || msg.includes('busy') || msg.includes('processing')) {
      statusText = 'IN USE - PRINTING';
      statusClass = 'printing';
      statusIcon = 'printer';
      isPrinting = true;
    } else if (msg.includes('warm')) {
      statusText = 'Warming Up';
      statusClass = 'warmup';
      statusIcon = 'sun';
    } else if (msg.includes('copy')) {
      statusText = 'IN USE - COPYING';
      statusClass = 'printing';
      statusIcon = 'copy';
      isPrinting = true;
    } else if (msg.includes('scan')) {
      statusText = 'IN USE - SCANNING';
      statusClass = 'printing';
      statusIcon = 'scan';
      isPrinting = true;
    } else {
      statusText = data.statusMessage;
      statusClass = 'unknown';
      statusIcon = 'circle';
    }
  }

  // Big prominent status display
  if (isPrinting) {
    html += '<div class="live-status-active">';
    html += '<div class="active-icon-pulse"><i data-lucide="' + statusIcon + '"></i></div>';
    html += '<div class="active-text">' + escapeHtml(statusText) + '</div>';
    html += '<div class="active-subtext">Someone is using this device right now</div>';
    html += '</div>';
  } else {
    html += '<div class="live-status-idle">';
    html += '<div class="idle-icon"><i data-lucide="' + statusIcon + '"></i></div>';
    html += '<div class="idle-text">' + escapeHtml(statusText) + '</div>';
    html += '<div class="idle-subtext">Device is available</div>';
    html += '</div>';
  }

  // Last updated time
  html += '<div class="live-updated">';
  html += '<span>Auto-refreshing every 3s</span>';
  if (data.responseTime) {
    html += '<span class="live-ping"><i data-lucide="activity"></i> ' + data.responseTime + 'ms</span>';
  }
  html += '</div>';

  contentEl.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Render error state for live activity
 * @param {string} deviceId - Device ID
 * @param {string} errorMsg - Error message
 */
function renderLiveActivityError(deviceId, errorMsg) {
  var contentEl = document.getElementById('live-activity-content-' + deviceId);
  if (!contentEl) return;

  var html = '<div class="live-activity-error">';
  html += '<i data-lucide="wifi-off"></i>';
  html += '<span>Could not fetch live status</span>';
  html += '<small>' + escapeHtml(errorMsg) + '</small>';
  html += '</div>';

  contentEl.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Render remote access mode for live activity — shows cached data from Google Sheets
 * @param {string} deviceId - Device ID
 */
function renderLiveActivityRemote(deviceId) {
  var contentEl = document.getElementById('live-activity-content-' + deviceId);
  if (!contentEl) return;

  // Get cached device data from state
  var device = state.devices.find(function(d) { return d.id === deviceId; });
  var html = '';

  if (device) {
    // Show cached status
    var statusText = device.status || 'Unknown';
    var statusClass = 'unknown';
    var statusIcon = 'globe';

    if (statusText === 'online') { statusClass = 'idle'; statusIcon = 'check-circle'; statusText = 'Online (Last Known)'; }
    else if (statusText === 'offline') { statusClass = 'offline'; statusIcon = 'x-circle'; statusText = 'Offline (Last Known)'; }
    else if (statusText === 'issue') { statusClass = 'warning'; statusIcon = 'alert-triangle'; statusText = 'Issue (Last Known)'; }

    html += '<div class="live-status-idle">';
    html += '<div class="idle-icon"><i data-lucide="' + statusIcon + '"></i></div>';
    html += '<div class="idle-text">' + escapeHtml(statusText) + '</div>';
    html += '<div class="idle-subtext" style="color: var(--primary);">';
    html += '<i data-lucide="globe" style="width:14px;height:14px;display:inline;vertical-align:middle;margin-right:4px;"></i>';
    html += 'Remote access — showing cached data from Google Sheets</div>';
    html += '</div>';

    // Show last seen time
    if (device.lastSeen) {
      var lastSeenDate = new Date(device.lastSeen);
      var timeAgo = getTimeAgo(lastSeenDate);
      html += '<div class="live-updated">';
      html += '<span>Last updated: ' + timeAgo + '</span>';
      html += '</div>';
    }
  } else {
    html += '<div class="live-status-idle">';
    html += '<div class="idle-icon"><i data-lucide="globe"></i></div>';
    html += '<div class="idle-text">Remote Access Mode</div>';
    html += '<div class="idle-subtext">Live polling unavailable — viewing cached data</div>';
    html += '</div>';
  }

  contentEl.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Get human-readable time ago string
 */
function getTimeAgo(date) {
  var now = new Date();
  // Handle string dates (ISO format), Date objects, and timestamps
  var then;
  if (date instanceof Date) {
    then = date;
  } else if (typeof date === 'string' && date.trim()) {
    then = new Date(date);
  } else if (typeof date === 'number') {
    then = new Date(date);
  } else {
    return '';
  }
  // Check for invalid dates
  if (isNaN(then.getTime())) return '';
  var diffMs = now - then;
  if (diffMs < 0) return 'just now';
  var diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return diffMins + ' min ago';
  var diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return diffHours + 'h ago';
  var diffDays = Math.floor(diffHours / 24);
  return diffDays + 'd ago';
}

/**
 * Format large numbers with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
function formatNumber(num) {
  if (num === undefined || num === null) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* =========================================================================
   DEBUG CONSOLE - Test every function in the system
   ========================================================================= */

var debugTests = [];
var debugResults = { total: 0, passed: 0, failed: 0, skipped: 0 };
var debugStartTime = 0;

/**
 * Define all test categories and tests
 */
function getDebugTestDefinitions() {
  return [
    {
      category: 'Initialization & Core',
      icon: 'power',
      tests: [
        { name: 'getSpreadsheet()', desc: 'Get spreadsheet reference', fn: function() { return serverCall('getSettings'); } },
        { name: 'initializeSpreadsheet()', desc: 'Verify sheet structure exists', fn: function() { return serverCall('getSheetStats'); } }
      ]
    },
    {
      category: 'Device Management',
      icon: 'printer',
      tests: [
        { name: 'getDevices()', desc: 'Fetch all devices', fn: function() { return serverCall('getDevices', null, function(r) { return Array.isArray(r) ? r.length + ' devices loaded' : 'Unexpected format'; }); } },
        { name: 'getDeviceTypes()', desc: 'Fetch device types', fn: function() { return serverCall('getDeviceTypes', null, function(r) { return Array.isArray(r) ? r.length + ' types loaded' : 'Unexpected format'; }); } },
        { name: 'getDeviceTypeById()', desc: 'Fetch single device type', fn: function() {
          return new Promise(function(resolve) {
            google.script.run.withSuccessHandler(function(types) {
              if (!types || !types.length) return resolve({ pass: true, msg: 'No device types to test (skipped)' });
              google.script.run.withSuccessHandler(function(dt) {
                resolve({ pass: !!dt, msg: dt ? 'Got: ' + (dt.name || dt.id) : 'Not found' });
              }).withFailureHandler(function(e) { resolve({ pass: false, msg: e.message }); }).getDeviceTypeById(types[0].id);
            }).withFailureHandler(function(e) { resolve({ pass: false, msg: e.message }); }).getDeviceTypes();
          });
        }},
        { name: 'saveDevice() [dry]', desc: 'Verify save function exists', fn: function() { return fnExists('saveDevice'); } }
      ]
    },
    {
      category: 'SNMP Traps & Alerts',
      icon: 'bell',
      tests: [
        { name: 'getTraps()', desc: 'Fetch trap records', fn: function() { return serverCall('getTraps', [50], function(r) { return Array.isArray(r) ? r.length + ' traps loaded' : 'Unexpected format'; }); } },
        { name: 'getTrapsWithAssignments()', desc: 'Fetch traps with tech assignments', fn: function() { return serverCall('getTrapsWithAssignments', [50], function(r) { return Array.isArray(r) ? r.length + ' traps loaded' : 'Unexpected format'; }); } },
        { name: 'reprocessAllTraps()', desc: 'Reprocess trap alert messages', fn: function() { return serverCall('reprocessAllTraps', null, function(r) { return r ? 'Processed: ' + JSON.stringify(r).substring(0, 80) : 'Done'; }); } }
      ]
    },
    {
      category: 'Email Configuration',
      icon: 'mail',
      tests: [
        { name: 'getEmailConfig()', desc: 'Fetch email settings', fn: function() { return serverCall('getEmailConfig', null, function(r) { return r ? 'Config loaded' : 'Empty config'; }); } },
        { name: 'getEmailTemplates()', desc: 'Fetch email templates', fn: function() { return serverCall('getEmailTemplates', null, function(r) { return Array.isArray(r) ? r.length + ' templates' : 'Loaded'; }); } },
        { name: 'testEmailAuthorization()', desc: 'Test email auth', fn: function() { return serverCall('testEmailAuthorization', null, function(r) { return r ? JSON.stringify(r).substring(0, 80) : 'OK'; }); } }
      ]
    },
    {
      category: 'Settings & Configuration',
      icon: 'settings',
      tests: [
        { name: 'getSettings()', desc: 'Fetch all settings', fn: function() { return serverCall('getSettings', null, function(r) { return r ? Object.keys(r).length + ' settings loaded' : 'Empty'; }); } },
        { name: 'getAfterHoursSettings()', desc: 'Fetch after-hours config', fn: function() { return serverCall('getAfterHoursSettings', null, function(r) { return r ? 'After-hours config loaded' : 'No config'; }); } },
        { name: 'getWorkingHoursStatus()', desc: 'Check working hours', fn: function() { return serverCall('getWorkingHoursStatus', null, function(r) { return r || 'Status returned'; }); } },
        { name: 'isPasswordProtected()', desc: 'Check password protection', fn: function() { return serverCall('isPasswordProtected', null, function(r) { return 'Protected: ' + r; }); } }
      ]
    },
    {
      category: 'Blueprint Management',
      icon: 'map',
      tests: [
        { name: 'getBlueprints()', desc: 'Fetch floor plans', fn: function() { return serverCall('getBlueprints', null, function(r) { return Array.isArray(r) ? r.length + ' blueprints' : 'Loaded'; }); } },
        { name: 'BlueprintDB.init()', desc: 'Initialize IndexedDB', fn: function() {
          return new Promise(function(resolve) {
            try {
              if (typeof BlueprintDB !== 'undefined' && BlueprintDB.init) {
                BlueprintDB.init().then(function() { resolve({ pass: true, msg: 'IndexedDB initialized' }); }).catch(function(e) { resolve({ pass: false, msg: e.message }); });
              } else { resolve({ pass: true, msg: 'BlueprintDB not available (OK)' }); }
            } catch(e) { resolve({ pass: false, msg: e.message }); }
          });
        }},
        { name: 'getLabelLayout()', desc: 'Fetch QR label layout', fn: function() { return serverCall('getLabelLayout', null, function(r) { return r ? 'Layout loaded (v' + (r.version || '?') + ')' : 'Default layout'; }); } }
      ]
    },
    {
      category: 'Technician Management',
      icon: 'wrench',
      tests: [
        { name: 'getTechnicians()', desc: 'Fetch technician list', fn: function() { return serverCall('getTechnicians', null, function(r) { return Array.isArray(r) ? r.length + ' technicians' : 'Loaded'; }); } }
      ]
    },
    {
      category: 'Teacher Management',
      icon: 'graduation-cap',
      tests: [
        { name: 'getTeachers()', desc: 'Fetch teacher list', fn: function() { return serverCall('getTeachers', null, function(r) { return Array.isArray(r) ? r.length + ' teachers' : 'Loaded'; }); } },
        { name: 'exportTeachers()', desc: 'Export teachers data', fn: function() { return serverCall('exportTeachers', null, function(r) { return r ? 'Export ready (' + (r.length || 0) + ' chars)' : 'Empty export'; }); } }
      ]
    },
    {
      category: 'Service Requests',
      icon: 'clipboard-list',
      tests: [
        { name: 'getServiceRequests()', desc: 'Fetch service requests', fn: function() { return serverCall('getServiceRequests', [50], function(r) { return Array.isArray(r) ? r.length + ' requests' : 'Loaded'; }); } },
        { name: 'getPendingServiceRequests()', desc: 'Fetch pending requests', fn: function() { return serverCall('getPendingServiceRequests', null, function(r) { return Array.isArray(r) ? r.length + ' pending' : 'Loaded'; }); } }
      ]
    },
    {
      category: 'QR Codes',
      icon: 'qr-code',
      tests: [
        { name: 'getQRCodes()', desc: 'Fetch QR code records', fn: function() { return serverCall('getQRCodes', null, function(r) { return Array.isArray(r) ? r.length + ' QR codes' : 'Loaded'; }); } },
        { name: 'getWebAppUrl()', desc: 'Get deployed web app URL', fn: function() { return serverCall('getWebAppUrl', null, function(r) { return r ? r.substring(0, 60) + '...' : 'No URL'; }); } }
      ]
    },
    {
      category: 'Issue Buttons',
      icon: 'circle-alert',
      tests: [
        { name: 'getIssueButtons()', desc: 'Fetch issue button definitions', fn: function() { return serverCall('getIssueButtons', null, function(r) { return Array.isArray(r) ? r.length + ' buttons' : 'Loaded'; }); } }
      ]
    },
    {
      category: 'Email History',
      icon: 'mail-open',
      tests: [
        { name: 'getEmailHistory()', desc: 'Fetch email log', fn: function() { return serverCall('getEmailHistory', null, function(r) { return Array.isArray(r) ? r.length + ' emails' : 'Loaded'; }); } }
      ]
    },
    {
      category: 'Incidents & Help Desk',
      icon: 'headphones',
      tests: [
        { name: 'getIncidents()', desc: 'Fetch incidents', fn: function() { return serverCall('getIncidents', [50], function(r) { return Array.isArray(r) ? r.length + ' incidents' : 'Loaded'; }); } },
        { name: 'getEmailQueue()', desc: 'Fetch email queue', fn: function() { return serverCall('getEmailQueue', null, function(r) { return Array.isArray(r) ? r.length + ' queued emails' : 'Loaded'; }); } },
        { name: 'classifyIncident()', desc: 'Test AI classification', fn: function() { return serverCall('classifyIncident', ['printer paper jam in room 204', 'Test User', '204'], function(r) { return r ? 'Category: ' + (r.category || 'none') + ' / ' + (r.subcategory || 'none') : 'No result'; }); } }
      ]
    },
    {
      category: 'Computer Repairs',
      icon: 'laptop',
      tests: [
        { name: 'getComputerRepairs()', desc: 'Fetch repair tickets', fn: function() { return serverCall('getComputerRepairs', [50], function(r) { return Array.isArray(r) ? r.length + ' repairs' : 'Loaded'; }); } },
        { name: 'classifyComputerRepair()', desc: 'Test repair classification', fn: function() { return serverCall('classifyComputerRepair', ['laptop screen cracked'], function(r) { return r ? 'Category: ' + (r.category || 'none') : 'No result'; }); } }
      ]
    },
    {
      category: 'Analytics & Data',
      icon: 'bar-chart-3',
      tests: [
        { name: 'getSheetStats()', desc: 'Fetch sheet statistics', fn: function() { return serverCall('getSheetStats', null, function(r) { return r ? Object.keys(r).length + ' sheets reported' : 'No stats'; }); } },
        { name: 'getAnalyticsData()', desc: 'Fetch analytics data', fn: function() { return serverCall('getAnalyticsData', null, function(r) { return r ? 'Analytics loaded' : 'No data'; }); } },
        { name: 'getTrainingData()', desc: 'Fetch AI training data', fn: function() { return serverCall('getTrainingData', null, function(r) { return Array.isArray(r) ? r.length + ' entries' : 'Loaded'; }); } },
        { name: 'exportAllData()', desc: 'Test full data export', fn: function() { return serverCall('exportAllData', null, function(r) { return r ? 'Export ready (' + Object.keys(r).length + ' sections)' : 'Empty'; }); } }
      ]
    },
    {
      category: 'SNMP Gateway',
      icon: 'radio-tower',
      tests: [
        { name: 'Gateway Health', desc: 'Check gateway /health endpoint', fn: function() {
          return new Promise(function(resolve) {
            var url = (typeof gatewayControllerUrl !== 'undefined' ? gatewayControllerUrl : 'http://localhost:5018') ;
            fetch(url.replace(':5018', ':5017') + '/health', { signal: AbortSignal.timeout(5000) })
              .then(function(r) { return r.json(); })
              .then(function(d) { resolve({ pass: d.status === 'online', msg: 'Status: ' + d.status + ', Devices: ' + d.devicesCount + ', Uptime: ' + Math.round(d.uptime) + 's' }); })
              .catch(function(e) { resolve({ pass: false, msg: 'Gateway unreachable: ' + e.message }); });
          });
        }},
        { name: 'Gateway Controller', desc: 'Check controller /status', fn: function() {
          return new Promise(function(resolve) {
            var url = (typeof gatewayControllerUrl !== 'undefined' ? gatewayControllerUrl : 'http://localhost:5018');
            fetch(url + '/status', { signal: AbortSignal.timeout(5000) })
              .then(function(r) { return r.json(); })
              .then(function(d) { resolve({ pass: true, msg: 'Controller online, Gateway PID: ' + (d.pid || 'none') }); })
              .catch(function(e) { resolve({ pass: false, msg: 'Controller unreachable: ' + e.message }); });
          });
        }}
      ]
    },
    {
      category: 'Client-Side Functions',
      icon: 'code',
      tests: [
        { name: 'renderDashboard()', desc: 'Render main dashboard', fn: function() { return clientTest(function() { renderDashboard(); }, 'Dashboard rendered'); } },
        { name: 'renderDeviceTable()', desc: 'Render device table', fn: function() { return clientTest(function() { renderDeviceTable(); }, 'Device table rendered'); } },
        { name: 'renderTrapsList()', desc: 'Render traps list', fn: function() { return clientTest(function() { renderTrapsList(); }, 'Traps list rendered'); } },
        { name: 'updateAllStats()', desc: 'Update dashboard stats', fn: function() { return clientTest(function() { updateAllStats(); }, 'Stats updated'); } },
        { name: 'renderDeviceMarkers()', desc: 'Render map markers', fn: function() { return clientTest(function() { renderDeviceMarkers(); }, 'Markers rendered'); } },
        { name: 'AudioAlert.init()', desc: 'Initialize audio system', fn: function() {
          return new Promise(function(resolve) {
            try {
              if (typeof AudioAlert !== 'undefined' && AudioAlert.init) {
                AudioAlert.init();
                resolve({ pass: true, msg: 'Audio initialized' });
              } else { resolve({ pass: true, msg: 'AudioAlert not available (OK)' }); }
            } catch(e) { resolve({ pass: false, msg: e.message }); }
          });
        }},
        { name: 'escapeHtml()', desc: 'Test HTML escaping', fn: function() {
          return new Promise(function(resolve) {
            try {
              var testStr = '<div onclick="alert(1)">&amp;</div>';
              var result = escapeHtml(testStr);
              var pass = result.indexOf('<div') === -1 && result.indexOf('&amp;amp;') > -1;
              resolve({ pass: pass, msg: pass ? 'HTML properly escaped' : 'FAILED to escape' });
            } catch(e) { resolve({ pass: false, msg: e.message }); }
          });
        }},
        { name: 'getTimeAgo()', desc: 'Test time formatting', fn: function() {
          return new Promise(function(resolve) {
            try {
              var result = getTimeAgo(new Date(Date.now() - 300000));
              resolve({ pass: result.indexOf('min') > -1, msg: 'Result: ' + result });
            } catch(e) { resolve({ pass: false, msg: e.message }); }
          });
        }},
        { name: 'calculateDeviceHealth()', desc: 'Test health calculation', fn: function() {
          return new Promise(function(resolve) {
            try {
              var mockDevice = { status: 'online', supplies: [{ name: 'Black Toner', percentage: 75 }] };
              var score = calculateDeviceHealth(mockDevice);
              resolve({ pass: typeof score === 'number' && score >= 0 && score <= 100, msg: 'Health score: ' + score });
            } catch(e) { resolve({ pass: false, msg: e.message }); }
          });
        }}
      ]
    }
  ];
}

/**
 * Helper: wrap a google.script.run call as a promise
 */
function serverCall(fnName, args, formatter) {
  return new Promise(function(resolve) {
    var runner = google.script.run
      .withSuccessHandler(function(result) {
        var msg = formatter ? formatter(result) : 'OK';
        resolve({ pass: true, msg: msg });
      })
      .withFailureHandler(function(err) {
        resolve({ pass: false, msg: err.message || String(err) });
      });
    if (args && args.length) {
      runner[fnName].apply(runner, args);
    } else {
      runner[fnName]();
    }
  });
}

/**
 * Helper: test a client-side function
 */
function clientTest(fn, successMsg) {
  return new Promise(function(resolve) {
    try {
      fn();
      resolve({ pass: true, msg: successMsg });
    } catch(e) {
      resolve({ pass: false, msg: e.message });
    }
  });
}

/**
 * Helper: check if a server function exists
 */
function fnExists(name) {
  return new Promise(function(resolve) {
    var exists = typeof google.script.run[name] === 'function';
    resolve({ pass: exists, msg: exists ? 'Function exists' : 'Function not found' });
  });
}

/**
 * Render the debug test categories
 */
function debugRenderCategories() {
  var container = document.getElementById('debug-test-categories');
  if (!container) return;
  var defs = getDebugTestDefinitions();
  var html = '';
  for (var i = 0; i < defs.length; i++) {
    var cat = defs[i];
    html += '<div class="debug-category" id="debug-cat-' + i + '">';
    html += '<div class="debug-category-header" onclick="debugToggleCategory(' + i + ')">';
    html += '<div style="display:flex; align-items:center; gap:10px;">';
    html += '<i data-lucide="' + cat.icon + '" style="width:18px; height:18px;"></i>';
    html += '<span style="font-weight:600; font-size:14px;">' + cat.category + '</span>';
    html += '<span class="debug-cat-badge" id="debug-cat-badge-' + i + '" style="font-size:11px; padding:2px 8px; border-radius:10px; background:var(--bg-tertiary); color:var(--text-muted);">' + cat.tests.length + ' tests</span>';
    html += '</div>';
    html += '<div style="display:flex; align-items:center; gap:8px;">';
    html += '<button class="btn btn-outline" style="padding:4px 12px; font-size:12px;" onclick="event.stopPropagation(); debugRunCategory(' + i + ')"><i data-lucide="play" style="width:12px; height:12px;"></i> Run</button>';
    html += '<i data-lucide="chevron-down" class="debug-chevron" style="width:16px; height:16px; transition:transform 0.2s;"></i>';
    html += '</div>';
    html += '</div>';
    html += '<div class="debug-category-body" id="debug-cat-body-' + i + '" style="display:none;">';
    for (var j = 0; j < cat.tests.length; j++) {
      var test = cat.tests[j];
      html += '<div class="debug-test-row" id="debug-test-' + i + '-' + j + '">';
      html += '<div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">';
      html += '<div class="debug-status-dot" id="debug-dot-' + i + '-' + j + '"></div>';
      html += '<div style="min-width:0;">';
      html += '<div style="font-size:13px; font-weight:500; font-family:monospace;">' + escapeHtml(test.name) + '</div>';
      html += '<div style="font-size:11px; color:var(--text-muted);">' + escapeHtml(test.desc) + '</div>';
      html += '</div>';
      html += '</div>';
      html += '<div style="display:flex; align-items:center; gap:8px;">';
      html += '<span class="debug-result-msg" id="debug-msg-' + i + '-' + j + '" style="font-size:11px; color:var(--text-muted); max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></span>';
      html += '<span class="debug-result-time" id="debug-time-' + i + '-' + j + '" style="font-size:11px; color:var(--text-muted); white-space:nowrap;"></span>';
      html += '<button class="btn btn-outline" style="padding:2px 8px; font-size:11px;" onclick="debugRunSingleTest(' + i + ',' + j + ')"><i data-lucide="play" style="width:10px; height:10px;"></i></button>';
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
    html += '</div>';
  }
  container.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Toggle category expand/collapse
 */
function debugToggleCategory(catIdx) {
  var body = document.getElementById('debug-cat-body-' + catIdx);
  if (!body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  var header = body.previousElementSibling;
  var chevron = header ? header.querySelector('.debug-chevron') : null;
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}

/**
 * Run a single test
 */
function debugRunSingleTest(catIdx, testIdx) {
  var defs = getDebugTestDefinitions();
  var test = defs[catIdx].tests[testIdx];
  var dot = document.getElementById('debug-dot-' + catIdx + '-' + testIdx);
  var msg = document.getElementById('debug-msg-' + catIdx + '-' + testIdx);
  var timeEl = document.getElementById('debug-time-' + catIdx + '-' + testIdx);
  if (dot) { dot.className = 'debug-status-dot running'; }
  if (msg) msg.textContent = 'Running...';
  if (timeEl) timeEl.textContent = '';
  var start = performance.now();
  var result;
  try {
    result = test.fn();
  } catch(e) {
    result = Promise.resolve({ pass: false, msg: e.message });
  }
  Promise.resolve(result).then(function(r) {
    var elapsed = Math.round(performance.now() - start);
    if (dot) dot.className = 'debug-status-dot ' + (r.pass ? 'pass' : 'fail');
    if (msg) { msg.textContent = r.msg || ''; msg.title = r.msg || ''; }
    if (timeEl) timeEl.textContent = elapsed + 'ms';
    return r;
  });
}

/**
 * Run all tests in a category
 */
function debugRunCategory(catIdx) {
  var defs = getDebugTestDefinitions();
  var cat = defs[catIdx];
  var body = document.getElementById('debug-cat-body-' + catIdx);
  if (body) body.style.display = 'block';
  var chevron = document.querySelector('#debug-cat-' + catIdx + ' .debug-chevron');
  if (chevron) chevron.style.transform = 'rotate(180deg)';
  var chain = Promise.resolve();
  for (var j = 0; j < cat.tests.length; j++) {
    (function(jj) {
      chain = chain.then(function() {
        return new Promise(function(resolve) {
          debugRunSingleTest(catIdx, jj);
          setTimeout(resolve, 150);
        });
      });
    })(j);
  }
}

/**
 * Run ALL tests across all categories
 */
function debugRunAllTests() {
  var defs = getDebugTestDefinitions();
  var totalTests = 0;
  for (var i = 0; i < defs.length; i++) totalTests += defs[i].tests.length;

  debugResults = { total: totalTests, passed: 0, failed: 0, skipped: 0 };
  debugStartTime = performance.now();

  // Show progress
  var progressWrap = document.getElementById('debug-progress-wrap');
  var summaryEl = document.getElementById('debug-summary');
  if (progressWrap) progressWrap.style.display = 'block';
  if (summaryEl) summaryEl.style.display = 'none';

  debugRenderCategories();

  var completed = 0;
  var chain = Promise.resolve();

  for (var ci = 0; ci < defs.length; ci++) {
    var cat = defs[ci];
    // Expand category
    (function(cc) {
      chain = chain.then(function() {
        var body = document.getElementById('debug-cat-body-' + cc);
        if (body) body.style.display = 'block';
        var chevron = document.querySelector('#debug-cat-' + cc + ' .debug-chevron');
        if (chevron) chevron.style.transform = 'rotate(180deg)';
        return Promise.resolve();
      });
    })(ci);

    for (var ti = 0; ti < cat.tests.length; ti++) {
      (function(cc, tt) {
        chain = chain.then(function() {
          return new Promise(function(resolve) {
            var test = defs[cc].tests[tt];
            var dot = document.getElementById('debug-dot-' + cc + '-' + tt);
            var msgEl = document.getElementById('debug-msg-' + cc + '-' + tt);
            var timeEl = document.getElementById('debug-time-' + cc + '-' + tt);
            if (dot) dot.className = 'debug-status-dot running';
            if (msgEl) msgEl.textContent = 'Running...';
            var start = performance.now();
            var result;
            try { result = test.fn(); } catch(e) { result = Promise.resolve({ pass: false, msg: e.message }); }
            Promise.resolve(result).then(function(r) {
              var elapsed = Math.round(performance.now() - start);
              if (dot) dot.className = 'debug-status-dot ' + (r.pass ? 'pass' : 'fail');
              if (msgEl) { msgEl.textContent = r.msg || ''; msgEl.title = r.msg || ''; }
              if (timeEl) timeEl.textContent = elapsed + 'ms';
              if (r.pass) debugResults.passed++; else debugResults.failed++;
              completed++;
              debugUpdateProgress(completed, totalTests);
              debugUpdateCategoryBadge(cc, defs[cc]);
              setTimeout(resolve, 100);
            });
          });
        });
      })(ci, ti);
    }
  }

  chain.then(function() {
    var elapsed = ((performance.now() - debugStartTime) / 1000).toFixed(1);
    if (progressWrap) progressWrap.style.display = 'none';
    debugShowSummary(elapsed);
  });
}

/**
 * Update progress bar
 */
function debugUpdateProgress(done, total) {
  var pct = Math.round((done / total) * 100);
  var bar = document.getElementById('debug-progress-bar');
  var count = document.getElementById('debug-progress-count');
  var label = document.getElementById('debug-progress-label');
  if (bar) bar.style.width = pct + '%';
  if (count) count.textContent = done + '/' + total;
  if (label) label.textContent = 'Running tests... ' + pct + '%';
}

/**
 * Update category badge with pass/fail counts
 */
function debugUpdateCategoryBadge(catIdx, catDef) {
  var badge = document.getElementById('debug-cat-badge-' + catIdx);
  if (!badge) return;
  var passed = 0, failed = 0;
  for (var j = 0; j < catDef.tests.length; j++) {
    var dot = document.getElementById('debug-dot-' + catIdx + '-' + j);
    if (dot && dot.classList.contains('pass')) passed++;
    else if (dot && dot.classList.contains('fail')) failed++;
  }
  if (failed > 0) {
    badge.textContent = passed + '/' + catDef.tests.length + ' passed';
    badge.style.background = 'var(--danger-light, #fee2e2)';
    badge.style.color = 'var(--danger)';
  } else if (passed === catDef.tests.length) {
    badge.textContent = 'All passed';
    badge.style.background = 'var(--success-light, #dcfce7)';
    badge.style.color = 'var(--success)';
  } else {
    badge.textContent = passed + '/' + catDef.tests.length;
    badge.style.background = 'var(--bg-tertiary)';
    badge.style.color = 'var(--text-muted)';
  }
}

/**
 * Show final summary
 */
function debugShowSummary(elapsed) {
  var el = document.getElementById('debug-summary');
  if (el) el.style.display = 'block';
  var t = document.getElementById('debug-total');
  var p = document.getElementById('debug-passed');
  var f = document.getElementById('debug-failed');
  var s = document.getElementById('debug-skipped');
  var tm = document.getElementById('debug-time');
  if (t) t.textContent = debugResults.total;
  if (p) p.textContent = debugResults.passed;
  if (f) f.textContent = debugResults.failed;
  if (s) s.textContent = debugResults.skipped;
  if (tm) tm.textContent = elapsed + 's';
}

/**
 * Clear all test results
 */
function debugClearResults() {
  debugResults = { total: 0, passed: 0, failed: 0, skipped: 0 };
  var progressWrap = document.getElementById('debug-progress-wrap');
  var summaryEl = document.getElementById('debug-summary');
  if (progressWrap) progressWrap.style.display = 'none';
  if (summaryEl) summaryEl.style.display = 'none';
  debugRenderCategories();
}

// Render debug categories as soon as DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    debugRenderCategories();
  }, 1000);
});


