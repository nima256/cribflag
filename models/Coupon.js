const mongoose = require('mongoose');
const couponSchema = new mongoose.Schema({
  publicId: { type: Number, required: true, unique: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  type: { type: String, enum: ['percent', 'fixed'], required: true },
  value: { type: Number, required: true, min: 0 },
  minOrderAmount: { type: Number, default: 0 },
  usageLimit: { type: Number, default: 0 },
  usedCount: { type: Number, default: 0 },
  expiresAt: Date,
  displayExpires: String,
  status: { type: String, enum: ['active', 'expired'], default: 'active' },
  oneTimePerUser: { type: Boolean, default: false },
  usedBy: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, orderNumber: String }]
}, { timestamps: true });
module.exports = mongoose.model('Coupon', couponSchema);
