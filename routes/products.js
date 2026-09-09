const express = require('express');
const Product = require('../models/Product');
const Category = require('../models/Category');
const S = require('../services/serializers');
const { asyncHandler, ok, AppError } = require('../utils/http');
const { ensureLegacyCategories } = require('../services/categories');
const { getCustomPricingConfig } = require('../utils/customPricing');
const router = express.Router();

async function categoryContext() {
  await ensureLegacyCategories();
  const categories = await Category.find({ status: 'active' }).sort({ sortOrder: 1, publicId: 1 }).lean();
  return {
    categories,
    lookup: new Map(categories.map(category => [String(category._id), category]))
  };
}

router.get('/custom-pricing', asyncHandler(async (_req, res) => {
  ok(res, { pricing: await getCustomPricingConfig() });
}));

router.get('/', asyncHandler(async (req, res) => {
  const { categories, lookup } = await categoryContext();
  const filter = { status: 'active' };
  if (req.query.category) {
    const raw = String(req.query.category).trim();
    const numericId = Number(raw);
    const category = categories.find(item =>
      item.slug === raw || item.name === raw || (Number.isFinite(numericId) && item.publicId === numericId)
    );
    filter.$or = category ? [
      { categoryRefs: category._id },
      { primaryCategory: category._id },
      { category: category.name },
      { categories: category.name }
    ] : [
      { category: raw },
      { categories: raw }
    ];
  }
  const products = await Product.find(filter).sort({ publicId: 1 }).lean();
  ok(res, { products: products.map(product => S.product(product, lookup)) });
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const { lookup } = await categoryContext();
  const product = await Product.findOne({ publicId: Number(req.params.id), status: 'active' }).lean();
  if (!product) throw new AppError(404, 'محصول یافت نشد');
  ok(res, { product: S.product(product, lookup) });
}));
module.exports = router;
