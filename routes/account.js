const fs = require('fs');
const express = require('express');
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Ticket = require('../models/Ticket');
const CustomRequest = require('../models/CustomRequest');
const Notification = require('../models/Notification');
const upload = require('../middlewares/upload');
const { requireUser } = require('../middlewares/auth');
const { asyncHandler, ok, AppError } = require('../utils/http');
const { publicCode, normalizeMobile } = require('../utils/formatters');
const { calculateCustomPrice } = require('../utils/customPricing');
const { isPaidSale } = require('../services/analytics');
const { assertUploadedFile } = require('../utils/uploadValidation');
const S = require('../services/serializers');

const router = express.Router();
router.use(requireUser);

const cleanText = (value, max = 500) => String(value || '').trim().slice(0, max);
const validEmail = value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

async function bootstrap(userId) {
  const user = await User.findById(userId);
  if (!user?.isActive) throw new AppError(401, 'حساب کاربری فعال نیست');
  const [orders, tickets, custom, notifications, products] = await Promise.all([
    Order.find({ user: userId }).sort({ createdAt: -1 }).lean(),
    Ticket.find({ user: userId }).sort({ createdAt: -1 }).lean(),
    CustomRequest.find({ user: userId }).sort({ createdAt: -1 }).lean(),
    Notification.find({ user: userId }).sort({ createdAt: -1 }).lean(),
    Product.find({ status: 'active' }).sort({ publicId: 1 }).lean()
  ]);
  const paidOrders = orders.filter(isPaidSale);
  const total = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const hydratedTickets = tickets.map(ticket => ({ ...ticket, user }));
  const hydratedCustom = custom.map(item => ({ ...item, user }));
  return {
    products: products.map(S.product),
    orders: orders.map(order => S.order({ ...order, user: { publicId: user.publicId } })),
    users: [S.user(user, { orders: orders.length, total })],
    tickets: hydratedTickets.map(S.ticket),
    addresses: user.addresses.map(address => S.address(address, user.publicId)),
    notifications: notifications.map(notification => ({ ...S.notification(notification), userId: user.publicId })),
    custom: hydratedCustom.map(S.custom),
    wishlist: user.wishlist || [],
    session: { userId: user.publicId, name: user.fullName, loggedIn: true }
  };
}

router.get('/bootstrap', asyncHandler(async (req, res) => ok(res, await bootstrap(req.session.userId))));

async function normalizedAvailableMobile(user, value) {
  const mobile = normalizeMobile(value);
  if (!/^09\d{9}$/.test(mobile)) throw new AppError(400, 'شماره موبایل معتبر نیست');
  const duplicate = await User.exists({ _id: { $ne: user._id }, mobile });
  if (duplicate) throw new AppError(409, 'این شماره موبایل قبلاً ثبت شده است');
  return mobile;
}

router.patch('/profile', asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId);
  if (!user?.isActive) throw new AppError(401, 'حساب کاربری فعال نیست');

  const fullName = cleanText(req.body.name, 100);
  if (fullName.length < 2) throw new AppError(400, 'نام و نام خانوادگی معتبر نیست');
  const email = cleanText(req.body.email, 180).toLowerCase();
  if (!validEmail(email)) throw new AppError(400, 'ایمیل معتبر نیست');
  if (email && await User.exists({ _id: { $ne: user._id }, email })) throw new AppError(409, 'این ایمیل قبلاً ثبت شده است');

  user.fullName = fullName;
  if (req.body.phone !== undefined) user.mobile = await normalizedAvailableMobile(user, req.body.phone);
  user.email = email || undefined;
  await user.save();
  ok(res, { user: S.user(user) });
}));

router.post('/tickets', asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId);
  const subject = cleanText(req.body.subject, 180);
  const department = cleanText(req.body.department, 80);
  const message = cleanText(req.body.message, 3000);
  const priority = req.body.priority === 'high' ? 'high' : 'normal';
  if (!subject || !department || message.length < 2) throw new AppError(400, 'موضوع، بخش و متن تیکت را کامل وارد کنید');

  const ticket = await Ticket.create({
    publicId: publicCode('TK'),
    user: user._id,
    customer: user.fullName,
    subject,
    department,
    priority,
    messages: [{ from: 'user', text: message, date: 'همین حالا' }]
  });
  ok(res, { ticket: S.ticket({ ...ticket.toObject(), user }) }, 201);
}));

router.post('/tickets/:publicId/reply', asyncHandler(async (req, res) => {
  const text = cleanText(req.body.message, 3000);
  if (text.length < 2) throw new AppError(400, 'متن پاسخ را وارد کنید');
  const ticket = await Ticket.findOne({ publicId: req.params.publicId, user: req.session.userId });
  if (!ticket) throw new AppError(404, 'تیکت پیدا نشد');
  if (ticket.status === 'closed') throw new AppError(409, 'این تیکت بسته شده است');

  ticket.messages.push({ from: 'user', text, date: 'همین حالا' });
  ticket.status = 'open';
  await ticket.save();
  const user = await User.findById(req.session.userId);
  ok(res, { ticket: S.ticket({ ...ticket.toObject(), user }) });
}));

