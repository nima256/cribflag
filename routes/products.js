const express = require('express');
const Product = require('../models/Product');
const S = require('../services/serializers');
const { asyncHandler, ok, AppError } = require('../utils/http');
const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const filter = { status: 'active' };
  if (req.query.category) filter.category = req.query.category;
  const products = await Product.find(filter).sort({ publicId: 1 }).lean();
  ok(res, { products: products.map(S.product) });
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const product = await Product.findOne({ publicId: Number(req.params.id), status: 'active' }).lean();
  if (!product) throw new AppError(404, 'محصول یافت نشد');
  ok(res, { product: S.product(product) });
}));
module.exports = router;
