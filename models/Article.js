const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
  publicId: { type: Number, required: true, unique: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  slug: { type: String, required: true, unique: true, trim: true, index: true },
  excerpt: { type: String, required: true, trim: true, maxlength: 500 },
  content: { type: String, required: true },
  category: { type: String, required: true, trim: true, index: true },
  tags: { type: [String], default: [] },
  coverImage: { type: String, default: '/assets/images/blog-detail-image-18.svg' },
  status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
  featured: { type: Boolean, default: false },
  authorName: { type: String, trim: true, default: 'مجله Crib Flag' },
  readTime: { type: Number, min: 1, max: 120, default: 5 },
  seoTitle: { type: String, trim: true, maxlength: 180, default: '' },
  metaDescription: { type: String, trim: true, maxlength: 320, default: '' },
  publishedAt: { type: Date, default: null, index: true },
  views: { type: Number, min: 0, default: 0 }
}, { timestamps: true });

articleSchema.pre('validate', function normalizeArticle(next) {
  this.tags = [...new Set((Array.isArray(this.tags) ? this.tags : [])
    .map(item => String(item || '').trim())
    .filter(Boolean))];
  if (this.status === 'published' && !this.publishedAt) this.publishedAt = new Date();
  next();
});

module.exports = mongoose.model('Article', articleSchema);
