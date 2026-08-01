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
const { applyInventory, releaseInventory } = require('../services/inventory');
const { consumeCoupon } = require('../services/coupons');
const upload = require('../middlewares/upload');
const { buildAnalytics, isPaidSale } = require('../services/analytics');
const { categoryPayload, ensureLegacyCategories, nextCategoryId, resolveCategorySelection, syncProductCategoryNames } = require('../services/categories');
const { parsePersianDate } = require('../utils/formatters');

const COUPON_SIZES = ['۱۵۰ × ۹۰ سانتی‌متر', '۱۰۰ × ۷۰ سانتی‌متر', '۵۰ × ۷۰ سانتی‌متر'];
const COUPON_FABRICS = ['ساتن آمریکایی', 'ساتن براق', 'مخمل'];
const COUPON_SIZE_SET = new Set(COUPON_SIZES);
const COUPON_FABRIC_SET = new Set(COUPON_FABRICS);

function normalizeCouponVariants(value) {
  const unique = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    const size = String(item?.size || '').trim();
    const fabric = String(item?.fabric || '').trim();
    if (!COUPON_SIZE_SET.has(size) || !COUPON_FABRIC_SET.has(fabric)) {
      throw new AppError(400, 'یکی از ترکیب‌های سایز و جنس کد تخفیف معتبر نیست');
    }
    unique.set(`${size}\u0000${fabric}`, { size, fabric });
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
  if (!admin || !admin.isActive || !(await admin.comparePassword(password))) {
    throw new AppError(401, 'ایمیل یا رمز عبور اشتباه است');
  }

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
  try {
    await Promise.all(files.map(file => assertUploadedFile(file, allowedImageTypes)));
  } catch (error) {
    await Promise.all(files.map(file => fs.promises.unlink(file.path).catch(() => {})));
    throw error;
  }

  const images = files.map(file => `/uploads/products/${file.filename}`);
  ok(res, {
    message: `${images.length} تصویر محصول آپلود شد`,
    image: images[0],
    images
  }, 201);
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
    orders: orders.map(S.order),
    users: users.map(user => S.user(user, userStats[user.publicId] || {})),
    coupons: coupons.map(S.coupon),
    tickets: tickets.map(S.ticket),
    custom: custom.map(S.custom),
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
  Object.assign(category, data);
  await category.save();
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
  await category.deleteOne();
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

  const size = selectedProductOption(product, req.body.size, 'sizes');
  const fabric = selectedProductOption(product, req.body.fabric, 'fabrics');
  const variant = findVariantPricing(product, size, fabric);
  if (product.variantPrices?.length && !variant) throw new AppError(400, 'برای ترکیب سایز و جنس انتخاب‌شده قیمت ثبت نشده است');
  const pricing = variant || fallbackPricing(product);
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
    const ids = [];
    for (const p of value) {
      const id = Number(p.id);
      if (!Number.isFinite(id)) continue;
      ids.push(id);

      const sizes = Array.isArray(p.sizes) ? p.sizes.map(item => String(item).trim()).filter(Boolean) : [];
      const fabrics = Array.isArray(p.fabrics) ? p.fabrics.map(item => String(item).trim()).filter(Boolean) : [];
      const selectedCategories = await resolveCategorySelection(p);
      const pricing = prepareProductPricing(p);
      pricing.variantPrices = pricing.variantPrices.filter(item => sizes.includes(item.size) && fabrics.includes(item.fabric));
      if (Array.isArray(p.variantPrices) && p.variantPrices.length && pricing.variantPrices.length !== sizes.length * fabrics.length) {
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
  }else if(name==='coupons'){
    const ids = [];
    for (const submitted of value) {
      const id = Number(submitted.id);
      const code = String(submitted.code || '').trim().toUpperCase();
      const type = submitted.type === 'fixed' ? 'fixed' : 'percent';
      const amount = Number(submitted.value);
      const minOrderAmount = Number(submitted.min || 0);
      const applicability = submitted.applicability === 'variants' ? 'variants' : 'all';
      const eligibleVariants = applicability === 'variants' ? normalizeCouponVariants(submitted.eligibleVariants) : [];
      const usageLimit = Number(submitted.limit || 0);
      const usedCount = Number(submitted.used || 0);
      const displayExpires = String(submitted.expires || '').trim();
      const expiresAt = displayExpires ? parsePersianDate(displayExpires) : null;
      if (!Number.isInteger(id) || id < 1) throw new AppError(400, 'شناسه کد تخفیف معتبر نیست');
      if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new AppError(400, `کد تخفیف ${code || id} معتبر نیست`);
      if (!Number.isFinite(amount) || amount <= 0 || (type === 'percent' && amount > 100)) throw new AppError(400, `مقدار کد ${code} معتبر نیست`);
      if (!Number.isInteger(minOrderAmount) || minOrderAmount < 0) throw new AppError(400, `حداقل خرید کد ${code} باید عدد صحیح صفر یا بیشتر باشد`);
      if (applicability === 'variants' && !eligibleVariants.length) throw new AppError(400, `حداقل یک ترکیب سایز و جنس برای کد ${code} انتخاب کنید`);
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
    const validStatuses = new Set(['processing', 'design-review', 'shipped', 'delivered', 'cancelled']);
    const validPaymentStatuses = new Set(['pending', 'review', 'paid', 'failed', 'refunded']);
    for (const submitted of value) {
      const order = await Order.findOne({ orderNumber: submitted.id });
      if (!order) continue;
      const status = validStatuses.has(submitted.status) ? submitted.status : order.status;
      const paymentStatus = validPaymentStatuses.has(submitted.paymentStatus) ? submitted.paymentStatus : order.paymentStatus;
      const shouldRelease = status === 'cancelled' || ['failed', 'refunded'].includes(paymentStatus);
      const shouldApply = !shouldRelease && paymentStatus === 'paid';
      if (shouldRelease) await releaseInventory(order);
      else if (shouldApply) { await applyInventory(order); await consumeCoupon(order); }
      order.status = status;
      order.paymentStatus = paymentStatus;
      order.tracking = String(submitted.tracking || '').trim().slice(0, 120);
      order.adminNote = String(submitted.adminNote || '').trim().slice(0, 2000);
      await order.save();
    }
  }else if(name==='users'){
    for(const u of value)await User.updateOne({publicId:Number(u.id)},{$set:{fullName:u.name,mobile:u.phone,email:u.email||undefined,role:u.role||'customer',isActive:u.status!=='blocked'}});
  }else if(name==='tickets'){
    for(const t of value){const user=await User.findOne({publicId:Number(t.userId)});if(user)await Ticket.findOneAndUpdate({publicId:t.id},{$set:{user:user._id,customer:t.customer||user.fullName,subject:t.subject,department:t.department,priority:t.priority,status:t.status,messages:t.messages}},{upsert:true,setDefaultsOnInsert:true});}
  }else if(name==='custom'){
    for(const c of value){const user=await User.findOne({publicId:Number(c.userId)});if(!user)continue;const old=await CustomRequest.findOne({publicId:c.id});await CustomRequest.findOneAndUpdate({publicId:c.id},{$set:{user:user._id,customer:c.customer||user.fullName,fileName:c.fileName,size:c.size,fabric:c.fabric,notes:c.notes,status:c.status,price:Number(c.price||0),adminNote:c.adminNote||''}},{upsert:true,setDefaultsOnInsert:true});if(c.status==='preview-ready'&&old?.status!=='preview-ready')await Notification.create({user:user._id,title:'پیش‌نمایش طرح آماده است',text:`پیش‌نمایش درخواست ${c.id} برای تأیید شما آماده شد.`});}
  }
  ok(res,{message:'اطلاعات ذخیره شد'});
}));
module.exports=router;
