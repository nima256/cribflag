const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8080),
  siteUrl: (process.env.SITE_URL || 'http://localhost:8080').replace(/\/$/, ''),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/cribflag',
  sessionSecret: process.env.SESSION_SECRET || 'cribflag-local-only-change-me',
  sessionStore: process.env.SESSION_STORE || 'memory',
  trustProxy: process.env.TRUST_PROXY === '1',
  corsOrigin: process.env.CORS_ORIGIN || '',
  cookieSameSite: process.env.COOKIE_SAMESITE || 'lax',
  otpExpiresSeconds: Number(process.env.OTP_EXPIRES_SECONDS || 120),
  melipayamakSharedKey: process.env.MELIPAYAMAK_SHARED_KEY || '',
  melipayamakBodyId: Number(process.env.MELIPAYAMAK_BODY_ID || 502666),
  paymentMock: process.env.PAYMENT_MOCK === 'true',
  zarinpalMerchantId: process.env.ZARINPAL_MERCHANT_ID || '',
  zarinpalSandbox: process.env.ZARINPAL_SANDBOX === 'true',
  zarinpalAmountUnit: process.env.ZARINPAL_AMOUNT_UNIT || 'toman',
  adminEmail: process.env.ADMIN_EMAIL || "iUqcjT1Nh62e@gmail.com",
  adminPassword: process.env.ADMIN_PASSWORD || "gl4N}(E9o99An%fCSND#",
  adminMobile: process.env.ADMIN_MOBILE
};

env.isProduction = env.nodeEnv === 'production';

if (!Number.isInteger(env.port) || env.port < 1 || env.port > 65535) {
  throw new Error('PORT باید یک عدد معتبر بین ۱ تا ۶۵۵۳۵ باشد');
}
if (!['lax', 'strict', 'none'].includes(String(env.cookieSameSite).toLowerCase())) {
  throw new Error('COOKIE_SAMESITE فقط می‌تواند lax، strict یا none باشد');
}
env.cookieSameSite = String(env.cookieSameSite).toLowerCase();

if (env.isProduction) {
  const missing = [];
  if (!process.env.SESSION_SECRET || env.sessionSecret === 'cribflag-local-only-change-me' || env.sessionSecret.length < 32) missing.push('SESSION_SECRET قوی (حداقل ۳۲ کاراکتر)');
  if (!process.env.MONGODB_URI) missing.push('MONGODB_URI');
  if (!process.env.SITE_URL || !/^https:\/\//i.test(env.siteUrl)) missing.push('SITE_URL با HTTPS');
  if (!env.melipayamakSharedKey) missing.push('MELIPAYAMAK_SHARED_KEY');
  if (!env.paymentMock && !env.zarinpalMerchantId) missing.push('ZARINPAL_MERCHANT_ID');
  if (!process.env.ADMIN_PASSWORD || env.adminPassword === 'Admin123!') missing.push('ADMIN_PASSWORD غیرپیش‌فرض');
  if (missing.length) throw new Error(`تنظیمات ضروری محیط production ناقص است: ${missing.join('، ')}`);
}

module.exports = env;
