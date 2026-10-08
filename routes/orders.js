const express = require('express');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const CustomRequest = require('../models/CustomRequest');
const { calculate } = require('./discounts');
const { requestPayment, verifyPayment } = require('../services/payment');
const torobPay = require('../services/torobPay');
const snappPay = require('../services/snappPay');
const { buildSnappPayPayload, snappPayMobile } = require('../services/snappPayPricing');
const { reconcilerConfig, resolveSnappPayAction, startSnappPayReconciler } = require('../services/snappPayReconciler');
const { sendOrderRegisteredSms } = require('../services/sms');
const { requireUser } = require('../middlewares/auth');
const { asyncHandler, ok, AppError } = require('../utils/http');
const { orderNumber, normalizeMobile } = require('../utils/formatters');
const env = require('../config/env');
const { findVariantPricing, fallbackPricing } = require('../utils/productPricing');
const { normalizeCustomProductType } = require('../utils/customPricing');
const { applyInventory, releaseInventory } = require('../services/inventory');
const { consumeCoupon, releaseCoupon } = require('../services/coupons');
const { syncCustomRequestsFromOrder } = require('../services/customOrderSync');

const router = express.Router();

const SNAPPPAY_LABEL = 'پرداخت اقساطی اسنپ‌پی';
const PAYMENT_METHODS = ['zarinpal', 'torobpay', 'snappay'];

function orderAcquisitionFromSession(req) {
  const touch = req.session?.attribution?.lastTouch || req.session?.attribution?.firstTouch || null;
  if (!touch) {
    return { source: 'Direct', medium: '', campaign: '', term: '', content: '', referrer: '', landingPage: '', capturedAt: new Date() };
  }
  return {
    source: String(touch.source || 'Direct').trim().slice(0, 120),
    medium: String(touch.medium || '').trim().slice(0, 120),
    campaign: String(touch.campaign || '').trim().slice(0, 180),
    term: String(touch.term || '').trim().slice(0, 180),
    content: String(touch.content || '').trim().slice(0, 180),
    referrer: String(touch.referrer || '').trim().slice(0, 500),
    landingPage: String(touch.landingPage || '').trim().slice(0, 500),
    capturedAt: touch.capturedAt ? new Date(touch.capturedAt) : new Date()
  };
}

const isCustomItem = item => ['طرح دلخواه', 'طرح اختصاصی'].includes(String(item?.category || '')) || Boolean(item?.customRequestId);
const normalizeDigits = value => String(value || '')
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

function normalizedCustomIds(items = []) {
  return items
    .map(item => String(item?.customRequestId || '').trim())
    .filter(Boolean)
    .sort();
}

function assertClientCartSnapshot(body, rawItems) {
  const expectedItemCount = Number(body.expectedItemCount);
  if (!Number.isInteger(expectedItemCount) || expectedItemCount < 0 || !Array.isArray(body.expectedCustomRequestIds)) {
    throw new AppError(409, 'نسخه صفحه تسویه قدیمی است؛ صفحه را تازه‌سازی و دوباره سفارش را ثبت کنید');
  }
  if (expectedItemCount !== rawItems.length) {
    throw new AppError(409, 'سبد خرید هنگام ثبت سفارش تغییر کرده است؛ صفحه را تازه‌سازی و دوباره تلاش کنید');
  }

  const expectedCustomIds = body.expectedCustomRequestIds
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .sort();
  const submittedCustomIds = normalizedCustomIds(rawItems);
  if (JSON.stringify(expectedCustomIds) !== JSON.stringify(submittedCustomIds)) {
    throw new AppError(409, 'اقلام طرح اختصاصی سبد خرید کامل ارسال نشده‌اند؛ دوباره تلاش کنید');
  }
}

async function assertPersistedOrderSnapshot(orderId, expected) {
  const persisted = await Order.findById(orderId).lean();
  if (!persisted) throw new AppError(500, 'سفارش پس از ثبت قابل بازیابی نیست');

  const expectedItems = Array.isArray(expected.items) ? expected.items : [];
  const persistedItems = Array.isArray(persisted.items) ? persisted.items : [];
  const sameCustomIds = JSON.stringify(normalizedCustomIds(expectedItems)) === JSON.stringify(normalizedCustomIds(persistedItems));
  const sameItemCount = persistedItems.length === expectedItems.length;
  const sameSubtotal = Number(persisted.subtotal) === Number(expected.subtotal);
  const sameTax = Number(persisted.tax || 0) === Number(expected.tax || 0);
  const sameTotal = Number(persisted.total) === Number(expected.total);

  if (!sameItemCount || !sameCustomIds || !sameSubtotal || !sameTax || !sameTotal) {
    await Order.deleteOne({ _id: orderId }).catch(() => {});
    throw new AppError(500, 'ثبت کامل اقلام سفارش تأیید نشد؛ هیچ پرداختی ایجاد نشد، دوباره تلاش کنید');
  }

  return persisted;
}

async function priceItems(items) {
  const output = [];
  const requestedByProduct = new Map();
  let subtotal = 0;

  for (const raw of items || []) {
    const qty = Number(raw.qty ?? 1);
    const publicId = Number(raw.id);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      throw new AppError(400, `تعداد انتخاب‌شده برای ${raw.title || 'محصول'} معتبر نیست`);
    }
    if (!Number.isFinite(publicId)) {
      throw new AppError(400, `شناسه ${raw.title || 'محصول'} معتبر نیست`);
    }

    const product = await Product.findOne({ publicId, status: 'active' });
    if (!product) throw new AppError(400, `محصول ${raw.title || publicId} موجود نیست`);
    const inventoryManaged = product.inventoryMode === 'managed';
    const requestedTotal = (requestedByProduct.get(publicId) || 0) + qty;
    requestedByProduct.set(publicId, requestedTotal);
    if (inventoryManaged && product.stock < requestedTotal) throw new AppError(400, `موجودی ${product.title} کافی نیست؛ فقط ${product.stock} عدد باقی مانده است`);

    const pricingProduct = product;
    const sizes = Array.isArray(pricingProduct.sizes) ? pricingProduct.sizes : [];
    const fabrics = Array.isArray(pricingProduct.fabrics) ? pricingProduct.fabrics : [];
    const size = String(raw.size || sizes[0] || '').trim();
    const fabric = String(raw.fabric || fabrics[0] || '').trim();
    if (sizes.length && !sizes.includes(size)) throw new AppError(400, `سایز انتخاب‌شده برای ${product.title} معتبر نیست`);
    if (fabrics.length && !fabrics.includes(fabric)) throw new AppError(400, `جنس پارچه انتخاب‌شده برای ${product.title} معتبر نیست`);

    const variant = findVariantPricing(pricingProduct, size, fabric);
    if (pricingProduct.variantPrices?.length && !variant) {
      throw new AppError(400, `برای ترکیب سایز و جنس انتخاب‌شده محصول ${product.title} قیمت ثبت نشده است`);
    }
    const pricing = variant || fallbackPricing(pricingProduct);
    const categories = [...new Set([product.category, ...(product.categories || [])].filter(Boolean))];
    output.push({ productId: publicId, title: product.title, category: categories[0] || product.category, categories, price: pricing.price, qty, size, fabric, notes: String(raw.notes || '').trim(), inventoryManaged });
    subtotal += pricing.price * qty;
  }

  return { items: output, subtotal };
}

