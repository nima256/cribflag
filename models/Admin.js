const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(value || ''));
}

function safePlainTextCompare(input, stored) {
  const inputBuffer = Buffer.from(String(input || ''), 'utf8');
  const storedBuffer = Buffer.from(String(stored || ''), 'utf8');

  return inputBuffer.length === storedBuffer.length
    && crypto.timingSafeEqual(inputBuffer, storedBuffer);
}

const adminSchema = new mongoose.Schema({
  fullName: { type: String, default: 'ادمین' },
  email: { type: String, required: true, unique: true, lowercase: true },
  mobile: String,
  password: { type: String, required: true, select: false },
  role: { type: String, default: 'superadmin' },
  permissions: { type: [String], default: ['*'] },
  isActive: { type: Boolean, default: true },
  lastLoginAt: Date,
  lastLoginIP: String
}, { timestamps: true });

// از ذخیره‌شدن رمز ساده برای ادمین‌های جدید یا ویرایش‌شده جلوگیری می‌کند.
adminSchema.pre('save', async function hashAdminPassword() {
  if (!this.isModified('password') || !this.password || isBcryptHash(this.password)) return;
  this.password = await bcrypt.hash(String(this.password), 12);
});

adminSchema.methods.comparePassword = async function comparePassword(password) {
  const storedPassword = String(this.password || '');
  if (!storedPassword) return false;

  if (isBcryptHash(storedPassword)) {
    return bcrypt.compare(String(password || ''), storedPassword);
  }

  // سازگاری موقت با ادمین‌های قدیمی که رمز آن‌ها به‌صورت ساده وارد دیتابیس شده است.
  return safePlainTextCompare(password, storedPassword);
};

adminSchema.methods.passwordNeedsHash = function passwordNeedsHash() {
  return !isBcryptHash(this.password);
};

adminSchema.methods.setPassword = async function setPassword(password) {
  this.password = await bcrypt.hash(String(password), 12);
};

module.exports = mongoose.model('Admin', adminSchema);
