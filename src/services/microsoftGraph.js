/**
 * Gmail / Google OAuth2 Email Service
 *
 * Sends emails via Gmail API using OAuth2.
 * Works from anywhere — no SMTP needed, no school network required.
 *
 * Flow: Authorization Code (desktop app)
 *   1. User signs in with their Google account (one-time)
 *   2. We receive an access token + refresh token
 *   3. Refresh token is stored locally for silent renewal
 *   4. Emails are sent via Gmail API (users.messages.send)
 *
 * NOTE: File is still named microsoftGraph.js for backward compatibility
 * with IPC handlers and email.js imports. Internally it's all Google now.
 */

const { google } = require('googleapis');
const db = require('../database/db');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];
const REDIRECT_URI = 'http://localhost:3847/auth/callback';

let oauth2Client = null;

/**
 * Get stored config from DB
 */
function getGraphConfig() {
  try {
    return db.getKeyValue('ms_graph_config') || {};
  } catch (e) {
    return {};
  }
}

/**
 * Save config to DB
 */
function saveGraphConfig(config) {
  try {
    db.setKeyValues('ms_graph_config', config);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Get or create OAuth2 client
 */
function getOAuth2Client(clientId, clientSecret) {
  const config = getGraphConfig();
  const cid = clientId || config.clientId || '';
  const secret = clientSecret || config.clientSecret || '';

  if (!cid || !secret) return null;

  oauth2Client = new google.auth.OAuth2(cid, secret, REDIRECT_URI);

  // Restore saved tokens if we have them
  if (config.refreshToken) {
    oauth2Client.setCredentials({
      refresh_token: config.refreshToken,
      access_token: config.accessToken || '',
      expiry_date: parseInt(config.expiryDate) || 0
    });
  }

  return oauth2Client;
}

/**
 * Interactive sign-in.
 * In web mode: returns { needsRedirect: true, authUrl } for the browser to navigate to.
 * The auth callback route on the server calls handleAuthCallback() to complete the flow.
 */
async function signIn(clientId, clientSecret) {
  try {
    const config = getGraphConfig();
    const cid = clientId || config.clientId;
    const secret = clientSecret || config.clientSecret;

    if (!cid || !secret) {
      return { success: false, error: 'Enter your Google OAuth Client ID and Client Secret.' };
    }

    // Save credentials so handleAuthCallback can use them
    config.clientId = cid;
    config.clientSecret = secret;
    saveGraphConfig(config);

    const client = new google.auth.OAuth2(cid, secret, REDIRECT_URI);

    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'
    });

    // In web mode, return the URL for the browser to redirect to
    return { success: true, needsRedirect: true, authUrl };
  } catch (error) {
    console.error('Google sign-in error:', error);
    let msg = error.message || 'Sign-in failed';
    if (msg.includes('invalid_client')) msg = 'Invalid Client ID or Secret. Check your Google Cloud Console credentials.';
    return { success: false, error: msg };
  }
}

/**
 * Handle the OAuth callback code exchange (called by the /auth/callback route)
 */
