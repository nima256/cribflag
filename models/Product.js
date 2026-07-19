const mongoose = require('mongoose');

const variantPriceSchema = new mongoose.Schema({
  size: { type: String, required: true, trim: true },
  fabric: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  hasDiscount: { type: Boolean, default: false },
  oldPrice: { type: Number, min: 0, default: null }
}, { _id: false });

const productSchema = new mongoose.Schema({
  publicId: { type: Number, required: true, unique: true, index: true },
  title: { type: String, required: true, trim: true },
  sku: { type: String, required: true, unique: true, trim: true, uppercase: true },
  // category برای سازگاری با داده‌های قدیمی، دسته اصلی محصول است.
  category: { type: String, required: true, index: true },
  // categories امکان حضور هم‌زمان محصول در چند بخش فروشگاه را فراهم می‌کند.
  categories: { type: [String], default: [], index: true },
  price: { type: Number, required: true, min: 0 },
  hasDiscount: { type: Boolean, default: false },
  oldPrice: { type: Number, min: 0, default: null },
  variantPrices: { type: [variantPriceSchema], default: [] },
  badge: { type: String, default: '' },
  sortDate: { type: Number, default: 1 },
  rate: { type: Number, default: 4.7, min: 0, max: 5 },
  status: { type: String, enum: ['active', 'draft'], default: 'active' },
  sales: { type: Number, default: 0, min: 0 },
  stock: { type: Number, default: 999, min: 0 },
  sizes: { type: [String], default: [] },
  fabrics: { type: [String], default: [] },
  image: { type: String, default: 'assets/images/ukflag.png' },
  images: { type: [String], default: [] },
  description: { type: String, default: '' }
}, { timestamps: true });

productSchema.pre('validate', function normalizeCategories(next) {
  let categories = [...new Set((Array.isArray(this.categories) ? this.categories : [])
    .map(item => String(item || '').trim())
    .filter(Boolean))];
  const legacyCategory = String(this.category || '').trim();
  if (legacyCategory) categories = [legacyCategory, ...categories.filter(item => item !== legacyCategory)];
  if (!legacyCategory && categories.length) this.category = categories[0];
  this.categories = categories;
  next();
});

module.exports = mongoose.model('Product', productSchema);
