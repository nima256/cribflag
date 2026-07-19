process.env.SESSION_STORE = 'memory';
process.env.NODE_ENV = 'test';

const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const app = require('../server');
const Product = require('../models/Product');

const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
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
  Product.find = () => ({
    sort: () => ({
      lean: async () => Array.from({ length: 6 }, (_, index) => ({
        publicId: index + 1,
        title: `فلگ آزمایشی ${index + 1}`,
        sku: `TEST-${index + 1}`,
        category: 'فلگ دیواری',
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
  const routedHome = await request(app).get('/').expect(200);
  Product.find = originalFind;
  if (!routedHome.text.includes('فلگ آزمایشی 1') || !routedHome.text.includes('/product/1')) throw new Error('Express EJS product route failed');
  if (!routedHome.text.includes('فلگ دیواری') || !routedHome.text.includes('استیکر مخمل')) throw new Error('Express navbar route failed');

  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'index.ejs'), {
    products: [product, product, product, product, product],
    readyDesigns: [],
    currentUser: null,
    product: null,
    nextUrl: '',
    paymentFailed: false,
    toFa: value => new Intl.NumberFormat('fa-IR').format(Number(value || 0)),
    toman: value => `${new Intl.NumberFormat('fa-IR').format(Number(value || 0))} تومان`,
    safeJson
  });
  if (!html.includes('فلگ دیواری') || !html.includes('استیکر مخمل')) throw new Error('Navbar submenu missing');
  if (!html.includes('فلگ آزمایشی') || !html.includes('/product/1')) throw new Error('EJS product rendering failed');

  console.log('Smoke OK: Express EJS routes + checkout guard + anonymous order guard');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
