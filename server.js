const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const env = require('./config/env');
const { AppError } = require('./utils/http');

const app = express();
if (env.trustProxy || env.isProduction) app.set('trust proxy', 1); // حفظ کوکی نشست پشت Nginx/Cloudflare/هاست

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(compression());
if (env.corsOrigin) app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const sessionOptions = {
  name: 'cribflag.sid',
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.isProduction ? 'auto' : false,
    maxAge: 14 * 24 * 60 * 60 * 1000
  }
};
// انتشار: SESSION_STORE=mongo باعث ذخیره نشست‌ها در MongoDB می‌شود.
if (env.sessionStore === 'mongo' || env.isProduction) {
  sessionOptions.store = MongoStore.create({ mongoUrl: env.mongodbUri, collectionName: 'sessions' });
}
app.use(session(sessionOptions));

app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), {
  maxAge: env.isProduction ? '30d' : 0,
  etag: true,
  setHeaders(res, filePath) {
    // JS/CSS filenames are not content-hashed, so revalidate them. `no-cache`
    // still allows the browser to keep a local copy and receive a lightweight 304.
    if (/\.(?:js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { fallthrough: false, maxAge: env.isProduction ? '7d' : 0 }));

app.get('/api/health', (_req, res) => res.json({ success: true, status: 'ok', environment: env.nodeEnv, paymentMock: env.paymentMock, viewEngine: 'ejs' }));
app.use('/api/products', require('./routes/products'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/discounts', require('./routes/discounts'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/account', require('./routes/account'));
app.use('/api/admin', require('./routes/admin'));
app.use('/admin/download', require('./routes/admin-download'));
app.use('/api', (_req, _res, next) => next(new AppError(404, 'مسیر API یافت نشد')));

app.use(require('./routes/pages'));
app.use(async (req, res) => {
  res.status(404).render('404', { message: 'صفحه موردنظر پیدا نشد.' });
});

app.use((err, req, res, _next) => {
  let status = err.status || 500;
  let message = err.message;
  if (err.code === 11000) { status = 409; message = 'اطلاعات تکراری است'; }
  if (err.name === 'ValidationError') { status = 400; message = 'داده‌های ارسالی معتبر نیست'; }
  if (err.code === 'LIMIT_FILE_SIZE') { status = 400; message = 'حجم فایل بیشتر از ۲۰ مگابایت است'; }
  if (status >= 500) console.error(err);
  if (!req.path.startsWith('/api')) return res.status(status).render('404', { message: status === 500 ? 'خطای داخلی سرور' : message });
  res.status(status).json({ success: false, message: status === 500 ? 'خطای داخلی سرور' : message, details: err.details, ...(env.isProduction ? {} : { stack: err.stack }) });
});

async function start() {
  await mongoose.connect(env.mongodbUri);
  await require('./services/categories').ensureLegacyCategories();
  app.listen(env.port, () => console.log(`Crib Flag: ${env.siteUrl} | MongoDB: ${env.mongodbUri} | EJS enabled`));
}
if (require.main === module) start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
module.exports = app;
