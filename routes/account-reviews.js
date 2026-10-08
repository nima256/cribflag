const fs = require('fs');
const express = require('express');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const CustomerReview = require('../models/CustomerReview');
const upload = require('../middlewares/upload');
const { requireUser } = require('../middlewares/auth');
const { asyncHandler, ok, AppError } = require('../utils/http');
const { assertUploadedFile } = require('../utils/uploadValidation');
const { processUploadedImage, removeManagedImages, unlinkQuietly } = require('../utils/imageProcessing');
const { adminReview } = require('../services/customerReviews');

const router = express.Router();
router.use(requireUser);

const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const cleanText = (value, max = 2000) => String(value || '').trim().slice(0, max);

const reviewUpload = (req, res, next) => {
  upload.reviewPhotos.array('images', 4)(req, res, error => {
    if (error?.code === 'LIMIT_FILE_SIZE') return next(new AppError(400, 'حجم هر تصویر باید حداکثر ۵ مگابایت باشد'));
    if (error?.code === 'LIMIT_UNEXPECTED_FILE') return next(new AppError(400, 'حداکثر ۴ تصویر قابل ارسال است'));
    return next(error);
  });
};

async function processReviewImages(files = []) {
  const processed = [];
  try {
    for (const file of files) {
      await assertUploadedFile(file, allowedImageTypes);
      const item = await processUploadedImage(file, 'review');
      processed.push({ image: item.image, thumbnail: item.thumbnail });
    }
    return processed;
  } catch (error) {
    await Promise.all(files.map(file => unlinkQuietly(file.path)));
    await removeManagedImages(processed.map(item => item.image));
    throw error;
  }
}

function uniqueOrderProducts(order) {
  const seen = new Set();
  return (order.items || []).filter(item => {
    const productId = Number(item.productId);
    if (!Number.isInteger(productId) || productId <= 0 || seen.has(productId)) return false;
    seen.add(productId);
    return true;
  });
}

router.get('/', asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.session.userId, status: 'delivered' })
    .sort({ 'reviewRequest.eligibleAt': -1, updatedAt: -1 })
    .lean();
  const reviews = await CustomerReview.find({ user: req.session.userId, source: 'customer' })
    .sort({ createdAt: -1 })
    .lean();

  const reviewMap = new Map(reviews.map(review => [`${review.orderNumber}:${review.productId}`, adminReview(review)]));
  const productIds = [...new Set(orders.flatMap(order => uniqueOrderProducts(order).map(item => Number(item.productId))))];
  const products = await Product.find({ publicId: { $in: productIds } })
    .select('publicId title image images status')
    .lean();
  const productMap = new Map(products.map(product => [Number(product.publicId), product]));

  const eligible = orders.map(order => ({
    orderNumber: order.orderNumber,
    deliveredAt: order.reviewRequest?.eligibleAt || order.updatedAt,
    items: uniqueOrderProducts(order).map(item => {
      const productId = Number(item.productId);
      const product = productMap.get(productId);
      return {
        productId,
        title: product?.title || item.title || `محصول ${productId}`,
        image: product?.images?.[0] || product?.image || '',
        size: String(item.size || '').trim(),
        fabric: String(item.fabric || '').trim(),
        review: reviewMap.get(`${order.orderNumber}:${productId}`) || null
      };
    })
  })).filter(order => order.items.length);

  ok(res, {
    eligible,
    reviews: reviews.map(adminReview),
    pendingCount: reviews.filter(review => review.status === 'pending').length
  });
}));

router.post('/', reviewUpload, asyncHandler(async (req, res) => {
  const files = req.files || [];
  const text = cleanText(req.body.text, 2000);
  const orderNumber = cleanText(req.body.orderNumber, 80);
  const productId = Number(req.body.productId);
  if (!orderNumber || !Number.isInteger(productId) || productId <= 0) {
    await Promise.all(files.map(file => unlinkQuietly(file.path)));
    throw new AppError(400, 'سفارش یا محصول انتخاب‌شده معتبر نیست');
  }
  if (!text && !files.length) throw new AppError(400, 'حداقل متن نظر یا یک تصویر ارسال کنید');

  const [order, user, product] = await Promise.all([
    Order.findOne({ orderNumber, user: req.session.userId, status: 'delivered' }),
    User.findById(req.session.userId).select('fullName isActive'),
    Product.findOne({ publicId: productId })
  ]);
  if (!order) {
    await Promise.all(files.map(file => unlinkQuietly(file.path)));
    throw new AppError(403, 'ثبت نظر فقط برای سفارش تحویل‌شده خودتان امکان‌پذیر است');
  }
  if (!user?.isActive) {
    await Promise.all(files.map(file => unlinkQuietly(file.path)));
    throw new AppError(401, 'حساب کاربری فعال نیست');
  }
  if (!product || !(order.items || []).some(item => Number(item.productId) === productId)) {
    await Promise.all(files.map(file => unlinkQuietly(file.path)));
    throw new AppError(403, 'این محصول در سفارش انتخاب‌شده وجود ندارد');
  }

  const existing = await CustomerReview.findOne({
    user: req.session.userId,
    order: order._id,
    productId,
    source: 'customer'
  });
  if (existing?.status === 'approved') {
    await Promise.all(files.map(file => unlinkQuietly(file.path)));
    throw new AppError(409, 'نظر تأییدشده این محصول قبلاً ثبت شده است');
  }

  const newImages = await processReviewImages(files);
  const oldImages = existing?.images?.map(item => item.image) || [];
  const review = existing || new CustomerReview();
  review.user = req.session.userId;
  review.order = order._id;
  review.orderNumber = order.orderNumber;
  review.product = product._id;
  review.productId = product.publicId;
  review.productTitle = product.title;
  review.customerName = user.fullName;
  review.text = text;
  if (newImages.length) review.images = newImages;
  review.source = 'customer';
  review.verifiedPurchase = true;
  review.status = 'pending';
  review.approvedBy = null;
  review.approvedAt = null;
  review.moderatedAt = null;
  review.moderationNote = '';

  try {
    await review.save();
  } catch (error) {
    await removeManagedImages(newImages.map(item => item.image));
    if (error?.code === 11000) throw new AppError(409, 'برای این محصول در این سفارش قبلاً نظر ثبت شده است');
    throw error;
  }

  if (newImages.length && oldImages.length) await removeManagedImages(oldImages);
  ok(res, { message: 'نظر شما ثبت شد و پس از تأیید در سایت نمایش داده می‌شود.', review: adminReview(review) }, existing ? 200 : 201);
}));

module.exports = router;
