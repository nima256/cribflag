const express = require('express');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const CustomRequest = require('../models/CustomRequest');
const { calculate } = require('./discounts');
const { requestPayment, verifyPayment } = require('../services/payment');
const torobPay = require('../services/torobPay');
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

router.post('/quote', requireUser, asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId);
  if (!user || !user.isActive) throw new AppError(401, 'ابتدا وارد حساب کاربری فعال شوید');

  const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
  assertClientCartSnapshot(req.body, rawItems);
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
  if (req.body.couponCode && subtotal > 0) {
    const result = await calculate(req.body.couponCode, { items, subtotal }, user._id);
    discount = result.amount;
  }

  const requestedPaymentMethod = String(req.body.paymentMethod || '').trim();
  if (requestedPaymentMethod && !['zarinpal', 'torobpay'].includes(requestedPaymentMethod)) {
    throw new AppError(400, 'روش پرداخت انتخاب‌شده معتبر نیست');
  }
  const paymentMethod = requestedPaymentMethod || 'zarinpal';
  const payableBeforeTax = Math.max(0, subtotal - discount);
  const tax = paymentMethod === 'torobpay' ? Math.round(payableBeforeTax * 0.10) : 0;
  const total = payableBeforeTax + tax;

  return ok(res, { subtotal, discount, tax, total, paymentMethod });
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
  if (requestedPaymentMethod && !['zarinpal', 'torobpay'].includes(requestedPaymentMethod)) {
    throw new AppError(400, 'روش پرداخت انتخاب‌شده معتبر نیست');
  }
  const paymentMethod = requestedPaymentMethod || 'zarinpal';
  const customerMobile = normalizeMobile(user.mobile);
  if (!/^09\d{9}$/.test(customerMobile)) {
    throw new AppError(400, 'شماره موبایل حساب کاربری معتبر نیست؛ ابتدا آن را در پروفایل اصلاح کنید');
  }

  const payableBeforeTax = Math.max(0, subtotal - discount);
  const tax = paymentMethod === 'torobpay' ? Math.round(payableBeforeTax * 0.10) : 0;
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

  const paymentLabel = paymentMethod === 'torobpay'
    ? 'پرداخت اقساطی ترب‌پی'
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
