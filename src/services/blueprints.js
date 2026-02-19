const db = require('../database/db');
const fs = require('fs');
const path = require('path');

function getBlueprintsDir() {
  const userDataPath = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
  const dir = path.join(userDataPath, 'blueprints');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getBlueprints() {
  try { return db.getAll('blueprints'); }
  catch (error) { console.error('Error getting blueprints:', error); return []; }
}

function saveBlueprint(blueprint) {
  try {
    const now = new Date().toISOString();
    const data = {
      id: blueprint.id || db.generateId(),
      name: blueprint.name || 'Blueprint',
      imageData: blueprint.imageData || '',
      createdAt: blueprint.createdAt || now,
      updatedAt: now
    };
    db.upsert('blueprints', data);
    return { success: true, blueprint: data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function deleteBlueprint(blueprintId) {
  try {
    const bp = db.getById('blueprints', blueprintId);
    if (!bp) return { success: false, error: 'Blueprint not found' };

    // Delete local file if it exists
    if (bp.imageData && bp.imageData.startsWith('local:')) {
      const filename = bp.imageData.substring(6);
      const filePath = path.join(getBlueprintsDir(), filename);
      try { fs.unlinkSync(filePath); } catch (e) {}
    }

    db.deleteById('blueprints', blueprintId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function saveBlueprintImage(blueprintId, base64DataUrl) {
  try {
    const parts = base64DataUrl.split(',');
    const mimeMatch = parts[0].match(/data:(.*?);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const ext = mimeType === 'image/png' ? '.png' : '.jpg';
    const base64Data = parts[1];

    const dir = getBlueprintsDir();
    const filename = blueprintId + ext;
    const filePath = path.join(dir, filename);

    // Delete old files for this blueprint
    try { fs.unlinkSync(path.join(dir, blueprintId + '.jpg')); } catch (e) {}
    try { fs.unlinkSync(path.join(dir, blueprintId + '.png')); } catch (e) {}

    // Write new file
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    // Update database
    const now = new Date().toISOString();
    db.run('UPDATE blueprints SET imageData = ?, updatedAt = ? WHERE id = ?',
      ['local:' + filename, now, blueprintId]);

    return { success: true, driveFileId: filename };
  } catch (error) {
    console.error('saveBlueprintImage error:', error);
    return { success: false, error: error.message };
  }
}

function getBlueprintImage(fileRef) {
  try {
    const dir = getBlueprintsDir();
    let filename = fileRef;

    // Handle legacy 'drive:' prefix or 'local:' prefix
    if (filename.startsWith('drive:') || filename.startsWith('local:')) {
      filename = filename.substring(6);
    }

    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) {
      // Try with different extensions
      const base = filename.replace(/\.(jpg|png)$/, '');
      for (const ext of ['.jpg', '.png']) {
        const altPath = path.join(dir, base + ext);
        if (fs.existsSync(altPath)) {
          const data = fs.readFileSync(altPath);
          const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
          return { success: true, imageData: 'data:' + mime + ';base64,' + data.toString('base64') };
        }
      }
      return { success: false, error: 'File not found' };
    }

    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    return { success: true, imageData: 'data:' + mime + ';base64,' + data.toString('base64') };
  } catch (error) {
    console.error('getBlueprintImage error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getBlueprints, saveBlueprint, deleteBlueprint,
  saveBlueprintImage, getBlueprintImage
};