router.post('/custom', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, 'فایل طرح الزامی است');
  try {
    await assertUploadedFile(req.file, new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']));
    const fabric = cleanText(req.body.fabric, 80);
    if (!['ساتن آمریکایی', 'مخمل'].includes(fabric)) {
      throw new AppError(400, 'جنس پارچه انتخاب‌شده معتبر نیست');
    }
    const pricing = calculateCustomPrice(req.body.size, undefined, fabric);
    if (!pricing.valid) {
      throw new AppError(400, pricing.reason === 'too-large'
        ? 'حداکثر سایز قابل ثبت ۱۵۰ × ۹۰ سانتی‌متر است'
        : 'ابعاد واردشده معتبر نیست');
    }
    const user = await User.findById(req.session.userId);
    const item = await CustomRequest.create({
      publicId: publicCode('DS'),
      user: user._id,
      customer: user.fullName,
      phone: user.mobile,
      email: user.email || '',
      fileName: cleanText(req.file.originalname, 255),
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      size: cleanText(req.body.size, 80),
      fabric,
      requestType: cleanText(req.body.requestType, 80),
      notes: cleanText(req.body.notes, 3000),
      status: 'review',
      price: pricing.price
    });
    ok(res, { request: S.custom({ ...item.toObject(), user }) }, 201);
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    throw error;
  }
}));

router.post('/custom/:publicId/approve', asyncHandler(async (req, res) => {
  const item = await CustomRequest.findOne({ publicId: req.params.publicId, user: req.session.userId });
  if (!item) throw new AppError(404, 'درخواست طراحی پیدا نشد');
  if (item.status !== 'preview-ready') throw new AppError(409, 'پیش‌نمایش این درخواست هنوز آماده تأیید نیست');
  item.status = 'approved';
  await item.save();
  const user = await User.findById(req.session.userId);
  ok(res, { request: S.custom({ ...item.toObject(), user }) });
}));

router.put('/sync/:name', asyncHandler(async (req, res) => {
  const name = req.params.name;
  const value = req.body.value;
  if (!Array.isArray(value)) throw new AppError(400, 'ساختار اطلاعات معتبر نیست');
  const user = await User.findById(req.session.userId);
  if (!user?.isActive) throw new AppError(401, 'حساب کاربری فعال نیست');

  if (name === 'users') {
    const candidate = value.find(item => Number(item.id) === Number(user.publicId)) || value[0];
    if (candidate) {
      const fullName = cleanText(candidate.name, 100);
      if (fullName.length >= 2) user.fullName = fullName;
      if (candidate.phone !== undefined) user.mobile = await normalizedAvailableMobile(user, candidate.phone);
      const email = cleanText(candidate.email, 180).toLowerCase();
      if (!validEmail(email)) throw new AppError(400, 'ایمیل معتبر نیست');
      if (email && await User.exists({ _id: { $ne: user._id }, email })) throw new AppError(409, 'این ایمیل قبلاً ثبت شده است');
      user.email = email || undefined;
      await user.save();
    }
  } else if (name === 'addresses') {
    const own = value.filter(item => Number(item.userId) === Number(user.publicId)).slice(0, 20);
    const addresses = own.map((item, index) => {
      const address = {
        publicId: Number(item.id) || Date.now() + index,
        title: cleanText(item.title, 60),
        receiver: cleanText(item.receiver, 100),
        phone: normalizeMobile(item.phone),
        postal: String(item.postal || '').replace(/\D/g, ''),
        province: cleanText(item.province, 80),
        city: cleanText(item.city, 80),
        address: cleanText(item.address, 500),
        default: Boolean(item.default)
      };
      if (!address.title || !address.receiver || !/^09\d{9}$/.test(address.phone) || !/^\d{10}$/.test(address.postal) || !address.province || !address.city || address.address.length < 5) {
        throw new AppError(400, 'اطلاعات یکی از آدرس‌ها کامل یا معتبر نیست');
      }
      return address;
    });
    let defaultSeen = false;
    for (const address of addresses) {
      if (address.default && !defaultSeen) defaultSeen = true;
      else if (address.default) address.default = false;
    }
    if (addresses.length && !defaultSeen) addresses[0].default = true;
    user.addresses = addresses;
    await user.save();
  } else if (name === 'wishlist') {
    const ids = [...new Set(value.map(Number).filter(Number.isFinite))].slice(0, 200);
    const existing = await Product.find({ publicId: { $in: ids }, status: 'active' }).select('publicId').lean();
    user.wishlist = existing.map(product => product.publicId);
    await user.save();
  } else if (name === 'notifications') {
    for (const notification of value.slice(0, 500)) {
      if (notification.id) await Notification.updateOne({ _id: notification.id, user: user._id }, { read: Boolean(notification.read) });
    }
  } else {
    throw new AppError(400, 'این نوع همگام‌سازی مجاز نیست');
  }

  ok(res, { message: 'ذخیره شد' });
}));

module.exports = router;
