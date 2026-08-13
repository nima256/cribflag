process.env.SESSION_STORE = 'memory';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const app = require('../server');
const Product = require('../models/Product');
const Category = require('../models/Category');

const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
const categories = [
  { id: 1, publicId: 1, _id: '64b000000000000000000001', name: 'پرچم دیواری', slug: 'wall-flag', description: '', image: '/assets/images/divari.png', status: 'active', sortOrder: 10, showInMenu: true, showInStore: true, showInHome: true, showInReady: false, isReadyRoot: false },
  { id: 2, publicId: 2, _id: '64b000000000000000000002', name: 'دکور اتاق', slug: 'room-decor', description: '', image: '', status: 'active', sortOrder: 20, showInMenu: false, showInStore: false, showInHome: false, showInReady: true, isReadyRoot: false },
  { id: 3, publicId: 3, _id: '64b000000000000000000003', name: 'طرح آماده', slug: 'ready-design', description: '', image: '', status: 'active', sortOrder: 999, showInMenu: false, showInStore: false, showInHome: false, showInReady: false, isReadyRoot: true }
];
const product = {
  id: 1,
  title: 'پرچم آزمایشی',
  category: 'پرچم دیواری',
  image: '/assets/images/ukflag.png',
  badge: 'ویژه',
  rate: 4.9,
  old: 500000,
  price: 450000,
  description: 'محصول تست',
  sizes: ['۱۰۰ × ۷۰'],
  fabrics: ['مخمل']
};

