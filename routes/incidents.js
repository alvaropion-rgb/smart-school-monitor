const express = require('express');
const router = express.Router();
const { db, generateId, getAll, getById, getByColumn, insert, update, updateField, remove, clearTable, count, getSetting } = require('../db/database');
const { sendEmail } = require('../services/emailService');

// ============================================
// AI CLASSIFICATION ENGINE — KEYWORD RULES
// ============================================

const AI_KEYWORD_RULES = {
  categories: {
    'Hardware': {
      keywords: ['printer', 'copier', 'chromebook', 'laptop', 'monitor', 'projector', 'camera', 'phone', 'scanner', 'keyboard', 'mouse', 'cart', 'dock', 'charger', 'screen', 'broken', 'jam', 'paper', 'toner', 'ink', 'drum', 'device', 'hardware', 'power', 'cable', 'usb', 'hdmi', 'adapter'],
      subcategories: {
        'Printer': ['printer', 'printing', 'print job', 'paper jam', 'toner', 'ink', 'print queue'],
        'Copier': ['copier', 'copy', 'copying', 'scan to email', 'copy machine'],
        'Chromebook': ['chromebook', 'chrome book', 'cb', 'chrome os'],
        'Windows Laptop': ['laptop', 'windows laptop', 'dell laptop', 'hp laptop', 'lenovo'],
        'Windows Desktop': ['desktop', 'pc', 'windows desktop', 'tower', 'workstation', 'computer'],
        'Projector LCD': ['projector', 'lcd projector', 'display', 'hdmi no signal'],
        'Projector Bulb': ['projector bulb', 'bulb replacement', 'lamp', 'dim projector'],
        'Smart Panel': ['smart panel', 'smart board', 'interactive panel', 'promethean', 'viewsonic', 'touch screen panel'],
        'Document Camera': ['doc cam', 'document camera', 'elmo'],
        'Phone': ['phone', 'voip', 'desk phone', 'handset', 'telephone', 'dial tone'],
        'Scanner': ['scanner', 'scanning', 'scan document'],
        'Camera': ['camera', 'webcam', 'security camera', 'surveillance'],
        'Apple': ['apple', 'ipad', 'macbook', 'imac', 'mac', 'ios'],
        'Mobile Device': ['mobile', 'tablet', 'iphone', 'android', 'cell phone'],
        'Sound System': ['sound system', 'speaker', 'pa system', 'audio system', 'no sound'],
        'Amplifier': ['amplifier', 'amp'],
        'Audio Enhancement': ['audio enhancement', 'hearing', 'microphone system', 'hearing aid'],
        'Microphone': ['microphone', 'mic', 'wireless mic'],
        'Intercom': ['intercom', 'paging', 'bell system', 'announcement'],
        'Digital Signage': ['digital signage', 'digital sign', 'display board', 'tv display'],
        'Cart': ['cart', 'charging cart', 'laptop cart', 'chromebook cart'],
        'Server': ['server', 'rack', 'server room'],
        'Stage Lighting': ['stage light', 'stage lighting', 'theater', 'auditorium light'],
        'Time Clock': ['time clock', 'punch clock', 'clock in'],
        'TEN': ['ten device', 'ten hardware']
      }
    },
    'Network': {
      keywords: ['wifi', 'internet', 'network', 'ethernet', 'cable', 'port', 'switch', 'slow', 'disconnect', 'wireless', 'lan', 'vpn', 'connect', 'connection', 'offline', 'down', 'outage', 'no access'],
      subcategories: {
        'SDPBC Wireless': ['wifi', 'wireless', 'wifi access', 'hotspot', 'wap', 'no wifi', 'wifi down', 'cant connect wifi'],
        'Internet': ['internet', 'web', 'browsing', 'website', 'online', 'connectivity', 'no internet', 'internet down'],
        'Data Port': ['data port', 'ethernet port', 'wall port', 'network jack', 'rj45', 'wall jack'],
        'LAN': ['lan', 'local network', 'wired network', 'network drop', 'wired connection'],
        'Slowness': ['slow', 'sluggish', 'lagging', 'buffering', 'speed', 'crawling', 'very slow'],
        'District WiFi Access Key': ['wifi key', 'access key', 'wifi password', 'guest wifi', 'wifi code'],
        'Wireless Access Point': ['access point', 'ap down', 'wap down'],
        'Core Switch': ['core switch', 'main switch'],
        'Extreme Switch': ['extreme switch', 'edge switch', 'network switch', 'switch down'],
        'Fiber': ['fiber', 'fiber optic', 'sfp', 'fiber cut'],
        'Router': ['router', 'routing', 'gateway'],
        'Loop': ['loop', 'network loop', 'spanning tree', 'broadcast storm'],
        'UPS': ['ups', 'battery backup', 'uninterruptible', 'power backup']
      }
    },
    'Software': {
      keywords: ['password', 'login', 'account', 'locked', 'reset', 'install', 'update', 'error', 'crash', 'application', 'app', 'email', 'google', 'outlook', 'software', 'program', 'sign in', 'log in', 'access'],
      subcategories: {
        'Password Reset': ['password', 'reset password', 'forgot password', 'password expired', 'change password', 'new password', 'password not working'],
        'Account Lockout': ['locked out', 'lockout', 'account locked', 'disabled account', 'cant login', 'account disabled', 'too many attempts'],
        'Google Apps (Mail, Calendar, etc.)': ['google', 'gmail', 'google classroom', 'google drive', 'google calendar', 'google meet', 'g suite', 'google apps', 'google docs', 'google sheets'],
        'Active Directory': ['active directory', 'ad account', 'domain', 'group policy'],
        'Operating System': ['windows', 'os', 'blue screen', 'bsod', 'update', 'boot', 'startup', 'wont turn on', 'restart loop', 'frozen'],
        'Multi Factor Authentication': ['mfa', 'two factor', '2fa', 'authenticator', 'duo', 'verification code'],
        'MFA Bypass': ['mfa bypass', 'bypass mfa', 'skip mfa', 'lost phone mfa'],
        'Antivirus': ['virus', 'antivirus', 'malware', 'security alert', 'threat', 'infected'],
        'VPN': ['vpn', 'remote access', 'tunnel', 'work from home', 'remote'],
        'Business Application': ['sap', 'business app', 'enterprise'],
        'Instructional Application': ['app install', 'software install', 'instructional', 'educational software', 'install software', 'need app'],
        'Database': ['database', 'sql', 'data corruption'],
        'ERP / PeopleSoft': ['peoplesoft', 'erp', 'hr system', 'payroll', 'people soft'],
        'File Backup': ['backup', 'file recovery', 'restore', 'lost files', 'deleted files'],
        'Identity Management': ['identity', 'provisioning', 'user creation', 'new user', 'new account'],
        'Portal': ['portal', 'web portal', 'parent portal', 'student portal'],
        'SIS': ['sis', 'student information', 'gradebook', 'pinnacle', 'grades'],
        'TEN': ['ten software', 'ten app'],
        'TRIRIGA': ['tririga', 'facilities', 'work order']
      }
    }
  },
  channelKeywords: {
    'walk-in': ['walked in', 'came to', 'stopped by', 'in person', 'at my desk', 'showed up', 'came by', 'walk in'],
    'phone': ['called', 'phone call', 'rang', 'on the phone', 'phoned', 'call from'],
    'email': ['emailed', 'sent email', 'email from', 'wrote to', 'sent a message'],
    'self-service': ['ticket', 'submitted', 'portal request', 'self service', 'online request']
  },
  impactKeywords: {
    '1': ['district', 'all schools', 'everyone', 'districtwide', 'district wide', 'all users'],
    '2': ['multiple', 'several schools', 'many users', 'whole department', 'multiple schools', 'several'],
    '3': ['school', 'building', 'department', 'entire school', 'our school', 'whole school', 'all teachers'],
    '4': ['one', 'single', 'individual', 'my', 'teacher', 'user', 'person', 'i cant', 'i can', 'one user', 'one teacher', 'his', 'her', 'their']
  }
};

