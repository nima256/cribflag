const express = require('express');
const rateLimit = require('express-rate-limit');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Coupon = require('../models/Coupon');
const Order = require('../models/Order');
const Ticket = require('../models/Ticket');
const CustomRequest = require('../models/CustomRequest');
const Notification = require('../models/Notification');
const RecentAction = require('../models/RecentAction');
const CustomerReview = require('../models/CustomerReview');
const { requireAdmin } = require('../middlewares/auth');
const { asyncHandler, ok, AppError } = require('../utils/http');
const S = require('../services/serializers');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { prepareProductPricing, findVariantPricing, fallbackPricing, normalizeVariantPrices, variantKey } = require('../utils/productPricing');
const { assertUploadedFile } = require('../utils/uploadValidation');
const { processUploadedImage, removeManagedImage, removeManagedImages, unlinkQuietly } = require('../utils/imageProcessing');
const { applyInventory, releaseInventory, restockReturnedItems } = require('../services/inventory');
const { consumeCoupon, releaseCoupon } = require('../services/coupons');
const torobPay = require('../services/torobPay');
const snappPay = require('../services/snappPay');
const { buildSnappPayPayload, countUnits, itemsSubtotal, recalculateDiscount } = require('../services/snappPayPricing');
const { itemIsEligible } = require('./discounts');
const SNAPPPAY_LABEL = 'پرداخت اقساطی اسنپ‌پی';
const SNAPPPAY_STALE_LOCK_MS = 10 * 60 * 1000;
const upload = require('../middlewares/upload');
const { buildAnalytics, isPaidSale } = require('../services/analytics');
const { categoryPayload, ensureLegacyCategories, nextCategoryId, resolveCategorySelection, syncProductCategoryNames } = require('../services/categories');
const { parsePersianDate } = require('../utils/formatters');
const { detectPillowMode, getPillowConfig } = require('../utils/pillowPricing');
const { getCustomPricingConfig, saveCustomPricingConfig } = require('../utils/customPricing');
const { markReviewRequestEligible } = require('../services/reviewRequestSms');
const {
  CUSTOM_PAYMENT_STATUSES,
  ORDER_PAYMENT_STATUSES,
  hydrateCustomRequestsWithOrders,
  syncCustomRequestsFromOrder
} = require('../services/customOrderSync');

const ORDER_STATUS_LABELS = Object.freeze({
  processing: 'در حال آماده‌سازی',
  'design-review': 'بررسی طراحی',
  'print-preparation': 'آماده‌سازی برای چاپ',
  printed: 'چاپ شده',
  packed: 'بسته‌بندی شده',
  shipped: 'ارسال شده',
  delivered: 'تحویل شده',
  cancelled: 'لغو شده'
});
const ORDER_STATUSES = new Set(Object.keys(ORDER_STATUS_LABELS));

// Paid SnappPay orders are only cancelled/refunded through the SnappPay cancel action
// (admin confirmation + payment/v1/cancel), otherwise the two sides would disagree.
function assertNotSilentSnappPayCancel(order, status, paymentStatus) {
  const paidSnappPay = order.payment === SNAPPPAY_LABEL && order.paymentStatus === 'paid' && order.snappPay?.status === 'SETTLE';
  if (paidSnappPay && (status === 'cancelled' || ['failed', 'refunded'].includes(paymentStatus))) {
    throw new AppError(409, `سفارش ${order.orderNumber} با اسنپ‌پی پرداخت شده است؛ لغو آن فقط از دکمه «لغو کامل در اسنپ‌پی» در جزئیات سفارش ممکن است`);
  }
}

async function applyBulkOrderStatus(order, status) {
  assertNotSilentSnappPayCancel(order, status, order.paymentStatus);
  const previousStatus = order.status;
  let paymentStatus = order.paymentStatus;
  const isTorobPayOrder = order.payment === 'پرداخت اقساطی ترب‌پی';
  const shouldCancelTorob = status === 'cancelled' &&
    paymentStatus === 'paid' &&
    isTorobPayOrder &&
    Boolean(order.paymentInfo?.torobPaymentToken);

  if (shouldCancelTorob) {
    try {
      await torobPay.cancelPayment(order.paymentInfo.torobPaymentToken);
      order.paymentInfo.torobStatus = 'REVERT';
      paymentStatus = 'refunded';
    } catch (error) {
      throw new AppError(502, `لغو سفارش ${order.orderNumber} در ترب‌پی انجام نشد؛ وضعیت سفارش تغییر نکرد: ${error?.message || 'خطای نامشخص'}`);
    }
  }

  const shouldRelease = status === 'cancelled' || ['failed', 'refunded'].includes(paymentStatus);
  if (shouldRelease) {
    await releaseInventory(order);
    await releaseCoupon(order);
  } else if (paymentStatus === 'paid') {
    await applyInventory(order);
    await consumeCoupon(order);
  }

  order.status = status;
  order.paymentStatus = paymentStatus;
  await order.save();
  await syncCustomRequestsFromOrder(order);
  await markReviewRequestEligible(order, previousStatus);
}

function addOrderRelations(order, orderNumbers, customRequestIds) {
  if (!order) return false;
  let changed = false;
  const orderNumber = String(order.orderNumber || '').trim();
  if (orderNumber && !orderNumbers.has(orderNumber)) {
    orderNumbers.add(orderNumber);
    changed = true;
  }
  for (const item of order.items || []) {
    const customRequestId = String(item?.customRequestId || '').trim();
    if (customRequestId && !customRequestIds.has(customRequestId)) {
      customRequestIds.add(customRequestId);
      changed = true;
    }
  }
  return changed;
}

function addCustomRelations(customRequest, orderNumbers, customRequestIds) {
  if (!customRequest) return false;
  let changed = false;
  const publicId = String(customRequest.publicId || '').trim();
  const orderNumber = String(customRequest.orderNumber || '').trim();
  if (publicId && !customRequestIds.has(publicId)) {
    customRequestIds.add(publicId);
    changed = true;
  }
  if (orderNumber && !orderNumbers.has(orderNumber)) {
    orderNumbers.add(orderNumber);
    changed = true;
  }
  return changed;
}

function orderRelationQuery(orderNumbers, customRequestIds) {
  const conditions = [];
  if (orderNumbers.size) conditions.push({ orderNumber: { $in: [...orderNumbers] } });
  if (customRequestIds.size) conditions.push({ 'items.customRequestId': { $in: [...customRequestIds] } });
  return conditions.length ? { $or: conditions } : { _id: null };
}

function customRelationQuery(orderNumbers, customRequestIds) {
  const conditions = [];
  if (orderNumbers.size) conditions.push({ orderNumber: { $in: [...orderNumbers] } });
  if (customRequestIds.size) conditions.push({ publicId: { $in: [...customRequestIds] } });
  return conditions.length ? { $or: conditions } : { _id: null };
}

function adminOrderPayload(order, customRequestById = new Map()) {
  const payload = S.order(order);
  payload.items = (payload.items || []).map(item => {
    const customRequestId = String(item?.customRequestId || '').trim();
    if (!customRequestId) return item;

    const customRequest = customRequestById.get(customRequestId);
    return {
      ...item,
      adminNote: String(customRequest?.adminNote || '').trim()
    };
  });
  return payload;
}

async function resolveOrderDeletion(identifier, source) {
  const orderNumbers = new Set();
  const customRequestIds = new Set();

  if (source === 'custom') {
    const customRequest = await CustomRequest.findOne({ publicId: identifier });
    if (!customRequest) throw new AppError(404, 'سفارش اختصاصی پیدا نشد');
    addCustomRelations(customRequest, orderNumbers, customRequestIds);
  } else {
    const order = await Order.findOne({ orderNumber: identifier });
    if (!order) throw new AppError(404, 'سفارش پیدا نشد');
    addOrderRelations(order, orderNumbers, customRequestIds);
  }

  let orders = [];
  let customRequests = [];

  // ارتباط‌های قدیمی ممکن است فقط در یکی از دو سند ذخیره شده باشند؛
  // چند مرحله گسترش، همه رکوردهای یک خرید را بدون باقی‌گذاشتن DS/KR یتیم پیدا می‌کند.
  for (let round = 0; round < 5; round += 1) {
    orders = await Order.find(orderRelationQuery(orderNumbers, customRequestIds));
    customRequests = await CustomRequest.find(customRelationQuery(orderNumbers, customRequestIds));

    let changed = false;
    for (const order of orders) changed = addOrderRelations(order, orderNumbers, customRequestIds) || changed;
    for (const customRequest of customRequests) changed = addCustomRelations(customRequest, orderNumbers, customRequestIds) || changed;
    if (!changed) break;
  }

  return { orders, customRequests, orderNumbers, customRequestIds };
}