async function priceCustomItems(items, user) {
  const rawItems = Array.isArray(items) ? items : [];
  if (!rawItems.length) return { items: [], subtotal: 0 };

  const publicIds = rawItems.map(item => String(item.customRequestId || '').trim());
  if (publicIds.some(id => !id)) throw new AppError(400, 'شناسه درخواست طرح اختصاصی موجود نیست');
  if (new Set(publicIds).size !== publicIds.length) throw new AppError(400, 'یک طرح اختصاصی بیش از یک بار به سبد اضافه شده است');

  const requests = await CustomRequest.find({
    publicId: { $in: publicIds },
    user: user._id
  });
  const requestById = new Map(requests.map(item => [item.publicId, item]));

  if (requestById.size !== publicIds.length) {
    throw new AppError(404, 'یک یا چند درخواست طرح اختصاصی پیدا نشد');
  }

  const output = [];
  let subtotal = 0;

  for (const raw of rawItems) {
    const qty = Number(raw.qty ?? 1);
    if (qty !== 1) throw new AppError(400, 'تعداد هر درخواست طرح اختصاصی باید یک عدد باشد');

    const request = requestById.get(String(raw.customRequestId).trim());
    const price = Number(request.price);
    const requestType = normalizeCustomProductType(request.requestType);
    if (!Number.isFinite(price) || price <= 0) {
      throw new AppError(400, `قیمت درخواست ${request.publicId} معتبر نیست`);
    }

    output.push({
      title: `${requestType} طرح دلخواه — ${request.fileName || request.publicId}`,
      category: 'طرح دلخواه',
      categories: ['طرح دلخواه'],
      price,
      qty: 1,
      size: request.size,
      fabric: request.fabric,
      requestType,
      notes: request.notes || '',
      fileName: request.fileName || '',
      filePath: request.filePath || '',
      customRequestId: request.publicId
    });
    subtotal += price;
  }

  return { items: output, subtotal };
}

async function resolveOrderCustomerMobile(order) {
  let userMobile = '';

  if (order.user) {
    const userId = order.user?._id || order.user;
    const customer = await User.findById(userId).select('mobile').lean();
    userMobile = normalizeMobile(customer?.mobile);
  }

  const orderMobile = normalizeMobile(order.phone);
  const customerMobile = /^09\d{9}$/.test(userMobile) ? userMobile : orderMobile;
  if (!/^09\d{9}$/.test(customerMobile)) {
    throw new Error(`شماره موبایل کاربر برای سفارش ${order.orderNumber} معتبر یا قابل بازیابی نیست`);
  }

  // شماره نرمال‌شده را روی خود سفارش هم نگه می‌داریم تا callbackهای بعدی مستقل از پروفایل باشند.
  order.phone = customerMobile;
  return customerMobile;
}

async function notifyOrderRegistered(order) {
  if (order.orderRegisteredSmsSentAt) return;

  const staleLock = new Date(Date.now() - 5 * 60 * 1000);
  const lock = await Order.updateOne(
    {
      _id: order._id,
      orderRegisteredSmsSentAt: { $exists: false },
      $or: [
        { orderRegisteredSmsLockAt: { $exists: false } },
        { orderRegisteredSmsLockAt: { $lt: staleLock } }
      ]
    },
    { $set: { orderRegisteredSmsLockAt: new Date() } }
  );
  if (!lock.modifiedCount) return;

  try {
    const customerMobile = await resolveOrderCustomerMobile(order);
    const result = await sendOrderRegisteredSms(order, {
      customerMobile,
      alreadySentRecipients: order.orderRegisteredSmsRecipients
    });

    order.orderRegisteredSmsRecipients = [...new Set([
      ...(order.orderRegisteredSmsRecipients || []),
      ...result.successfulRecipients
    ])];

    const sentRecipients = new Set(order.orderRegisteredSmsRecipients);
    const pendingRecipients = result.recipients.filter(to => !sentRecipients.has(to));
    if (!pendingRecipients.length) order.orderRegisteredSmsSentAt = new Date();
    order.orderRegisteredSmsLockAt = undefined;
    await order.save();

    for (const failure of result.failedRecipients) {
      console.error(`[ORDER SMS] order=${order.orderNumber} to=${failure.to}`, failure.error);
    }
  } catch (error) {
    await Order.updateOne({ _id: order._id }, { $unset: { orderRegisteredSmsLockAt: 1 } }).catch(() => {});
    console.error(`[ORDER SMS] order=${order.orderNumber}`, error);
  }
}

function torobSuccessUrl(order) {
  return `/payment/success?order=${encodeURIComponent(order.orderNumber)}&shipping=${encodeURIComponent(order.shippingMethod)}&refId=${encodeURIComponent(order.paymentInfo?.torobTransactionId || '')}`;
}

function torobFailedUrl(order, reason = '') {
  const suffix = reason ? `&reason=${encodeURIComponent(reason)}` : '';
  return `/payment/failed?order=${encodeURIComponent(order.orderNumber)}${suffix}`;
}