const AI_STOP_WORDS = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'it', 'its', 'this', 'that', 'these', 'those', 'and', 'but', 'or', 'not', 'no', 'so', 'if', 'then', 'than', 'too', 'very', 'just', 'also', 'please', 'thanks', 'thank', 'hi', 'hello', 'hey'];

const SERVICE_OFFERING_MAP = {
  // Hardware subcategories
  'Printer': 'Printer',
  'Copier': 'Copier',
  'Chromebook': 'Chromebook',
  'Windows Laptop': 'Windows Laptop',
  'Windows Desktop': 'Windows Desktop',
  'Projector LCD': 'Display',
  'Projector Bulb': 'Display',
  'Smart Panel': 'Display',
  'Document Camera': 'Document Camera',
  'Phone': 'Phone',
  'Scanner': 'Scanner',
  'Camera': 'Camera',
  'Apple': 'Apple',
  'Mobile Device': 'Mobile Device',
  'Sound System': 'Sound System',
  'Amplifier': 'Amplifier',
  'Audio Enhancement': 'Audio Enhancement',
  'Microphone': 'Microphone',
  'Intercom': 'Intercom',
  'Digital Signage': 'Digital Signage',
  'Cart': 'Cart',
  'Server': 'Server',
  'Stage Lighting': 'Stage Lighting',
  'Time Clock': 'Time Clock',
  'TEN': 'TEN',
  'Keyboard': 'Keyboard',
  'Battery': 'Battery',
  'Motherboard': 'Motherboard',
  'USB Port': 'USB Port',
  // Network subcategories
  'SDPBC Wireless': 'SDPBC Wireless',
  'Internet': 'Internet',
  'Data Port': 'Data Port',
  'LAN': 'LAN',
  'Slowness': 'Slowness',
  'District WiFi Access Key': 'District WiFi Access Key',
  'Wireless Access Point': 'Wireless Access Point',
  'Core Switch': 'Core Switch',
  'Extreme Switch': 'Extreme Switch',
  'Fiber': 'Fiber',
  'Router': 'Router',
  'Loop': 'Loop',
  'UPS': 'UPS',
  // Software subcategories
  'Password Reset': 'Password Reset',
  'Account Lockout': 'Account Lockout',
  'Google Apps (Mail, Calendar, etc.)': 'Google Apps',
  'Active Directory': 'Active Directory',
  'Operating System': 'Operating System',
  'Multi Factor Authentication': 'Multi Factor Authentication',
  'MFA Bypass': 'MFA Bypass',
  'Antivirus': 'Antivirus',
  'VPN': 'VPN',
  'Business Application': 'Business Application',
  'Instructional Application': 'Instructional Application',
  'Database': 'Database',
  'ERP / PeopleSoft': 'ERP / PeopleSoft',
  'File Backup': 'File Backup',
  'Identity Management': 'Identity Management',
  'Portal': 'Portal',
  'SIS': 'SIS',
  'TRIRIGA': 'TRIRIGA'
};

