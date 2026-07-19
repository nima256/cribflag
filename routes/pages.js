const express = require('express');
const Product = require('../models/Product');
const User = require('../models/User');
const Admin = require('../models/Admin');
const S = require('../services/serializers');
const { asyncHandler } = require('../utils/http');
const iranCity = require('iran-city');

const router = express.Router();


const iranProvinces = iranCity.allProvinces()
  .map(province => ({
    id: Number(province.id),
    name: String(province.name || '').trim(),
    cities: iranCity.citiesOfProvince(Number(province.id))
      .map(city => String(city.name || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'fa'))
  }))
  .filter(province => province.name && province.cities.length)
  .sort((a, b) => a.name.localeCompare(b.name, 'fa'));

const toFa = value => new Intl.NumberFormat('fa-IR').format(Number(value || 0));
const toman = value => `${toFa(value)} تومان`;
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
const normalizeAsset = value => {
  const image = String(value || '/assets/images/ukflag.png');
  if (/^(https?:|data:|\/)/.test(image)) return image;
  return `/${image.replace(/^\.\//, '')}`;
};

async function common(req) {
  const productDocs = await Product.find({ status: 'active' }).sort({ publicId: 1 }).lean();
  const products = productDocs.map(S.product).map(item => {
    const images = (Array.isArray(item.images) ? item.images : [item.image]).map(normalizeAsset);
    return { ...item, image: images[0], images };
  });
  const readyDesigns = products.filter(item => Array.isArray(item.categories) && item.categories.includes('طرح آماده'));
  let currentUser = null;
  if (req.session?.userId) {
    const user = await User.findById(req.session.userId).lean();
    if (user) currentUser = S.user(user);
  }
  return {
    products,
    readyDesigns,
    currentUser,
    product: null,
    nextUrl: String(req.query.next || ''),
    toFa,
    toman,
    safeJson
  };
}

async function render(req, res, view, extra = {}) {
  res.render(view, { ...(await common(req)), ...extra });
}

function requirePageUser(req, res, next) {
  if (req.session?.userId) return next();
  const nextUrl = encodeURIComponent(req.originalUrl || '/checkout');
  return res.redirect(`/?auth=login&next=${nextUrl}`);
}

router.get('/', asyncHandler((req, res) => render(req, res, 'index')));
router.get('/store', asyncHandler((req, res) => render(req, res, 'store')));
router.get('/custom', asyncHandler((req, res) => render(req, res, 'custom')));
router.get('/ready', asyncHandler((req, res) => render(req, res, 'ready')));
router.get('/faq', asyncHandler((req, res) => render(req, res, 'faq')));
router.get('/blog', asyncHandler((req, res) => render(req, res, 'blog')));
router.get('/blog/:id', asyncHandler((req, res) => render(req, res, 'blog-detail', { blogId: Number(req.params.id) || 1 })));
router.get('/cart', asyncHandler((req, res) => render(req, res, 'cart')));
router.get('/checkout', requirePageUser, asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId)
    .select('fullName mobile email isActive')
    .lean();

  if (!user || !user.isActive) {
    return res.redirect('/?auth=login&next=%2Fcheckout');
  }

  await render(req, res, 'checkout', {
    user,
    provinces: iranProvinces
  });
}));
router.get('/account', requirePageUser, asyncHandler((req, res) => render(req, res, 'account')));
router.get('/admin', asyncHandler(async (req, res) => {
  let admin = null;
  if (req.session?.adminId) admin = await Admin.findById(req.session.adminId).lean();
  await render(req, res, 'admin', { admin });
}));
router.get('/payment/success', asyncHandler((req, res) => render(req, res, 'success', { paymentFailed: false })));
router.get('/payment/failed', asyncHandler((req, res) => render(req, res, 'success', { paymentFailed: true })));
router.get('/product/:id', asyncHandler(async (req, res) => {
  const data = await common(req);
  const product = data.products.find(item => Number(item.id) === Number(req.params.id));
  if (!product) return res.status(404).render('404', { ...data, message: 'محصول موردنظر پیدا نشد.' });
  res.render('product', { ...data, product });
}));

const legacy = {
  '/index.html': '/', '/store.html': '/store', '/custom.html': '/custom', '/ready.html': '/ready',
  '/faq.html': '/faq', '/blog.html': '/blog', '/cart.html': '/cart', '/checkout.html': '/checkout',
  '/account.html': '/account', '/admin.html': '/admin', '/success.html': '/payment/success'
};
Object.entries(legacy).forEach(([from, to]) => router.get(from, (req, res) => res.redirect(301, `${to}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`)));
router.get('/product.html', (req, res) => res.redirect(301, `/product/${Number(req.query.id) || 1}`));
router.get('/blog-detail.html', (req, res) => res.redirect(301, `/blog/${Number(req.query.id) || 1}`));

module.exports = router;
