const express = require('express');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const CustomRequest = require('../models/CustomRequest');
const { calculate } = require('./discounts');
const { requestPayment, verifyPayment } = require('../services/payment');
const { sendOrderRegisteredSms } = require('../services/sms');
const { requireUser } = require('../middlewares/auth');
const { asyncHandler, ok, AppError } = require('../utils/http');
const { orderNumber, normalizeMobile } = require('../utils/formatters');
const env = require('../config/env');
const { findVariantPricing, fallbackPricing } = require('../utils/productPricing');
const { applyInventory } = require('../services/inventory');
const { consumeCoupon } = require('../services/coupons');

const router = express.Router();

const isCustomItem = item => ['طرح دلخواه', 'طرح اختصاصی'].includes(String(item?.category || '')) || Boolean(item?.customRequestId);
const normalizeDigits = value => String(value || '')
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

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

    const sizes = Array.isArray(product.sizes) ? product.sizes : [];
    const fabrics = Array.isArray(product.fabrics) ? product.fabrics : [];
    const size = String(raw.size || sizes[0] || '').trim();
    const fabric = String(raw.fabric || fabrics[0] || '').trim();
    if (sizes.length && !sizes.includes(size)) throw new AppError(400, `سایز انتخاب‌شده برای ${product.title} معتبر نیست`);
    if (fabrics.length && !fabrics.includes(fabric)) throw new AppError(400, `جنس پارچه انتخاب‌شده برای ${product.title} معتبر نیست`);

    const variant = findVariantPricing(product, size, fabric);
    if (product.variantPrices?.length && !variant) {
      throw new AppError(400, `برای ترکیب سایز و جنس انتخاب‌شده محصول ${product.title} قیمت ثبت نشده است`);
    }
    const pricing = variant || fallbackPricing(product);
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
    if (!Number.isFinite(price) || price <= 0) {
      throw new AppError(400, `قیمت درخواست ${request.publicId} معتبر نیست`);
    }

    output.push({
      title: `چاپ طرح اختصاصی — ${request.fileName || request.publicId}`,
      category: 'طرح دلخواه',
      categories: ['طرح دلخواه'],
      price,
      qty: 1,
      size: request.size,
      fabric: request.fabric,
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
        status: 'review'
      }
    }
  );

  return publicIds;
}

router.post('/', requireUser, asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId);
  if (!user || !user.isActive) throw new AppError(401, 'ابتدا وارد حساب کاربری فعال شوید');

  const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
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
  if (req.body.couponCode && normalPricing.subtotal > 0) {
    // کد تخفیف فقط روی محصولات فروشگاه اعمال می‌شود، نه روی طرح اختصاصی.
    const result = await calculate(req.body.couponCode, normalPricing, user._id);
    discount = result.amount;
    coupon = result.coupon;
  }

  const paymentMethod = req.body.paymentMethod === 'manual' ? 'manual' : 'online';
  const customerMobile = normalizeMobile(user.mobile);
  if (!/^09\d{9}$/.test(customerMobile)) {
    throw new AppError(400, 'شماره موبایل حساب کاربری معتبر نیست؛ ابتدا آن را در پروفایل اصلاح کنید');
  }

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
    total: Math.max(0, subtotal - discount),
    couponCode: coupon?.code,
    customerNote: String(req.body.note || '').trim(),
    status: customItems.length ? 'design-review' : 'processing',
    payment: paymentMethod === 'manual' ? 'کارت به کارت' : 'پرداخت آنلاین زرین‌پال',
    paymentStatus: paymentMethod === 'manual' ? 'review' : 'pending',
    shippingMethod
  });

  if (paymentMethod === 'manual') {
    await notifyOrderRegistered(order);
    return ok(res, {
      message: 'سفارش کارت‌به‌کارت ثبت شد',
      orderNumber: order.orderNumber,
      successUrl: `/payment/success?order=${encodeURIComponent(order.orderNumber)}&shipping=${encodeURIComponent(order.shippingMethod)}`
    }, 201);
  }

  if (env.paymentMock) {
    order.paymentStatus = 'paid';
    order.paymentInfo.paidAt = new Date();
    await applyInventory(order);
    await consumeCoupon(order);
    await notifyOrderRegistered(order);
    return ok(res, {
      message: 'پرداخت محلی شبیه‌سازی شد',
      orderNumber: order.orderNumber,
      successUrl: `/payment/success?order=${encodeURIComponent(order.orderNumber)}&shipping=${encodeURIComponent(order.shippingMethod)}`
    }, 201);
  }

  try {
    const payment = await requestPayment(order);
    if (!payment?.url || !payment?.authority) throw new Error('پاسخ معتبر از زرین‌پال دریافت نشد');
    order.paymentInfo.authority = payment.authority;
    order.paymentInfo.url = payment.url;
    await order.save();
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

router.get('/verify', asyncHandler(async (req, res) => {
  const { Authority, Status } = req.query;
  if (!Authority) return res.redirect('/payment/failed?reason=authority');
  const order = await Order.findOne({ 'paymentInfo.authority': Authority });
  if (!order) return res.redirect('/payment/failed?reason=order');

  if (order.paymentStatus === 'paid') {
    return res.redirect(`/payment/success?order=${encodeURIComponent(order.orderNumber)}&shipping=${encodeURIComponent(order.shippingMethod)}&refId=${encodeURIComponent(order.paymentInfo.refId || '')}`);
  }

  if (Status !== 'OK') {
    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    await order.save();
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
    await notifyOrderRegistered(order);
    return res.redirect(`/payment/success?order=${encodeURIComponent(order.orderNumber)}&shipping=${encodeURIComponent(order.shippingMethod)}&refId=${encodeURIComponent(order.paymentInfo.refId)}`);
  }

  order.paymentStatus = 'failed';
  order.status = 'cancelled';
  await order.save();
  return res.redirect(`/payment/failed?order=${encodeURIComponent(order.orderNumber)}`);
}));

module.exports = router;