async function handleAuthCallback(code) {
  try {
    const config = getGraphConfig();
    const cid = config.clientId;
    const secret = config.clientSecret;

    if (!cid || !secret) {
      return { success: false, error: 'OAuth credentials not configured.' };
    }

    const client = new google.auth.OAuth2(cid, secret, REDIRECT_URI);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Get user info
    const oauth2Api = google.oauth2({ version: 'v2', auth: client });
    const userInfo = await oauth2Api.userinfo.get();

    // Save everything
    const updatedConfig = {
      ...config,
      provider: 'google',
      accountName: userInfo.data.name || '',
      accountEmail: userInfo.data.email || '',
      refreshToken: tokens.refresh_token || config.refreshToken || '',
      accessToken: tokens.access_token || '',
      expiryDate: String(tokens.expiry_date || ''),
      signedIn: 'true',
      lastSignIn: new Date().toISOString()
    };
    saveGraphConfig(updatedConfig);

    oauth2Client = client;

    return {
      success: true,
      account: {
        name: userInfo.data.name || '',
        email: userInfo.data.email || ''
      }
    };
  } catch (error) {
    console.error('OAuth callback error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get authenticated OAuth2 client (silently refreshes tokens)
 */
async function getAuthClient() {
  const config = getGraphConfig();
  if (config.signedIn !== 'true' || !config.clientId || !config.clientSecret) {
    throw new Error('Not signed in to Google. Go to Settings > Email to sign in.');
  }

  if (!config.refreshToken) {
    throw new Error('No refresh token. Please sign in again in Settings > Email.');
  }

  const client = getOAuth2Client(config.clientId, config.clientSecret);
  if (!client) throw new Error('OAuth2 client not configured');

  // Force token refresh if expired or close to expiry
  const now = Date.now();
  const expiry = parseInt(config.expiryDate) || 0;
  if (!config.accessToken || now >= expiry - 60000) {
    try {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);

      // Save refreshed tokens
      config.accessToken = credentials.access_token || config.accessToken;
      if (credentials.refresh_token) config.refreshToken = credentials.refresh_token;
      config.expiryDate = String(credentials.expiry_date || '');
      saveGraphConfig(config);
    } catch (err) {
      console.error('Token refresh failed:', err.message);
      config.signedIn = 'false';
      saveGraphConfig(config);
      throw new Error('Session expired. Please sign in again in Settings > Email.');
    }
  }

  return client;
}

/**
 * Send email via Gmail API
 * (Function kept as sendGraphEmail for backward compat with email.js)
 */
async function sendGraphEmail(to, subject, bodyText, bodyHtml, options = {}) {
  const auth = await getAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const config = getGraphConfig();
  const from = config.accountEmail || '';

  // Build MIME message
  const toAddrs = Array.isArray(to) ? to.join(', ') : to;
  let mime = '';
  mime += 'From: ' + from + '\r\n';
  mime += 'To: ' + toAddrs + '\r\n';
  if (options.cc) {
    const ccList = Array.isArray(options.cc) ? options.cc.join(', ') : options.cc;
    mime += 'Cc: ' + ccList + '\r\n';
  }
  mime += 'Subject: ' + subject + '\r\n';
  mime += 'MIME-Version: 1.0\r\n';

  if (bodyHtml) {
    const boundary = 'boundary_' + Date.now();
    mime += 'Content-Type: multipart/alternative; boundary="' + boundary + '"\r\n\r\n';
    mime += '--' + boundary + '\r\n';
    mime += 'Content-Type: text/plain; charset="UTF-8"\r\n\r\n';
    mime += (bodyText || 'See HTML version') + '\r\n\r\n';
    mime += '--' + boundary + '\r\n';
    mime += 'Content-Type: text/html; charset="UTF-8"\r\n\r\n';
    mime += bodyHtml + '\r\n\r\n';
    mime += '--' + boundary + '--\r\n';
  } else {
    mime += 'Content-Type: text/plain; charset="UTF-8"\r\n\r\n';
    mime += (bodyText || '') + '\r\n';
  }

  // Base64url encode
  const encodedMessage = Buffer.from(mime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage
    }
  });

  return { success: true, message: 'Email sent via Gmail' };
}

/**
 * Get sign-in status
 */
function getSignInStatus() {
  const config = getGraphConfig();
  return {
    signedIn: config.signedIn === 'true',
    accountName: config.accountName || '',
    accountEmail: config.accountEmail || '',
    clientId: config.clientId || '',
    provider: config.provider || 'google',
    lastSignIn: config.lastSignIn || ''
  };
}

/**
 * Sign out — clear tokens
 */
function signOut() {
  const config = getGraphConfig();
  config.signedIn = 'false';
  config.refreshToken = '';
  config.accessToken = '';
  config.expiryDate = '';
  config.accountName = '';
  config.accountEmail = '';
  config.lastSignIn = '';
  saveGraphConfig(config);
  oauth2Client = null;
  return { success: true };
}

/**
 * Check if Gmail is configured and signed in
 */
function isGraphAvailable() {
  const config = getGraphConfig();
  return config.signedIn === 'true' && !!config.clientId && !!config.refreshToken;
}

// Keep same export names for backward compatibility
module.exports = {
  signIn,
  signOut,
  sendGraphEmail,
  getAccessToken: getAuthClient,
  getSignInStatus,
  getGraphConfig,
  saveGraphConfig,
  isGraphAvailable,
  handleAuthCallback
};
