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
const { requireAdmin } = require('../middlewares/auth');
const { asyncHandler, ok, AppError } = require('../utils/http');
const S = require('../services/serializers');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { prepareProductPricing, findVariantPricing, fallbackPricing } = require('../utils/productPricing');
const { assertUploadedFile } = require('../utils/uploadValidation');
const { processUploadedImage, removeManagedImage, removeManagedImages, unlinkQuietly } = require('../utils/imageProcessing');
const { applyInventory, releaseInventory } = require('../services/inventory');
const { consumeCoupon, releaseCoupon } = require('../services/coupons');
const torobPay = require('../services/torobPay');
const upload = require('../middlewares/upload');
const { buildAnalytics, isPaidSale } = require('../services/analytics');
const { categoryPayload, ensureLegacyCategories, nextCategoryId, resolveCategorySelection, syncProductCategoryNames } = require('../services/categories');
const { parsePersianDate } = require('../utils/formatters');
const { detectPillowMode, getPillowConfig } = require('../utils/pillowPricing');
const {
  CUSTOM_PAYMENT_STATUSES,
  ORDER_PAYMENT_STATUSES,
  hydrateCustomRequestsWithOrders,
  syncCustomRequestsFromOrder
} = require('../services/customOrderSync');

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
    const validStatuses = new Set(['processing', 'design-review', 'print-preparation', 'shipped', 'delivered', 'cancelled']);
    const validPaymentStatuses = new Set(['pending', 'review', 'paid', 'failed', 'refunded']);
    for (const submitted of value) {
      const order = await Order.findOne({ orderNumber: submitted.id });
      if (!order) continue;
      const status = validStatuses.has(submitted.status) ? submitted.status : order.status;
      const paymentStatus = validPaymentStatuses.has(submitted.paymentStatus) ? submitted.paymentStatus : order.paymentStatus;
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
    }
  }else if(name==='users'){
    for(const u of value)await User.updateOne({publicId:Number(u.id)},{$set:{fullName:u.name,mobile:u.phone,email:u.email||undefined,role:u.role||'customer',isActive:u.status!=='blocked'}});
  }else if(name==='tickets'){
    for(const t of value){const user=await User.findOne({publicId:Number(t.userId)});if(user)await Ticket.findOneAndUpdate({publicId:t.id},{$set:{user:user._id,customer:t.customer||user.fullName,subject:t.subject,department:t.department,priority:t.priority,status:t.status,messages:t.messages}},{upsert:true,setDefaultsOnInsert:true});}
  }else if(name==='custom'){
    const validCustomOrderStatuses = new Set(['processing', 'design-review', 'print-preparation', 'shipped', 'delivered', 'cancelled']);
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