function managedCustomFilePath(filePath) {
  if (!filePath) return '';
  const uploadsDirectory = path.resolve(__dirname, '..', 'uploads');
  const absoluteFilePath = path.resolve(filePath);
  if (!absoluteFilePath.startsWith(`${uploadsDirectory}${path.sep}`)) return '';
  return absoluteFilePath;
}

async function normalizeCouponVariants(value) {
  const parsed = [];
  const productIds = new Set();

  for (const item of Array.isArray(value) ? value : []) {
    const rawProductId = Number(item?.productId);
    const productId = Number.isInteger(rawProductId) && rawProductId > 0 ? rawProductId : null;
    const size = String(item?.size || '').trim();
    const fabric = String(item?.fabric || '').trim();
    if (!size || !fabric || size.length > 160 || fabric.length > 120) {
      throw new AppError(400, 'یکی از ترکیب‌های محصول، سایز یا جنس کد تخفیف معتبر نیست');
    }
    if (productId) productIds.add(productId);
    parsed.push({ productId, size, fabric });
  }

  const products = productIds.size
    ? await Product.find({ publicId: { $in: [...productIds] } })
      .select('publicId title sizes fabrics variantPrices')
      .lean()
    : [];
  const productById = new Map(products.map(product => [Number(product.publicId), product]));

  if (productById.size !== productIds.size) {
    throw new AppError(400, 'یکی از محصولات انتخاب‌شده برای کد تخفیف پیدا نشد');
  }

  const unique = new Map();
  for (const item of parsed) {
    if (item.productId) {
      const product = productById.get(item.productId);
      const sizes = Array.isArray(product.sizes) ? product.sizes.map(value => String(value).trim()) : [];
      const fabrics = Array.isArray(product.fabrics) ? product.fabrics.map(value => String(value).trim()) : [];
      if (sizes.length && !sizes.includes(item.size)) {
        throw new AppError(400, `سایز انتخاب‌شده برای محصول ${product.title || item.productId} معتبر نیست`);
      }
      if (fabrics.length && !fabrics.includes(item.fabric)) {
        throw new AppError(400, `جنس انتخاب‌شده برای محصول ${product.title || item.productId} معتبر نیست`);
      }
      const variants = Array.isArray(product.variantPrices) ? product.variantPrices : [];
      if (variants.length && !variants.some(variant => String(variant.size || '').trim() === item.size && String(variant.fabric || '').trim() === item.fabric)) {
        throw new AppError(400, `ترکیب انتخاب‌شده برای محصول ${product.title || item.productId} وجود ندارد`);
      }
    }

    const key = `${item.productId || '*'}\u0000${item.size}\u0000${item.fabric}`;
    unique.set(key, item);
  }

  return [...unique.values()];
}


const GALLERY_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif']);
const GALLERY_ROOTS = Object.freeze({
  public: path.resolve(__dirname, '..', 'public'),
  uploads: path.resolve(__dirname, '..', 'uploads')
});

function galleryFileId(rootKey, relativePath) {
  return Buffer.from(`${rootKey}:${String(relativePath || '').replace(/\\/g, '/')}`, 'utf8').toString('base64url');
}

function galleryFileFromId(id) {
  let decoded = '';
  try { decoded = Buffer.from(String(id || ''), 'base64url').toString('utf8'); } catch {}
  const separator = decoded.indexOf(':');
  if (separator < 1) throw new AppError(400, 'شناسه تصویر معتبر نیست');
  const rootKey = decoded.slice(0, separator);
  const relativePath = decoded.slice(separator + 1).replace(/\\/g, '/').replace(/^\/+/, '');
  const root = GALLERY_ROOTS[rootKey];
  if (!root || !relativePath || relativePath.split('/').includes('..')) throw new AppError(400, 'مسیر تصویر معتبر نیست');
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath === root || !absolutePath.startsWith(`${root}${path.sep}`)) throw new AppError(403, 'مسیر تصویر خارج از محدوده مجاز است');
  if (!GALLERY_IMAGE_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) throw new AppError(400, 'فایل انتخاب‌شده تصویر نیست');
  return { rootKey, relativePath, absolutePath };
}

async function walkGalleryImages(rootKey, directory = GALLERY_ROOTS[rootKey], prefix = '') {
  let entries = [];
  try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { return []; }
  const output = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (rootKey === 'uploads' && !prefix && entry.name === '.incoming') continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...await walkGalleryImages(rootKey, absolutePath, relativePath));
      continue;
    }
    if (!entry.isFile() || !GALLERY_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const stat = await fs.promises.stat(absolutePath).catch(() => null);
    if (!stat) continue;
    output.push({ rootKey, relativePath, absolutePath, bytes: stat.size, modifiedAt: stat.mtime });
  }
  return output;
}

function galleryPublicUrl(rootKey, relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (rootKey === 'public') return `/${normalized}`;
  if (rootKey === 'uploads' && !normalized.startsWith('custom/')) return `/uploads/${normalized}`;
  return '';
}

async function galleryReferenceSets() {
  const [products, categories, customRequests, customerReviews] = await Promise.all([
    Product.find().select('image images').lean(),
    Category.find().select('image').lean(),
    CustomRequest.find().select('filePath').lean(),
    CustomerReview.find().select('images').lean()
  ]);
  const urls = new Set();
  const reviewUrls = new Set();
  for (const product of products) {
    for (const image of (Array.isArray(product.images) && product.images.length ? product.images : [product.image])) {
      const normalized = String(image || '').split('?')[0].trim();
      if (normalized) urls.add(normalized.startsWith('/') ? normalized : `/${normalized.replace(/^\.\//, '')}`);
    }
  }
  for (const category of categories) {
    const normalized = String(category.image || '').split('?')[0].trim();
    if (normalized) urls.add(normalized.startsWith('/') ? normalized : `/${normalized.replace(/^\.\//, '')}`);
  }
  for (const review of customerReviews) {
    for (const item of Array.isArray(review.images) ? review.images : []) {
      for (const value of [item?.image, item?.thumbnail]) {
        const normalized = String(value || '').split('?')[0].trim();
        if (normalized) reviewUrls.add(normalized.startsWith('/') ? normalized : `/${normalized.replace(/^\.\//, '')}`);
      }
    }
  }
  const customPaths = new Set(customRequests.map(item => path.resolve(String(item.filePath || ''))).filter(Boolean));
  return { urls, reviewUrls, customPaths };
}


const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'تعداد تلاش ورود بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید.' }
});
const saveSession = req => new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
const regenerateSession = req => new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
const destroySession = req => new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));

async function regenerateAdminSession(req) {
  // ادمین و کاربر یک کوکی مشترک دارند؛ هنگام ورود ادمین، نشست فعال کاربر را حفظ می‌کنیم.
  const userId = req.session?.userId;
  await regenerateSession(req);
  if (userId) req.session.userId = userId;
}

async function logoutAdminOnly(req, res) {
  delete req.session.adminId;

  if (req.session.userId) {
    await saveSession(req);
    return;
  }

  await destroySession(req);
  res.clearCookie('cribflag.sid');
}


function booleanField(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

async function categoryData(body = {}, current = null) {
  const name = String(body.name || '').trim();
  if (!name) throw new AppError(400, 'نام دسته‌بندی الزامی است');
  const slug = Category.normalizeSlug(body.slug || name);
  if (!slug) throw new AppError(400, 'اسلاگ دسته‌بندی معتبر نیست');
  return {
    name,
    slug,
    description: String(body.description || '').trim(),
    image: String(body.image || '').trim(),
    status: body.status === 'draft' ? 'draft' : 'active',
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : Number(current?.sortOrder || 0),
    showInMenu: booleanField(body.showInMenu, current?.showInMenu ?? true),
    showInStore: booleanField(body.showInStore, current?.showInStore ?? true),
    showInHome: booleanField(body.showInHome, current?.showInHome ?? true),
    showInReady: booleanField(body.showInReady, current?.showInReady ?? false),
    isReadyRoot: booleanField(body.isReadyRoot, current?.isReadyRoot ?? false)
  };
}

async function generateUniqueSku() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const sku = `CF-${crypto.randomInt(100000, 1000000)}`;
    if (!(await Product.exists({ sku }))) return sku;
  }
  return `CF-${Date.now().toString().slice(-9)}`;
}

