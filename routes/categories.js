const express = require('express');
const Category = require('../models/Category');
const Product = require('../models/Product');
const S = require('../services/serializers');
const { asyncHandler, ok } = require('../utils/http');
const { ensureLegacyCategories, listCategories } = require('../services/categories');

const router = express.Router();

router.get('/', asyncHandler(async (_req, res) => {
  await ensureLegacyCategories();
  const categories = await listCategories({ activeOnly: true, withCounts: true });
  ok(res, { categories });
}));

router.get('/:slug/products', asyncHandler(async (req, res) => {
  await ensureLegacyCategories();
  const category = await Category.findOne({ slug: req.params.slug, status: 'active' }).lean();
  if (!category) return ok(res, { category: null, products: [] });
  const categoryDocs = await Category.find({ status: 'active' }).lean();
  const lookup = new Map(categoryDocs.map(item => [String(item._id), item]));
  const products = await Product.find({
    status: 'active',
    $or: [
      { categoryRefs: category._id },
      { primaryCategory: category._id },
      { category: category.name },
      { categories: category.name }
    ]
  }).sort({ publicId: 1 }).lean();
  ok(res, {
    category: { id: category.publicId, name: category.name, slug: category.slug },
    products: products.map(product => S.product(product, lookup))
  });
}));

module.exports = router;
