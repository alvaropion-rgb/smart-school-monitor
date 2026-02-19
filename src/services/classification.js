const db = require('../database/db');

// Simplified classification using keyword rules (ported from Code.gs classifyIncident)
function classifyIncident(rawText, employeeName, roomNumber) {
  try {
    const text = (rawText || '').toLowerCase();
    let category = '', subcategory = '', channel = 'Walk Up', impact = '3 - Low', serviceOffering = '';
    let confidence = 0.5;
    let improvedDescription = rawText || '';

    // Hardware rules
    if (/monitor|display|screen(?!shot)/i.test(text)) { category = 'Hardware'; subcategory = 'Monitor'; confidence = 0.8; }
    else if (/printer|print|toner|paper jam/i.test(text)) { category = 'Hardware'; subcategory = 'Printer'; confidence = 0.8; }
    else if (/keyboard/i.test(text)) { category = 'Hardware'; subcategory = 'Keyboard'; confidence = 0.8; }
    else if (/mouse|trackpad/i.test(text)) { category = 'Hardware'; subcategory = 'Mouse'; confidence = 0.8; }
    else if (/headphone|headset|speaker|audio|sound/i.test(text)) { category = 'Hardware'; subcategory = 'Peripherals'; confidence = 0.7; }
    else if (/laptop|computer|desktop|pc|mac/i.test(text)) { category = 'Hardware'; subcategory = 'Computer'; confidence = 0.7; }
    else if (/phone|voip|telephone/i.test(text)) { category = 'Hardware'; subcategory = 'Phone'; confidence = 0.7; }
    else if (/projector|smartboard|interactive/i.test(text)) { category = 'Hardware'; subcategory = 'Classroom Technology'; confidence = 0.7; }
    else if (/charger|cable|adapter|dongle/i.test(text)) { category = 'Hardware'; subcategory = 'Accessories'; confidence = 0.6; }

    // Software rules
    else if (/install|setup|download/i.test(text)) { category = 'Software'; subcategory = 'Installation'; confidence = 0.7; }
    else if (/update|upgrade|patch/i.test(text)) { category = 'Software'; subcategory = 'Update'; confidence = 0.7; }
    else if (/license|activation|key/i.test(text)) { category = 'Software'; subcategory = 'Licensing'; confidence = 0.7; }
    else if (/crash|freeze|hang|not responding|blue screen/i.test(text)) { category = 'Software'; subcategory = 'Application Error'; confidence = 0.8; }
    else if (/outlook|email|office|word|excel|teams/i.test(text)) { category = 'Software'; subcategory = 'Microsoft Office'; confidence = 0.7; }
    else if (/chrome|browser|firefox|safari|internet/i.test(text)) { category = 'Software'; subcategory = 'Web Browser'; confidence = 0.7; }

    // Network rules
    else if (/wifi|wi-fi|wireless|network|internet|connect/i.test(text)) { category = 'Network'; subcategory = 'Connectivity'; confidence = 0.8; }
    else if (/vpn/i.test(text)) { category = 'Network'; subcategory = 'VPN'; confidence = 0.8; }
    else if (/slow|speed|bandwidth|lag/i.test(text)) { category = 'Network'; subcategory = 'Performance'; confidence = 0.6; }

    // Account rules
    else if (/password|login|sign.?in|locked.?out|access|account/i.test(text)) { category = 'Access'; subcategory = 'Account/Password'; confidence = 0.8; }
    else if (/permission|rights|admin/i.test(text)) { category = 'Access'; subcategory = 'Permissions'; confidence = 0.7; }

    // Default
    if (!category) { category = 'Other'; subcategory = 'General'; confidence = 0.3; }

    // Impact assessment
    if (/urgent|emergency|critical|asap|immediately/i.test(text)) impact = '1 - Critical';
    else if (/important|high|many|multiple|all/i.test(text)) impact = '2 - High';
    else if (/low|minor|small|when you can/i.test(text)) impact = '4 - Low';

    return {
      success: true,
      classification: {
        category, subcategory, channel, impact, serviceOffering, confidence,
        improvedDescription,
        keywords: text.split(/\s+/).filter(w => w.length > 3).slice(0, 10).join(',')
      }
    };
  } catch (error) { return { success: false, error: error.message }; }
}

