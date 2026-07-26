process.env.SESSION_STORE = 'memory';
process.env.NODE_ENV = 'test';

const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const app = require('../server');
const Product = require('../models/Product');
const Category = require('../models/Category');

const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
const categories = [
  { id: 1, publicId: 1, _id: '64b000000000000000000001', name: 'فلگ دیواری', slug: 'wall-flag', description: '', image: '/assets/images/divari.png', status: 'active', sortOrder: 10, showInMenu: true, showInStore: true, showInHome: true, showInReady: false, isReadyRoot: false },
  { id: 2, publicId: 2, _id: '64b000000000000000000002', name: 'دکور اتاق', slug: 'room-decor', description: '', image: '', status: 'active', sortOrder: 20, showInMenu: false, showInStore: false, showInHome: false, showInReady: true, isReadyRoot: false }
];
const product = {
  id: 1,
  title: 'فلگ آزمایشی',
  category: 'فلگ دیواری',
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


  const originalFind = Product.find;
  const originalCategoryFind = Category.find;
  const originalProductAggregate = Product.aggregate;
  Product.find = () => ({
    sort: () => ({
      lean: async () => Array.from({ length: 6 }, (_, index) => ({
        publicId: index + 1,
        title: `فلگ آزمایشی ${index + 1}`,
        sku: `TEST-${index + 1}`,
        category: 'فلگ دیواری',
        categories: index === 0 ? ['فلگ دیواری', 'دکور اتاق', 'طرح آماده'] : ['فلگ دیواری'],
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
      }))
    })
  });
  Category.find = () => ({ sort: () => ({ lean: async () => categories }) });
  Product.aggregate = async () => [{ _id: categories[0]._id, count: 6 }];
  const categoryApi = await request(app).get('/api/categories').expect(200);
  if (categoryApi.body.categories?.[0]?.slug !== 'wall-flag' || categoryApi.body.categories[0].productCount !== 6) throw new Error('Category API failed');
  const routedHome = await request(app).get('/').expect(200);
  const routedReady = await request(app).get('/ready').expect(200);
  Product.find = originalFind;
  Category.find = originalCategoryFind;
  Product.aggregate = originalProductAggregate;
  if (!routedHome.text.includes('فلگ آزمایشی 1') || !routedHome.text.includes('/product/1')) throw new Error('Express EJS product route failed');
  if (!routedHome.text.includes('فلگ دیواری') || !routedHome.text.includes('wall-flag')) throw new Error('Express dynamic category navbar route failed');
  if (!routedReady.text.includes('<h3>فلگ آزمایشی 1</h3>') || routedReady.text.includes('<h3>فلگ آزمایشی 2</h3>')) throw new Error('Ready route database category filtering failed');

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
  if (!html.includes('فلگ دیواری') || !html.includes('wall-flag')) throw new Error('Dynamic navbar submenu missing');
  if (!html.includes('فلگ آزمایشی') || !html.includes('/product/1')) throw new Error('EJS product rendering failed');

  const serializers = require('../services/serializers');
  const serializedOrder = serializers.order({
    orderNumber: 'TEST-1', customer: 'کاربر تست', phone: '09120000000', createdAt: new Date(),
    subtotal: 1000000, shipping: 0, discount: 100000, total: 900000,
    couponCode: 'SAVE10', customerNote: 'لطفاً قبل از ارسال تماس بگیرید.', items: []
  });
  if (serializedOrder.couponCode !== 'SAVE10' || serializedOrder.discount !== 100000 || !serializedOrder.customerNote) {
    throw new Error('Order discount/note serialization failed');
  }

  console.log('Smoke OK: category API, dynamic routes, ready DB filtering, order discount/note serialization, and guards');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