// ============================================
// AI HELPER FUNCTIONS
// ============================================

function extractKeywords(text) {
  var normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  var words = normalized.split(' ');
  var keywords = [];
  for (var i = 0; i < words.length; i++) {
    if (words[i].length > 1 && AI_STOP_WORDS.indexOf(words[i]) === -1) {
      keywords.push(words[i]);
    }
  }
  return keywords;
}

function jaccardSimilarity(a, b) {
  if (a.length === 0 && b.length === 0) return 1;
  var setA = {};
  var setB = {};
  for (var i = 0; i < a.length; i++) setA[a[i]] = true;
  for (var j = 0; j < b.length; j++) setB[b[j]] = true;
  var intersection = 0;
  var union = {};
  for (var k in setA) { union[k] = true; if (setB[k]) intersection++; }
  for (var k in setB) { union[k] = true; }
  var unionSize = Object.keys(union).length;
  return unionSize > 0 ? intersection / unionSize : 0;
}

function containsPhrase(text, phrase) {
  return text.toLowerCase().indexOf(phrase.toLowerCase()) !== -1;
}

function getServiceOffering(subcategory, category) {
  if (!subcategory) return '';

  // Tier 1: Learn from past entries
  try {
    var trainingData = getAll('ai_training');
    if (trainingData && trainingData.length > 0) {
      var counts = {};
      for (var i = 0; i < trainingData.length; i++) {
        var entry = trainingData[i];
        if (entry.subcategory === subcategory && entry.serviceOffering) {
          counts[entry.serviceOffering] = (counts[entry.serviceOffering] || 0) + 1;
        }
      }
      var bestSO = '';
      var bestCount = 0;
      for (var so in counts) {
        if (counts[so] > bestCount) {
          bestCount = counts[so];
          bestSO = so;
        }
      }
      if (bestSO) return bestSO;
    }
  } catch (e) {
    // Fall through to static map
  }

  // Tier 2: Static map
  return SERVICE_OFFERING_MAP[subcategory] || '';
}

