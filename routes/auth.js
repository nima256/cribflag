const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Otp = require('../models/Otp');
const env = require('../config/env');
const { sendPatternSms } = require('../services/sms');
const { asyncHandler, ok, AppError } = require('../utils/http');
const { normalizeMobile, normalizeDigits } = require('../utils/formatters');
const { requireUser } = require('../middlewares/auth');
const S = require('../services/serializers');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'تعداد درخواست کد بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید.' } });
router.use(limiter);

const validate = req => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new AppError(400, 'خطا در اعتبارسنجی', errors.array());
};
const mobileRule = body('mobile').customSanitizer(normalizeMobile).matches(/^09\d{9}$/).withMessage('شماره موبایل معتبر نیست');
const normalizeOtp = value => normalizeDigits(value).replace(/[^0-9]/g, '');
const otpRule = body('otp').customSanitizer(normalizeOtp).matches(/^\d{5}$/).withMessage('کد تأیید باید ۵ رقم باشد');
const saveSession = req => new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
const regenerateSession = req => new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
const destroySession = req => new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));

async function regenerateUserSession(req) {
  // ادمین و کاربر یک کوکی مشترک دارند؛ هنگام ورود کاربر، نشست فعال ادمین را حفظ می‌کنیم.
  // اطلاعات منبع ورود نیز باید بعد از regenerate باقی بماند تا سفارش به کمپین درست نسبت داده شود.
  const adminId = req.session?.adminId;
  const attribution = req.session?.attribution;
  await regenerateSession(req);
  if (adminId) req.session.adminId = adminId;
  if (attribution) req.session.attribution = attribution;
}

async function logoutUserOnly(req, res) {
  delete req.session.userId;
  delete req.session.pendingSigninUserId;
  delete req.session.pendingSigninMobile;

  if (req.session.adminId) {
    await saveSession(req);
    return;
  }

  await destroySession(req);
  res.clearCookie('cribflag.sid');
}

async function nextUserPublicId() {
  const last = await User.findOne().sort({ publicId: -1 }).select('publicId').lean();
  return Number(last?.publicId || 0) + 1;
}
function codeHash(code) { return crypto.createHash('sha256').update(String(code)).digest('hex'); }