async function markTorobOrderPaid(order, statusData = {}) {
  order.paymentStatus = 'paid';
  order.paymentInfo.torobStatus = 'SETTLE';
  order.paymentInfo.torobSettledAt = order.paymentInfo.torobSettledAt || new Date();
  order.paymentInfo.torobTransactionId = String(statusData.transactionId || order.paymentInfo.torobTransactionId || order.orderNumber);
  order.paymentInfo.refId = order.paymentInfo.torobTransactionId;
  order.paymentInfo.paidAt = order.paymentInfo.paidAt || new Date();
  await applyInventory(order);
  await consumeCoupon(order);
  await order.save();
  await syncCustomRequestsFromOrder(order);
  await notifyOrderRegistered(order);
}

async function failTorobOrder(order, { release = true } = {}) {
  if (release) {
    await releaseInventory(order).catch(error => console.error('[TOROBPAY RELEASE INVENTORY]', error));
    await releaseCoupon(order).catch(error => console.error('[TOROBPAY RELEASE COUPON]', error));
  }
  order.paymentStatus = 'failed';
  order.status = 'cancelled';
  order.paymentInfo.torobStatus = 'REVERT';
  await order.save();
  await syncCustomRequestsFromOrder(order);
}

async function updateCustomDelivery({ customItems, user, province, city, address, postalCode, shippingMethod, deliveryNote }) {
  const publicIds = [...new Set(
    customItems
      .map(item => String(item.customRequestId || '').trim())
      .filter(Boolean)
  )];

  if (!publicIds.length) throw new AppError(400, 'شناسه درخواست طرح اختصاصی موجود نیست');

  const requests = await CustomRequest.find({
    publicId: { $in: publicIds },
    user: user._id
  });

  if (requests.length !== publicIds.length) {
    throw new AppError(404, 'یک یا چند درخواست طرح اختصاصی پیدا نشد');
  }

  await CustomRequest.updateMany(
    { publicId: { $in: publicIds }, user: user._id },
    {
      $set: {
        customer: user.fullName,
        phone: user.mobile,
        email: user.email || '',
        province,
        city,
        postalCode,
        address,
        shippingMethod,
        deliveryNote,
        status: 'review',
        orderStatus: 'design-review'
      }
    }
  );

  return publicIds;
}

// Server-authoritative price of the current cart for a payment method.
async function quoteCart(user, body, paymentMethodOverride) {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  assertClientCartSnapshot(body, rawItems);
  const customItems = rawItems.filter(isCustomItem);
  const normalItems = rawItems.filter(item => !isCustomItem(item));

  const normalPricing = await priceItems(normalItems);
  const customPricing = await priceCustomItems(customItems, user);
  const items = [...normalPricing.items, ...customPricing.items];
  const subtotal = normalPricing.subtotal + customPricing.subtotal;

  if (!items.length) throw new AppError(400, 'سبد خرید خالی است');
  if (items.length !== rawItems.length || normalPricing.items.length !== normalItems.length || customPricing.items.length !== customItems.length) {
    throw new AppError(500, 'همه اقلام سبد خرید برای بازبینی قیمت پردازش نشدند؛ صفحه را تازه‌سازی کنید');
  }

  let discount = 0;
  if (body.couponCode && subtotal > 0) {
    const result = await calculate(body.couponCode, { items, subtotal }, user._id);
    discount = result.amount;
  }

  const requestedPaymentMethod = String(paymentMethodOverride || body.paymentMethod || '').trim();
  if (requestedPaymentMethod && !PAYMENT_METHODS.includes(requestedPaymentMethod)) {
    throw new AppError(400, 'روش پرداخت انتخاب‌شده معتبر نیست');
  }
  const paymentMethod = requestedPaymentMethod || 'zarinpal';
  const payableBeforeTax = Math.max(0, subtotal - discount);
  const tax = paymentMethod === 'torobpay' ? Math.round(payableBeforeTax * 0.15) : 0;
  const total = payableBeforeTax + tax;
  return { items, subtotal, discount, tax, total, paymentMethod };
}

router.post('/quote', requireUser, asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId);
  if (!user || !user.isActive) throw new AppError(401, 'ابتدا وارد حساب کاربری فعال شوید');

  const { items, subtotal, discount, tax, total, paymentMethod } = await quoteCart(user, req.body);
  const pricedItems = items.map(item => ({
    productId: item.productId,
    customRequestId: item.customRequestId,
    title: item.title,
    price: item.price,
    qty: item.qty,
    size: item.size,
    fabric: item.fabric,
    requestType: item.requestType
  }));

  return ok(res, { subtotal, discount, tax, total, paymentMethod, items: pricedItems });
}));

// SnappPay eligible: called with the final (server-computed) cart amount every time it
// changes; title_message and description are returned verbatim for the gateway option.
router.post('/snappay/eligibility', requireUser, asyncHandler(async (req, res) => {
  if (!snappPay.isConfigured()) return ok(res, { eligible: false, unavailable: true });
  const user = await User.findById(req.session.userId);
  if (!user || !user.isActive) throw new AppError(401, 'ابتدا وارد حساب کاربری فعال شوید');

  const quote = await quoteCart(user, req.body, 'snappay');
  try {
    const result = await snappPay.eligible(snappPay.toRial(quote.total));
    return ok(res, {
      eligible: result?.eligible === true,
      title_message: result?.title_message ?? '',
      description: result?.description ?? '',
      total: quote.total
    });
  } catch (error) {
    console.error('[SNAPPPAY ELIGIBILITY]', error?.message || error);
    // An outage of SnappPay must never block the other payment methods.
    return ok(res, { eligible: false, unavailable: true });
  }
}));

router.get('/torobpay/eligibility', requireUser, asyncHandler(async (req, res) => {
  const amountToman = Number(req.query.amount);
  if (!Number.isFinite(amountToman) || amountToman <= 0) throw new AppError(400, 'مبلغ سفارش برای بررسی ترب‌پی معتبر نیست');

  try {
    const result = await torobPay.checkEligibility(amountToman);
    return ok(res, {
      eligible: result?.eligible === true,
      messageTitle: result?.message_title || 'پرداخت اقساطی با ترب‌پی',
      description: result?.description || ''
    });
  } catch (error) {
    console.error('[TOROBPAY ELIGIBILITY]', error);
    return ok(res, { eligible: false, unavailable: true, message: 'ترب‌پی موقتاً در دسترس نیست' });
  }
}));