function selectedProductOption(product, value, field) {
  const options = Array.isArray(product[field]) ? product[field] : [];
  const selected = String(value || options[0] || '').trim();
  if (options.length && !options.includes(selected)) {
    throw new AppError(400, `${field === 'sizes' ? 'سایز' : 'جنس پارچه'} انتخاب‌شده معتبر نیست`);
  }
  return selected;
}

router.post('/login', adminLoginLimiter, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const admin = await Admin.findOne({ email }).select('+password');
  const passwordIsValid = admin?.isActive && await admin.comparePassword(password);
  if (!passwordIsValid) {
    throw new AppError(401, 'ایمیل یا رمز عبور اشتباه است');
  }

  // رمزهای ساده‌ای که قبلاً مستقیم وارد دیتابیس شده‌اند، بعد از اولین ورود امن می‌شوند.
  if (admin.passwordNeedsHash()) await admin.setPassword(password);

  admin.lastLoginAt = new Date();
  admin.lastLoginIP = req.ip;
  await admin.save();
  await regenerateAdminSession(req);
  req.session.adminId = admin._id.toString();
  await RecentAction.create({ action: 'admin_login', targetType: 'admin', targetId: String(admin._id), targetName: admin.fullName, adminId: admin._id, adminName: admin.fullName, ipAddress: req.ip });
  await saveSession(req);
  ok(res, { admin: { fullName: admin.fullName, email: admin.email, role: admin.role, permissions: admin.permissions } });
}));

router.post('/logout', requireAdmin, asyncHandler(async (req, res) => {
  const id = req.session.adminId;
  await RecentAction.create({ action: 'admin_logout', targetType: 'admin', targetId: id, adminId: id, ipAddress: req.ip });
  await logoutAdminOnly(req, res);
  ok(res, { message: 'خارج شدید' });
}));
router.use(requireAdmin);

// ---------------------------------------------------------------- SnappPay order actions
async function loadSnappPayOrder(orderNumber) {
  const order = await Order.findOne({ orderNumber: String(orderNumber || '').trim(), payment: SNAPPPAY_LABEL });
  if (!order || !order.snappPay?.paymentToken) throw new AppError(404, 'سفارش اسنپ‌پی یافت نشد');
  return order;
}

function requireSnappPayConfirmation(req) {
  if (req.body?.confirmed !== true) throw new AppError(400, 'برای این عملیات برگشت‌ناپذیر، تأیید مجدد مدیر الزامی است');
}

// Atomic lock so a double click or two admins never send two irreversible requests.
async function acquireSnappPayLock(order) {
  const locked = await Order.findOneAndUpdate(
    {
      _id: order._id,
      $or: [
        { 'snappPay.processing': { $ne: true } },
        { 'snappPay.processingStartedAt': { $lt: new Date(Date.now() - SNAPPPAY_STALE_LOCK_MS) } }
      ]
    },
    { $set: { 'snappPay.processing': true, 'snappPay.processingStartedAt': new Date() } },
    { new: true }
  );
  if (!locked) throw new AppError(409, 'عملیات دیگری روی این سفارش اسنپ‌پی در حال انجام است');
  order.snappPay.processing = true;
  return locked;
}

async function releaseSnappPayAdminLock(order, error) {
  await Order.updateOne(
    { _id: order._id },
    { $set: { 'snappPay.processing': false, ...(error ? { 'snappPay.lastError': String(error).slice(0, 500) } : {}) }, $unset: { 'snappPay.processingStartedAt': 1 } }
  ).catch(() => {});
}

async function assertGatewaySettled(order) {
  const result = await snappPay.getPaymentStatus(order.snappPay.paymentToken);
  const status = snappPay.normalizeStatus(result?.status);
  order.snappPay.lastStatusCheckAt = new Date();
  if (status !== 'SETTLE') throw new AppError(409, `این عملیات فقط در وضعیت SETTLE ممکن است (وضعیت فعلی اسنپ‌پی: ${status || 'نامشخص'})`);
}

const snappAdminView = order => ({ ...S.order(order) });

router.post('/orders/:orderNumber/snappay/sync', asyncHandler(async (req, res) => {
  let order = await loadSnappPayOrder(req.params.orderNumber);
  if (['pending', 'review'].includes(order.paymentStatus) && order.status !== 'cancelled') {
    // Open payment: run the same Get Payment Status reconciliation as the scheduler.
    const action = await require('./orders').reconcileSnappPayOrder(order._id);
    order = await loadSnappPayOrder(req.params.orderNumber);
    return ok(res, { message: `وضعیت اسنپ‌پی بررسی شد (${action})`, status: order.snappPay.status, order: snappAdminView(order) });
  }
  const result = await snappPay.getPaymentStatus(order.snappPay.paymentToken);
  const status = snappPay.normalizeStatus(result?.status);
  order.snappPay.lastStatusCheckAt = new Date();
  if (['PENDING', 'VERIFY', 'SETTLE', 'CANCEL', 'REVERT'].includes(status)) order.snappPay.status = status;
  if (['CANCEL', 'REVERT'].includes(status) && order.status !== 'cancelled') {
    await releaseInventory(order);
    await releaseCoupon(order);
    order.status = 'cancelled';
    order.paymentStatus = order.paymentStatus === 'paid' ? 'refunded' : 'failed';
  }
  await order.save();
  await syncCustomRequestsFromOrder(order);
  ok(res, { message: `وضعیت اسنپ‌پی: ${status || 'نامشخص'}`, status, order: snappAdminView(order) });
}));

// payment/v1/update — partial return. Body: { confirmed: true, items: [{ index, qty }] }.
router.post('/orders/:orderNumber/snappay/update', asyncHandler(async (req, res) => {
  requireSnappPayConfirmation(req);
  const order = await loadSnappPayOrder(req.params.orderNumber);
  if (order.paymentStatus !== 'paid' || order.snappPay.status !== 'SETTLE' || order.status === 'cancelled') {
    throw new AppError(409, 'بروزرسانی فقط برای سفارش پرداخت‌شده و تسویه‌شده اسنپ‌پی ممکن است');
  }
  // SnappPay review: with a single item left, update is disabled and only cancel remains.
  if (countUnits(order.items) <= 1) throw new AppError(400, 'در سفارش فقط یک آیتم باقی مانده است؛ برای مرجوعی از «لغو کامل در اسنپ‌پی» استفاده کنید');

  const requested = new Map((Array.isArray(req.body.items) ? req.body.items : [])
    .map(item => [Number(item.index), Number(item.qty)]));
  const previousItems = order.items.map(item => (typeof item.toObject === 'function' ? item.toObject() : { ...item }));
  const nextItems = [];
  const returned = [];
  previousItems.forEach((item, index) => {
    const current = Math.max(1, Number(item.qty || 1));
    const next = requested.has(index) ? requested.get(index) : current;
    if (!Number.isInteger(next) || next < 0 || next > current) {
      throw new AppError(400, `تعداد جدید «${item.title}» معتبر نیست (افزایش تعداد مجاز نیست)`);
    }
    if (next < current) returned.push({ ...item, qty: current - next });
    if (next > 0) nextItems.push({ ...item, qty: next });
  });
  if (!returned.length) throw new AppError(400, 'برای بروزرسانی باید حداقل تعداد یک قلم کاهش یابد');
  if (!nextItems.length) throw new AppError(400, 'برای مرجوعی کامل از «لغو کامل در اسنپ‌پی» استفاده کنید');

  const coupon = order.couponCode ? await Coupon.findOne({ code: order.couponCode }).lean() : null;
  const discount = recalculateDiscount({
    coupon,
    previousItems,
    nextItems,
    previousDiscount: order.discount,
    isEligible: itemIsEligible
  });
  const payload = buildSnappPayPayload(order, { items: nextItems, discount });
  if (payload.amount >= snappPay.toRial(order.total)) throw new AppError(400, 'مبلغ بروزرسانی باید از مبلغ فعلی سفارش کمتر باشد');

  await acquireSnappPayLock(order);
  try {
    await assertGatewaySettled(order);
    await snappPay.update({ ...payload, paymentToken: order.snappPay.paymentToken });

    await restockReturnedItems(order, returned);
    order.items = nextItems;
    order.subtotal = itemsSubtotal(nextItems);
    order.discount = discount;
    order.total = payload.amount / 10;
    order.snappPay.updateHistory.push({
      amount: payload.amount,
      discount: payload.discountAmount,
      changedBy: String(req.session.adminId || ''),
      items: nextItems.map(item => ({ title: item.title, qty: item.qty, price: item.price }))
    });
    order.snappPay.processing = false;
    order.snappPay.processingStartedAt = undefined;
    order.snappPay.lastError = undefined;
    await order.save();
    await syncCustomRequestsFromOrder(order);
  } catch (error) {
    await releaseSnappPayAdminLock(order, error.message);
    throw error instanceof AppError ? error : new AppError(502, `بروزرسانی در اسنپ‌پی انجام نشد: ${error.message}`);
  }
  ok(res, { message: 'سفارش در اسنپ‌پی بروزرسانی شد', order: snappAdminView(order) });
}));