function improveDescription(rawText, employeeName, roomNumber, category, subcategory) {
  if (!rawText) return '';
  var text = rawText.trim();

  // Capitalize first letter
  text = text.charAt(0).toUpperCase() + text.slice(1);

  // Ensure it ends with a period
  if (text && !text.match(/[.!?]$/)) text += '.';

  // Build structured description
  var parts = [];
  if (employeeName) parts.push(employeeName);
  if (roomNumber) parts.push('Room ' + roomNumber);

  var prefix = '';
  if (parts.length > 0) {
    prefix = parts.join(', ') + ' \u2014 ';
  }

  // Add category context if available
  var suffix = '';
  if (category && subcategory) {
    suffix = ' [' + category + ' / ' + subcategory + ']';
  } else if (category) {
    suffix = ' [' + category + ']';
  }

  return prefix + text + suffix;
}

/**
 * Main classification function - 3-tier engine
 */
function classifyIncident(rawText, employeeName, roomNumber) {
  try {
    var normalized = rawText.toLowerCase().trim().replace(/\s+/g, ' ');
    var keywords = extractKeywords(rawText);

    // --- Tier 1: Exact match from training data ---
    try {
      var trainingData = getAll('ai_training');
      if (trainingData && trainingData.length > 0) {
        // Check exact match
        for (var i = 0; i < trainingData.length; i++) {
          var entry = trainingData[i];
          var entryNorm = (entry.rawDescription || '').toLowerCase().trim().replace(/\s+/g, ' ');
          if (entryNorm === normalized && entry.category) {
            var so = entry.serviceOffering || getServiceOffering(entry.subcategory || '', entry.category);
            return {
              category: entry.category,
              subcategory: entry.subcategory || '',
              channel: entry.channel || 'walk-in',
              impact: entry.impact || '4',
              serviceOffering: so,
              improvedDescription: improveDescription(rawText, employeeName, roomNumber, entry.category, entry.subcategory),
              confidence: 0.98,
              source: 'exact'
            };
          }
        }

        // --- Tier 2: Similarity match ---
        var bestMatch = null;
        var bestScore = 0;
        for (var i = 0; i < trainingData.length; i++) {
          var entry = trainingData[i];
          if (!entry.keywords || !entry.category) continue;
          var entryKeywords = (entry.keywords || '').split(',').map(function(k) { return k.trim(); }).filter(function(k) { return k.length > 0; });
          var score = jaccardSimilarity(keywords, entryKeywords);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = entry;
          }
        }
        if (bestScore >= 0.5 && bestMatch) {
          var so = bestMatch.serviceOffering || getServiceOffering(bestMatch.subcategory || '', bestMatch.category);
          return {
            category: bestMatch.category,
            subcategory: bestMatch.subcategory || '',
            channel: bestMatch.channel || 'walk-in',
            impact: bestMatch.impact || '4',
            serviceOffering: so,
            improvedDescription: improveDescription(rawText, employeeName, roomNumber, bestMatch.category, bestMatch.subcategory),
            confidence: Math.round(bestScore * 100) / 100,
            source: 'similarity'
          };
        }
      }
    } catch (e) {
      console.log('AI Tier 1/2 error (training data): ' + e);
    }

    // --- Tier 3: Static keyword rules ---
    var bestCategory = '';
    var bestCategoryScore = 0;
    var bestSubcategory = '';
    var bestSubcategoryScore = 0;

    var cats = AI_KEYWORD_RULES.categories;
    for (var catName in cats) {
      var catData = cats[catName];
      var catScore = 0;
      for (var k = 0; k < catData.keywords.length; k++) {
        if (containsPhrase(normalized, catData.keywords[k])) catScore++;
      }
      if (catScore > bestCategoryScore) {
        bestCategoryScore = catScore;
        bestCategory = catName;
      }
    }

    // Find best subcategory within the best category
    if (bestCategory && cats[bestCategory]) {
      var subs = cats[bestCategory].subcategories;
      for (var subName in subs) {
        var subKeywords = subs[subName];
        var subScore = 0;
        for (var k = 0; k < subKeywords.length; k++) {
          if (containsPhrase(normalized, subKeywords[k])) subScore++;
        }
        if (subScore > bestSubcategoryScore) {
          bestSubcategoryScore = subScore;
          bestSubcategory = subName;
        }
      }
    }

    // Detect channel
    var detectedChannel = 'walk-in';
    var channelRules = AI_KEYWORD_RULES.channelKeywords;
    var bestChannelScore = 0;
    for (var ch in channelRules) {
      var chKeywords = channelRules[ch];
      var chScore = 0;
      for (var k = 0; k < chKeywords.length; k++) {
        if (containsPhrase(normalized, chKeywords[k])) chScore++;
      }
      if (chScore > bestChannelScore) {
        bestChannelScore = chScore;
        detectedChannel = ch;
      }
    }

    // Detect impact
    var detectedImpact = '4';
    var impactRules = AI_KEYWORD_RULES.impactKeywords;
    var bestImpactScore = 0;
    for (var imp in impactRules) {
      var impKeywords = impactRules[imp];
      var impScore = 0;
      for (var k = 0; k < impKeywords.length; k++) {
        if (containsPhrase(normalized, impKeywords[k])) impScore++;
      }
      if (impScore > bestImpactScore) {
        bestImpactScore = impScore;
        detectedImpact = imp;
      }
    }

    // Calculate confidence
    var totalMatches = bestCategoryScore + bestSubcategoryScore + bestChannelScore + bestImpactScore;
    var confidence = Math.min(0.85, totalMatches > 0 ? Math.min(totalMatches / keywords.length, 0.85) : 0.15);
    confidence = Math.round(confidence * 100) / 100;

    return {
      category: bestCategory || '',
      subcategory: bestSubcategory || '',
      channel: detectedChannel,
      impact: detectedImpact,
      serviceOffering: getServiceOffering(bestSubcategory || '', bestCategory || ''),
      improvedDescription: improveDescription(rawText, employeeName, roomNumber, bestCategory, bestSubcategory),
      confidence: confidence,
      source: 'rules'
    };
  } catch (error) {
    console.log('classifyIncident error: ' + error);
    return {
      category: '', subcategory: '', channel: 'walk-in', impact: '4',
      serviceOffering: '', improvedDescription: rawText, confidence: 0, source: 'error'
    };
  }
}