router.post('/', requireUser, asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId);
  if (!user || !user.isActive) throw new AppError(401, 'ابتدا وارد حساب کاربری فعال شوید');

  const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
  assertClientCartSnapshot(req.body, rawItems);
  const customItems = rawItems.filter(isCustomItem);
  const normalItems = rawItems.filter(item => !isCustomItem(item));

  const province = String(req.body.province || '').trim();
  const city = String(req.body.city || '').trim();
  const address = String(req.body.address || '').trim();
  const postalCode = normalizeDigits(req.body.postalCode).trim();

  if (!province) throw new AppError(400, 'استان را انتخاب کنید');
  if (!city) throw new AppError(400, 'شهر را انتخاب کنید');
  if (address.length < 10) throw new AppError(400, 'آدرس کامل تحویل را وارد کنید');
  if (!/^\d{10}$/.test(postalCode)) throw new AppError(400, 'کد پستی باید دقیقاً ۱۰ رقم باشد');

  const shippingMethod = req.body.shippingMethod === 'snapp' ? 'ارسال فوری از کرج' : 'تیپاکس';
  // هزینه تیپاکس به‌صورت پس‌کرایه و هزینه ارسال فوری مستقیماً با مشتری است.
  // بنابراین هیچ مبلغی بابت ارسال به درگاه پرداخت اضافه نمی‌شود.
  const shipping = 0;

  const normalPricing = await priceItems(normalItems);
  const customPricing = await priceCustomItems(customItems, user);
  const items = [...normalPricing.items, ...customPricing.items];
  const subtotal = normalPricing.subtotal + customPricing.subtotal;
  if (!items.length) throw new AppError(400, 'سبد خرید خالی است');
  if (items.length !== rawItems.length || normalPricing.items.length !== normalItems.length || customPricing.items.length !== customItems.length) {
    throw new AppError(500, 'همه اقلام سبد خرید پردازش نشدند؛ هیچ پرداختی ایجاد نشد، دوباره تلاش کنید');
  }

  const expectedSubtotal = Number(req.body.expectedSubtotal);

  if (customItems.length) {
    await updateCustomDelivery({
      customItems,
      user,
      province,
      city,
      address,
      postalCode,
      shippingMethod,
      deliveryNote: String(req.body.note || '').trim()
    });
  }

  let discount = 0;
  let coupon = null;
  if (req.body.couponCode && subtotal > 0) {
    // همان اعتبارسنجی محصول، سایز، جنس و حالت سفارش برای اقلام عادی و اختصاصی اجرا می‌شود.
    const result = await calculate(req.body.couponCode, { items, subtotal }, user._id);
    discount = result.amount;
    coupon = result.coupon;
  }

  const requestedPaymentMethod = String(req.body.paymentMethod || '').trim();
  if (requestedPaymentMethod && !PAYMENT_METHODS.includes(requestedPaymentMethod)) {
    throw new AppError(400, 'روش پرداخت انتخاب‌شده معتبر نیست');
  }
  const paymentMethod = requestedPaymentMethod || 'zarinpal';
  if (paymentMethod === 'snappay' && !snappPay.isConfigured()) {
    throw new AppError(503, 'درگاه اسنپ‌پی هنوز روی سرور تنظیم نشده است');
  }
  const customerMobile = normalizeMobile(user.mobile);
  if (!/^09\d{9}$/.test(customerMobile)) {
    throw new AppError(400, 'شماره موبایل حساب کاربری معتبر نیست؛ ابتدا آن را در پروفایل اصلاح کنید');
  }

  const payableBeforeTax = Math.max(0, subtotal - discount);
  const tax = paymentMethod === 'torobpay' ? Math.round(payableBeforeTax * 0.15) : 0;
  const total = payableBeforeTax + tax;
  const expectedDiscount = Number(req.body.expectedDiscount);
  const expectedTax = Number(req.body.expectedTax);
  const expectedTotal = Number(req.body.expectedTotal);
  const checkoutSnapshotMatches = Number.isFinite(expectedSubtotal)
    && Number.isFinite(expectedDiscount)
    && Number.isFinite(expectedTax)
    && Number.isFinite(expectedTotal)
    && expectedSubtotal === subtotal
    && expectedDiscount === discount
    && expectedTax === tax
    && expectedTotal === total;
  if (!checkoutSnapshotMatches) {
    throw new AppError(409, 'مبلغ سفارش نسبت به صفحه بازبینی تغییر کرده است؛ بازبینی سفارش را دوباره انجام دهید تا مبلغ نهایی قبل از ورود به درگاه نمایش داده شود');
  }
  if (paymentMethod === 'torobpay') {
    try {
      const eligibility = await torobPay.checkEligibility(total);
      if (eligibility?.eligible !== true) {
        throw new AppError(400, eligibility?.description || 'این مبلغ در حال حاضر واجد شرایط پرداخت اقساطی ترب‌پی نیست');
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, `بررسی امکان پرداخت ترب‌پی انجام نشد: ${error?.message || 'خطای نامشخص'}`);
    }
  }

  let snappEligibility = null;
  if (paymentMethod === 'snappay') {
    try {
      snappEligibility = await snappPay.eligible(snappPay.toRial(total));
    } catch (error) {
      throw new AppError(502, `بررسی امکان پرداخت اسنپ‌پی انجام نشد: ${error?.message || 'خطای نامشخص'}`);
    }
    if (snappEligibility?.eligible !== true) {
      throw new AppError(400, snappEligibility?.description || 'این مبلغ در حال حاضر واجد شرایط پرداخت اسنپ‌پی نیست');
    }
  }

  const paymentLabel = paymentMethod === 'torobpay'
    ? 'پرداخت اقساطی ترب‌پی'
    : paymentMethod === 'snappay'
      ? SNAPPPAY_LABEL
      : 'پرداخت آنلاین زرین‌پال';

  const order = await Order.create({
    orderNumber: orderNumber(),
    user: user._id,
    customer: user.fullName,
    phone: customerMobile,
    email: user.email || req.body.email || '',
    province,
    city,
    address,
    postalCode,
    items,
    subtotal,
    shipping,
    discount,
    tax,
    total,
    couponCode: coupon?.code,
    customerNote: String(req.body.note || '').trim(),
    acquisition: orderAcquisitionFromSession(req),
    status: normalItems.length ? 'processing' : 'design-review',
    payment: paymentLabel,
    paymentStatus: 'pending',
    shippingMethod
  });

  await assertPersistedOrderSnapshot(order._id, { items, subtotal, tax, total });

  if (env.paymentMock) {
    order.paymentStatus = 'paid';
    order.paymentInfo.paidAt = new Date();
    await applyInventory(order);
    await consumeCoupon(order);
    await syncCustomRequestsFromOrder(order);
    await notifyOrderRegistered(order);
    return ok(res, {
      message: 'پرداخت محلی شبیه‌سازی شد',
      orderNumber: order.orderNumber,
      successUrl: `/payment/success?order=${encodeURIComponent(order.orderNumber)}&shipping=${encodeURIComponent(order.shippingMethod)}`
    }, 201);
  }

  if (paymentMethod === 'snappay') {
    try {
      const payload = buildSnappPayPayload(order);
      // The SnappPay amount must be exactly the order total the customer reviewed.
      if (payload.amount !== snappPay.toRial(order.total)) throw new Error('مبلغ سفارش با مبلغ اسنپ‌پی یکسان نیست');
      const payment = await snappPay.createPaymentToken({
        ...payload,
        mobile: snappPayMobile(order.phone),
        returnURL: `${env.siteUrl}/api/orders/snappay/callback`,
        transactionId: String(order.orderNumber)
      });
      if (!payment?.paymentToken || !payment?.paymentPageUrl) throw new Error('پاسخ معتبر از اسنپ‌پی دریافت نشد');
      order.snappPay = {
        paymentToken: payment.paymentToken,
        transactionId: String(order.orderNumber),
        status: 'PENDING',
        eligibleTitle: snappEligibility?.title_message || '',
        eligibleDescription: snappEligibility?.description || ''
      };
      order.paymentInfo.url = payment.paymentPageUrl;
      await order.save();
      await syncCustomRequestsFromOrder(order);
      console.log(`[SNAPPPAY TOKEN] order=${order.orderNumber} paymentToken=${payment.paymentToken}`);
      return ok(res, {
        message: 'انتقال به درگاه اسنپ‌پی',
        orderNumber: order.orderNumber,
        paymentUrl: payment.paymentPageUrl
      }, 201);
    } catch (error) {
      await Order.deleteOne({ _id: order._id });
      throw new AppError(502, `اتصال به درگاه اسنپ‌پی انجام نشد: ${error?.message || 'خطای نامشخص'}`);
    }
  }

  if (paymentMethod === 'torobpay') {
    try {
      const payment = await torobPay.createPayment(order);
      if (!payment?.paymentToken || !payment?.paymentPageUrl) throw new Error('پاسخ معتبر از ترب‌پی دریافت نشد');
      order.paymentInfo.torobPaymentToken = payment.paymentToken;
      order.paymentInfo.torobTransactionId = order.orderNumber;
      order.paymentInfo.torobStatus = 'PENDING';
      order.paymentInfo.url = payment.paymentPageUrl;
      await order.save();
      await syncCustomRequestsFromOrder(order);
      return ok(res, {
        message: 'انتقال به درگاه ترب‌پی',
        orderNumber: order.orderNumber,
        paymentUrl: payment.paymentPageUrl
      }, 201);
    } catch (error) {
      await Order.deleteOne({ _id: order._id });
      throw new AppError(502, `اتصال به درگاه ترب‌پی انجام نشد: ${error?.message || 'خطای نامشخص'}`);
    }
  }

  try {
    const payment = await requestPayment(order);
    if (!payment?.url || !payment?.authority) throw new Error('پاسخ معتبر از زرین‌پال دریافت نشد');
    order.paymentInfo.authority = payment.authority;
    order.paymentInfo.url = payment.url;
    await order.save();
    await syncCustomRequestsFromOrder(order);
    return ok(res, {
      message: 'انتقال به درگاه زرین‌پال',
      orderNumber: order.orderNumber,
      paymentUrl: payment.url
    }, 201);
  } catch (error) {
    await Order.deleteOne({ _id: order._id });
    throw new AppError(502, `اتصال به درگاه پرداخت انجام نشد: ${error?.message || 'خطای نامشخص'}`);
  }
}));