// payment/v1/cancel — full return (allowed on an updated order too).
router.post('/orders/:orderNumber/snappay/cancel', asyncHandler(async (req, res) => {
  requireSnappPayConfirmation(req);
  const order = await loadSnappPayOrder(req.params.orderNumber);
  if (order.snappPay.status === 'CANCEL') return ok(res, { message: 'این سفارش قبلاً در اسنپ‌پی لغو شده است', order: snappAdminView(order) });
  if (order.paymentStatus !== 'paid' || order.snappPay.status !== 'SETTLE') {
    throw new AppError(409, 'لغو در اسنپ‌پی فقط برای سفارش پرداخت‌شده و تسویه‌شده ممکن است');
  }

  await acquireSnappPayLock(order);
  try {
    await assertGatewaySettled(order);
    await snappPay.cancel(order.snappPay.paymentToken);
    await releaseInventory(order);
    await releaseCoupon(order);
    order.snappPay.status = 'CANCEL';
    order.snappPay.cancelledAt = new Date();
    order.snappPay.processing = false;
    order.snappPay.processingStartedAt = undefined;
    order.snappPay.lastError = undefined;
    order.status = 'cancelled';
    order.paymentStatus = 'refunded';
    await order.save();
    await syncCustomRequestsFromOrder(order);
  } catch (error) {
    await releaseSnappPayAdminLock(order, error.message);
    throw error instanceof AppError ? error : new AppError(502, `لغو در اسنپ‌پی انجام نشد: ${error.message}`);
  }
  ok(res, { message: 'سفارش در اسنپ‌پی لغو شد', order: snappAdminView(order) });
}));

router.post('/products/upload-image', upload.fields([
  { name: 'images', maxCount: 12 },
  { name: 'image', maxCount: 1 }
]), asyncHandler(async (req, res) => {
  const files = [...(req.files?.images || []), ...(req.files?.image || [])];
  if (!files.length) throw new AppError(400, 'حداقل یک تصویر محصول انتخاب کنید');

  const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const processed = [];
  try {
    // پردازش عمداً ترتیبی است تا آپلود هم‌زمان چند عکس بزرگ، RAM هاست را پر نکند.
    for (const file of files) {
      await assertUploadedFile(file, allowedImageTypes);
      processed.push(await processUploadedImage(file, 'product'));
    }
  } catch (error) {
    await Promise.all(files.map(file => unlinkQuietly(file.path)));
    await removeManagedImages(processed.map(item => item.image));
    throw error;
  }

  const images = processed.map(item => item.image);
  const thumbnails = processed.map(item => item.thumbnail);
  ok(res, {
    message: `${images.length} تصویر محصول بهینه و آپلود شد`,
    image: images[0],
    thumbnail: thumbnails[0],
    images,
    thumbnails,
    items: processed
  }, 201);
}));

router.post('/categories/upload-image', upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, 'تصویر دسته‌بندی را انتخاب کنید');
  const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

  try {
    await assertUploadedFile(req.file, allowedImageTypes);
    const processed = await processUploadedImage(req.file, 'category');
    ok(res, {
      message: 'تصویر دسته‌بندی بهینه و آپلود شد',
      ...processed
    }, 201);
  } catch (error) {
    await unlinkQuietly(req.file?.path);
    throw error;
  }
}));


router.get('/settings/custom-pricing', asyncHandler(async (_req, res) => {
  ok(res, { pricing: await getCustomPricingConfig() });
}));

router.put('/settings/custom-pricing', asyncHandler(async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new AppError(400, 'ساختار قیمت‌گذاری معتبر نیست');
  const pricing = await saveCustomPricingConfig(req.body);
  await RecentAction.create({
    action: 'custom_pricing_update',
    targetType: 'settings',
    targetId: 'custom-pricing',
    targetName: 'قیمت‌های طرح دلخواه',
    adminId: req.session.adminId,
    ipAddress: req.ip
  });
  ok(res, { message: 'قیمت‌های طرح دلخواه ذخیره شد', pricing });
}));

function categoryProductQuery(category) {
  return {
    $or: [
      { categoryRefs: category._id },
      { primaryCategory: category._id },
      { category: category.name },
      { categories: category.name }
    ]
  };
}

function categoryPricingPayload(category, products) {
  const variants = new Map();
  let productsWithoutVariants = 0;

  for (const product of products) {
    const productVariants = normalizeVariantPrices(product.variantPrices, Boolean(product.hasDiscount));
    if (!productVariants.length) {
      productsWithoutVariants += 1;
      continue;
    }

    for (const variant of productVariants) {
      const key = variantKey(variant.size, variant.fabric);
      let row = variants.get(key);
      if (!row) {
        row = {
          size: variant.size,
          fabric: variant.fabric,
          affectedProducts: 0,
          prices: new Set()
        };
        variants.set(key, row);
      }
      row.affectedProducts += 1;
      row.prices.add(Number(variant.price || 0));
    }
  }

  const rows = [...variants.values()].map(row => {
    const prices = [...row.prices].sort((a, b) => a - b);
    return {
      size: row.size,
      fabric: row.fabric,
      affectedProducts: row.affectedProducts,
      mixed: prices.length > 1,
      price: prices.length === 1 ? prices[0] : null,
      minPrice: prices.length ? prices[0] : null,
      maxPrice: prices.length ? prices[prices.length - 1] : null
    };
  }).sort((a, b) => `${a.size} ${a.fabric}`.localeCompare(`${b.size} ${b.fabric}`, 'fa'));

  return {
    category: categoryPayload(category, products.length),
    productCount: products.length,
    productsWithoutVariants,
    variants: rows
  };
}

router.get('/category-pricing/:id', asyncHandler(async (req, res) => {
  const category = await Category.findOne({ publicId: Number(req.params.id) }).lean();
  if (!category) throw new AppError(404, 'دسته‌بندی پیدا نشد');
  const products = await Product.find(categoryProductQuery(category)).sort({ publicId: 1 }).lean();
  ok(res, categoryPricingPayload(category, products));
}));

