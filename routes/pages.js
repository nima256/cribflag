const fs = require('fs');
const path = require('path');
const express = require('express');
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const Admin = require('../models/Admin');
const S = require('../services/serializers');
const { asyncHandler } = require('../utils/http');
const iranCity = require('iran-city');
const { performance } = require('node:perf_hooks');
const { buildProductPageMeta } = require('../helper/torobProductMeta');

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

const PUBLIC_ASSET_VERSION = String(process.env.PUBLIC_ASSET_VERSION || '20260801-final-scroll-v3').trim();
const versionLocalAsset = value => {
  const image = normalizeAsset(value);
  if (/^https?:\/\//i.test(image) || !PUBLIC_ASSET_VERSION) return image;
  if (!image.startsWith('/uploads/') && !image.startsWith('/assets/images/')) return image;
  const separator = image.includes('?') ? '&' : '?';
  return `${image}${separator}v=${encodeURIComponent(PUBLIC_ASSET_VERSION)}`;
};

const thumbnailRoots = [
  { prefix: '/uploads/products/', directory: path.join(__dirname, '..', 'uploads', 'products', 'thumbs') },
  { prefix: '/uploads/categories/', directory: path.join(__dirname, '..', 'uploads', 'categories', 'thumbs') },
  { prefix: '/uploads/', directory: path.join(__dirname, '..', 'uploads', 'thumbs') },
  { prefix: '/assets/images/', directory: path.join(__dirname, '..', 'public', 'assets', 'images', 'thumbs') }
];

function cardThumbnailAsset(value) {
  const image = normalizeAsset(value);
  if (/^https?:\/\//i.test(image)) return image;
  if (image.includes('/thumbs/')) return versionLocalAsset(image);
  if (!/\.(?:png|jpe?g|webp)$/i.test(image)) return versionLocalAsset(image);

  const root = thumbnailRoots.find(item => image.startsWith(item.prefix));
  if (!root) return versionLocalAsset(image);

  const sourceName = path.posix.basename(image);
  const thumbnailName = `${path.parse(sourceName).name}.webp`;
  const thumbnailFile = path.join(root.directory, thumbnailName);
  if (!fs.existsSync(thumbnailFile)) return versionLocalAsset(image);

  return versionLocalAsset(`${root.prefix}thumbs/${thumbnailName}`);
}

const PUBLIC_CATALOG_CACHE_MS = Math.max(0, Number(process.env.PUBLIC_CATALOG_CACHE_MS || 15000));
const catalogCache = { value: null, expiresAt: 0, pending: null };

async function loadPublicCatalog(req) {
  const now = Date.now();
  if (catalogCache.value && now < catalogCache.expiresAt) {
    req.catalogCacheHit = true;
    return catalogCache.value;
  }
  if (catalogCache.pending) {
    req.catalogCacheHit = true;
    return catalogCache.pending;
  }

  req.catalogCacheHit = false;
  catalogCache.pending = (async () => {
    const [productDocs, categoryDocs] = await Promise.all([
      Product.find({ status: 'active' })
        .select('-__v -createdAt -updatedAt')
        .sort({ publicId: -1 })
        .lean(),
      Category.find({ status: 'active' })
        .sort({ sortOrder: 1, publicId: 1 })
        .lean()
    ]);
    const categoryLookup = new Map(categoryDocs.map(category => [String(category._id), category]));
    const categories = categoryDocs.map(category => {
      const sourceImage = category.image ? normalizeAsset(category.image) : '';
      const image = sourceImage ? versionLocalAsset(sourceImage) : '';
      return {
      id: category.publicId,
      name: category.name,
      slug: category.slug,
      description: category.description || '',
      image,
      thumbnail: sourceImage ? cardThumbnailAsset(sourceImage) : '',
      sortOrder: Number(category.sortOrder || 0),
      showInMenu: Boolean(category.showInMenu),
      showInStore: Boolean(category.showInStore),
      showInHome: Boolean(category.showInHome),
      showInReady: Boolean(category.showInReady),
      isReadyRoot: Boolean(category.isReadyRoot)
      };
    });
    const products = productDocs.map(product => S.product(product, categoryLookup)).map(item => {
      const sourceImages = (Array.isArray(item.images) ? item.images : [item.image]).map(normalizeAsset);
      const images = sourceImages.map(versionLocalAsset);
      return {
        ...item,
        image: images[0],
        thumbnail: cardThumbnailAsset(sourceImages[0]),
        images
      };
    });
    const readyRoot = categories.find(category => category.isReadyRoot);
    const readyDesigns = products.filter(item => readyRoot
      ? item.categoryIds.includes(readyRoot.id)
      : Array.isArray(item.categories) && item.categories.includes('طرح آماده'));

    const value = {
      products,
      categories,
      navCategories: categories.filter(category => category.showInMenu && !category.isReadyRoot),
      storeCategories: categories.filter(category => category.showInStore && !category.isReadyRoot),
      homeCategories: categories.filter(category => category.showInHome && !category.isReadyRoot),
      readyCategories: categories.filter(category => category.showInReady && !category.isReadyRoot),
      readyRootCategory: readyRoot || null,
      readyDesigns
    };
    catalogCache.value = value;
    catalogCache.expiresAt = Date.now() + PUBLIC_CATALOG_CACHE_MS;
    return value;
  })();

  try {
    return await catalogCache.pending;
  } finally {
    catalogCache.pending = null;
  }
}

async function common(req) {
  const catalog = await loadPublicCatalog(req);
  let currentUser = null;
  if (req.session?.userId) {
    const user = await User.findById(req.session.userId)
      .select('publicId fullName mobile email role isActive createdAt')
      .lean();
    if (user?.isActive) currentUser = S.user(user);
  }
  return {
    ...catalog,
    currentUser,
    // Compatibility alias for templates that still reference `user`.
    user: currentUser,
    product: null,
    catalogPage: Math.max(1, Number.parseInt(req.query.page, 10) || 1),
    nextUrl: safeNextUrl(req.query.next),
    toFa,
    toman,
    safeJson
  };
}

async function render(req, res, view, extra = {}) {
  const startedAt = performance.now();
  const data = await common(req);
  res.set('Server-Timing', `page-data;dur=${(performance.now() - startedAt).toFixed(1)};desc="catalog-${req.catalogCacheHit ? 'hit' : 'miss'}"`);
  res.render(view, { ...data, ...extra });
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
router.get('/payment/success', asyncHandler((req, res) => render(req, res, 'success', { paymentFailed: false, paymentPending: false })));
router.get('/payment/failed', asyncHandler((req, res) => render(req, res, 'success', { paymentFailed: true, paymentPending: false })));
router.get('/payment/pending', asyncHandler((req, res) => render(req, res, 'success', { paymentFailed: false, paymentPending: true })));
router.get('/product/:id', asyncHandler(async (req, res) => {
  const startedAt = performance.now();
  const data = await common(req);
  res.set('Server-Timing', `page-data;dur=${(performance.now() - startedAt).toFixed(1)};desc="catalog-${req.catalogCacheHit ? 'hit' : 'miss'}"`);
  const product = data.products.find(item => Number(item.id) === Number(req.params.id));
  if (!product) return res.status(404).render('404', { ...data, message: 'محصول موردنظر پیدا نشد.' });
  const torobMeta = buildProductPageMeta(product, req.query.size, req.query.fabric);
  res.render('product', { ...data, product, torobMeta });
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