router.post('/torobpay/callback', asyncHandler(async (req, res) => {
  const transactionId = String(req.body?.transactionId || '').trim();
  const state = String(req.body?.state || '').trim().toUpperCase();
  const callbackAmount = Number(req.body?.amount);

  if (!transactionId || transactionId.length > 120) {
    return res.redirect('/payment/failed?reason=torob-transaction');
  }

  const order = await Order.findOne({
    orderNumber: transactionId,
    payment: 'پرداخت اقساطی ترب‌پی'
  });
  if (!order) return res.redirect('/payment/failed?reason=torob-order');

  const paymentToken = order.paymentInfo?.torobPaymentToken;
  if (!paymentToken) return res.redirect(torobFailedUrl(order, 'torob-token'));

  if (order.paymentStatus === 'paid') {
    await syncCustomRequestsFromOrder(order);
    return res.redirect(torobSuccessUrl(order));
  }

  const expectedAmount = torobPay.toRial(order.total);
  if (Number.isFinite(callbackAmount) && callbackAmount !== expectedAmount) {
    console.warn(`[TOROBPAY CALLBACK AMOUNT] order=${order.orderNumber} expected=${expectedAmount} received=${callbackAmount}`);
  }

  if (state !== 'OK') {
    try {
      const status = await torobPay.getPaymentStatus(paymentToken);
      if (status?.status === 'SETTLE') {
        await markTorobOrderPaid(order, status);
        return res.redirect(torobSuccessUrl(order));
      }
    } catch (error) {
      console.error(`[TOROBPAY STATUS AFTER FAILED CALLBACK] order=${order.orderNumber}`, error);
    }

    await failTorobOrder(order, { release: false });
    return res.redirect(torobFailedUrl(order, 'torob-failed'));
  }

  try {
    let alreadyVerified = false;
    try {
      const verification = await torobPay.verifyPayment(paymentToken);
      order.paymentInfo.torobVerifiedAt = new Date();
      order.paymentInfo.torobStatus = 'VERIFY';
      order.paymentInfo.torobTransactionId = String(verification?.transactionId || order.orderNumber);
      await order.save();
      alreadyVerified = true;
    } catch (verifyError) {
      // Callback may be repeated or the response of a previous verify may have been lost.
      const status = await torobPay.getPaymentStatus(paymentToken);
      if (status?.status === 'SETTLE') {
        await markTorobOrderPaid(order, status);
        return res.redirect(torobSuccessUrl(order));
      }
      if (status?.status !== 'VERIFY') throw verifyError;
      alreadyVerified = true;
      order.paymentInfo.torobStatus = 'VERIFY';
      order.paymentInfo.torobVerifiedAt = order.paymentInfo.torobVerifiedAt || new Date();
      await order.save();
    }

    if (!alreadyVerified) throw new Error('تأیید پرداخت ترب‌پی کامل نشد');

    try {
      await applyInventory(order);
      await consumeCoupon(order);
    } catch (inventoryError) {
      try {
        await torobPay.cancelPayment(paymentToken);
      } catch (cancelError) {
        console.error(`[TOROBPAY CANCEL AFTER INVENTORY ERROR] order=${order.orderNumber}`, cancelError);
      }
      await failTorobOrder(order);
      console.error(`[TOROBPAY INVENTORY] order=${order.orderNumber}`, inventoryError);
      return res.redirect(torobFailedUrl(order, 'inventory'));
    }

    try {
      const settled = await torobPay.settlePayment(paymentToken);
      order.paymentInfo.torobSettledAt = new Date();
      await markTorobOrderPaid(order, settled);
      return res.redirect(torobSuccessUrl(order));
    } catch (settleError) {
      // TorobPay can settle automatically; query status before showing an uncertain result.
      try {
        const status = await torobPay.getPaymentStatus(paymentToken);
        if (status?.status === 'SETTLE') {
          await markTorobOrderPaid(order, status);
          return res.redirect(torobSuccessUrl(order));
        }
        if (status?.status === 'REVERT') {
          await failTorobOrder(order);
          return res.redirect(torobFailedUrl(order, 'torob-reverted'));
        }
      } catch (statusError) {
        console.error(`[TOROBPAY STATUS AFTER SETTLE ERROR] order=${order.orderNumber}`, statusError);
      }

      console.error(`[TOROBPAY SETTLE PENDING] order=${order.orderNumber}`, settleError);
      order.paymentInfo.torobStatus = 'VERIFY';
      await order.save();
      return res.redirect(`/payment/pending?order=${encodeURIComponent(order.orderNumber)}`);
    }
  } catch (error) {
    console.error(`[TOROBPAY CALLBACK] order=${order.orderNumber}`, error);
    try {
      const status = await torobPay.getPaymentStatus(paymentToken);
      if (status?.status === 'SETTLE') {
        await markTorobOrderPaid(order, status);
        return res.redirect(torobSuccessUrl(order));
      }
      if (status?.status === 'REVERT') {
        await failTorobOrder(order);
        return res.redirect(torobFailedUrl(order, 'torob-reverted'));
      }
    } catch (statusError) {
      console.error(`[TOROBPAY FINAL STATUS] order=${order.orderNumber}`, statusError);
    }
    return res.redirect(`/payment/pending?order=${encodeURIComponent(order.orderNumber)}`);
  }
}));


