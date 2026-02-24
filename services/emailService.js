/**
 * Email Service - Replaces GmailApp/MailApp from Google Apps Script
 * Uses Nodemailer with Gmail OAuth2
 */
const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!config.GMAIL_USER) {
    console.warn('Email not configured: GMAIL_USER is empty. Emails will be logged but not sent.');
    return null;
  }

  if (config.GMAIL_CLIENT_ID && config.GMAIL_REFRESH_TOKEN) {
    // OAuth2 authentication
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: config.GMAIL_USER,
        clientId: config.GMAIL_CLIENT_ID,
        clientSecret: config.GMAIL_CLIENT_SECRET,
        refreshToken: config.GMAIL_REFRESH_TOKEN
      }
    });
  } else {
    // Fallback to app password or less secure apps
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.GMAIL_USER,
        pass: config.GMAIL_CLIENT_SECRET // Use client secret field as app password
      }
    });
  }

  return transporter;
}

/**
 * Send an email
 * @param {Object} options - { to, subject, text, html, from, cc, replyTo }
 * @returns {Object} { success, messageId, error }
 */
async function sendEmail(options) {
  const transport = getTransporter();

  if (!transport) {
    console.log('[EMAIL NOT CONFIGURED] Would send to:', options.to, 'Subject:', options.subject);
    return { success: true, messageId: 'not-configured', note: 'Email not configured - message logged only' };
  }

  try {
    const result = await transport.sendMail({
      from: options.from || `Smart School Monitor <${config.GMAIL_USER}>`,
      to: options.to,
      cc: options.cc || undefined,
      replyTo: options.replyTo || undefined,
      subject: options.subject,
      text: options.text || '',
      html: options.html || ''
    });

    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Email send error:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { sendEmail };