function classifyComputerRepair(rawText) {
  try {
    const text = (rawText || '').toLowerCase();
    let category = '', subcategory = '', impact = '3 - Low';
    let confidence = 0.5;

    if (/screen|display|crack|lcd|broken screen/i.test(text)) { category = 'Hardware'; subcategory = 'Screen/Display'; confidence = 0.8; }
    else if (/battery|charge|power|won't turn on/i.test(text)) { category = 'Hardware'; subcategory = 'Battery/Power'; confidence = 0.8; }
    else if (/keyboard|key|typing/i.test(text)) { category = 'Hardware'; subcategory = 'Keyboard'; confidence = 0.8; }
    else if (/hard drive|ssd|storage|disk/i.test(text)) { category = 'Hardware'; subcategory = 'Storage'; confidence = 0.7; }
    else if (/ram|memory|slow/i.test(text)) { category = 'Hardware'; subcategory = 'Memory/RAM'; confidence = 0.6; }
    else if (/wifi|wireless|bluetooth|network/i.test(text)) { category = 'Hardware'; subcategory = 'Wireless'; confidence = 0.7; }
    else if (/usb|port|hdmi|thunderbolt/i.test(text)) { category = 'Hardware'; subcategory = 'Ports'; confidence = 0.7; }
    else if (/os|windows|macos|reimage|reinstall/i.test(text)) { category = 'Software'; subcategory = 'Operating System'; confidence = 0.7; }
    else if (/virus|malware|infected/i.test(text)) { category = 'Software'; subcategory = 'Malware'; confidence = 0.8; }
    else if (/damage|drop|water|spill|broken/i.test(text)) { category = 'Physical Damage'; subcategory = 'Accidental Damage'; confidence = 0.8; }
    else { category = 'Other'; subcategory = 'General'; confidence = 0.3; }

    return {
      success: true,
      classification: { category, subcategory, impact, confidence, improvedDescription: rawText || '' }
    };
  } catch (error) { return { success: false, error: error.message }; }
}

function saveTrainingEntry(data) {
  try {
    db.insert('ai_training', {
      id: db.generateId(),
      rawDescription: data.rawDescription || '',
      improvedDescription: data.improvedDescription || '',
      category: data.category || '',
      subcategory: data.subcategory || '',
      channel: data.channel || '',
      impact: data.impact || '',
      serviceOffering: data.serviceOffering || '',
      keywords: data.keywords || '',
      aiAccepted: data.aiAccepted ? 1 : 0,
      confidence: data.confidence || 0,
      source: data.source || '',
      incidentId: data.incidentId || '',
      createdAt: new Date().toISOString()
    });
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

function saveCrTrainingEntry(data) {
  try {
    db.insert('cr_training', {
      id: db.generateId(),
      rawDescription: data.rawDescription || '',
      improvedDescription: data.improvedDescription || '',
      category: data.category || '',
      subcategory: data.subcategory || '',
      impact: data.impact || '',
      aiAccepted: data.aiAccepted ? 1 : 0,
      confidence: data.confidence || 0,
      source: data.source || '',
      repairId: data.repairId || '',
      isQuickTicket: data.isQuickTicket ? 1 : 0,
      createdAt: new Date().toISOString()
    });
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

function getTrainingData() {
  try { return db.getAll('ai_training'); } catch (error) { return []; }
}

function findSimilarComputerRepairs(searchText) {
  try {
    if (!searchText || searchText.length < 3) return [];
    const term = '%' + searchText.toLowerCase() + '%';
    return db.query("SELECT * FROM cr_training WHERE LOWER(rawDescription) LIKE ? OR LOWER(improvedDescription) LIKE ? LIMIT 10", [term, term]);
  } catch (error) { return []; }
}

module.exports = {
  classifyIncident, classifyComputerRepair,
  saveTrainingEntry, saveCrTrainingEntry,
  getTrainingData, findSimilarComputerRepairs
};
