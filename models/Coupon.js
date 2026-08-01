const mongoose = require('mongoose');

const eligibleVariantSchema = new mongoose.Schema({
  size: { type: String, required: true, trim: true },
  fabric: { type: String, required: true, trim: true }
}, { _id: false });

const couponSchema = new mongoose.Schema({
  publicId: { type: Number, required: true, unique: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  type: { type: String, enum: ['percent', 'fixed'], required: true },
  value: { type: Number, required: true, min: 0 },
  minOrderAmount: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  applicability: { type: String, enum: ['all', 'variants'], default: 'all' },
  eligibleVariants: { type: [eligibleVariantSchema], default: [] },
  usageLimit: { type: Number, default: 0 },
  usedCount: { type: Number, default: 0 },
  expiresAt: Date,
  displayExpires: String,
  status: { type: String, enum: ['active', 'expired'], default: 'active' },
  oneTimePerUser: { type: Boolean, default: false },
  usedBy: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, orderNumber: String }]
}, { timestamps: true });

couponSchema.pre('validate', function normalizeEligibleVariants(next) {
  const unique = new Map();
  for (const item of Array.isArray(this.eligibleVariants) ? this.eligibleVariants : []) {
    const size = String(item?.size || '').trim();
    const fabric = String(item?.fabric || '').trim();
    if (size && fabric) unique.set(`${size}\u0000${fabric}`, { size, fabric });
  }
  this.eligibleVariants = [...unique.values()];
  if (this.applicability !== 'variants') this.eligibleVariants = [];
  next();
});

module.exports = mongoose.model('Coupon', couponSchema);
