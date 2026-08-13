const mongoose = require('mongoose');
const env = require('../config/env');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { detectPillowMode, fixedProductPricing } = require('../utils/pillowPricing');
const { prepareProductPricing } = require('../utils/productPricing');

async function categoryNamesById() {
  const categories = await Category.find({}).select('_id name slug').lean();
  return new Map(categories.map(category => [String(category._id), category]));
}

function productCategoryValues(product, categoryMap) {
  const values = [product.category, ...(Array.isArray(product.categories) ? product.categories : [])];
  const refs = [product.primaryCategory, ...(Array.isArray(product.categoryRefs) ? product.categoryRefs : [])]
    .map(value => String(value || ''))
    .filter(Boolean);

  for (const ref of refs) {
    const category = categoryMap.get(ref);
    if (category) values.push(category.name, category.slug);
  }
  return values;
}

async function run() {
  await mongoose.connect(env.mongodbUri);
  const categoryMap = await categoryNamesById();
  const products = await Product.find({});
  let updated = 0;

  for (const product of products) {
    const mode = detectPillowMode(productCategoryValues(product, categoryMap));
    if (!mode) continue;

    const defaults = fixedProductPricing(mode);
    const allowedSizes = new Set(defaults.sizes);
    const allowedFabrics = new Set(defaults.fabrics);
    const currentSizes = (Array.isArray(product.sizes) ? product.sizes : []).filter(size => allowedSizes.has(size));
    const currentFabrics = (Array.isArray(product.fabrics) ? product.fabrics : []).filter(fabric => allowedFabrics.has(fabric));
    const sizes = currentSizes.length ? currentSizes : defaults.sizes;
    const fabrics = currentFabrics.length ? currentFabrics : defaults.fabrics;

    const key = (size, fabric) => `${String(size || '').trim()}\u0000${String(fabric || '').trim()}`;
    const defaultByKey = new Map(defaults.variantPrices.map(item => [key(item.size, item.fabric), item]));
    const currentByKey = new Map((Array.isArray(product.variantPrices) ? product.variantPrices : [])
      .filter(item => sizes.includes(item.size) && fabrics.includes(item.fabric) && Number.isFinite(Number(item.price)) && Number(item.price) >= 0)
      .map(item => [key(item.size, item.fabric), item]));

    const variantPrices = sizes.flatMap(size => fabrics.map(fabric => {
      const current = currentByKey.get(key(size, fabric));
      const fallback = defaultByKey.get(key(size, fabric));
      return current || fallback;
    })).filter(Boolean);
    const pricing = prepareProductPricing({
      price: product.price,
      hasDiscount: product.hasDiscount,
      oldPrice: product.oldPrice,
      variantPrices
    });

    product.sizes = sizes;
    product.fabrics = fabrics;
    product.price = pricing.price;
    product.hasDiscount = pricing.hasDiscount;
    product.oldPrice = pricing.oldPrice;
    product.variantPrices = pricing.variantPrices;
    await product.save();
    updated += 1;
  }

  console.log(`Pillow pricing migration completed. Seeded/normalized products: ${updated}.`);
  await mongoose.disconnect();
}

run().catch(async error => {
  console.error('Pillow pricing migration failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