router.put('/category-pricing/:id', asyncHandler(async (req, res) => {
  const category = await Category.findOne({ publicId: Number(req.params.id) });
  if (!category) throw new AppError(404, 'دسته‌بندی پیدا نشد');
  const submitted = Array.isArray(req.body?.variants) ? req.body.variants : [];
  if (!submitted.length) throw new AppError(400, 'حداقل یک قیمت برای اعمال انتخاب کنید');
  if (submitted.length > 100) throw new AppError(400, 'تعداد ردیف‌های قیمت بیش از حد مجاز است');

  const updates = new Map();
  for (const item of submitted) {
    const size = String(item?.size || '').trim();
    const fabric = String(item?.fabric || '').trim();
    const price = Number(item?.price);
    if (!size || size.length > 160 || !fabric || fabric.length > 120) throw new AppError(400, 'سایز یا جنس یکی از ردیف‌ها معتبر نیست');
    if (!Number.isInteger(price) || price < 0) throw new AppError(400, `قیمت «${size} / ${fabric}» باید عدد صحیح صفر یا بیشتر باشد`);
    updates.set(variantKey(size, fabric), { size, fabric, price });
  }

  const products = await Product.find(categoryProductQuery(category)).lean();
  if (!products.length) throw new AppError(404, 'محصولی در این دسته‌بندی پیدا نشد');

  const operations = [];
  const matchedCounts = new Map([...updates.keys()].map(key => [key, 0]));
  let updatedVariantRows = 0;

  for (const product of products) {
    const currentVariants = normalizeVariantPrices(product.variantPrices, Boolean(product.hasDiscount));
    if (!currentVariants.length) continue;
    let changed = false;
    const nextVariants = currentVariants.map(variant => {
      const key = variantKey(variant.size, variant.fabric);
      const requested = updates.get(key);
      if (!requested) return variant;
      matchedCounts.set(key, (matchedCounts.get(key) || 0) + 1);
      updatedVariantRows += 1;
      changed = changed || Number(variant.price) !== requested.price;
      const oldPrice = Number(variant.oldPrice);
      const keepDiscount = Boolean(product.hasDiscount && Number.isFinite(oldPrice) && oldPrice > requested.price);
      return {
        ...variant,
        price: requested.price,
        hasDiscount: keepDiscount,
        oldPrice: keepDiscount ? oldPrice : null
      };
    });

    if (!changed) continue;
    const pricing = prepareProductPricing({
      price: product.price,
      hasDiscount: product.hasDiscount,
      oldPrice: product.oldPrice,
      variantPrices: nextVariants
    });
    operations.push({
      updateOne: {
        filter: { _id: product._id },
        update: { $set: {
          price: pricing.price,
          hasDiscount: pricing.hasDiscount,
          oldPrice: pricing.oldPrice,
          variantPrices: pricing.variantPrices
        } }
      }
    });
  }

  if (operations.length) await Product.bulkWrite(operations, { ordered: false });

  const unmatchedVariants = [...updates.values()].filter(item => matchedCounts.get(variantKey(item.size, item.fabric)) === 0);
  await RecentAction.create({
    action: 'category_bulk_pricing_update',
    targetType: 'category',
    targetId: String(category._id),
    targetName: category.name,
    adminId: req.session.adminId,
    ipAddress: req.ip
  });

  const refreshedProducts = await Product.find(categoryProductQuery(category)).sort({ publicId: 1 }).lean();
  ok(res, {
    message: operations.length ? `قیمت ${operations.length} محصول در دسته «${category.name}» به‌روزرسانی شد` : 'قیمت‌ها از قبل همین مقدار بودند',
    updatedProducts: operations.length,
    matchedVariantRows: updatedVariantRows,
    unmatchedVariants,
    ...categoryPricingPayload(category, refreshedProducts)
  });
}));

router.get('/gallery', asyncHandler(async (_req, res) => {
  const [publicFiles, uploadFiles, references] = await Promise.all([
    walkGalleryImages('public'),
    walkGalleryImages('uploads'),
    galleryReferenceSets()
  ]);
  const images = [...publicFiles, ...uploadFiles].map(item => {
    const publicUrl = galleryPublicUrl(item.rootKey, item.relativePath);
    const usedByCatalog = Boolean(publicUrl && references.urls.has(publicUrl));
    const usedByReview = Boolean(publicUrl && references.reviewUrls.has(publicUrl));
    const usedByCustom = item.rootKey === 'uploads' && references.customPaths.has(path.resolve(item.absolutePath));
    return {
      id: galleryFileId(item.rootKey, item.relativePath),
      name: path.basename(item.relativePath),
      path: `${item.rootKey}/${item.relativePath}`,
      source: item.rootKey,
      bytes: item.bytes,
      modifiedAt: item.modifiedAt,
      previewUrl: `/api/admin/gallery/file/${galleryFileId(item.rootKey, item.relativePath)}`,
      referenced: usedByCatalog || usedByReview || usedByCustom,
      referenceType: usedByCustom ? 'طرح اختصاصی' : usedByReview ? 'رضایت مشتری' : usedByCatalog ? 'کاتالوگ سایت' : ''
    };
  }).sort((a, b) => Number(b.bytes || 0) - Number(a.bytes || 0));
  ok(res, { images, totalBytes: images.reduce((sum, image) => sum + Number(image.bytes || 0), 0) });
}));

router.get('/gallery/file/:id', asyncHandler(async (req, res) => {
  const file = galleryFileFromId(req.params.id);
  const stat = await fs.promises.stat(file.absolutePath).catch(() => null);
  if (!stat?.isFile()) throw new AppError(404, 'تصویر روی هاست پیدا نشد');
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(path.extname(file.absolutePath));
  return res.sendFile(file.absolutePath);
}));

router.delete('/gallery/:id', asyncHandler(async (req, res) => {
  const file = galleryFileFromId(req.params.id);
  const stat = await fs.promises.stat(file.absolutePath).catch(() => null);
  if (!stat?.isFile()) throw new AppError(404, 'تصویر روی هاست پیدا نشد');
  await fs.promises.unlink(file.absolutePath);
  await RecentAction.create({
    action: 'gallery_image_delete',
    targetType: 'image',
    targetId: req.params.id,
    targetName: `${file.rootKey}/${file.relativePath}`.slice(0, 300),
    adminId: req.session.adminId,
    ipAddress: req.ip
  });
  ok(res, { message: 'تصویر از هاست حذف شد' });
}));

router.get(
  '/custom/:publicId/download',
  asyncHandler(async (req, res) => {
    const customRequest = await CustomRequest.findOne({
      publicId: req.params.publicId
    }).lean();

    if (!customRequest) {
      throw new AppError(404, 'درخواست طراحی پیدا نشد');
    }

    if (!customRequest.filePath) {
      throw new AppError(404, 'مسیر فایل برای این درخواست ثبت نشده است');
    }

    const uploadsDirectory = path.resolve(
      __dirname,
      '..',
      'uploads'
    );

    const absoluteFilePath = path.resolve(
      customRequest.filePath
    );

    /*
     * جلوگیری از دسترسی به فایل‌های بیرون از uploads
     */
    if (
      absoluteFilePath !== uploadsDirectory &&
      !absoluteFilePath.startsWith(`${uploadsDirectory}${path.sep}`)
    ) {
      throw new AppError(403, 'مسیر فایل معتبر نیست');
    }

    if (!fs.existsSync(absoluteFilePath)) {
      throw new AppError(404, 'فایل روی سرور پیدا نشد');
    }

    return res.download(
      absoluteFilePath,
      customRequest.fileName || path.basename(absoluteFilePath)
    );
  })
);

async function getBootstrap() {
  await ensureLegacyCategories();
  const [products, categories, orders, users, coupons, tickets, custom] = await Promise.all([
    Product.find().sort({ publicId: -1 }).lean(),
    Category.find().sort({ sortOrder: 1, publicId: 1 }).lean(),
    Order.find().populate('user').sort({ createdAt: -1 }).lean(),
    User.find().sort({ publicId: 1 }).lean(),
    Coupon.find().sort({ publicId: 1 }).lean(),
    Ticket.find().populate('user').sort({ createdAt: -1 }).lean(),
    CustomRequest.find().populate('user').sort({ createdAt: -1 }).lean()
  ]);
  const categoryLookup = new Map(categories.map(category => [String(category._id), category]));
  const customRequestById = new Map(
    custom.map(item => [String(item.publicId || '').trim(), item])
  );
  const categoryCounts = new Map();
  for (const product of products) {
    for (const categoryId of product.categoryRefs || []) {
      const key = String(categoryId);
      categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
    }
  }

  const userStats = {};
  for (const order of orders) {
    const id = order.user?.publicId;
    if (!id) continue;
    userStats[id] ??= { orders: 0, total: 0 };
    userStats[id].orders += 1;
    if (isPaidSale(order)) userStats[id].total += Number(order.total || 0);
  }

  return {
    products: products.map(product => S.product(product, categoryLookup)),
    categories: categories.map(category => categoryPayload(category, categoryCounts.get(String(category._id)) || 0)),
    orders: orders.map(order => adminOrderPayload(order, customRequestById)),
    users: users.map(user => S.user(user, userStats[user.publicId] || {})),
    coupons: coupons.map(S.coupon),
    tickets: tickets.map(S.ticket),
    custom: hydrateCustomRequestsWithOrders(custom, orders).map(S.custom),
    notifications: [],
    analytics: buildAnalytics({ orders, products, users })
  };
}
router.get('/bootstrap',asyncHandler(async(_req,res)=>ok(res,await getBootstrap())));
router.get('/categories', asyncHandler(async (_req, res) => {
  await ensureLegacyCategories();
  const categories = await Category.find().sort({ sortOrder: 1, publicId: 1 }).lean();
  const counts = await Product.aggregate([
    { $unwind: { path: '$categoryRefs', preserveNullAndEmptyArrays: false } },
    { $group: { _id: '$categoryRefs', count: { $sum: 1 } } }
  ]);
  const countMap = new Map(counts.map(item => [String(item._id), item.count]));
  ok(res, { categories: categories.map(category => categoryPayload(category, countMap.get(String(category._id)) || 0)) });
}));

