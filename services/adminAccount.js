const Admin = require('../models/Admin');
const env = require('../config/env');

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function ensureAdminFromEnv() {
  const email = normalizedEmail(env.adminEmail);
  const password = String(env.adminPassword || '');

  if (!email || !password) {
    throw new Error('ADMIN_EMAIL و ADMIN_PASSWORD باید در فایل .env تنظیم شوند');
  }

  // اول ادمینی را پیدا می‌کنیم که همین ایمیل جدید را دارد.
  let admin = await Admin.findOne({ email }).select('+password');

  // اگر ایمیل عوض شده باشد، ادمین اصلی قبلی را به اطلاعات جدید منتقل می‌کنیم.
  if (!admin) {
    admin = await Admin.findOne({ role: 'superadmin' })
      .sort({ createdAt: 1 })
      .select('+password');
  }

  let created = false;
  let passwordChanged = false;

  if (!admin) {
    admin = new Admin({
      fullName: 'مدیر Crib Flag',
      email,
      mobile: env.adminMobile,
      role: 'superadmin',
      permissions: ['*'],
      isActive: true
    });
    await admin.setPassword(password);
    created = true;
    passwordChanged = true;
  } else {
    admin.email = email;
    if (env.adminMobile) admin.mobile = env.adminMobile;
    admin.role = 'superadmin';
    admin.permissions = ['*'];
    admin.isActive = true;

    const passwordMatches = admin.password
      ? await admin.comparePassword(password)
      : false;

    if (!passwordMatches) {
      await admin.setPassword(password);
      passwordChanged = true;
    }
  }

  if (created || passwordChanged || admin.isModified()) {
    await admin.save();
  }

  return {
    email: admin.email,
    created,
    passwordChanged
  };
}

module.exports = { ensureAdminFromEnv };