// ---------------------------------------------------------------- SnappPay
function snappSuccessUrl(order) {
  const transactionId = order.snappPay?.transactionId || order.orderNumber;
  return `/payment/success?order=${encodeURIComponent(order.orderNumber)}&shipping=${encodeURIComponent(order.shippingMethod || '')}&refId=${encodeURIComponent(transactionId)}&gateway=snappay`;
}
const snappFailedUrl = (order, reason = '') =>
  `/payment/failed?order=${encodeURIComponent(order.orderNumber)}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}&gateway=snappay`;
const snappPendingUrl = order => `/payment/pending?order=${encodeURIComponent(order.orderNumber)}&gateway=snappay`;

const isSnappPaid = order => order?.paymentStatus === 'paid' && order?.snappPay?.status === 'SETTLE';

// Atomic per-order lock shared by the callback, the reconciler and admin actions;
// an abandoned lock (crash mid-request) expires after reconcilerConfig.staleLockMs.
function lockSnappPayOrder(orderId, extraSet = {}) {
  return Order.findOneAndUpdate(
    {
      _id: orderId,
      'snappPay.status': { $ne: 'SETTLE' },
      $or: [
        { 'snappPay.processing': { $ne: true } },
        { 'snappPay.processingStartedAt': { $lt: new Date(Date.now() - reconcilerConfig.staleLockMs) } }
      ]
    },
    { $set: { 'snappPay.processing': true, 'snappPay.processingStartedAt': new Date(), ...extraSet } },
    { new: true }
  );
}

async function releaseSnappPayLock(order, { error, paymentStatus } = {}) {
  order.snappPay.processing = false;
  order.snappPay.processingStartedAt = undefined;
  if (error) order.snappPay.lastError = String(error).slice(0, 500);
  if (paymentStatus) order.paymentStatus = paymentStatus;
  await order.save();
}

async function markSnappPayOrderPaid(order, result = {}) {
  order.snappPay.status = 'SETTLE';
  order.snappPay.transactionId = String(result?.transactionId || order.snappPay.transactionId || order.orderNumber);
  order.snappPay.settledAt = order.snappPay.settledAt || new Date();
  order.snappPay.lastStatusCheckAt = new Date();
  order.snappPay.lastError = undefined;
  order.snappPay.processing = false;
  order.snappPay.processingStartedAt = undefined;
  order.paymentStatus = 'paid';
  order.paymentInfo.refId = order.snappPay.transactionId;
  order.paymentInfo.paidAt = order.paymentInfo.paidAt || new Date();
  try {
    await applyInventory(order);
  } catch (inventoryError) {
    // Money is already settled here; keep the order paid and let the admin resolve
    // the stock conflict with SnappPay update/cancel.
    order.snappPay.lastError = `موجودی: ${inventoryError.message}`.slice(0, 500);
    console.error(`[SNAPPPAY INVENTORY AFTER SETTLE] order=${order.orderNumber}`, inventoryError);
  }
  await consumeCoupon(order);
  await order.save();
  await syncCustomRequestsFromOrder(order);
  await notifyOrderRegistered(order);
}