// ============================================
// EMAIL HTML BUILDER
// ============================================

function buildIncidentEmailHtml(incident) {
  var incNum = incident.snowIncidentNumber || 'Pending';
  return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">' +
    '<div style="background:#1e40af;color:#fff;padding:20px;border-radius:8px 8px 0 0;">' +
      '<h2 style="margin:0;">Tech Support \u2014 Incident Confirmation</h2>' +
    '</div>' +
    '<div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">' +
      '<p>Hello <strong>' + (incident.employeeName || 'Team Member') + '</strong>,</p>' +
      '<p>Your tech support incident has been recorded. A technician is working on your issue.</p>' +
      '<table style="width:100%;border-collapse:collapse;margin:16px 0;">' +
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;width:140px;">Incident #</td>' +
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">' + incNum + '</td></tr>' +
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Category</td>' +
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;">' + (incident.category || 'N/A') +
            (incident.subcategory ? ' / ' + incident.subcategory : '') + '</td></tr>' +
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Issue</td>' +
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;">' + (incident.shortDescription || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Room</td>' +
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;">' + (incident.roomNumber || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:8px;color:#6b7280;">Details</td>' +
            '<td style="padding:8px;">' + (incident.description || 'N/A') + '</td></tr>' +
      '</table>' +
      '<p style="color:#6b7280;font-size:13px;margin-top:20px;">If you have questions, reply to this email or contact the IT Help Desk.</p>' +
      '<p style="color:#9ca3af;font-size:12px;margin-top:16px;">\u2014 Smart School Monitor</p>' +
    '</div>' +
  '</div>';
}

// ============================================
// ROUTES
// ============================================

/**
 * Create a new incident record
 */
