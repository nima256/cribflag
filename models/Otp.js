const mongoose = require('mongoose');
const otpSchema = new mongoose.Schema({
  mobile: { type: String, required: true, index: true },
  purpose: { type: String, enum: ['password_reset', 'login', 'signup'], required: true },
  codeHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, default: Date.now }
}, { timestamps: true });
otpSchema.index({ mobile: 1, purpose: 1 }, { unique: true });
module.exports = mongoose.model('Otp', otpSchema);
