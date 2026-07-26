const mongoose = require('mongoose');

function normalizeSlug(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const categorySchema = new mongoose.Schema({
  publicId: { type: Number, required: true, unique: true, index: true },
  name: { type: String, required: true, unique: true, trim: true, index: true },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
  description: { type: String, default: '', trim: true },
  image: { type: String, default: '', trim: true },
  status: { type: String, enum: ['active', 'draft'], default: 'active', index: true },
  sortOrder: { type: Number, default: 0, index: true },
  showInMenu: { type: Boolean, default: true },
  showInStore: { type: Boolean, default: true },
  showInHome: { type: Boolean, default: true },
  showInReady: { type: Boolean, default: false },
  isReadyRoot: { type: Boolean, default: false, index: true }
}, { timestamps: true });

categorySchema.pre('validate', function normalizeCategory(next) {
  this.name = String(this.name || '').trim();
  this.slug = normalizeSlug(this.slug || this.name);
  next();
});

categorySchema.statics.normalizeSlug = normalizeSlug;

module.exports = mongoose.model('Category', categorySchema);
