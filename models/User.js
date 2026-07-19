const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const addressSchema = new mongoose.Schema({
  publicId: { type: Number, default: () => Date.now() },
  title: { type: String, required: true, trim: true },
  receiver: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  postal: { type: String, required: true, trim: true },
  province: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  default: { type: Boolean, default: false }
}, { _id: true });

const userSchema = new mongoose.Schema({
  publicId: { type: Number, unique: true, index: true },
  fullName: { type: String, required: true, trim: true },
  mobile: { type: String, required: true, unique: true, index: true },
  email: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['customer', 'business'], default: 'customer' },
  isActive: { type: Boolean, default: true },
  addresses: { type: [addressSchema], default: [] },
  wishlist: { type: [Number], default: [] },
  passwordResetToken: { type: String, select: false },
  passwordResetExpires: { type: Date, select: false },
  passwordChangedAt: Date,
  lastLoginAt: Date
}, { timestamps: true });

userSchema.methods.comparePassword = function(password) { return bcrypt.compare(password, this.password); };
userSchema.methods.setPassword = async function(password) { this.password = await bcrypt.hash(password, 12); };

module.exports = mongoose.model('User', userSchema);
