/**
 * QR Code Redirect Trampoline for Smart School Monitor
 *
 * Deploy this as a Google Apps Script Web App.
 * It receives ?d=DEVICE_ID&s=IP:PORT and redirects to:
 *   http://IP:PORT/request?device=DEVICE_ID
 *
 * OPTIMIZED: Uses <meta http-equiv="refresh"> instead of JavaScript redirect.
 * Meta-refresh fires during HTML parsing (before JS execution), cutting
 * redirect latency by ~500ms-1s compared to the JavaScript approach.
 *
 * Setup:
 * 1. Go to https://script.google.com → New project
 * 2. Paste this code into Code.gs
 * 3. Deploy → New deployment → Web app
 * 4. Execute as: Me | Access: Anyone (or Anyone in your org)
 * 5. Copy the deployment URL and paste it into Smart School Monitor
 *    Settings → QR Codes → QR Redirect URL
 */

function doGet(e) {
  var deviceId = (e.parameter.d || '').trim();
  var server   = (e.parameter.s || '').trim();

  // Validate required params
  if (!deviceId || !server) {
    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px">' +
      '<h2>Invalid QR Code</h2><p>Missing device or server parameter.</p></body></html>'
    ).setTitle('Error');
  }

  // Sanitize server: must be IP:port or hostname:port
  if (!/^[\w.\-]+:\d{1,5}$/.test(server)) {
    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px">' +
      '<h2>Invalid Server</h2><p>Server address format not recognized.</p></body></html>'
    ).setTitle('Error');
  }

  var targetUrl = 'http://' + server + '/request?device=' + encodeURIComponent(deviceId);
  var serverOrigin = 'http://' + server;

  // Minimal HTML — meta-refresh is the FIRST thing in <head> so the browser
  // starts the redirect during initial HTML parsing, before any CSS/JS loads.
  // The preconnect hint tells the browser to open a TCP connection to the
  // local server immediately, overlapping with the GAS page load.
  var html = '<!DOCTYPE html><html><head>' +
    '<meta http-equiv="refresh" content="0;url=' + targetUrl + '">' +
    '<link rel="preconnect" href="' + serverOrigin + '">' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '</head><body style="font-family:sans-serif;text-align:center;padding:60px 20px;color:#555">' +
    '<p>Connecting...</p>' +
    '<p style="font-size:12px;color:#999;margin-top:20px"><a href="' + targetUrl + '">Tap here if not redirected</a></p>' +
    '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('Connecting...')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