router.post('/createIncident', (req, res) => {
  try {
    const [data] = req.body.args || [];
    const now = new Date().toISOString();
    const id = generateId();

    const snowUrl = data.snowIncidentNumber
      ? 'https://pbcsd.service-now.com/nav_to.do?uri=incident.do?sysparm_query=number=' + data.snowIncidentNumber
      : '';

    const incidentData = {
      id: id,
      employeeId: data.employeeId || '',
      employeeName: data.employeeName || '',
      employeeEmail: data.employeeEmail || '',
      roomNumber: data.roomNumber || '',
      shortDescription: data.shortDescription || '',
      description: data.description || '',
      category: data.category || '',
      subcategory: data.subcategory || '',
      channel: data.channel || '',
      impact: data.impact || '',
      userType: data.userType || '',
      snowIncidentNumber: data.snowIncidentNumber || '',
      snowUrl: snowUrl,
      emailStatus: data.emailStatus || 'not-sent',
      emailSentAt: '',
      status: 'open',
      createdAt: now,
      updatedAt: now
    };

    insert('incidents', incidentData);

    res.json({ success: true, incident: incidentData });
  } catch (error) {
    console.log('Error creating incident: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Get recent incidents, optionally limited
 */
router.post('/getIncidents', (req, res) => {
  try {
    const [limit] = req.body.args || [200];
    var incidents = getAll('incidents');
    incidents.sort(function(a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    if (limit && limit > 0) {
      incidents = incidents.slice(0, limit);
    }
    res.json({ success: true, incidents: incidents });
  } catch (error) {
    console.log('Error getting incidents: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Send incident confirmation email immediately
 */
router.post('/sendIncidentEmail', async (req, res) => {
  try {
    const [incidentId] = req.body.args || [];
    const incident = getById('incidents', incidentId);
    if (!incident) {
      return res.json({ success: false, error: 'Incident not found' });
    }
    if (!incident.employeeEmail) {
      return res.json({ success: false, error: 'No employee email on record' });
    }

    var subject = 'Incident Reported: ' + (incident.shortDescription || 'Your Tech Issue');
    var htmlBody = buildIncidentEmailHtml(incident);

    const result = await sendEmail({
      to: incident.employeeEmail,
      subject: subject,
      html: htmlBody
    });

    if (result.success) {
      updateField('incidents', incidentId, 'emailStatus', 'sent');
      updateField('incidents', incidentId, 'emailSentAt', new Date().toISOString());
      updateField('incidents', incidentId, 'updatedAt', new Date().toISOString());
      console.log('Incident email sent to: ' + incident.employeeEmail);
      res.json({ success: true, message: 'Email sent to ' + incident.employeeEmail });
    } else {
      updateField('incidents', incidentId, 'emailStatus', 'failed');
      updateField('incidents', incidentId, 'updatedAt', new Date().toISOString());
      res.json({ success: false, error: result.error || 'Failed to send email' });
    }
  } catch (error) {
    console.log('Error sending incident email: ' + error);
    const incidentId = (req.body.args || [])[0];
    try { if (incidentId) updateField('incidents', incidentId, 'emailStatus', 'failed'); } catch(e) {}
    res.json({ success: false, error: error.message });
  }
});

/**
 * Queue an incident email for later sending
 */
router.post('/queueIncidentEmail', (req, res) => {
  try {
    const [incidentId] = req.body.args || [];
    const incident = getById('incidents', incidentId);
    if (!incident) {
      return res.json({ success: false, error: 'Incident not found' });
    }
    if (!incident.employeeEmail) {
      return res.json({ success: false, error: 'No employee email on record' });
    }

    var subject = 'Incident Reported: ' + (incident.shortDescription || 'Your Tech Issue');
    var htmlBody = buildIncidentEmailHtml(incident);

    var now = new Date().toISOString();
    var queueId = generateId();

    insert('email_queue', {
      id: queueId,
      incidentId: incidentId,
      toAddr: incident.employeeEmail,
      subject: subject,
      body: htmlBody,
      status: 'pending',
      scheduledAt: now,
      sentAt: '',
      createdAt: now,
      error: ''
    });

    updateField('incidents', incidentId, 'emailStatus', 'queued');
    updateField('incidents', incidentId, 'updatedAt', new Date().toISOString());

    res.json({ success: true, message: 'Email queued for ' + incident.employeeEmail });
  } catch (error) {
    console.log('Error queuing incident email: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Update a single field on an incident row
 */
router.post('/updateIncidentField', (req, res) => {
  try {
    const [incidentId, fieldName, value] = req.body.args || [];
    updateField('incidents', incidentId, fieldName, value);
    updateField('incidents', incidentId, 'updatedAt', new Date().toISOString());
    res.json({ success: true });
  } catch (error) {
    console.log('Error updating incident field: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Classify an incident using the 3-tier AI engine
 */
router.post('/classifyIncident', (req, res) => {
  try {
    const [rawText, employeeName, roomNumber] = req.body.args || [];
    const result = classifyIncident(rawText || '', employeeName || '', roomNumber || '');
    res.json(result);
  } catch (error) {
    console.log('classifyIncident route error: ' + error);
    res.json({
      category: '', subcategory: '', channel: 'walk-in', impact: '4',
      serviceOffering: '', improvedDescription: '', confidence: 0, source: 'error'
    });
  }
});

/**
 * Improve a raw description into a professional format
 */
router.post('/improveDescription', (req, res) => {
  try {
    const [rawText, employeeName, roomNumber, category, subcategory] = req.body.args || [];
    const result = improveDescription(rawText || '', employeeName || '', roomNumber || '', category || '', subcategory || '');
    res.json(result);
  } catch (error) {
    console.log('improveDescription error: ' + error);
    res.json('');
  }
});

/**
 * Save a training entry after incident is saved
 */
router.post('/saveTrainingEntry', (req, res) => {
  try {
    const [data] = req.body.args || [];
    var id = generateId();
    var now = new Date().toISOString();
    var keywords = extractKeywords(data.rawDescription || '').join(',');

    insert('ai_training', {
      id: id,
      rawDescription: data.rawDescription || '',
      improvedDescription: data.improvedDescription || '',
      category: data.category || '',
      subcategory: data.subcategory || '',
      channel: data.channel || '',
      impact: data.impact || '',
      serviceOffering: data.serviceOffering || '',
      keywords: keywords,
      aiAccepted: data.aiAccepted ? 'true' : 'false',
      confidence: data.confidence || 0,
      source: data.source || '',
      incidentId: data.incidentId || '',
      createdAt: now
    });

    res.json({ success: true, id: id });
  } catch (error) {
    console.log('saveTrainingEntry error: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Get all training data for display or export
 */
router.post('/getTrainingData', (req, res) => {
  try {
    const data = getAll('ai_training');
    res.json(data);
  } catch (error) {
    console.log('getTrainingData error: ' + error);
    res.json([]);
  }
});

/**
 * Aggregate analytics data from incidents and ai_training tables
 */
router.post('/getAnalyticsData', (req, res) => {
  try {
    var incidents = getAll('incidents');
    var training = getAll('ai_training');

    var total = incidents.length;
    var openCount = 0;
    var closedCount = 0;
    var categoryCounts = {};
    var subcategoryCounts = {};
    var channelCounts = {};
    var requesterCounts = {};
    var monthCounts = {};
    var impactCounts = {};

    for (var i = 0; i < incidents.length; i++) {
      var inc = incidents[i];
      var status = (inc.status || 'open').toLowerCase();
      if (status === 'open' || status === 'new') { openCount++; } else { closedCount++; }

      var cat = inc.category || 'Uncategorized';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

      var sub = inc.subcategory || 'Other';
      subcategoryCounts[sub] = (subcategoryCounts[sub] || 0) + 1;

      var ch = inc.channel || 'Unknown';
      channelCounts[ch] = (channelCounts[ch] || 0) + 1;

      var imp = inc.impact || 'Unknown';
      impactCounts[imp] = (impactCounts[imp] || 0) + 1;

      var empName = inc.employeeName || 'Unknown';
      requesterCounts[empName] = (requesterCounts[empName] || 0) + 1;

      var created = inc.createdAt || '';
      if (created) {
        var dateStr = String(created);
        var monthKey = dateStr.length >= 7 ? dateStr.substring(0, 7) : '';
        if (monthKey) {
          monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
        }
      }
    }

    function sortedEntries(obj, limit) {
      var entries = [];
      var k = Object.keys(obj);
      for (var j = 0; j < k.length; j++) {
        entries.push({ name: k[j], count: obj[k[j]] });
      }
      entries.sort(function(a, b) { return b.count - a.count; });
      if (limit) entries = entries.slice(0, limit);
      return entries;
    }

    function withPercentages(entries, tot) {
      for (var j = 0; j < entries.length; j++) {
        entries[j].pct = tot > 0 ? Math.round((entries[j].count / tot) * 100) : 0;
      }
      return entries;
    }

    var catEntries = sortedEntries(categoryCounts);
    var topCategory = catEntries.length > 0 ? catEntries[0].name : 'N/A';

    var monthEntries = [];
    var now = new Date();
    for (var m = 11; m >= 0; m--) {
      var d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      var label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
      monthEntries.push({ month: key, label: label, count: monthCounts[key] || 0 });
    }

    var aiTotal = training.length;
    var aiAccepted = 0;
    var aiSourceCounts = { exact: 0, similarity: 0, rules: 0 };
    var confidenceSum = 0;

    for (var t = 0; t < training.length; t++) {
      var tr = training[t];
      if (String(tr.aiAccepted).toLowerCase() === 'true') { aiAccepted++; }
      var src = (tr.source || 'rules').toLowerCase();
      if (aiSourceCounts.hasOwnProperty(src)) { aiSourceCounts[src]++; }
      confidenceSum += (parseFloat(tr.confidence) || 0);
    }

    var aiAccuracy = aiTotal > 0 ? Math.round((aiAccepted / aiTotal) * 100) : 0;
    var avgConfidence = aiTotal > 0 ? Math.round((confidenceSum / aiTotal) * 100) : 0;

    res.json({
      success: true,
      summary: {
        total: total,
        open: openCount,
        closed: closedCount,
        topCategory: topCategory,
        aiAccuracy: aiAccuracy
      },
      categories: withPercentages(sortedEntries(categoryCounts), total),
      subcategories: withPercentages(sortedEntries(subcategoryCounts, 10), total),
      channels: withPercentages(sortedEntries(channelCounts), total),
      impacts: withPercentages(sortedEntries(impactCounts), total),
      topRequesters: sortedEntries(requesterCounts, 10),
      monthly: monthEntries,
      ai: {
        total: aiTotal,
        accepted: aiAccepted,
        accuracy: aiAccuracy,
        avgConfidence: avgConfidence,
        sources: aiSourceCounts
      }
    });
  } catch (error) {
    console.log('getAnalyticsData error: ' + error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Get service offering for a subcategory/category
 */
router.post('/getServiceOffering', (req, res) => {
  try {
    const [subcategory, category] = req.body.args || [];
    const result = getServiceOffering(subcategory || '', category || '');
    res.json(result);
  } catch (error) {
    console.log('getServiceOffering error: ' + error);
    res.json('');
  }
});

/**
 * Query ServiceNow REST API for the latest incident
 */
router.post('/getLatestSnIncident', async (req, res) => {
  try {
    const [employeeNumber, shortDescription] = req.body.args || [];

    var snUser = getSetting('servicenowUser');
    var snPass = getSetting('servicenowPassword');
    var snInstance = getSetting('servicenowInstance') || 'pbcsd';

    if (!snUser || !snPass) {
      return res.json({ success: false, error: 'ServiceNow API credentials not configured. Admin must run setupSnCredentials() once.' });
    }

    // Query: find incidents created in the last 10 minutes by this employee, newest first
    var baseUrl = 'https://' + snInstance + '.service-now.com/api/now/table/incident';
    var tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);

    var query = 'caller_id.employee_number=' + employeeNumber +
                '^sys_created_on>=' + tenMinAgo +
                '^ORDERBYDESCsys_created_on';

    var url = baseUrl + '?sysparm_query=' + encodeURIComponent(query) +
              '&sysparm_fields=number,sys_id,short_description,sys_created_on' +
              '&sysparm_limit=5';

    var auth = Buffer.from(snUser + ':' + snPass).toString('base64');

    var response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.log('ServiceNow API error: ' + response.status);
      return res.json({ success: false, error: 'ServiceNow API returned ' + response.status });
    }

    var data = await response.json();
    var results = data.result || [];

    if (results.length === 0) {
      return res.json({ success: false, error: 'No recent incidents found for employee ' + employeeNumber });
    }

    // If short description provided, try to match it for accuracy
    if (shortDescription) {
      var descLower = shortDescription.toLowerCase().trim();
      for (var i = 0; i < results.length; i++) {
        var snDesc = (results[i].short_description || '').toLowerCase().trim();
        if (snDesc === descLower || snDesc.indexOf(descLower) !== -1 || descLower.indexOf(snDesc) !== -1) {
          return res.json({
            success: true,
            incidentNumber: results[i].number,
            sysId: results[i].sys_id,
            shortDescription: results[i].short_description
          });
        }
      }
    }

    // No exact description match - return the newest incident
    res.json({
      success: true,
      incidentNumber: results[0].number,
      sysId: results[0].sys_id,
      shortDescription: results[0].short_description
    });
  } catch (error) {
    console.log('getLatestSnIncident error: ' + error);
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;
