// Error filter for third-party SDK noise (DCV SDK, etc.)
// This script must load before any other scripts to intercept errors early
(function() {
  var ignoredPatterns = [
    'networkMonitor',
    'No transition available',
    'Close received after close',
    'Timeout reached while waiting for data',
    'WebSocket connection',
    'dcv.js',
    'dcvjs',
    "Cannot read properties of null (reading 'state')",
    "reading 'state'"
  ];

  function shouldIgnore(message) {
    if (!message) return false;
    var msg = String(message);
    for (var i = 0; i < ignoredPatterns.length; i++) {
      if (msg.indexOf(ignoredPatterns[i]) !== -1) {
        return true;
      }
    }
    return false;
  }

  // Intercept window.onerror
  var originalOnError = window.onerror;
  window.onerror = function(message, source, lineno, colno, error) {
    if (shouldIgnore(message) || shouldIgnore(source)) {
      return true; // Suppress error
    }
    if (originalOnError) {
      return originalOnError.apply(window, arguments);
    }
    return false;
  };

  // Intercept unhandled promise rejections
  window.addEventListener('unhandledrejection', function(event) {
    var reason = event.reason;
    var message = reason && reason.message ? reason.message : String(reason || '');
    if (shouldIgnore(message)) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
  }, true);

  // Intercept console.error
  var originalConsoleError = console.error;
  console.error = function() {
    var args = Array.prototype.slice.call(arguments);
    var message = args.map(function(arg) {
      return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
    }).join(' ');
    if (!shouldIgnore(message)) {
      originalConsoleError.apply(console, args);
    }
  };
})();
