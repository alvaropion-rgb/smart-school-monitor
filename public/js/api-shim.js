/**
 * google.script.run Proxy Shim
 *
 * Drop-in replacement for Google Apps Script's google.script.run API.
 * Intercepts all calls like:
 *   google.script.run.withSuccessHandler(cb).withFailureHandler(err).functionName(args)
 * And converts them to:
 *   fetch('/api/functionName', { method: 'POST', body: JSON.stringify({ args: [...] }) })
 *
 * This means ZERO changes needed in the existing client-side code.
 */
(function() {
  'use strict';

  function createCallBuilder() {
    var _successHandler = null;
    var _failureHandler = null;
    var _userObject = null;

    function makeCall(fnName, args) {
      var argsArray = Array.prototype.slice.call(args);

      fetch('/api/' + fnName, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: argsArray })
      })
      .then(function(response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status + ': ' + response.statusText);
        }
        return response.json();
      })
      .then(function(data) {
        if (_successHandler) {
          if (_userObject !== null) {
            _successHandler.call(null, data, _userObject);
          } else {
            _successHandler(data);
          }
        }
      })
      .catch(function(err) {
        if (_failureHandler) {
          if (_userObject !== null) {
            _failureHandler.call(null, err, _userObject);
          } else {
            _failureHandler(err);
          }
        } else {
          console.error('API call to ' + fnName + ' failed:', err);
        }
      });
    }

    // Create a proxy that intercepts method calls
    var handler = {
      get: function(target, prop) {
        if (prop === 'withSuccessHandler') {
          return function(fn) {
            _successHandler = fn;
            return new Proxy({}, handler);
          };
        }
        if (prop === 'withFailureHandler') {
          return function(fn) {
            _failureHandler = fn;
            return new Proxy({}, handler);
          };
        }
        if (prop === 'withUserObject') {
          return function(obj) {
            _userObject = obj;
            return new Proxy({}, handler);
          };
        }
        // Any other property access is treated as the function name to call
        return function() {
          makeCall(prop, arguments);
        };
      }
    };

    return new Proxy({}, handler);
  }

  // Define the google.script.run global
  if (typeof window.google === 'undefined') {
    window.google = {};
  }
  if (typeof window.google.script === 'undefined') {
    window.google.script = {};
  }

  // Every access to google.script.run creates a fresh call builder
  Object.defineProperty(window.google.script, 'run', {
    get: function() {
      return createCallBuilder();
    }
  });

  // Stub google.script.url for compatibility
  if (typeof window.google.script.url === 'undefined') {
    window.google.script.url = {
      getLocation: function(callback) {
        var params = {};
        var searchParams = new URLSearchParams(window.location.search);
        searchParams.forEach(function(value, key) {
          params[key] = value;
        });
        callback({ parameter: params, parameters: params, hash: window.location.hash });
      }
    };
  }
})();
