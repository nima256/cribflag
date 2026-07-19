const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  mobile: String,
  password: { type: String, required: true, select: false },
  role: { type: String, default: 'superadmin' },
  permissions: { type: [String], default: ['*'] },
  isActive: { type: Boolean, default: true },
  lastLoginAt: Date,
  lastLoginIP: String
}, { timestamps: true });

adminSchema.methods.comparePassword = function(password) { return bcrypt.compare(password, this.password); };
adminSchema.methods.setPassword = async function(password) { this.password = await bcrypt.hash(password, 12); };
module.exports = mongoose.model('Admin', adminSchema);
