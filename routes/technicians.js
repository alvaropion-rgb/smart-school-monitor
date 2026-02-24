const express = require('express');
const router = express.Router();
const db = require('../db/database');

// ============================================
// TECHNICIANS CRUD
// ============================================

router.post('/getTechnicians', (req, res) => {
  try {
    const all = db.getAll('technicians');
    // Only return active technicians (filter out soft-deleted)
    const active = all.filter(t => t.active !== false && t.active !== 'false');
    res.json(active);
  } catch (error) {
    console.error('Error getting technicians:', error);
    res.json([]);
  }
});

router.post('/saveTechnician', (req, res) => {
  try {
    const [technician] = req.body.args || [];
    const now = new Date().toISOString();

    const techData = {
      id: technician.id || db.generateId(),
      name: technician.name || '',
      email: technician.email || '',
      phone: technician.phone || '',
      active: technician.active !== false ? 'true' : 'false',
      createdAt: technician.createdAt || now,
      updatedAt: now
    };

    const existing = db.getById('technicians', techData.id);

    if (existing) {
      // Update existing
      db.update('technicians', techData.id, {
        name: techData.name,
        email: techData.email,
        phone: techData.phone,
        active: techData.active,
        updatedAt: now
      });
    } else {
      // Insert new
      db.insert('technicians', techData);
    }

    res.json({ success: true, technician: techData });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

router.post('/deleteTechnician', (req, res) => {
  try {
    const [techId] = req.body.args || [];
    const existing = db.getById('technicians', techId);

    if (!existing) {
      return res.json({ success: false, error: 'Technician not found' });
    }

    // Soft delete: set active to 'false'
    db.update('technicians', techId, {
      active: 'false',
      updatedAt: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;
