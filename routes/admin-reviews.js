const express = require('express');
const Product = require('../models/Product');
const CustomerReview = require('../models/CustomerReview');
const RecentAction = require('../models/RecentAction');
const upload = require('../middlewares/upload');
const { requireAdmin } = require('../middlewares/auth');
const { asyncHandler, ok, AppError } = require('../utils/http');
const { assertUploadedFile } = require('../utils/uploadValidation');
const { processUploadedImage, removeManagedImages, unlinkQuietly } = require('../utils/imageProcessing');
const { adminReview, SOURCE_LABELS } = require('../services/customerReviews');

const router = express.Router();
router.use(requireAdmin);

const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const allowedSources = new Set(Object.keys(SOURCE_LABELS).filter(item => item !== 'customer'));
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

router.get('/', asyncHandler(async (req, res) => {
  const status = String(req.query.status || '').trim();
  const query = ['pending', 'approved', 'rejected'].includes(status) ? { status } : {};
  const reviews = await CustomerReview.find(query).sort({ createdAt: -1 }).limit(500).lean();
  const counts = await CustomerReview.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  const countMap = Object.fromEntries(counts.map(item => [item._id, item.count]));
  ok(res, {
    reviews: reviews.map(adminReview),
    counts: {
      pending: Number(countMap.pending || 0),
      approved: Number(countMap.approved || 0),
      rejected: Number(countMap.rejected || 0),
      total: reviews.length
    }
  });
}));

router.post('/', reviewUpload, asyncHandler(async (req, res) => {
  const files = req.files || [];
  const rawProductId = String(req.body.productId || '').trim();
  const isCustomDesign = rawProductId === 'custom-design';
  const productId = isCustomDesign ? null : Number(rawProductId);
  const customerName = cleanText(req.body.customerName, 120);
  const text = cleanText(req.body.text, 2000);
  const source = allowedSources.has(String(req.body.source || '')) ? String(req.body.source) : 'admin';
  const status = req.body.status === 'pending' ? 'pending' : 'approved';

  if ((!isCustomDesign && (!Number.isInteger(productId) || productId <= 0)) || customerName.length < 2) {
    await Promise.all(files.map(file => unlinkQuietly(file.path)));
    throw new AppError(400, 'محصول یا طرح دلخواه و نام مشتری را کامل انتخاب کنید');
  }
  if (!text && !files.length) throw new AppError(400, 'حداقل متن نظر یا یک تصویر وارد کنید');
  const product = isCustomDesign ? null : await Product.findOne({ publicId: productId });
  if (!isCustomDesign && !product) {
    await Promise.all(files.map(file => unlinkQuietly(file.path)));
    throw new AppError(404, 'محصول پیدا نشد');
  }

  const images = await processReviewImages(files);
  let review;
  try {
    review = await CustomerReview.create({
      reviewType: isCustomDesign ? 'custom_design' : 'product',
      product: product?._id || null,
      productId: product?.publicId || null,
      productTitle: isCustomDesign ? 'طرح دلخواه' : product.title,
      customerName,
      text,
      images,
      source,
      verifiedPurchase: false,
      status,
      approvedBy: status === 'approved' ? req.session.adminId : null,
      approvedAt: status === 'approved' ? new Date() : null,
      moderatedAt: status === 'approved' ? new Date() : null
    });
  } catch (error) {
    await removeManagedImages(images.map(item => item.image));
    throw error;
  }

  await RecentAction.create({
    action: 'review_create', targetType: 'review', targetId: String(review._id),
    targetName: isCustomDesign ? 'طرح دلخواه' : product.title, adminId: req.session.adminId, ipAddress: req.ip
  });
  ok(res, { message: status === 'approved' ? 'رضایت مشتری ثبت و منتشر شد' : 'رضایت مشتری در انتظار تأیید ثبت شد', review: adminReview(review) }, 201);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const status = String(req.body.status || '').trim();
  if (!['pending', 'approved', 'rejected'].includes(status)) throw new AppError(400, 'وضعیت نظر معتبر نیست');
  const review = await CustomerReview.findById(req.params.id);
  if (!review) throw new AppError(404, 'نظر پیدا نشد');

  review.status = status;
  review.moderatedAt = new Date();
  review.moderationNote = cleanText(req.body.moderationNote, 1000);
  if (status === 'approved') {
    review.approvedBy = req.session.adminId;
    review.approvedAt = review.approvedAt || new Date();
  } else {
    review.approvedBy = null;
    review.approvedAt = null;
  }
  await review.save();

  await RecentAction.create({
    action: `review_${status}`, targetType: 'review', targetId: String(review._id),
    targetName: review.productTitle, adminId: req.session.adminId, ipAddress: req.ip
  });
  ok(res, { message: 'وضعیت نظر ذخیره شد', review: adminReview(review) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const review = await CustomerReview.findById(req.params.id);
  if (!review) throw new AppError(404, 'نظر پیدا نشد');
  const images = review.images.map(item => item.image);
  await review.deleteOne();
  await removeManagedImages(images);
  await RecentAction.create({
    action: 'review_delete', targetType: 'review', targetId: String(review._id),
    targetName: review.productTitle, adminId: req.session.adminId, ipAddress: req.ip
  });
  ok(res, { message: 'نظر حذف شد' });
}));

module.exports = router;
