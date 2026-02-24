/**
 * Blueprint Storage Service - Replaces Google Drive storage
 * Stores blueprint images as files on the local filesystem
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Ensure blueprint directory exists
const blueprintDir = path.resolve(config.BLUEPRINT_DIR);
if (!fs.existsSync(blueprintDir)) {
  fs.mkdirSync(blueprintDir, { recursive: true });
}

/**
 * Save a blueprint image from a base64 data URL
 * @param {string} blueprintId
 * @param {string} base64DataUrl - Full data URL (data:image/jpeg;base64,...)
 * @returns {Object} { success, driveFileId (actually filename), error }
 */
function saveBlueprintImage(blueprintId, base64DataUrl) {
  try {
    // Parse the data URL
    var parts = base64DataUrl.split(',');
    var mimeMatch = parts[0].match(/data:(.*?);/);
    var mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    var ext = mimeType === 'image/png' ? '.png' : '.jpg';
    var buffer = Buffer.from(parts[1], 'base64');

    var filename = blueprintId + ext;
    var filepath = path.join(blueprintDir, filename);

    // Delete old files for this blueprint
    ['.jpg', '.png', '.jpeg'].forEach(function(oldExt) {
      var oldPath = path.join(blueprintDir, blueprintId + oldExt);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    });

    fs.writeFileSync(filepath, buffer);

    return { success: true, driveFileId: filename };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get a blueprint image as a base64 data URL
 * @param {string} fileRef - filename or legacy drive file ID
 * @returns {Object} { success, imageData, error }
 */
function getBlueprintImage(fileRef) {
  try {
    var filepath = path.join(blueprintDir, fileRef);

    if (!fs.existsSync(filepath)) {
      return { success: false, error: 'File not found: ' + fileRef };
    }

    var buffer = fs.readFileSync(filepath);
    var ext = path.extname(fileRef).toLowerCase();
    var mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    var dataUrl = 'data:' + mimeType + ';base64,' + buffer.toString('base64');

    return { success: true, imageData: dataUrl };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete a blueprint image
 * @param {string} fileRef
 */
function deleteBlueprintImage(fileRef) {
  try {
    var filepath = path.join(blueprintDir, fileRef);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { saveBlueprintImage, getBlueprintImage, deleteBlueprintImage };
