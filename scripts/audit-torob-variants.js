#!/usr/bin/env node
'use strict';

const mongoose = require('mongoose');
const env = require('../config/env');
const Product = require('../models/Product');
const {
  getProductVariants,
  formatProductForTorob,
  isAvailable
} = require('../helper/torobProductMeta');

const argValue = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
};

(async () => {
  const database = String(argValue('--database') || '').trim();
  await mongoose.connect(env.mongodbUri, database ? { dbName: database } : undefined);

  const products = await Product.find({ status: 'active' })
    .select('publicId title sku category categories price hasDiscount oldPrice variantPrices status inventoryMode stock sizes fabrics image images description createdAt updatedAt')
    .sort({ publicId: 1 })
    .lean();

  const items = [];
  const feedErrors = [];
  const perProduct = [];

  for (const product of products) {
    try {
      const variants = getProductVariants(product);
      const formatted = variants.map(variant => formatProductForTorob(product, variant));
      const parentAvailability = isAvailable(product);
      const availabilityMismatches = formatted.filter(item => item.availability !== parentAvailability).length;
      const badPrices = formatted.filter(item => item.availability && !(Number(item.current_price) > 0)).length;
      const missingUrls = formatted.filter(item => !item.page_url).length;
      const missingImages = formatted.filter(item => !Array.isArray(item.image_links) || !item.image_links.length).length;
      const badGroups = formatted.filter(item => String(item.product_group_id) !== String(product.publicId)).length;
      const badSpec = formatted.filter((item, index) => {
        const variant = variants[index];
        if (variant.size && item.spec?.['سایز'] !== variant.size) return true;
        if (variant.fabric && item.spec?.['جنس پارچه'] !== variant.fabric) return true;
        return false;
      }).length;

      if (!variants.length) feedErrors.push({ id: product.publicId, title: product.title, error: 'no-variants' });
      if (availabilityMismatches) feedErrors.push({ id: product.publicId, title: product.title, error: 'global-availability-mismatch', count: availabilityMismatches });
      if (badPrices) feedErrors.push({ id: product.publicId, title: product.title, error: 'available-zero-price', count: badPrices });
      if (missingUrls) feedErrors.push({ id: product.publicId, title: product.title, error: 'missing-page-url', count: missingUrls });
      if (missingImages) feedErrors.push({ id: product.publicId, title: product.title, error: 'missing-images', count: missingImages });
      if (badGroups) feedErrors.push({ id: product.publicId, title: product.title, error: 'bad-product-group-id', count: badGroups });
      if (badSpec) feedErrors.push({ id: product.publicId, title: product.title, error: 'variant-spec-mismatch', count: badSpec });

      items.push(...formatted);
      perProduct.push({
        id: product.publicId,
        title: product.title,
        sizes: Array.isArray(product.sizes) ? product.sizes.length : 0,
        fabrics: Array.isArray(product.fabrics) ? product.fabrics.length : 0,
        variants: formatted.length,
        availability: parentAvailability,
        stockMode: product.inventoryMode,
        stock: product.inventoryMode === 'managed' ? Number(product.stock || 0) : null
      });
    } catch (error) {
      feedErrors.push({ id: product.publicId, title: product.title, error: error.message });
    }
  }

  const ids = items.map(item => item.page_unique);
  const duplicatePageUniques = ids.length - new Set(ids).size;
  const available = items.filter(item => item.availability === true);
  const unavailable = items.filter(item => item.availability === false);

  console.log(JSON.stringify({
    mode: 'READ ONLY',
    database: mongoose.connection.name,
    activeProducts: products.length,
    totalVariants: items.length,
    availableVariants: available.length,
    unavailableVariants: unavailable.length,
    duplicatePageUniques,
    availableWithZeroPrice: available.filter(item => !(Number(item.current_price) > 0)).length,
    unavailableWithNonZeroPrice: unavailable.filter(item => Number(item.current_price) !== 0).length,
    missingPageUrl: items.filter(item => !item.page_url).length,
    missingPageUnique: items.filter(item => !item.page_unique).length,
    feedErrors,
    sampleProducts: perProduct.slice(0, 8),
    sampleVariants: items.slice(0, 8).map(item => ({
      page_unique: item.page_unique,
      title: item.title,
      availability: item.availability,
      current_price: item.current_price,
      page_url: item.page_url
    })),
    rule: 'Availability is parent-product only. Size/fabric combinations never have independent stock.'
  }, null, 2));

  await mongoose.disconnect();
})().catch(async error => {
  console.error(error.stack || error.message || error);
  try { await mongoose.disconnect(); } catch {}
  process.exitCode = 1;
});
