const db = require('../database/db');

// === TECHNICIANS ===
function getTechnicians() {
  try {
    return db.query("SELECT * FROM technicians WHERE active = 1 OR active = 'true'");
  } catch (error) { console.error('Error getting technicians:', error); return []; }
}

function saveTechnician(technician) {
  try {
    const now = new Date().toISOString();
    const data = {
      id: technician.id || db.generateId(),
      name: technician.name || '',
      email: technician.email || '',
      phone: technician.phone || '',
      active: technician.active !== false ? 1 : 0,
      createdAt: technician.createdAt || now,
      updatedAt: now
    };
    db.upsert('technicians', data);
    return { success: true, technician: data };
  } catch (error) { return { success: false, error: error.message }; }
}

function deleteTechnician(techId) {
  try {
    const now = new Date().toISOString();
    db.run('UPDATE technicians SET active = 0, updatedAt = ? WHERE id = ?', [now, techId]);
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

// === TEACHERS ===
function getTeachers() {
  try { return db.getAll('teachers'); }
  catch (error) { console.error('Error getting teachers:', error); return []; }
}

function saveTeacher(teacher) {
  try {
    const now = new Date().toISOString();
    const data = {
      id: teacher.id || db.generateId(),
      empId: teacher.empId || '',
      name: teacher.name || '',
      email: teacher.email || '',
      roomNumber: teacher.roomNumber || '',
      createdAt: teacher.createdAt || now,
      updatedAt: now
    };
    db.upsert('teachers', data);
    return { success: true, teacher: data };
  } catch (error) { return { success: false, error: error.message }; }
}

function deleteTeacher(teacherId) {
  try {
    const result = db.deleteById('teachers', teacherId);
    if (result.changes > 0) return { success: true };
    return { success: false, error: 'Teacher not found' };
  } catch (error) { return { success: false, error: error.message }; }
}

function deleteAllTeachers() {
  try {
    const count = db.getAll('teachers').length;
    db.deleteAll('teachers');
    return { success: true, deleted: count };
  } catch (error) { return { success: false, error: error.message }; }
}

function importTeachers(csvData) {
  try {
    const now = new Date().toISOString();
    let imported = 0, updated = 0;
    const existing = getTeachers();

    for (const row of csvData) {
      const empId = row.empId || row['emp id'] || row['Employee ID'] || row['EmpID'] || '';
      const name = row.name || row['Name'] || row['Teacher Name'] || '';
      const email = row.email || row['Email'] || row['E-mail'] || '';
      const roomNumber = row.roomNumber || row['room number'] || row['Room Number'] || row['Room'] || '';

      const match = existing.find(t => t.empId === empId && empId !== '');
      if (match) {
        db.update('teachers', match.id, { empId, name, email, roomNumber, updatedAt: now });
        updated++;
      } else {
        db.insert('teachers', { id: db.generateId(), empId, name, email, roomNumber, createdAt: now, updatedAt: now });
        imported++;
      }
    }
    return { success: true, imported, updated };
  } catch (error) { return { success: false, error: error.message }; }
}

function exportTeachers() {
  try {
    const teachers = getTeachers();
    return { success: true, data: teachers.map(t => ({ empId: t.empId, name: t.name, email: t.email, roomNumber: t.roomNumber })) };
  } catch (error) { return { success: false, error: error.message }; }
}

function clearAllTeachers() {
  try { db.deleteAll('teachers'); return { success: true }; }
  catch (error) { return { success: false, error: error.message }; }
}

function lookupEmployee(searchTerm) {
  try {
    if (!searchTerm || searchTerm.length < 2) return { success: false, error: 'Search term too short' };
    const term = String(searchTerm).trim();
    const teachers = getTeachers();

    // Exact empId match first
    let match = teachers.find(t => String(t.empId).trim() === term);
    if (match) return { success: true, employee: { empId: match.empId, name: match.name, email: match.email, roomNumber: match.roomNumber || '' } };

    // Partial name match
    const lower = term.toLowerCase();
    match = teachers.find(t => (t.name || '').toLowerCase().includes(lower));
    if (match) return { success: true, employee: { empId: match.empId, name: match.name, email: match.email, roomNumber: match.roomNumber || '' } };

    return { success: false, error: 'Employee not found' };
  } catch (error) { return { success: false, error: error.message }; }
}

module.exports = {
  getTechnicians, saveTechnician, deleteTechnician,
  getTeachers, saveTeacher, deleteTeacher, deleteAllTeachers,
  importTeachers, exportTeachers, clearAllTeachers, lookupEmployee
};
