const express = require('express');
const Coupon = require('../models/Coupon');
const Product = require('../models/Product');
const { findVariantPricing, fallbackPricing } = require('../utils/productPricing');
const { asyncHandler, ok, AppError } = require('../utils/http');
const router = express.Router();

const normalizeText = value => String(value || '').trim();

function variantKey(size, fabric) {
  return `${normalizeText(size)}\u0000${normalizeText(fabric)}`;
}

function couponVariantSet(coupon) {
  return new Set((coupon?.eligibleVariants || [])
    .map(item => variantKey(item?.size, item?.fabric))
    .filter(key => key !== '\u0000'));
}

function itemIsEligible(coupon, item) {
  if (coupon?.applicability !== 'variants') return true;
  return couponVariantSet(coupon).has(variantKey(item?.size, item?.fabric));
}

function variantDescription(coupon) {
  const labels = (coupon?.eligibleVariants || []).map(item => `${item.size} با ${item.fabric}`);
  if (!labels.length) return 'ترکیب‌های تعیین‌شده';
  const visible = labels.slice(0, 3).join('، ');
  return labels.length > 3 ? `${visible} و ${labels.length - 3} ترکیب دیگر` : visible;
}

async function priceSubmittedItems(rawItems) {
  const submitted = Array.isArray(rawItems) ? rawItems : [];
  if (!submitted.length) throw new AppError(400, 'محصولی برای بررسی کد تخفیف وجود ندارد');

  const publicIds = [...new Set(submitted.map(item => Number(item?.id)).filter(Number.isFinite))];
  const products = await Product.find({ publicId: { $in: publicIds }, status: 'active' });
  const byId = new Map(products.map(product => [Number(product.publicId), product]));
  const items = [];
  let subtotal = 0;

  for (const raw of submitted) {
    const publicId = Number(raw?.id);
    const qty = Number(raw?.qty ?? 1);
    if (!Number.isInteger(publicId)) throw new AppError(400, 'شناسه یکی از محصولات معتبر نیست');
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new AppError(400, 'تعداد یکی از محصولات معتبر نیست');

    const product = byId.get(publicId);
    if (!product) throw new AppError(400, `محصول شماره ${publicId} موجود یا فعال نیست`);

    const sizes = Array.isArray(product.sizes) ? product.sizes : [];
    const fabrics = Array.isArray(product.fabrics) ? product.fabrics : [];
    const size = normalizeText(raw?.size || sizes[0]);
    const fabric = normalizeText(raw?.fabric || fabrics[0]);
    if (sizes.length && !sizes.includes(size)) throw new AppError(400, `سایز انتخاب‌شده برای ${product.title} معتبر نیست`);
    if (fabrics.length && !fabrics.includes(fabric)) throw new AppError(400, `جنس انتخاب‌شده برای ${product.title} معتبر نیست`);

    const variant = findVariantPricing(product, size, fabric);
    if (product.variantPrices?.length && !variant) {
      throw new AppError(400, `برای ترکیب سایز و جنس ${product.title} قیمت ثبت نشده است`);
    }
    const pricing = variant || fallbackPricing(product);
    const price = Number(pricing.price || 0);
    if (!Number.isFinite(price) || price < 0) throw new AppError(400, `قیمت ${product.title} معتبر نیست`);

    items.push({ productId: publicId, title: product.title, size, fabric, price, qty });
    subtotal += price * qty;
  }

  return { items, subtotal };
}

async function calculate(code, pricingInput, userId) {
  const pricing = typeof pricingInput === 'number'
    ? { subtotal: pricingInput, items: [] }
    : (pricingInput || {});
  const items = Array.isArray(pricing.items) ? pricing.items : [];
  const calculatedSubtotal = items.reduce((sum, item) => sum + Number(item?.price || 0) * Number(item?.qty || 1), 0);
  const normalizedSubtotal = Number(pricing.subtotal ?? calculatedSubtotal);

  if (!Number.isFinite(normalizedSubtotal) || normalizedSubtotal <= 0) {
    throw new AppError(400, 'مبلغ سبد خرید معتبر نیست');
  }

  const coupon = await Coupon.findOne({ code: normalizeText(code).toUpperCase() });
  if (!coupon || coupon.status !== 'active') throw new AppError(400, 'کد تخفیف معتبر نیست');
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new AppError(400, 'کد تخفیف منقضی شده است');
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) throw new AppError(400, 'سقف استفاده از کد تخفیف تکمیل شده است');
  if (normalizedSubtotal < coupon.minOrderAmount) {
    const formattedMinimum = new Intl.NumberFormat('fa-IR').format(coupon.minOrderAmount);
    throw new AppError(400, `حداقل خرید برای استفاده از این کد ${formattedMinimum} تومان است`);
  }
  if (coupon.oneTimePerUser && userId && coupon.usedBy.some(x => String(x.user) === String(userId))) {
    throw new AppError(400, 'قبلاً از این کد استفاده کرده‌اید');
  }

  let eligibleSubtotal = normalizedSubtotal;
  if (coupon.applicability === 'variants') {
    if (!items.length) throw new AppError(400, 'برای بررسی این کد، جزئیات سایز و جنس محصولات لازم است');
    eligibleSubtotal = items
      .filter(item => itemIsEligible(coupon, item))
      .reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 1), 0);
    if (eligibleSubtotal <= 0) {
      throw new AppError(400, `این کد فقط برای ${variantDescription(coupon)} قابل استفاده است`);
    }
  }

  const rawAmount = coupon.type === 'fixed'
    ? Number(coupon.value || 0)
    : Math.round(eligibleSubtotal * Math.max(0, Number(coupon.value || 0)) / 100);
  const amount = Math.min(eligibleSubtotal, Math.max(0, rawAmount));
  return { coupon, amount, subtotal: normalizedSubtotal, eligibleSubtotal };
}

router.post('/validate', asyncHandler(async (req, res) => {
  const pricing = Array.isArray(req.body.items) && req.body.items.length
    ? await priceSubmittedItems(req.body.items)
    : { subtotal: Number(req.body.subtotal), items: [] };
  const result = await calculate(req.body.code, pricing, req.session?.userId);
  ok(res, {
    discount: result.amount,
    code: result.coupon.code,
    minOrderAmount: result.coupon.minOrderAmount || 0,
    eligibleSubtotal: result.eligibleSubtotal,
    applicability: result.coupon.applicability || 'all'
  });
}));

module.exports = router;
module.exports.calculate = calculate;
module.exports.itemIsEligible = itemIsEligible;
module.exports.priceSubmittedItems = priceSubmittedItems;
