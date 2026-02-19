// api-shim.js — Replaces Electron preload.js bridge with HTTP fetch calls.
// Loaded before app.js. If running inside Electron (preload.js already set window.api),
// this script does nothing. In a regular browser, it installs the HTTP-based shim.
(function() {
  'use strict';
  if (window.api) return; // Already in Electron — preload.js already set this

  var eventSource = null;

  window.api = {
    invoke: function(channel) {
      var args = Array.prototype.slice.call(arguments, 1);

      // Handle openExternal client-side (no server round-trip needed)
      if (channel === 'openExternal') {
        if (args[0] && (args[0].indexOf('http://') === 0 || args[0].indexOf('https://') === 0)) {
          window.open(args[0], '_blank');
        }
        return Promise.resolve();
      }

      return fetch('/api/ipc/' + encodeURIComponent(channel), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: args })
      }).then(function(r) {
        if (!r.ok) {
          return r.json().then(function(err) { throw new Error(err.error || 'API error ' + r.status); });
        }
        return r.json();
      });
    },

    on: function(channel, callback) {
      if (!eventSource) {
        eventSource = new EventSource('/api/events');
        eventSource.onerror = function() {
          // EventSource auto-reconnects — nothing to do
        };
      }
      eventSource.addEventListener(channel, function(e) {
        try {
          callback(JSON.parse(e.data));
        } catch (err) {
          callback(e.data);
        }
      });
      // Return unsubscribe function (matches Electron API signature)
      return function() {};
    }
  };
})();