router.post('/categories', asyncHandler(async (req, res) => {
  const data = await categoryData(req.body);
  if (data.isReadyRoot) await Category.updateMany({}, { $set: { isReadyRoot: false } });
  const category = await Category.create({ publicId: await nextCategoryId(), ...data });
  await RecentAction.create({ action: 'category_create', targetType: 'category', targetId: String(category._id), targetName: category.name, adminId: req.session.adminId, ipAddress: req.ip });
  ok(res, { message: 'دسته‌بندی ایجاد شد', category: categoryPayload(category, 0) }, 201);
}));

router.put('/categories/:id', asyncHandler(async (req, res) => {
  const category = await Category.findOne({ publicId: Number(req.params.id) });
  if (!category) throw new AppError(404, 'دسته‌بندی پیدا نشد');
  const oldName = category.name;
  const data = await categoryData(req.body, category);
  if (data.isReadyRoot) await Category.updateMany({ _id: { $ne: category._id } }, { $set: { isReadyRoot: false } });
  const oldImage = category.image;
  Object.assign(category, data);
  await category.save();
  if (oldImage && oldImage !== category.image) await removeManagedImage(oldImage);
  if (oldName !== category.name) await syncProductCategoryNames();
  await RecentAction.create({ action: 'category_update', targetType: 'category', targetId: String(category._id), targetName: category.name, adminId: req.session.adminId, ipAddress: req.ip });
  const productCount = await Product.countDocuments({ $or: [{ categoryRefs: category._id }, { primaryCategory: category._id }] });
  ok(res, { message: 'دسته‌بندی ویرایش شد', category: categoryPayload(category, productCount) });
}));

router.delete('/categories/:id', asyncHandler(async (req, res) => {
  const category = await Category.findOne({ publicId: Number(req.params.id) });
  if (!category) throw new AppError(404, 'دسته‌بندی پیدا نشد');
  const productCount = await Product.countDocuments({
    $or: [
      { categoryRefs: category._id },
      { primaryCategory: category._id },
      { category: category.name },
      { categories: category.name }
    ]
  });
  if (productCount) throw new AppError(409, `این دسته‌بندی به ${productCount} محصول متصل است؛ ابتدا دسته محصولات را تغییر دهید`);
  const categoryImage = category.image;
  await category.deleteOne();
  await removeManagedImage(categoryImage);
  await RecentAction.create({ action: 'category_delete', targetType: 'category', targetId: String(category._id), targetName: category.name, adminId: req.session.adminId, ipAddress: req.ip });
  ok(res, { message: 'دسته‌بندی حذف شد' });
}));

router.post('/orders/manual', asyncHandler(async (req, res) => {
  const productId = Number(req.body.productId);
  const qty = Number(req.body.qty ?? 1);
  const shipping = Number(req.body.shipping ?? 0);
  if (!Number.isFinite(productId)) throw new AppError(400, 'شناسه محصول معتبر نیست');
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) throw new AppError(400, 'تعداد باید عدد صحیح بین ۱ تا ۱۰۰ باشد');
  if (!Number.isFinite(shipping) || shipping < 0) throw new AppError(400, 'هزینه ارسال معتبر نیست');

  const product = await Product.findOne({ publicId: productId, status: 'active' });
  if (!product) throw new AppError(404, 'محصول یافت نشد');

  const pricingProduct = product;
  const size = selectedProductOption(pricingProduct, req.body.size, 'sizes');
  const fabric = selectedProductOption(pricingProduct, req.body.fabric, 'fabrics');
  const variant = findVariantPricing(pricingProduct, size, fabric);
  if (pricingProduct.variantPrices?.length && !variant) throw new AppError(400, 'برای ترکیب سایز و جنس انتخاب‌شده قیمت ثبت نشده است');
  const pricing = variant || fallbackPricing(pricingProduct);
  const inventoryManaged = product.inventoryMode === 'managed';
  if (inventoryManaged && product.stock < qty) throw new AppError(409, `فقط ${product.stock} عدد از این محصول موجود است`);

  const { orderNumber } = require('../utils/formatters');
  const subtotal = pricing.price * qty;
  try {
    const order = await Order.create({
      orderNumber: orderNumber(),
      customer: String(req.body.customer || 'مشتری حضوری').trim(),
      phone: String(req.body.phone || '00000000000').trim(),
      email: String(req.body.email || '').trim().toLowerCase(),
      address: String(req.body.address || 'ثبت توسط مدیر').trim(),
      items: [{ productId: product.publicId, title: product.title, category: product.category, categories: [...new Set([product.category, ...(product.categories || [])].filter(Boolean))], price: pricing.price, qty, size, fabric, inventoryManaged }],
      subtotal,
      shipping,
      discount: 0,
      total: subtotal + shipping,
      status: 'processing',
      payment: 'ثبت دستی مدیر',
      paymentStatus: req.body.paymentStatus === 'paid' ? 'paid' : 'review',
      shippingMethod: String(req.body.shippingMethod || 'تحویل حضوری').trim(),
      acquisition: { source: 'Admin', medium: 'manual', landingPage: '/admin', capturedAt: new Date() },
      inventoryApplied: false
    });
    if (order.paymentStatus === 'paid') {
      try {
        await applyInventory(order);
      } catch (error) {
        await Order.deleteOne({ _id: order._id });
        throw error;
      }
    }
    ok(res, { message: 'سفارش دستی ثبت شد', order: S.order(order) }, 201);
  } catch (error) {
    throw error;
  }
}));

router.patch('/orders/bulk-status', asyncHandler(async (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (!ORDER_STATUSES.has(status)) throw new AppError(400, 'وضعیت دسته‌جمعی معتبر نیست');

  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rawItems.length) throw new AppError(400, 'حداقل یک سفارش باید انتخاب شود');
  if (rawItems.length > 200) throw new AppError(400, 'در هر عملیات حداکثر ۲۰۰ سفارش قابل انتخاب است');

  const unique = new Map();
  for (const item of rawItems) {
    const id = String(item?.id || '').trim();
    const source = item?.source === 'custom' ? 'custom' : 'order';
    if (!id || id.length > 120) continue;
    unique.set(`${source}:${id}`, { id, source });
  }
  if (!unique.size) throw new AppError(400, 'شناسه سفارش‌های انتخاب‌شده معتبر نیست');

  let updated = 0;
  const missing = [];
  for (const { id, source } of unique.values()) {
    if (source === 'order') {
      const order = await Order.findOne({ orderNumber: id });
      if (!order) {
        missing.push(id);
        continue;
      }
      await applyBulkOrderStatus(order, status);
      updated += 1;
      continue;
    }

    const customRequest = await CustomRequest.findOne({ publicId: id });
    if (!customRequest) {
      missing.push(id);
      continue;
    }

    const linkedOrder = await Order.findOne({
      $or: [
        ...(customRequest.orderNumber ? [{ orderNumber: customRequest.orderNumber }] : []),
        { 'items.customRequestId': id }
      ]
    }).sort({ createdAt: -1 });

    if (linkedOrder) {
      await applyBulkOrderStatus(linkedOrder, status);
    } else {
      customRequest.orderStatus = status;
      await customRequest.save();
    }
    updated += 1;
  }

  await RecentAction.create({
    action: 'order_bulk_status',
    targetType: 'orders',
    targetId: [...unique.values()].map(item => item.id).join(',').slice(0, 500),
    targetName: `${status}:${updated}`,
    adminId: req.session.adminId,
    ipAddress: req.ip
  });

  ok(res, {
    message: `وضعیت ${updated} سفارش به «${ORDER_STATUS_LABELS[status]}» تغییر کرد`,
    updated,
    missing
  });
}));

