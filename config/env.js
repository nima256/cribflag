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
  melipayamakBodyId: Number(process.env.MELIPAYAMAK_BODY_ID || 347717),
  paymentMock: process.env.PAYMENT_MOCK === 'true',
  zarinpalMerchantId: process.env.ZARINPAL_MERCHANT_ID || '',
  zarinpalSandbox: process.env.ZARINPAL_SANDBOX === 'true',
  zarinpalAmountUnit: process.env.ZARINPAL_AMOUNT_UNIT || 'toman',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@cribflag.local',
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin123!',
  adminMobile: process.env.ADMIN_MOBILE || '09120000000'
};

env.isProduction = env.nodeEnv === 'production';
module.exports = env;
