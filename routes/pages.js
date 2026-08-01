const express = require('express');
const Product = require('../models/Product');
const Category = require('../models/Category');
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
const safeNextUrl = value => {
  const next = String(value || '').trim();
  return next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '';
};
const normalizeAsset = value => {
  const image = String(value || '/assets/images/ukflag.png').trim();
  if (/^https?:\/\//i.test(image) || image.startsWith('/')) return image;
  return `/${image.replace(/^\.\//, '')}`;
};

async function common(req) {
  const [productDocs, categoryDocs] = await Promise.all([
    Product.find({ status: 'active' }).sort({ publicId: -1 }).lean(),
    Category.find({ status: 'active' }).sort({ sortOrder: 1, publicId: 1 }).lean()
  ]);
  const categoryLookup = new Map(categoryDocs.map(category => [String(category._id), category]));
  const categories = categoryDocs.map(category => ({
    id: category.publicId,
    name: category.name,
    slug: category.slug,
    description: category.description || '',
    image: category.image ? normalizeAsset(category.image) : '',
    sortOrder: Number(category.sortOrder || 0),
    showInMenu: Boolean(category.showInMenu),
    showInStore: Boolean(category.showInStore),
    showInHome: Boolean(category.showInHome),
    showInReady: Boolean(category.showInReady),
    isReadyRoot: Boolean(category.isReadyRoot)
  }));
  const products = productDocs.map(product => S.product(product, categoryLookup)).map(item => {
    const images = (Array.isArray(item.images) ? item.images : [item.image]).map(normalizeAsset);
    return { ...item, image: images[0], images };
  });
  const readyRoot = categories.find(category => category.isReadyRoot);
  const readyDesigns = products.filter(item => readyRoot
    ? item.categoryIds.includes(readyRoot.id)
    : Array.isArray(item.categories) && item.categories.includes('طرح آماده'));
  let currentUser = null;
  if (req.session?.userId) {
    const user = await User.findById(req.session.userId).lean();
    if (user?.isActive) currentUser = S.user(user);
  }
  return {
    products,
    categories,
    navCategories: categories.filter(category => category.showInMenu && !category.isReadyRoot),
    storeCategories: categories.filter(category => category.showInStore && !category.isReadyRoot),
    homeCategories: categories.filter(category => category.showInHome && !category.isReadyRoot),
    readyCategories: categories.filter(category => category.showInReady && !category.isReadyRoot),
    readyRootCategory: readyRoot || null,
    readyDesigns,
    currentUser,
    product: null,
    catalogPage: Math.max(1, Number.parseInt(req.query.page, 10) || 1),
    nextUrl: safeNextUrl(req.query.next),
    toFa,
    toman,
    safeJson
  };
}

async function render(req, res, view, extra = {}) {
  res.render(view, { ...(await common(req)), ...extra });
}

async function requirePageUser(req, res, next) {
  try {
    if (req.session?.userId) {
      const user = await User.findById(req.session.userId).select('_id isActive').lean();
      if (user?.isActive) return next();
      delete req.session.userId;
    }
    const nextUrl = encodeURIComponent(safeNextUrl(req.originalUrl) || '/checkout');
    return res.redirect(`/?auth=login&next=${nextUrl}`);
  } catch (error) {
    next(error);
  }
}

router.get('/', asyncHandler((req, res) => render(req, res, 'index')));
router.get('/store', asyncHandler((req, res) => render(req, res, 'store')));
router.get('/custom', asyncHandler((req, res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); return render(req, res, 'custom'); }));
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