async function failSnappPayOrder(order, { gatewayStatus = 'FAILED', error } = {}) {
  await releaseInventory(order).catch(releaseError => console.error('[SNAPPPAY RELEASE INVENTORY]', releaseError));
  await releaseCoupon(order).catch(releaseError => console.error('[SNAPPPAY RELEASE COUPON]', releaseError));
  order.snappPay.status = gatewayStatus;
  order.snappPay.processing = false;
  order.snappPay.processingStartedAt = undefined;
  if (error) order.snappPay.lastError = String(error).slice(0, 500);
  order.paymentStatus = 'failed';
  order.status = 'cancelled';
  await order.save();
  await syncCustomRequestsFromOrder(order);
}

// After a successful verify: reserve stock, then settle. If the stock is gone the
// payment is reverted (revert is valid between verify and settle).
async function completeVerifiedSnappPayment(order, verified) {
  const token = order.snappPay.paymentToken;
  order.snappPay.verifiedAt = order.snappPay.verifiedAt || new Date();
  if (verified?.status === 'SETTLE') {
    await markSnappPayOrderPaid(order, verified);
    return 'paid';
  }
  order.snappPay.status = 'VERIFY';
  try {
    await applyInventory(order);
  } catch (inventoryError) {
    try {
      await snappPay.revert(token);
      order.snappPay.revertedAt = new Date();
    } catch (revertError) {
      console.error(`[SNAPPPAY REVERT AFTER INVENTORY] order=${order.orderNumber}`, revertError);
    }
    await failSnappPayOrder(order, { gatewayStatus: 'REVERT', error: `موجودی: ${inventoryError.message}` });
    return 'reverted';
  }
  const settled = await snappPay.settleWithStatusRecovery(token);
  await markSnappPayOrderPaid(order, { ...verified, ...settled });
  return 'paid';
}

// A payment completed after the order was closed locally (expired) must not be
// settled: verify it, then revert it so the customer's credit is returned.
async function revertLateSnappPayment(order) {
  try {
    await snappPay.verify(order.snappPay.paymentToken);
    await snappPay.revert(order.snappPay.paymentToken);
    order.snappPay.status = 'REVERT';
    order.snappPay.revertedAt = new Date();
  } catch (error) {
    order.snappPay.lastError = `revert: ${error.message}`.slice(0, 500);
  }
}

router.post('/snappay/callback', asyncHandler(async (req, res) => {
  const transactionId = String(req.body?.transactionId || '').trim();
  const state = String(req.body?.state || '').trim().toUpperCase();
  const rawAmount = req.body?.amount;
  const hasAmount = rawAmount !== undefined && rawAmount !== null && String(rawAmount).trim() !== '';
  const callbackAmount = hasAmount ? Number(rawAmount) : undefined;

  if (!transactionId || transactionId.length > 120) return res.redirect(303, '/payment/failed?reason=snappay-transaction');

  const found = await Order.findOne({ orderNumber: transactionId, payment: SNAPPPAY_LABEL });
  if (!found || !found.snappPay?.paymentToken) return res.redirect(303, '/payment/failed?reason=snappay-order');

  // Duplicate callback / refresh after a successful payment.
  if (isSnappPaid(found)) return res.redirect(303, snappSuccessUrl(found));

  const order = await lockSnappPayOrder(found._id, {
    'snappPay.callbackState': state,
    'snappPay.callbackAmount': Number.isFinite(callbackAmount) ? callbackAmount : null
  });
  if (!order) {
    const latest = await Order.findById(found._id);
    if (isSnappPaid(latest)) return res.redirect(303, snappSuccessUrl(latest));
    return res.redirect(303, snappPendingUrl(found));
  }

  try {
    // Order was already closed locally (payment window expired).
    if (order.status === 'cancelled') {
      if (state === 'OK') await revertLateSnappPayment(order);
      await releaseSnappPayLock(order);
      return res.redirect(303, snappFailedUrl(order, 'snappay-expired'));
    }

    // Callback fields come from the customer's browser and decide nothing on their own.
    if (hasAmount && callbackAmount !== snappPay.toRial(order.total)) {
      order.snappPay.status = 'UNKNOWN';
      await releaseSnappPayLock(order, {
        error: `مبلغ callback (${Number.isFinite(callbackAmount) ? callbackAmount : 'نامعتبر'}) با مبلغ سفارش (${snappPay.toRial(order.total)}) یکسان نیست`,
        paymentStatus: 'review'
      });
      return res.redirect(303, snappPendingUrl(order));
    }

    if (state !== 'OK') {
      // Confirm with Get Payment Status so a stray/forged FAILED never cancels a real payment.
      let gatewayStatus = '';
      try {
        gatewayStatus = snappPay.normalizeStatus((await snappPay.getPaymentStatus(order.snappPay.paymentToken))?.status);
        order.snappPay.lastStatusCheckAt = new Date();
      } catch (statusError) {
        order.snappPay.lastError = `status: ${statusError.message}`.slice(0, 500);
      }
      if (gatewayStatus !== 'SETTLE' && gatewayStatus !== 'VERIFY') {
        await failSnappPayOrder(order, { gatewayStatus: ['CANCEL', 'REVERT'].includes(gatewayStatus) ? gatewayStatus : 'FAILED' });
        return res.redirect(303, snappFailedUrl(order, 'snappay-failed'));
      }
    }

    const verified = await snappPay.verifyWithRecovery(order.snappPay.paymentToken);
    const outcome = await completeVerifiedSnappPayment(order, verified);
    return res.redirect(303, outcome === 'paid' ? snappSuccessUrl(order) : snappFailedUrl(order, 'inventory'));
  } catch (error) {
    console.error(`[SNAPPPAY CALLBACK] order=${order.orderNumber}`, error?.message || error);
    try {
      let recovered = '';
      try {
        recovered = snappPay.normalizeStatus((await snappPay.getPaymentStatus(order.snappPay.paymentToken))?.status);
        order.snappPay.lastStatusCheckAt = new Date();
      } catch (statusError) {
        order.snappPay.lastError = `${error.message}; status: ${statusError.message}`.slice(0, 500);
      }
      if (recovered === 'SETTLE') {
        await markSnappPayOrderPaid(order);
        return res.redirect(303, snappSuccessUrl(order));
      }
      if (['CANCEL', 'REVERT'].includes(recovered)) {
        await failSnappPayOrder(order, { gatewayStatus: recovered, error: error.message });
        return res.redirect(303, snappFailedUrl(order, 'snappay-reverted'));
      }
      // Still unresolved: the automatic reconciler retries via Get Payment Status.
      order.snappPay.status = 'UNKNOWN';
      await releaseSnappPayLock(order, { error: order.snappPay.lastError || error.message, paymentStatus: 'review' });
    } catch (saveError) {
      console.error(`[SNAPPPAY CALLBACK PERSIST] order=${order.orderNumber}`, saveError);
    }
    return res.redirect(303, snappPendingUrl(order));
  }
}));

