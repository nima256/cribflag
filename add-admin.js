'use strict';

const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

require('dotenv').config({
  path: path.join(__dirname, '.env')
});

// اگر مسیر مدل ادمین متفاوت است، این خط را اصلاح کن
const Admin = require('./models/Admin');

async function addAdmin() {
  try {
    const email = process.argv[2]?.trim().toLowerCase();
    const password = process.argv[3];
    const mobile = process.argv[4]?.trim();

    if (!email || !password) {
      throw new Error(
        'نحوه اجرا:\nnode add-admin.js email@example.com "StrongPassword" 09120000000'
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('ایمیل واردشده معتبر نیست');
    }

    if (password.length < 8) {
      throw new Error('رمز عبور باید حداقل ۸ کاراکتر باشد');
    }

    if (!process.env.MONGODB_URI) {
      throw new Error('مقدار MONGODB_URI داخل فایل .env تنظیم نشده است');
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const existingAdmin = await Admin.findOne({ email });

    if (existingAdmin) {
      throw new Error('یک ادمین با این ایمیل از قبل وجود دارد');
    }

    /*
     * اگر مدل Admin دارای pre("save") برای هش‌کردن رمز است،
     * password را مستقیم ذخیره کن.
     *
     * اگر مدل خودش رمز را هش نمی‌کند، مقدار hashedPassword را استفاده کن.
     */
    const hasPasswordHashMiddleware = Admin.schema
      .s.hooks
      ._pres
      ?.get('save')
      ?.length > 0;

    const passwordToSave = hasPasswordHashMiddleware
      ? password
      : await bcrypt.hash(password, 12);

    const adminData = {
      email,
      password: passwordToSave
    };

    // این فیلدها فقط درصورتی اضافه می‌شوند که در مدل وجود داشته باشند
    if (mobile && Admin.schema.path('mobile')) {
      adminData.mobile = mobile;
    }

    if (Admin.schema.path('isActive')) {
      adminData.isActive = true;
    }

    if (Admin.schema.path('role')) {
      adminData.role = 'admin';
    }

    const admin = await Admin.create(adminData);

    console.log('✅ ادمین با موفقیت ساخته شد');
    console.log(`ایمیل: ${admin.email}`);
    console.log(`شناسه: ${admin._id}`);
  } catch (error) {
    console.error(`❌ خطا: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

addAdmin();