router.delete('/orders/:identifier', asyncHandler(async (req, res) => {
  const identifier = String(req.params.identifier || '').trim();
  if (!identifier || identifier.length > 120) throw new AppError(400, 'شناسه سفارش معتبر نیست');

  const requestedSource = String(req.query.source || '').trim();
  const source = requestedSource === 'custom' || (!requestedSource && identifier.startsWith('DS-'))
    ? 'custom'
    : 'order';
  if (requestedSource && !['order', 'custom'].includes(requestedSource)) {
    throw new AppError(400, 'نوع سفارش معتبر نیست');
  }

  const deletion = await resolveOrderDeletion(identifier, source);
  const filePaths = [...new Set(
    deletion.customRequests
      .map(item => managedCustomFilePath(item.filePath))
      .filter(Boolean)
  )];

  for (const order of deletion.orders) {
    if (order.payment === 'پرداخت اقساطی ترب‌پی' && order.paymentStatus === 'paid') {
      throw new AppError(409, `سفارش ${order.orderNumber} با ترب‌پی پرداخت شده است؛ ابتدا از پنل سفارش را لغو/مسترد کنید تا عودت وجه توسط ترب‌پی انجام شود.`);
    }
    await releaseInventory(order);
    await releaseCoupon(order);
  }

  if (deletion.orders.length) {
    await Order.deleteMany({ _id: { $in: deletion.orders.map(item => item._id) } });
  }
  if (deletion.customRequests.length) {
    await CustomRequest.deleteMany({ _id: { $in: deletion.customRequests.map(item => item._id) } });
  }

  for (const filePath of filePaths) {
    const stillUsed = await CustomRequest.exists({ filePath });
    if (!stillUsed) await unlinkQuietly(filePath);
  }

  const removedOrderNumbers = [...deletion.orderNumbers];
  const removedCustomIds = [...deletion.customRequestIds];
  await RecentAction.create({
    action: 'order_delete',
    targetType: source === 'custom' ? 'custom-order' : 'order',
    targetId: identifier,
    targetName: [...removedCustomIds, ...removedOrderNumbers].join(' / ').slice(0, 300),
    adminId: req.session.adminId,
    ipAddress: req.ip
  });

  ok(res, {
    message: source === 'custom' ? 'سفارش اختصاصی حذف شد' : 'سفارش حذف شد',
    removedOrders: removedOrderNumbers,
    removedCustomRequests: removedCustomIds
  });
}));

function normalizeHomePosition(value) {
  if (value === null || value === undefined || value === '') return null;
  const position = Number(value);
  if (!Number.isInteger(position) || position < 1 || position > 4) return null;
  return position;
}

function assertUniqueHomePositions(products) {
  const special = new Map();
  const bestSeller = new Map();
  for (const product of products) {
    const id = Number(product.id);
    const specialPosition = normalizeHomePosition(product.homeSpecialPosition);
    const bestSellerPosition = normalizeHomePosition(product.homeBestSellerPosition);
    if (specialPosition) {
      if (special.has(specialPosition)) throw new AppError(409, `جایگاه ${specialPosition} پیشنهاد ویژه قبلاً برای محصول ${special.get(specialPosition)} انتخاب شده است`);
      special.set(specialPosition, product.title || id);
    }
    if (bestSellerPosition) {
      if (bestSeller.has(bestSellerPosition)) throw new AppError(409, `جایگاه ${bestSellerPosition} پرفروش‌ترین‌ها قبلاً برای محصول ${bestSeller.get(bestSellerPosition)} انتخاب شده است`);
      bestSeller.set(bestSellerPosition, product.title || id);
    }
  }
}

