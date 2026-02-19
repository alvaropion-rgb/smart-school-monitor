const settingsService = require('./settings');

function verifySecurityPassword(password) {
  try {
    const settings = settingsService.getSettings();
    const storedPassword = settings.securityPassword || '';
    const isProtected = settings.passwordProtected === 'true';
    if (!isProtected || !storedPassword) return { success: true, valid: true };
    return { success: true, valid: password === storedPassword };
  } catch (error) { return { success: false, error: error.message }; }
}

function setSecurityPassword(newPassword, oldPassword) {
  try {
    const settings = settingsService.getSettings();
    const storedPassword = settings.securityPassword || '';
    const isProtected = settings.passwordProtected === 'true';
    if (isProtected && storedPassword && oldPassword !== storedPassword) {
      return { success: false, error: 'Current password is incorrect' };
    }
    settingsService.saveSetting('securityPassword', newPassword);
    settingsService.saveSetting('passwordProtected', newPassword ? 'true' : 'false');
    return { success: true, message: newPassword ? 'Password set successfully' : 'Password protection disabled' };
  } catch (error) { return { success: false, error: error.message }; }
}

function isPasswordProtected() {
  try {
    const settings = settingsService.getSettings();
    return { success: true, protected: settings.passwordProtected === 'true' && !!settings.securityPassword };
  } catch (error) { return { success: false, protected: false }; }
}

module.exports = { verifySecurityPassword, setSecurityPassword, isPasswordProtected };
