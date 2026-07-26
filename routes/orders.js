const express = require('express');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const CustomRequest = require('../models/CustomRequest');
const { calculate } = require('./discounts');
const { requestPayment, verifyPayment } = require('../services/payment');
const { sendOrderRegisteredSms } = require('../services/sms');
const { requireUser } = require('../middlewares/auth');
const { asyncHandler, ok, AppError } = require('../utils/http');
const { orderNumber } = require('../utils/formatters');
const env = require('../config/env');
const { findVariantPricing, fallbackPricing } = require('../utils/productPricing');

const router = express.Router();

const isCustomItem = item => ['طرح دلخواه', 'طرح اختصاصی'].includes(String(item?.category || ''));
const normalizeDigits = value => String(value || '')
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

async function priceItems(items) {
  const output = [];
  let subtotal = 0;

  for (const raw of items || []) {
    const qty = Math.max(1, Math.min(50, Number(raw.qty || 1)));
    const publicId = Number(raw.id);

    if (Number.isFinite(publicId)) {
      const product = await Product.findOne({ publicId, status: 'active' });
      if (!product) throw new AppError(400, `محصول ${raw.title || publicId} موجود نیست`);
      if (product.stock < qty) throw new AppError(400, `موجودی ${product.title} کافی نیست`);

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
      output.push({ productId: publicId, title: product.title, category: categories[0] || product.category, categories, price: pricing.price, qty, size, fabric, notes: String(raw.notes || '').trim() });
      subtotal += pricing.price * qty;
    }
  }

  if (!output.length) throw new AppError(400, 'سبد خرید خالی است');
  return { items: output, subtotal };
}

async function applyInventory(order) {
  if (order.inventoryApplied) return;
  for (const item of order.items) {
    if (item.productId) {
      const result = await Product.updateOne(
        { publicId: item.productId, stock: { $gte: item.qty } },
        { $inc: { stock: -item.qty, sales: item.qty } }
      );
      if (!result.modifiedCount) throw new AppError(409, `موجودی ${item.title} در زمان پرداخت تغییر کرده است`);
    }
  }
  order.inventoryApplied = true;
  await order.save();
}

async function notifyOrderRegistered(order) {
  if (order.orderRegisteredSmsSentAt) return;

  try {
    await sendOrderRegisteredSms(order);
    order.orderRegisteredSmsSentAt = new Date();
    await order.save();
  } catch (error) {
    console.error(`[ORDER SMS] order=${order.orderNumber}`, error);
  }
}

async function consumeCoupon(order) {
  if (!order.couponCode) return;
  const coupon = await Coupon.findOne({ code: order.couponCode });
  if (!coupon) return;
  if (!coupon.usedBy.some(item => item.orderNumber === order.orderNumber)) {
    coupon.usedCount += 1;
    coupon.usedBy.push({ user: order.user, orderNumber: order.orderNumber });
    await coupon.save();
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

  let customRequestIds = [];
  if (customItems.length) {
    customRequestIds = await updateCustomDelivery({
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

  // طرح اختصاصی فقط در CustomRequest ذخیره می‌شود و Order جداگانه ساخته نمی‌شود.
  if (customItems.length && !normalItems.length) {
    const customRequestId = customRequestIds[0];
    return ok(res, {
      message: 'درخواست طرح اختصاصی با موفقیت ثبت شد',
      customRequestId,
      orderNumber: customRequestId,
      successUrl:
        `/payment/success?order=${encodeURIComponent(customRequestId)}` +
        `&shipping=${encodeURIComponent(shippingMethod)}` +
        '&type=custom'
    }, 201);
  }

  const { items, subtotal } = await priceItems(normalItems);

  let discount = 0;
  let coupon = null;
  if (req.body.couponCode) {
    const result = await calculate(req.body.couponCode, subtotal, user._id);
    discount = result.amount;
    coupon = result.coupon;
  }

  const paymentMethod = req.body.paymentMethod === 'manual' ? 'manual' : 'online';
  const order = await Order.create({
    orderNumber: orderNumber(),
    user: user._id,
    customer: user.fullName,
    phone: user.mobile,
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
    status: 'processing',
    payment: paymentMethod === 'manual' ? 'کارت به کارت' : 'پرداخت آنلاین زرین‌پال',
    paymentStatus: paymentMethod === 'manual' ? 'review' : 'pending',
    shippingMethod
  });

  if (paymentMethod === 'manual') {
    await applyInventory(order);
    await consumeCoupon(order);
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
