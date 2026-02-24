const express = require('express');
const router = express.Router();
const db = require('../db/database');
const blueprintStorage = require('../services/blueprintStorage');

// getBlueprints
router.post('/getBlueprints', (req, res) => {
  try {
    var blueprints = db.getAll('blueprints');
    res.json(blueprints);
  } catch (error) {
    res.json([]);
  }
});

// saveBlueprint
router.post('/saveBlueprint', (req, res) => {
  try {
    var [blueprint] = req.body.args || [req.body];
    var now = new Date().toISOString();
    var blueprintData = {
      id: blueprint.id || db.generateId(),
      name: blueprint.name || 'Blueprint',
      imageData: blueprint.imageData || '',
      createdAt: blueprint.createdAt || now,
      updatedAt: now
    };

    var existing = db.getById('blueprints', blueprintData.id);
    if (existing) {
      db.update('blueprints', blueprintData.id, blueprintData);
    } else {
      db.insert('blueprints', blueprintData);
    }

    res.json({ success: true, blueprint: blueprintData });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// deleteBlueprint
router.post('/deleteBlueprint', (req, res) => {
  try {
    var [blueprintId] = req.body.args || [];
    var existing = db.getById('blueprints', blueprintId);

    if (existing) {
      // Delete image file if stored locally
      if (existing.imageData && existing.imageData.startsWith('drive:')) {
        var fileRef = existing.imageData.substring(6);
        blueprintStorage.deleteBlueprintImage(fileRef);
      } else if (existing.imageData && existing.imageData.startsWith('file:')) {
        var fileRef = existing.imageData.substring(5);
        blueprintStorage.deleteBlueprintImage(fileRef);
      }
      db.remove('blueprints', blueprintId);
      res.json({ success: true });
    } else {
      res.json({ success: false, error: 'Blueprint not found' });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// saveBlueprintImage - Save base64 image to filesystem
router.post('/saveBlueprintImage', (req, res) => {
  try {
    var [blueprintId, base64DataUrl] = req.body.args || [];

    var result = blueprintStorage.saveBlueprintImage(blueprintId, base64DataUrl);

    if (result.success) {
      // Update blueprint record with file reference
      var existing = db.getById('blueprints', blueprintId);
      if (existing) {
        db.update('blueprints', blueprintId, {
          imageData: 'drive:' + result.driveFileId, // Keep 'drive:' prefix for frontend compatibility
          updatedAt: new Date().toISOString()
        });
      }
    }

    res.json(result);
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// getBlueprintImage - Retrieve image as base64 data URL
router.post('/getBlueprintImage', (req, res) => {
  try {
    var [fileRef] = req.body.args || [];
    var result = blueprintStorage.getBlueprintImage(fileRef);
    res.json(result);
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;