async function issueOtp(mobile, purpose) {
  const existing = await Otp.findOne({ mobile, purpose });
  if (existing?.lastSentAt && Date.now() - existing.lastSentAt.getTime() < 60_000) {
    const retryAfter = Math.ceil((60_000 - (Date.now() - existing.lastSentAt.getTime())) / 1000);
    throw new AppError(429, `ارسال مجدد کد تا ${retryAfter} ثانیه دیگر امکان‌پذیر است`);
  }
  const code = String(crypto.randomInt(10000, 100000));
  const expiresAt = new Date(Date.now() + env.otpExpiresSeconds * 1000);
  await Otp.findOneAndUpdate(
    { mobile, purpose },
    { codeHash: codeHash(code), expiresAt, attempts: 0, lastSentAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  try {
    await sendPatternSms(mobile, [code]);
  } catch (error) {
    await Otp.deleteOne({ mobile, purpose });
    throw new AppError(502, `ارسال پیامک انجام نشد: ${error.message}`);
  }
  return env.isProduction ? {} : { debugOtp: code };
}

async function verifyOtp(mobile, purpose, otp) {
  const record = await Otp.findOne({ mobile, purpose }).select('+codeHash');
  if (!record || record.expiresAt < new Date()) {
    if (record) await record.deleteOne();
    throw new AppError(400, 'کد تأیید منقضی شده یا وجود ندارد');
  }
  if (record.attempts >= 3) {
    await record.deleteOne();
    throw new AppError(429, 'تعداد تلاش مجاز تمام شده است؛ کد جدید دریافت کنید');
  }
  if (codeHash(otp) !== record.codeHash) {
    record.attempts += 1;
    await record.save();
    throw new AppError(400, `کد تأیید اشتباه است؛ ${Math.max(0, 3 - record.attempts)} تلاش باقی مانده`);
  }
  await record.deleteOne();
}

const signupValidation = [
  body('fullName').trim().isLength({ min: 2 }).withMessage('نام کامل الزامی است'),
  mobileRule,
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('ایمیل معتبر نیست'),
  body('password').isLength({ min: 6 }).withMessage('رمز عبور باید حداقل ۶ کاراکتر باشد'),
  body('confirmPassword').notEmpty().withMessage('تکرار رمز عبور الزامی است').bail().custom((value, { req }) => value === req.body.password).withMessage('تکرار رمز عبور یکسان نیست')
];

router.post('/signup/start', otpLimiter, signupValidation, asyncHandler(async (req, res) => {
  validate(req);
  const mobile = normalizeMobile(req.body.mobile);
  const email = req.body.email?.trim().toLowerCase() || undefined;
  if (await User.exists({ $or: [{ mobile }, ...(email ? [{ email }] : [])] })) throw new AppError(409, 'این شماره موبایل یا ایمیل قبلاً ثبت شده است');
  const debug = await issueOtp(mobile, 'signup');
  ok(res, { message: 'کد تأیید ثبت‌نام از ملی‌پیامک ارسال شد', mobile, ...debug });
}));

router.post('/signup/verify', [...signupValidation, otpRule], asyncHandler(async (req, res) => {
  validate(req);
  const mobile = normalizeMobile(req.body.mobile);
  const email = req.body.email?.trim().toLowerCase() || undefined;
  if (await User.exists({ $or: [{ mobile }, ...(email ? [{ email }] : [])] })) throw new AppError(409, 'این شماره موبایل یا ایمیل قبلاً ثبت شده است');
  await verifyOtp(mobile, 'signup', req.body.otp);
  const user = await User.create({
    publicId: await nextUserPublicId(),
    fullName: req.body.fullName.trim(), mobile, email,
    password: await bcrypt.hash(req.body.password, 12)
  });
  await regenerateUserSession(req);
  req.session.userId = user._id.toString();
  await saveSession(req);
  ok(res, { message: 'ثبت‌نام و تأیید شماره با موفقیت انجام شد', user: S.user(user) }, 201);
}));

router.post('/signin/start', otpLimiter, [mobileRule, body('password').isLength({ min: 6 })], asyncHandler(async (req, res) => {
  validate(req);
  const mobile = normalizeMobile(req.body.mobile);
  const user = await User.findOne({ mobile }).select('+password');
  if (!user || !user.isActive || !(await user.comparePassword(req.body.password))) throw new AppError(401, 'شماره موبایل یا رمز عبور اشتباه است');
  req.session.pendingSigninUserId = user._id.toString();
  req.session.pendingSigninMobile = mobile;
  await saveSession(req);
  const debug = await issueOtp(mobile, 'login');
  ok(res, { message: 'کد ورود از ملی‌پیامک ارسال شد', mobile, ...debug });
}));

router.post('/signin/verify', [mobileRule, otpRule], asyncHandler(async (req, res) => {
  validate(req);
  const mobile = normalizeMobile(req.body.mobile);
  if (!req.session.pendingSigninUserId || req.session.pendingSigninMobile !== mobile) throw new AppError(400, 'درخواست ورود معتبر نیست؛ دوباره رمز عبور را وارد کنید');
  await verifyOtp(mobile, 'login', req.body.otp);
  const user = await User.findOne({ _id: req.session.pendingSigninUserId, mobile });
  if (!user || !user.isActive) throw new AppError(401, 'حساب کاربری در دسترس نیست');
  user.lastLoginAt = new Date();
  await user.save();
  await regenerateUserSession(req);
  req.session.userId = user._id.toString();
  await saveSession(req);
  ok(res, { message: 'ورود با کد پیامکی موفق بود', user: S.user(user) });
}));

// مسیرهای قدیمی عمداً به جریان OTP هدایت می‌شوند.
router.post('/signup', (_req, _res, next) => next(new AppError(400, 'برای ثبت‌نام ابتدا کد تأیید پیامکی دریافت کنید')));
router.post('/signin', (_req, _res, next) => next(new AppError(400, 'برای ورود ابتدا کد ورود پیامکی دریافت کنید')));

router.post('/logout', asyncHandler(async (req, res) => {
  await logoutUserOnly(req, res);
  ok(res, { message: 'با موفقیت خارج شدید' });
}));
router.get('/me', asyncHandler(async (req, res) => {
  if (!req.session?.userId) return ok(res, { authenticated: false, user: null });
  const user = await User.findById(req.session.userId);
  if (!user?.isActive) {
    delete req.session.userId;
    await saveSession(req);
    return ok(res, { authenticated: false, user: null });
  }
  ok(res, { authenticated: true, user: S.user(user) });
}));

router.post('/password/forgot', otpLimiter, [mobileRule], asyncHandler(async (req, res) => {
  validate(req);
  const mobile = normalizeMobile(req.body.mobile);
  if (!await User.exists({ mobile })) throw new AppError(404, 'کاربری با این شماره موبایل یافت نشد');
  const debug = await issueOtp(mobile, 'password_reset');
  ok(res, { message: 'کد بازیابی از ملی‌پیامک ارسال شد', mobile, ...debug });
}));

router.post('/password/verify', [mobileRule, otpRule], asyncHandler(async (req, res) => {
  validate(req);
  const mobile = normalizeMobile(req.body.mobile);
  await verifyOtp(mobile, 'password_reset', req.body.otp);
  const token = crypto.randomBytes(32).toString('hex');
  await User.updateOne({ mobile }, { passwordResetToken: codeHash(token), passwordResetExpires: new Date(Date.now() + 10 * 60 * 1000) });
  ok(res, { message: 'کد صحیح است', resetToken: token });
}));

router.patch('/password/reset/:token', [body('password').isLength({ min: 6 })], asyncHandler(async (req, res) => {
  validate(req);
  const user = await User.findOne({ passwordResetToken: codeHash(req.params.token), passwordResetExpires: { $gt: new Date() } }).select('+password +passwordResetToken +passwordResetExpires');
  if (!user) throw new AppError(400, 'توکن بازیابی نامعتبر یا منقضی شده است');
  await user.setPassword(req.body.password);
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.passwordChangedAt = new Date();
  await user.save();
  ok(res, { message: 'رمز عبور تغییر کرد' });
}));

router.patch('/password/change', requireUser, [body('currentPassword').isLength({ min: 6 }), body('newPassword').isLength({ min: 6 })], asyncHandler(async (req, res) => {
  validate(req);
  const user = await User.findById(req.session.userId).select('+password');
  if (!user || !(await user.comparePassword(req.body.currentPassword))) throw new AppError(400, 'رمز عبور فعلی اشتباه است');
  await user.setPassword(req.body.newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  ok(res, { message: 'رمز عبور تغییر کرد' });
}));

module.exports = router;
