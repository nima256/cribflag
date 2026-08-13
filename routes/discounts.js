const express = require('express');
const Coupon = require('../models/Coupon');
const Product = require('../models/Product');
const CustomRequest = require('../models/CustomRequest');
const { findVariantPricing, fallbackPricing } = require('../utils/productPricing');
const { normalizeCustomProductType } = require('../utils/customPricing');
const { asyncHandler, ok, AppError } = require('../utils/http');
const router = express.Router();

const normalizeText = value => String(value || '').trim();
const normalizeDigits = value => normalizeText(value)
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

function normalizedProductId(value) {
  const productId = Number(value);
  return Number.isInteger(productId) && productId > 0 ? productId : null;
}

function normalizeVariantText(value) {
  return normalizeDigits(value)
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[\u200c\u200d\u200e\u200f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeVariantSize(value) {
  const text = normalizeVariantText(value);
  const option = /با\s*الیاف/.test(text) ? 'با الیاف' : (/کاور/.test(text) ? 'فقط کاور' : '');
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)/i);
  if (!match) return text;

  const first = Number(match[1]);
  const second = Number(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return text;
  const dimensions = `${Math.min(first, second)}x${Math.max(first, second)}`;
  return option ? `${option}|${dimensions}` : dimensions;
}

function variantKey(productId, size, fabric) {
  return `${normalizedProductId(productId) || '*'}\u0000${normalizeVariantSize(size)}\u0000${normalizeVariantText(fabric)}`;
}

function couponVariantSet(coupon) {
  return new Set((coupon?.eligibleVariants || [])
    .map(item => variantKey(item?.productId, item?.size, item?.fabric))
    .filter(key => !key.endsWith('\u0000\u0000')));
}

function itemIsEligible(coupon, item) {
  if (coupon?.applicability !== 'variants') return true;
  const variants = couponVariantSet(coupon);
  // کلید بدون شناسه محصول برای حالت‌های عمومی پرچم، روبالشتی و داکیماکورا
  // و همچنین سازگاری با کدهای قدیمی استفاده می‌شود.
  return variants.has(variantKey(item?.productId, item?.size, item?.fabric))
    || variants.has(variantKey(null, item?.size, item?.fabric));
}

function variantDescription(coupon) {
  const labels = (coupon?.eligibleVariants || []).map(item => {
    const product = normalizedProductId(item?.productId) ? `محصول شماره ${item.productId}، ` : '';
    return `${product}${item.size} با ${item.fabric}`;
  });
  if (!labels.length) return 'محصول‌ها و ترکیب‌های تعیین‌شده';
  const visible = labels.slice(0, 3).join('، ');
  return labels.length > 3 ? `${visible} و ${labels.length - 3} ترکیب دیگر` : visible;
}

function isSubmittedCustomItem(item) {
  return Boolean(normalizeText(item?.customRequestId));
}

async function priceSubmittedItems(rawItems, userId) {
  const submitted = Array.isArray(rawItems) ? rawItems : [];
  if (!submitted.length) throw new AppError(400, 'محصولی برای بررسی کد تخفیف وجود ندارد');

  const normalSubmitted = submitted.filter(item => !isSubmittedCustomItem(item));
  const customSubmitted = submitted.filter(isSubmittedCustomItem);

  const publicIds = [...new Set(normalSubmitted.map(item => Number(item?.id)).filter(Number.isFinite))];
  const products = publicIds.length
    ? await Product.find({ publicId: { $in: publicIds }, status: 'active' })
    : [];
  const byId = new Map(products.map(product => [Number(product.publicId), product]));

  const customIds = customSubmitted.map(item => normalizeText(item?.customRequestId));
  if (customIds.some(id => !id)) throw new AppError(400, 'شناسه یکی از طرح‌های اختصاصی معتبر نیست');
  if (new Set(customIds).size !== customIds.length) {
    throw new AppError(400, 'یک طرح اختصاصی بیش از یک بار برای کد تخفیف ارسال شده است');
  }
  if (customIds.length && !userId) {
    throw new AppError(401, 'برای اعمال کد تخفیف روی طرح اختصاصی ابتدا وارد حساب شوید');
  }

  const customRequests = customIds.length
    ? await CustomRequest.find({ publicId: { $in: customIds }, user: userId })
    : [];
  const customById = new Map(customRequests.map(item => [String(item.publicId), item]));
  if (customById.size !== customIds.length) {
    throw new AppError(404, 'یک یا چند طرح اختصاصی برای اعمال کد تخفیف پیدا نشد');
  }

  const items = [];
  let subtotal = 0;

  for (const raw of normalSubmitted) {
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

  for (const raw of customSubmitted) {
    const customRequestId = normalizeText(raw?.customRequestId);
    const qty = Number(raw?.qty ?? 1);
    if (qty !== 1) throw new AppError(400, 'تعداد هر طرح اختصاصی باید یک عدد باشد');

    const request = customById.get(customRequestId);
    const price = Number(request?.price || 0);
    if (!Number.isFinite(price) || price <= 0) {
      throw new AppError(400, `قیمت طرح اختصاصی ${customRequestId} معتبر نیست`);
    }

    const requestType = normalizeCustomProductType(request.requestType);
    const size = normalizeText(request.size);
    const fabric = normalizeText(request.fabric);
    if (!size || !fabric) {
      throw new AppError(400, `سایز یا جنس طرح اختصاصی ${customRequestId} کامل نیست`);
    }

    items.push({
      customRequestId,
      title: `${requestType} طرح اختصاصی`,
      category: 'طرح دلخواه',
      requestType,
      size,
      fabric,
      price,
      qty: 1
    });
    subtotal += price;
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
    if (!items.length) throw new AppError(400, 'برای بررسی این کد، جزئیات محصول، سایز و جنس لازم است');
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
    ? await priceSubmittedItems(req.body.items, req.session?.userId)
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
