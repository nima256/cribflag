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
  // فیلدهای متنی برای سازگاری با سفارش‌ها و داده‌های قبلی حفظ شده‌اند.
  category: { type: String, required: true, index: true },
  categories: { type: [String], default: [], index: true },
  // مرجع واقعی دسته‌بندی‌ها در دیتابیس.
  primaryCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
  categoryRefs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true }],
  price: { type: Number, required: true, min: 0 },
  hasDiscount: { type: Boolean, default: false },
  oldPrice: { type: Number, min: 0, default: null },
  variantPrices: { type: [variantPriceSchema], default: [] },
  badge: { type: String, default: '' },
  // جایگاه‌های مستقل صفحه اصلی؛ null یعنی این محصول در آن بخش انتخاب نشده است.
  homeSpecialPosition: { type: Number, min: 1, max: 4, default: null },
  homeBestSellerPosition: { type: Number, min: 1, max: 4, default: null },
  sortDate: { type: Number, default: 1 },
  rate: { type: Number, default: 4.7, min: 0, max: 5 },
  status: { type: String, enum: ['active', 'draft'], default: 'active' },
  sales: { type: Number, default: 0, min: 0 },
  inventoryMode: { type: String, enum: ['unlimited', 'managed'], default: 'unlimited', index: true },
  stock: { type: Number, default: 0, min: 0 },
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