router.put('/sync/:name', asyncHandler(async (req, res) => {
  const name = req.params.name;
  const allowed = new Set(['products', 'coupons', 'orders', 'users', 'tickets', 'custom']);
  if (!allowed.has(name)) throw new AppError(400, 'نوع همگام‌سازی معتبر نیست');
  if (!Array.isArray(req.body.value)) throw new AppError(400, 'داده همگام‌سازی باید آرایه باشد');
  const value = req.body.value;
  if (['products', 'coupons'].includes(name) && !value.length && req.body.confirmEmpty !== true) {
    throw new AppError(400, 'برای حذف کامل اطلاعات باید confirmEmpty=true ارسال شود');
  }
  if(name==='products'){
    assertUniqueHomePositions(value);
    const existingProducts = await Product.find().select('publicId image images').lean();
    const previouslyManagedImages = new Set(existingProducts.flatMap(product =>
      (Array.isArray(product.images) && product.images.length ? product.images : [product.image])
        .map(item => String(item || '').split('?')[0].trim())
        .filter(Boolean)
    ));
    const submittedManagedImages = new Set();
    const ids = [];
    for (const p of value) {
      const id = Number(p.id);
      if (!Number.isFinite(id)) continue;
      ids.push(id);

      let sizes = Array.isArray(p.sizes) ? p.sizes.map(item => String(item).trim()).filter(Boolean) : [];
      let fabrics = Array.isArray(p.fabrics) ? p.fabrics.map(item => String(item).trim()).filter(Boolean) : [];
      const selectedCategories = await resolveCategorySelection(p);
      const pillowMode = detectPillowMode([...selectedCategories.categories, ...selectedCategories.categorySlugs]);
      if (pillowMode) {
        const pillowConfig = getPillowConfig(pillowMode);
        const allowedSizes = new Set(pillowConfig.sizes);
        const allowedFabrics = new Set(pillowConfig.fabrics);
        if (!sizes.length || sizes.some(size => !allowedSizes.has(size))) {
          throw new AppError(400, `یکی از حالت‌ها یا سایزهای محصول ${p.title || id} معتبر نیست`);
        }
        if (!fabrics.length || fabrics.some(fabric => !allowedFabrics.has(fabric))) {
          throw new AppError(400, `جنس محصول ${p.title || id} باید مخمل باشد`);
        }
      }

      const pricing = prepareProductPricing(p);
      pricing.variantPrices = pricing.variantPrices.filter(item => sizes.includes(item.size) && fabrics.includes(item.fabric));
      const submittedVariantPricing = Array.isArray(p.variantPrices) && p.variantPrices.length > 0;
      if ((pillowMode || submittedVariantPricing) && pricing.variantPrices.length !== sizes.length * fabrics.length) {
        throw new AppError(400, `قیمت همه ترکیب‌های سایز و جنس برای محصول ${p.title || id} باید ثبت شود`);
      }
      const sku = String(p.sku || '').trim().toUpperCase() || await generateUniqueSku();
      const inventoryMode = p.inventoryMode === 'managed' ? 'managed' : 'unlimited';
      const stock = inventoryMode === 'managed' ? Number(p.stock) : 0;
      if (inventoryMode === 'managed' && (!Number.isInteger(stock) || stock < 0)) {
        throw new AppError(400, `موجودی محصول ${p.title || id} باید عدد صحیح صفر یا بیشتر باشد`);
      }
      const submittedImages = Array.isArray(p.images) ? p.images : [p.image];
      if (submittedImages.length > 12) throw new AppError(400, 'حداکثر ۱۲ تصویر برای هر محصول مجاز است');
      const images = [...new Set(submittedImages.map(item => String(item || '').trim()).filter(Boolean))];
      if (!images.length) images.push('assets/images/ukflag.png');
      images.forEach(image => submittedManagedImages.add(String(image).split('?')[0].trim()));

      await Product.findOneAndUpdate(
        { publicId: id },
        { $set: {
          title: p.title,
          sku,
          category: selectedCategories.category,
          categories: selectedCategories.categories,
          primaryCategory: selectedCategories.primaryCategory,
          categoryRefs: selectedCategories.categoryRefs,
          price: pricing.price,
          hasDiscount: pricing.hasDiscount,
          oldPrice: pricing.oldPrice,
          variantPrices: pricing.variantPrices,
          badge: p.badge || '',
          homeSpecialPosition: normalizeHomePosition(p.homeSpecialPosition),
          homeBestSellerPosition: normalizeHomePosition(p.homeBestSellerPosition),
          sortDate: Number(p.date || 1),
          rate: Number(p.rate || 4.7),
          status: p.status || 'active',
          sales: Number(p.sales || 0),
          inventoryMode,
          stock,
          sizes,
          fabrics,
          image: images[0],
          images
        } },
        { upsert: true, setDefaultsOnInsert: true, runValidators: true }
      );
    }
    await Product.deleteMany({ publicId: { $nin: ids } });
    const removedImages = [...previouslyManagedImages].filter(image => !submittedManagedImages.has(image));
    await removeManagedImages(removedImages);
  }else if(name==='coupons'){
    const ids = [];
    for (const submitted of value) {
      const id = Number(submitted.id);
      const code = String(submitted.code || '').trim().toUpperCase();
      const type = submitted.type === 'fixed' ? 'fixed' : 'percent';
      const amount = Number(submitted.value);
      const minOrderAmount = Number(submitted.min || 0);
      const applicability = submitted.applicability === 'variants' ? 'variants' : 'all';
      const eligibleVariants = applicability === 'variants' ? await normalizeCouponVariants(submitted.eligibleVariants) : [];
      const usageLimit = Number(submitted.limit || 0);
      const usedCount = Number(submitted.used || 0);
      const displayExpires = String(submitted.expires || '').trim();
      const expiresAt = displayExpires ? parsePersianDate(displayExpires) : null;
      if (!Number.isInteger(id) || id < 1) throw new AppError(400, 'شناسه کد تخفیف معتبر نیست');
      if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new AppError(400, `کد تخفیف ${code || id} معتبر نیست`);
      if (!Number.isFinite(amount) || amount <= 0 || (type === 'percent' && amount > 100)) throw new AppError(400, `مقدار کد ${code} معتبر نیست`);
      if (!Number.isInteger(minOrderAmount) || minOrderAmount < 0) throw new AppError(400, `حداقل خرید کد ${code} باید عدد صحیح صفر یا بیشتر باشد`);
      if (applicability === 'variants' && !eligibleVariants.length) throw new AppError(400, `حداقل یک محصول و ترکیب سایز، جنس یا حالت سفارش برای کد ${code} انتخاب کنید`);
      if (!Number.isInteger(usageLimit) || usageLimit < 0 || !Number.isInteger(usedCount) || usedCount < 0) throw new AppError(400, `سقف یا تعداد استفاده کد ${code} معتبر نیست`);
      if (displayExpires && !expiresAt) throw new AppError(400, `تاریخ انقضای کد ${code} معتبر نیست`);
      ids.push(id);
      await Coupon.findOneAndUpdate(
        { publicId: id },
        { $set: { code, type, value: amount, minOrderAmount, applicability, eligibleVariants, usageLimit, usedCount, displayExpires, expiresAt, status: submitted.status === 'expired' ? 'expired' : 'active' } },
        { upsert: true, setDefaultsOnInsert: true, runValidators: true }
      );
    }
    await Coupon.deleteMany({ publicId: { $nin: ids } });
  }else if(name==='orders'){
    const validStatuses = ORDER_STATUSES;
    const validPaymentStatuses = new Set(['pending', 'review', 'paid', 'failed', 'refunded']);
    for (const submitted of value) {
      const order = await Order.findOne({ orderNumber: submitted.id });
      if (!order) continue;
      const previousStatus = order.status;
      const status = validStatuses.has(submitted.status) ? submitted.status : order.status;
      const paymentStatus = validPaymentStatuses.has(submitted.paymentStatus) ? submitted.paymentStatus : order.paymentStatus;
      assertNotSilentSnappPayCancel(order, status, paymentStatus);
      let finalStatus = status;
      let finalPaymentStatus = paymentStatus;
      const shouldRelease = finalStatus === 'cancelled' || ['failed', 'refunded'].includes(finalPaymentStatus);
      const shouldApply = !shouldRelease && finalPaymentStatus === 'paid';
      const isTorobPayOrder = order.payment === 'پرداخت اقساطی ترب‌پی';
      const torobCancellationRequested = isTorobPayOrder && Boolean(order.paymentInfo?.torobPaymentToken) && (finalStatus === 'cancelled' || finalPaymentStatus === 'refunded');

      if (torobCancellationRequested && order.paymentStatus === 'paid') {
        try {
          await torobPay.cancelPayment(order.paymentInfo.torobPaymentToken);
          order.paymentInfo.torobStatus = 'REVERT';
          finalStatus = 'cancelled';
          finalPaymentStatus = 'refunded';
        } catch (error) {
          throw new AppError(502, `لغو سفارش در ترب‌پی انجام نشد؛ وضعیت سفارش تغییر نکرد: ${error?.message || 'خطای نامشخص'}`);
        }
      }

      const finalShouldRelease = finalStatus === 'cancelled' || ['failed', 'refunded'].includes(finalPaymentStatus);
      if (finalShouldRelease) { await releaseInventory(order); await releaseCoupon(order); }
      else if (shouldApply) { await applyInventory(order); await consumeCoupon(order); }
      order.status = finalStatus;
      order.paymentStatus = finalPaymentStatus;
      order.tracking = String(submitted.tracking || '').trim().slice(0, 120);
      order.adminNote = String(submitted.adminNote || '').trim().slice(0, 2000);
      await order.save();
      await syncCustomRequestsFromOrder(order);
      await markReviewRequestEligible(order, previousStatus);
    }
  }else if(name==='users'){
    for(const u of value)await User.updateOne({publicId:Number(u.id)},{$set:{fullName:u.name,mobile:u.phone,email:u.email||undefined,role:u.role||'customer',isActive:u.status!=='blocked'}});
  }else if(name==='tickets'){
    for(const t of value){const user=await User.findOne({publicId:Number(t.userId)});if(user)await Ticket.findOneAndUpdate({publicId:t.id},{$set:{user:user._id,customer:t.customer||user.fullName,subject:t.subject,department:t.department,priority:t.priority,status:t.status,messages:t.messages}},{upsert:true,setDefaultsOnInsert:true});}
  }else if(name==='custom'){
    const validCustomOrderStatuses = ORDER_STATUSES;
    for (const submitted of value) {
      const user = await User.findOne({ publicId: Number(submitted.userId) });
      if (!user) continue;

      const publicId = String(submitted.id || '').trim();
      const old = await CustomRequest.findOne({ publicId });
      const linkedOrder = await Order.findOne({ 'items.customRequestId': publicId })
        .sort({ createdAt: -1 });

      let paymentStatus = CUSTOM_PAYMENT_STATUSES.has(submitted.paymentStatus)
        ? submitted.paymentStatus
        : (linkedOrder?.paymentStatus || old?.paymentStatus || 'unpaid');

      if (linkedOrder) {
        const orderPaymentStatus = ORDER_PAYMENT_STATUSES.has(paymentStatus)
          ? paymentStatus
          : linkedOrder.paymentStatus;
        const shouldRelease = linkedOrder.status === 'cancelled' || ['failed', 'refunded'].includes(orderPaymentStatus);
        const shouldApply = !shouldRelease && orderPaymentStatus === 'paid';

        if (shouldRelease) await releaseInventory(linkedOrder);
        else if (shouldApply) {
          await applyInventory(linkedOrder);
          await consumeCoupon(linkedOrder);
        }

        linkedOrder.paymentStatus = orderPaymentStatus;
        await linkedOrder.save();
        await syncCustomRequestsFromOrder(linkedOrder);
        paymentStatus = linkedOrder.paymentStatus;
      }

      await CustomRequest.findOneAndUpdate(
        { publicId },
        {
          $set: {
            user: user._id,
            customer: submitted.customer || user.fullName,
            fileName: submitted.fileName,
            requestType: submitted.requestType || 'پرچم',
            size: submitted.size,
            fabric: submitted.fabric,
            notes: submitted.notes,
            status: submitted.status,
            orderStatus: validCustomOrderStatuses.has(submitted.orderStatus)
              ? submitted.orderStatus
              : (old?.orderStatus || linkedOrder?.status || 'design-review'),
            price: Number(submitted.price || 0),
            orderNumber: linkedOrder?.orderNumber || submitted.orderNumber || old?.orderNumber || '',
            payment: linkedOrder?.payment || submitted.payment || old?.payment || (paymentStatus === 'unpaid' ? 'ثبت نشده' : 'ثبت دستی مدیر'),
            paymentStatus,
            adminNote: submitted.adminNote || ''
          }
        },
        { upsert: true, setDefaultsOnInsert: true, runValidators: true }
      );

      if (submitted.status === 'preview-ready' && old?.status !== 'preview-ready') {
        await Notification.create({
          user: user._id,
          title: 'پیش‌نمایش طرح آماده است',
          text: `پیش‌نمایش درخواست ${publicId} برای تأیید شما آماده شد.`
        });
      }
    }
  }
  ok(res,{message:'اطلاعات ذخیره شد'});
}));
module.exports=router;