(async () => {
  const health = await request(app).get('/api/health').expect(200);
  if (!health.body.success || health.body.viewEngine !== 'ejs') throw new Error('Health/EJS check failed');

  const checkout = await request(app).get('/checkout').redirects(0).expect(302);
  if (!String(checkout.headers.location || '').includes('auth=login')) throw new Error('Checkout is not protected');

  const anonymousOrder = await request(app)
    .post('/api/orders')
    .send({ items: [], address: 'test' })
    .expect(401);
  if (anonymousOrder.body.success !== false) throw new Error('Anonymous order protection failed');

  const crossSiteMutation = await request(app)
    .post('/api/auth/logout')
    .set('Origin', 'https://evil.example')
    .expect(403);
  if (crossSiteMutation.body.success !== false) throw new Error('Cross-site mutation guard failed');

  await request(app).get('/uploads/custom/private-file.pdf').expect(404);

  const { assertUploadedFile } = require('../utils/uploadValidation');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cribflag-upload-'));
  const validPng = path.join(tempDir, 'valid.png');
  const fakePng = path.join(tempDir, 'fake.png');
  fs.writeFileSync(validPng, Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]));
  fs.writeFileSync(fakePng, 'not a png');
  await assertUploadedFile({ path: validPng, mimetype: 'image/png' }, new Set(['image/png']));
  let fakeRejected = false;
  try { await assertUploadedFile({ path: fakePng, mimetype: 'image/png' }, new Set(['image/png'])); }
  catch { fakeRejected = true; }
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (!fakeRejected) throw new Error('Spoofed upload signature was accepted');

  const originalFind = Product.find;
  const originalCategoryFind = Category.find;
  const originalProductAggregate = Product.aggregate;
  const productRows = Array.from({ length: 6 }, (_, index) => ({
    _id: `65b00000000000000000000${index + 1}`,
    publicId: index + 1,
    title: `پرچم آزمایشی ${index + 1}`,
    sku: `TEST-${index + 1}`,
    category: 'پرچم دیواری',
    categories: index === 0 ? ['پرچم دیواری', 'دکور اتاق', 'طرح آماده'] : ['پرچم دیواری'],
    primaryCategory: categories[0]._id,
    categoryRefs: index === 0 ? [categories[0]._id, categories[1]._id, categories[2]._id] : [categories[0]._id],
    image: '/assets/images/ukflag.png',
    badge: 'ویژه',
    rate: 4.9,
    oldPrice: 500000,
    price: 450000,
    description: 'محصول تست',
    sizes: ['۱۰۰ × ۷۰'],
    fabrics: ['مخمل'],
    status: 'active',
    stock: 10
  }));
  Product.find = () => {
    const query = {
      select: () => query,
      sort: () => query,
      lean: async () => productRows
    };
    return query;
  };
  Category.find = () => ({ sort: () => ({ lean: async () => categories }) });
  Product.aggregate = async () => [{ _id: categories[0]._id, count: 6 }];
  const categoryApi = await request(app).get('/api/categories').expect(200);
  if (categoryApi.body.categories?.[0]?.slug !== 'wall-flag' || categoryApi.body.categories[0].productCount !== 6) throw new Error('Category API failed');
  const routedHome = await request(app).get('/').expect(200);
  const routedReady = await request(app).get('/ready').expect(200);
  const routedCustom = await request(app).get('/custom').expect(200);
  Product.find = originalFind;
  Category.find = originalCategoryFind;
  Product.aggregate = originalProductAggregate;
  if (!routedHome.text.includes('پرچم آزمایشی 1') || !routedHome.text.includes('/product/1')) throw new Error('Express EJS product route failed');
  if (!routedHome.text.includes('پرچم دیواری') || !routedHome.text.includes('wall-flag')) throw new Error('Express dynamic category navbar route failed');
  if (!routedReady.text.includes('<h3>پرچم آزمایشی 1</h3>') || routedReady.text.includes('<h3>پرچم آزمایشی 2</h3>')) throw new Error('Ready route database category filtering failed');
  if (!routedCustom.text.includes('data-page=\"custom\"') || !routedCustom.text.includes('customFileInput') || routedCustom.text.includes('checkoutProvince')) {
    throw new Error('Custom page route/template regression failed');
  }

  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'index.ejs'), {
    products: [product, product, product, product, product],
    readyDesigns: [],
    categories,
    navCategories: categories.filter(item => item.showInMenu),
    storeCategories: categories.filter(item => item.showInStore),
    homeCategories: categories.filter(item => item.showInHome),
    readyCategories: categories.filter(item => item.showInReady),
    readyRootCategory: null,
    currentUser: null,
    product: null,
    nextUrl: '',
    paymentFailed: false,
    toFa: value => new Intl.NumberFormat('fa-IR').format(Number(value || 0)),
    toman: value => `${new Intl.NumberFormat('fa-IR').format(Number(value || 0))} تومان`,
    safeJson
  });
  if (!html.includes('پرچم دیواری') || !html.includes('wall-flag')) throw new Error('Dynamic navbar submenu missing');
  if (!html.includes('پرچم آزمایشی') || !html.includes('/product/1')) throw new Error('EJS product rendering failed');

  const serializers = require('../services/serializers');
  const serializedOrder = serializers.order({
    orderNumber: 'TEST-1', customer: 'کاربر تست', phone: '09120000000', createdAt: new Date(),
    subtotal: 1000000, shipping: 0, discount: 100000, total: 900000,
    couponCode: 'SAVE10', customerNote: 'لطفاً قبل از ارسال تماس بگیرید.', items: []
  });
  if (serializedOrder.couponCode !== 'SAVE10' || serializedOrder.discount !== 100000 || !serializedOrder.customerNote) {
    throw new Error('Order discount/note serialization failed');
  }

  const serializedCustom = serializers.custom({
    publicId: 'DS-PAY-1',
    user: { publicId: 1 },
    customer: 'کاربر تست',
    createdAt: new Date(),
    price: 990000,
    paymentStatus: 'failed',
    payment: 'پرداخت آنلاین زرین‌پال',
    orderNumber: 'KR-CUSTOM-1'
  });
  if (serializedCustom.paymentStatus !== 'failed' || serializedCustom.orderNumber !== 'KR-CUSTOM-1') {
    throw new Error('Custom request payment serialization failed');
  }

  const { hydrateCustomRequestsWithOrders } = require('../services/customOrderSync');
  const hydratedCustom = hydrateCustomRequestsWithOrders(
    [{ publicId: 'DS-LEGACY-1', paymentStatus: 'unpaid' }],
    [{
      orderNumber: 'KR-LEGACY-1',
      customer: 'کاربر سفارش اختصاصی',
      phone: '09121111111',
      province: 'البرز',
      city: 'کرج',
      postalCode: '3199999999',
      address: 'کرج، نشانی کامل سفارش اختصاصی',
      shippingMethod: 'تیپاکس',
      customerNote: 'قبل از ارسال تماس بگیرید',
      paymentStatus: 'paid',
      payment: 'پرداخت آنلاین',
      createdAt: new Date(),
      items: [{ customRequestId: 'DS-LEGACY-1' }]
    }]
  );
  if (
    hydratedCustom[0].paymentStatus !== 'paid' ||
    hydratedCustom[0].orderNumber !== 'KR-LEGACY-1' ||
    hydratedCustom[0].address !== 'کرج، نشانی کامل سفارش اختصاصی' ||
    hydratedCustom[0].postalCode !== '3199999999' ||
    hydratedCustom[0].deliveryNote !== 'قبل از ارسال تماس بگیرید'
  ) {
    throw new Error('Legacy custom request order hydration failed');
  }

  const { calculateCustomPrice, CUSTOM_FLAG_FABRICS } = require('../utils/customPricing');
  if (!CUSTOM_FLAG_FABRICS.includes('ساتن براق') || CUSTOM_FLAG_FABRICS.length !== 3) {
    throw new Error('Custom flag fabric allowlist is out of sync');
  }
  const { parsePersianDate } = require('../utils/formatters');
  const parsedExpiry = parsePersianDate('۱۴۰۵/۰۵/۳۱');
  if (!parsedExpiry || parsedExpiry.getUTCFullYear() !== 2026 || parsedExpiry.getUTCMonth() !== 7 || parsedExpiry.getUTCDate() !== 22) {
    throw new Error('Persian coupon expiration parsing failed');
  }
  const customPriceCases = [
    ['40 × 30 سانتی‌متر', true, 550000],
    ['70x50', true, 550000],
    ['71x50', true, 800000],
    ['100x70', true, 800000],
    ['101x70', true, 990000],
    ['150x90', true, 990000],
    ['90x150', true, 990000],
    ['151x90', false, 0],
    ['150x91', false, 0],
    ['۱۵۰ × ۹۰ سانتی‌متر', true, 990000]
  ];
  for (const [size, valid, price] of customPriceCases) {
    const result = calculateCustomPrice(size);
    if (result.valid !== valid || result.price !== price) {
      throw new Error(`Custom pricing failed for ${size}`);
    }
  }

  const pillowPriceCases = [
    ['روبالشتی', 'فقط کاور — ۵۰ × ۷۰ سانتی‌متر', 1000],
    ['روبالشتی', 'با الیاف — ۵۰ × ۷۰ سانتی‌متر', 950000],
    ['داکیماکورا بالشت قدی', 'فقط کاور — ۳۵ × ۱۰۰ سانتی‌متر', 700000],
    ['داکیماکورا بالشت قدی', 'با الیاف — ۳۵ × ۱۰۰ سانتی‌متر', 1050000],
    ['داکیماکورا بالشت قدی', 'فقط کاور — ۵۰ × ۱۵۰ سانتی‌متر', 990000],
    ['داکیماکورا بالشت قدی', 'با الیاف — ۵۰ × ۱۵۰ سانتی‌متر', 1450000]
  ];
  for (const [requestType, size, price] of pillowPriceCases) {
    const result = calculateCustomPrice(size, undefined, 'مخمل', requestType);
    if (!result.valid || result.price !== price || result.fabric !== 'مخمل') {
      throw new Error(`Pillow pricing failed for ${requestType}: ${size}`);
    }
  }
  if (calculateCustomPrice('فقط کاور — ۷۰ × ۱۰۰ سانتی‌متر', undefined, 'مخمل', 'روبالشتی').valid) {
    throw new Error('Invalid pillow size was accepted');
  }
  const serializedPillow = serializers.product({
    publicId: 99, title: 'روبالشتی تست', sku: 'PILLOW-99', category: 'رو بالشتی', categories: ['رو بالشتی'],
    price: 777000, hasDiscount: true, oldPrice: 888000,
    variantPrices: [{ size: 'فقط کاور — ۵۰ × ۷۰ سانتی‌متر', fabric: 'مخمل', price: 777000, oldPrice: 888000 }],
    sizes: ['فقط کاور — ۵۰ × ۷۰ سانتی‌متر'], fabrics: ['مخمل'], images: [], status: 'active'
  });
  if (serializedPillow.price !== 777000 || !serializedPillow.hasDiscount || serializedPillow.old !== 888000 || serializedPillow.variantPrices.length !== 1) {
    throw new Error('Serialized pillow product did not preserve editable stored pricing');
  }

  console.log('Smoke OK: category API, dynamic routes, ready/custom templates, custom payment hydration, flag/pillow custom pricing, editable product serialization, order serialization, auth and origin guards');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
