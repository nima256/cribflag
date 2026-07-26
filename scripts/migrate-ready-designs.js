const mongoose = require('mongoose');
const env = require('../config/env');
const Product = require('../models/Product');
const legacyReadyDesigns = require('../data/readyDesigns');
const { ensureLegacyCategories } = require('../services/categories');

const DEFAULT_SIZES = [
  '۱۵۰ × ۹۰ سانتی‌متر',
  '۱۰۰ × ۷۰ سانتی‌متر',
  '۵۰ × ۷۰ سانتی‌متر'
];
const DEFAULT_FABRICS = ['ساتن آمریکایی', 'ساتن براق', 'مخمل'];
const categoryAliases = {
  اتاق: 'دکور اتاق',
  مناسبتی: 'پرچم مناسبتی'
};

async function normalizeExistingProducts() {
  const products = await Product.find({});
  let changed = 0;
  for (const product of products) {
    const categories = [...new Set([
      product.category,
      ...(Array.isArray(product.categories) ? product.categories : [])
    ].map(item => String(item || '').trim()).filter(Boolean))];
    if (!categories.length) continue;
    if (JSON.stringify(categories) !== JSON.stringify(product.categories || [])) {
      product.categories = categories;
      product.category = categories[0];
      await product.save();
      changed += 1;
    }
  }
  return changed;
}

async function importLegacyReadyDesigns() {
  let imported = 0;
  let skipped = 0;

  for (const [publicId, design] of legacyReadyDesigns.entries()) {
    const sku = `READY-${publicId}`;
    const conflicting = await Product.findOne({ publicId });
    if (conflicting && conflicting.sku !== sku) {
      console.warn(`Skipped ${publicId}: publicId is already used by ${conflicting.sku}.`);
      skipped += 1;
      continue;
    }

    const category = categoryAliases[design.category] || design.category || 'فلگ دیواری';
    const existing = conflicting || await Product.findOne({ sku });
    if (existing) {
      const categories = [...new Set([existing.category, ...(existing.categories || []), category, 'طرح آماده'].filter(Boolean))];
      existing.categories = categories;
      existing.category = categories[0];
      await existing.save();
      continue;
    }

    await Product.create({
      publicId,
      title: design.title,
      sku,
      category,
      categories: [category, 'طرح آماده'],
      price: Number(design.price || 0),
      hasDiscount: false,
      oldPrice: null,
      badge: 'طرح آماده',
      sortDate: publicId,
      rate: 4.7,
      status: 'active',
      sales: 0,
      stock: 999,
      sizes: DEFAULT_SIZES,
      fabrics: DEFAULT_FABRICS,
      image: 'assets/images/ukflag.png',
      images: ['assets/images/ukflag.png'],
      description: design.description || ''
    });
    imported += 1;
  }

  return { imported, skipped };
}

async function run() {
  await mongoose.connect(env.mongodbUri);
  const normalized = await normalizeExistingProducts();
  const { imported, skipped } = await importLegacyReadyDesigns();
  await ensureLegacyCategories();
  console.log(`Category migration completed. Normalized: ${normalized}, imported ready designs: ${imported}, skipped conflicts: ${skipped}.`);
  await mongoose.disconnect();
}

run().catch(async error => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