// Automatic Get Payment Status reconciliation for SnappPay orders that are still open.
async function reconcileSnappPayOrder(orderId) {
  const order = await lockSnappPayOrder(orderId);
  if (!order) return 'locked';
  try {
    const ageMs = Date.now() - new Date(order.createdAt).getTime();
    let gatewayStatus = '';
    try {
      gatewayStatus = snappPay.normalizeStatus((await snappPay.getPaymentStatus(order.snappPay.paymentToken))?.status);
      order.snappPay.lastStatusCheckAt = new Date();
    } catch (statusError) {
      order.snappPay.lastError = `status: ${statusError.message}`.slice(0, 500);
    }

    const action = resolveSnappPayAction({ status: gatewayStatus, ageMs });
    if (action === 'settled') {
      await markSnappPayOrderPaid(order);
    } else if (action === 'settle') {
      await completeVerifiedSnappPayment(order, { status: 'VERIFY' });
    } else if (action === 'verify') {
      let verified;
      try {
        // Succeeds only if the customer paid but never came back to the callback.
        verified = await snappPay.verifyWithRecovery(order.snappPay.paymentToken);
      } catch {
        await releaseSnappPayLock(order);
        return 'pending';
      }
      await completeVerifiedSnappPayment(order, verified);
    } else if (action === 'cancelled') {
      await failSnappPayOrder(order, { gatewayStatus });
    } else if (action === 'expire') {
      await failSnappPayOrder(order, { error: `مهلت پرداخت به پایان رسید (وضعیت اسنپ‌پی: ${gatewayStatus || 'نامشخص'})` });
    } else {
      await releaseSnappPayLock(order);
    }
    return action;
  } catch (error) {
    console.error(`[SNAPPPAY RECONCILE] order=${order.orderNumber}`, error?.message || error);
    await releaseSnappPayLock(order, { error: error.message }).catch(() => {});
    return 'error';
  }
}

async function reconcileOpenSnappPayOrders() {
  const candidates = await Order.find({
    payment: SNAPPPAY_LABEL,
    'snappPay.paymentToken': { $exists: true, $ne: null },
    paymentStatus: { $in: ['pending', 'review'] },
    status: { $ne: 'cancelled' },
    createdAt: { $lte: new Date(Date.now() - reconcilerConfig.minAgeMs) }
  }).select('_id').sort({ createdAt: 1 }).limit(reconcilerConfig.batchSize).lean();

  const results = {};
  for (const { _id } of candidates) {
    const action = await reconcileSnappPayOrder(_id);
    results[action] = (results[action] || 0) + 1;
  }
  if (candidates.length) console.log('[SNAPPPAY RECONCILE]', results);
  return results;
}

router.get('/verify', asyncHandler(async (req, res) => {
  const { Authority, Status } = req.query;
  if (!Authority) return res.redirect('/payment/failed?reason=authority');
  const order = await Order.findOne({ 'paymentInfo.authority': Authority });
  if (!order) return res.redirect('/payment/failed?reason=order');

  if (order.paymentStatus === 'paid') {
    await syncCustomRequestsFromOrder(order);
    return res.redirect(`/payment/success?order=${encodeURIComponent(order.orderNumber)}&shipping=${encodeURIComponent(order.shippingMethod)}&refId=${encodeURIComponent(order.paymentInfo.refId || '')}`);
  }

  if (Status !== 'OK') {
    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    await order.save();
    await syncCustomRequestsFromOrder(order);
    return res.redirect(`/payment/failed?order=${encodeURIComponent(order.orderNumber)}`);
  }

  const verification = await verifyPayment(order, Authority);
  if (verification.status === 100 || verification.status === 101) {
    order.paymentStatus = 'paid';
    order.paymentInfo.refId = String(verification.refId || '');
    order.paymentInfo.cardPan = verification.cardPan || '';
    order.paymentInfo.paidAt = new Date();
    await applyInventory(order);
    await consumeCoupon(order);
    await syncCustomRequestsFromOrder(order);
    await notifyOrderRegistered(order);
    return res.redirect(`/payment/success?order=${encodeURIComponent(order.orderNumber)}&shipping=${encodeURIComponent(order.shippingMethod)}&refId=${encodeURIComponent(order.paymentInfo.refId)}`);
  }

  order.paymentStatus = 'failed';
  order.status = 'cancelled';
  await order.save();
  await syncCustomRequestsFromOrder(order);
  return res.redirect(`/payment/failed?order=${encodeURIComponent(order.orderNumber)}`);
}));

module.exports = router;
module.exports.SNAPPPAY_LABEL = SNAPPPAY_LABEL;
module.exports.lockSnappPayOrder = lockSnappPayOrder;
module.exports.releaseSnappPayLock = releaseSnappPayLock;
module.exports.reconcileOpenSnappPayOrders = reconcileOpenSnappPayOrders;
module.exports.reconcileSnappPayOrder = reconcileSnappPayOrder;
module.exports.startSnappPayReconciler = () =>
  snappPay.isConfigured() ? startSnappPayReconciler({ runOnce: reconcileOpenSnappPayOrders }) : () => {};
