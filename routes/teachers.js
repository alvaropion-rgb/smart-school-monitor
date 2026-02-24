const express = require('express');
const router = express.Router();
const db = require('../db/database');

// ============================================
// TEACHERS CRUD
// ============================================

router.post('/getTeachers', (req, res) => {
  try {
    const teachers = db.getAll('teachers');
    res.json(teachers);
  } catch (error) {
    console.error('Error getting teachers:', error);
    res.json([]);
  }
});

router.post('/saveTeacher', (req, res) => {
  try {
    const [teacher] = req.body.args || [];
    const now = new Date().toISOString();

    const teacherData = {
      id: teacher.id || db.generateId(),
      empId: teacher.empId || '',
      name: teacher.name || '',
      email: teacher.email || '',
      roomNumber: teacher.roomNumber || '',
      createdAt: teacher.createdAt || now,
      updatedAt: now
    };

    const existing = db.getById('teachers', teacherData.id);

    if (existing) {
      // Update existing
      db.update('teachers', teacherData.id, {
        empId: teacherData.empId,
        name: teacherData.name,
        email: teacherData.email,
        roomNumber: teacherData.roomNumber,
        updatedAt: now
      });
    } else {
      // Insert new
      db.insert('teachers', teacherData);
    }

    res.json({ success: true, teacher: teacherData });
  } catch (error) {
    console.error('Error saving teacher:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/deleteTeacher', (req, res) => {
  try {
    const [teacherId] = req.body.args || [];
    const existing = db.getById('teachers', teacherId);

    if (!existing) {
      return res.json({ success: false, error: 'Teacher not found' });
    }

    db.remove('teachers', teacherId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting teacher:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/deleteAllTeachers', (req, res) => {
  try {
    const countBefore = db.count('teachers');
    db.clearTable('teachers');
    res.json({ success: true, deleted: countBefore });
  } catch (error) {
    console.error('Error deleting all teachers:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// IMPORT / EXPORT
// ============================================

router.post('/importTeachers', (req, res) => {
  try {
    const [csvData] = req.body.args || [];
    const now = new Date().toISOString();
    let imported = 0;
    let updated = 0;

    // Load existing teachers once before the loop
    const existingTeachers = db.getAll('teachers');

    csvData.forEach(row => {
      const teacherData = {
        id: db.generateId(),
        empId: row.empId || row['emp id'] || row['Employee ID'] || row['EmpID'] || '',
        name: row.name || row['Name'] || row['Teacher Name'] || '',
        email: row.email || row['Email'] || row['E-mail'] || '',
        roomNumber: row.roomNumber || row['room number'] || row['Room Number'] || row['Room'] || '',
        createdAt: now,
        updatedAt: now
      };

      // Check if teacher with same empId already exists
      const existing = existingTeachers.find(t => t.empId === teacherData.empId && teacherData.empId !== '');

      if (existing) {
        // Update existing teacher
        db.update('teachers', existing.id, {
          empId: teacherData.empId,
          name: teacherData.name,
          email: teacherData.email,
          roomNumber: teacherData.roomNumber,
          updatedAt: now
        });
        updated++;
      } else {
        // Add new teacher
        db.insert('teachers', teacherData);
        imported++;
      }
    });

    res.json({ success: true, imported: imported, updated: updated });
  } catch (error) {
    console.error('Error importing teachers:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/exportTeachers', (req, res) => {
  try {
    const teachers = db.getAll('teachers');
    res.json({
      success: true,
      data: teachers.map(t => ({
        empId: t.empId,
        name: t.name,
        email: t.email,
        roomNumber: t.roomNumber
      }))
    });
  } catch (error) {
    console.error('Error exporting teachers:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// EMPLOYEE LOOKUP
// ============================================

router.post('/lookupEmployee', (req, res) => {
  try {
    const [searchTerm] = req.body.args || [];
    const search = String(searchTerm).trim();
    const searchLower = search.toLowerCase();

    const teachers = db.getAll('teachers');

    // First try exact employee ID match (prioritized)
    let employee = teachers.find(t => String(t.empId).trim() === search);

    // If not found by ID, try searching by name
    if (!employee) {
      // First try exact name match (case-insensitive)
      employee = teachers.find(t =>
        String(t.name || '').toLowerCase() === searchLower
      );

      // If still not found, try partial name match (name contains search term)
      if (!employee) {
        employee = teachers.find(t =>
          String(t.name || '').toLowerCase().includes(searchLower)
        );
      }
    }

    if (employee) {
      return res.json({
        success: true,
        employee: {
          empId: employee.empId,
          name: employee.name,
          email: employee.email,
          roomNumber: employee.roomNumber
        }
      });
    }

    res.json({ success: false, error: 'Employee not found' });
  } catch (error) {
    console.error('Error looking up employee:', error);
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;
