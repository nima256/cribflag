// Route-level SnappPay tests (callback, automatic reconciliation, admin update/cancel)
// with in-memory fakes for the models and SnappPay API — no MongoDB or network needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

// ---------------------------------------------------------------- fakes
const getPath = (obj, key) => key.split('.').reduce((value, part) => (value == null ? undefined : value[part]), obj);
const setPath = (obj, key, value) => {
  const parts = key.split('.');
  const last = parts.pop();
  parts.reduce((value, part) => (value[part] ??= {}), obj)[last] = value;
};
const unsetPath = (obj, key) => {
  const parts = key.split('.');
  const last = parts.pop();
  const target = parts.reduce((value, part) => value?.[part], obj);
  if (target) delete target[last];
};
const matches = (doc, filter) => Object.entries(filter).every(([key, condition]) => {
  if (key === '$or') return condition.some(sub => matches(doc, sub));
  const value = getPath(doc, key);
  if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
    return Object.entries(condition).every(([op, operand]) => {
      if (op === '$ne') return value !== operand;
      if (op === '$lt') return value instanceof Date && value < operand;
      if (op === '$lte') return value instanceof Date && value <= operand;
      if (op === '$in') return operand.includes(value);
      if (op === '$exists') return operand ? value !== undefined : value === undefined;
      throw new Error(`unsupported ${op}`);
    });
  }
  return String(value) === String(condition);
});

const store = new Map();
const makeOrder = fields => {
  const doc = {
    _id: `id-${fields.orderNumber}`,
    payment: 'پرداخت اقساطی اسنپ‌پی',
    status: 'processing',
    paymentStatus: 'pending',
    shipping: 0,
    discount: 0,
    tax: 0,
    paymentInfo: {},
    inventoryApplied: false,
    createdAt: new Date(),
    shippingMethod: 'تیپاکس',
    ...fields,
    snappPay: { processing: false, updateHistory: [], ...fields.snappPay },
    async save() { store.set(String(this._id), this); return this; }
  };
  store.set(String(doc._id), doc);
  return doc;
};
const applyUpdate = (doc, update) => {
  for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, value);
  for (const key of Object.keys(update.$unset || {})) unsetPath(doc, key);
};
const FakeOrder = {
  async findOne(filter) { return [...store.values()].find(doc => matches(doc, filter)) || null; },
  async findById(id) { return store.get(String(id)) || null; },
  async findOneAndUpdate(filter, update) {
    const doc = [...store.values()].find(item => matches(item, filter));
    if (!doc) return null;
    applyUpdate(doc, update);
    return doc;
  },
  async updateOne(filter, update) {
    const doc = [...store.values()].find(item => matches(item, filter));
    if (!doc) return { modifiedCount: 0 };
    // notifyOrderRegistered SMS lock: report "not acquired" so no SMS is attempted.
    if (update.$set && 'orderRegisteredSmsLockAt' in update.$set) return { modifiedCount: 0 };
    applyUpdate(doc, update);
    return { modifiedCount: 1 };
  },
  async deleteOne() { return { deletedCount: 1 }; },
  find(filter) {
    const result = [...store.values()].filter(doc => matches(doc, filter));
    const chain = { select: () => chain, sort: () => chain, limit: () => chain, lean: async () => result.map(doc => ({ _id: doc._id })) };
    return chain;
  }
};

const calls = [];
const inventory = { applied: [], released: [], restocked: [], failApplyFor: new Set() };
const gateway = { status: new Map(), verifyFails: new Set() };
const fakeSnappPay = {
  toRial: toman => Math.round(Number(toman || 0) * 10),
  isConfigured: () => true,
  normalizeStatus: value => String(value || '').trim().toUpperCase(),
  async getPaymentStatus(token) { calls.push(['status', token]); return { status: gateway.status.get(token) || 'PENDING' }; },
  async verifyWithRecovery(token) {
    calls.push(['verify', token]);
    if (gateway.verifyFails.has(token)) throw new Error('verify failed');
    if (gateway.status.get(token) === 'SETTLE') return { status: 'SETTLE' };
    gateway.status.set(token, 'VERIFY');
    return { status: 'VERIFY', transactionId: undefined };
  },
  async settleWithStatusRecovery(token) { calls.push(['settle', token]); gateway.status.set(token, 'SETTLE'); return { status: 'SETTLE' }; },
  async verify(token) { calls.push(['verify-only', token]); return {}; },
  async revert(token) { calls.push(['revert', token]); gateway.status.set(token, 'REVERT'); return {}; },
  async update(payload) { calls.push(['update', payload]); return {}; },
  async cancel(token) { calls.push(['cancel', token]); gateway.status.set(token, 'CANCEL'); return {}; },
  async eligible(amount) {
    calls.push(['eligible', amount]);
    return { eligible: amount <= 1000000, title_message: 'پرداخت قسطی و اعتباری با اسنپ‌پی', description: '۴ قسط بدون کارمزد، ماهانه ۱۵٬۰۰۰ تومان' };
  }
};

const stub = (relativePath, exports) => {
  const resolved = require.resolve(path.join(__dirname, '..', relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stub('models/Order.js', FakeOrder);
const customer = { _id: 'user-1', isActive: true, mobile: '09121234567', fullName: 'مشتری تست' };
stub('models/User.js', {
  findById: () => ({ then: (resolve, reject) => Promise.resolve(customer).then(resolve, reject), select: () => ({ lean: async () => customer }) })
});
stub('models/Product.js', {
  findOne: async ({ publicId }) => ({ publicId, title: `محصول ${publicId}`, category: 'پرچم', categories: [], inventoryMode: 'unlimited', stock: 0, sizes: ['A'], fabrics: ['مخمل'], variantPrices: [], price: 30000 }),
  updateOne: async () => ({ modifiedCount: 1 })
});
stub('models/Coupon.js', { findOne: () => ({ lean: async () => ({ code: 'TEST50', type: 'percent', value: 50, applicability: 'all' }) }) });
stub('services/snappPay.js', fakeSnappPay);
stub('services/inventory.js', {
  async applyInventory(order) {
    if (inventory.failApplyFor.has(order.orderNumber)) throw new Error('out of stock');
    inventory.applied.push(order.orderNumber); order.inventoryApplied = true; return true;
  },
  async releaseInventory(order) { inventory.released.push(order.orderNumber); order.inventoryApplied = false; return true; },
  async restockReturnedItems(order, returned) { inventory.restocked.push([order.orderNumber, returned.map(i => [i.title, i.qty])]); return true; }
});
stub('services/coupons.js', { consumeCoupon: async () => true, releaseCoupon: async () => true });
stub('services/customOrderSync.js', {
  syncCustomRequestsFromOrder: async () => {},
  hydrateCustomRequestsWithOrders: async items => items,
  CUSTOM_PAYMENT_STATUSES: new Set(), ORDER_PAYMENT_STATUSES: new Set()
});
stub('middlewares/auth.js', {
  requireAdmin: (_req, _res, next) => next(),
  requireUser: (_req, _res, next) => next(),
  logoutAdminOnly: async () => {}
});

const ordersRouter = require('../routes/orders');
const adminRouter = require('../routes/admin');

let server, baseUrl;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => { req.session = { adminId: 'admin-1' }; next(); });
  app.use('/api/orders', ordersRouter);
  app.use('/api/admin', adminRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, message: err.message }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));
test.beforeEach(() => { calls.length = 0; });

const callback = fields => fetch(`${baseUrl}/api/orders/snappay/callback`, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString()
});
const adminPost = (orderNumber, action, body) => fetch(`${baseUrl}/api/admin/orders/${orderNumber}/snappay/${action}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(async res => ({ status: res.status, body: await res.json() }));

const items = () => ([
  { productId: 11, title: 'پرچم معمولی', category: 'پرچم', price: 30000, qty: 2, size: 'A', fabric: 'مخمل', inventoryManaged: true },
  { productId: 12, title: 'پرچم تخفیف‌دار', category: 'پرچم', price: 20000, qty: 1, size: 'A', fabric: 'مخمل', inventoryManaged: true }
]);
const pending = (orderNumber, extra = {}) => makeOrder({
  orderNumber, items: items(), subtotal: 80000, discount: 40000, total: 40000, couponCode: 'TEST50',
  snappPay: { paymentToken: `tok-${orderNumber}`, transactionId: orderNumber, status: 'PENDING' }, ...extra
});

// ---------------------------------------------------------------- callback
test('callback موفق: verify → کسر موجودی → settle → نمایش شناسه تراکنش', async () => {
  const order = pending('KR-10001');
  const res = await callback({ transactionId: 'KR-10001', state: 'OK', amount: '400000' });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /payment\/success\?order=KR-10001.*refId=KR-10001.*gateway=snappay/);
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.snappPay.status, 'SETTLE');
  assert.equal(order.snappPay.processing, false);
  assert.deepEqual(calls.map(c => c[0]), ['verify', 'settle']);
  assert.ok(inventory.applied.includes('KR-10001'));
});

test('callback تکراری دوباره verify/settle نمی‌کند', async () => {
  const res = await callback({ transactionId: 'KR-10001', state: 'OK', amount: '400000' });
  assert.match(res.headers.get('location'), /payment\/success/);
  assert.equal(calls.length, 0);
});

test('ناموجود شدن کالا بین verify و settle: پرداخت revert و سفارش لغو می‌شود', async () => {
  const order = pending('KR-10002');
  inventory.failApplyFor.add('KR-10002');
  const res = await callback({ transactionId: 'KR-10002', state: 'OK' });
  assert.match(res.headers.get('location'), /payment\/failed.*reason=inventory/);
  assert.deepEqual(calls.map(c => c[0]), ['verify', 'revert']);
  assert.equal(order.status, 'cancelled');
  assert.equal(order.snappPay.status, 'REVERT');
});

test('callback ناموفق پس از استعلام وضعیت، سفارش را لغو می‌کند', async () => {
  const order = pending('KR-10003');
  const res = await callback({ transactionId: 'KR-10003', state: 'FAILED' });
  assert.match(res.headers.get('location'), /payment\/failed/);
  assert.equal(order.paymentStatus, 'failed');
  assert.deepEqual(calls.map(c => c[0]), ['status']);
});

test('FAILED جعلی پرداخت واقعی را لغو نمی‌کند', async () => {
  const order = pending('KR-10004');
  gateway.status.set('tok-KR-10004', 'VERIFY');
  const res = await callback({ transactionId: 'KR-10004', state: 'FAILED' });
  assert.match(res.headers.get('location'), /payment\/success/);
  assert.equal(order.paymentStatus, 'paid');
});

test('مبلغ دستکاری‌شده تأیید نمی‌شود و برای استعلام خودکار باز می‌ماند', async () => {
  const order = pending('KR-10005');
  const res = await callback({ transactionId: 'KR-10005', state: 'OK', amount: '10' });
  assert.match(res.headers.get('location'), /payment\/pending/);
  assert.equal(order.paymentStatus, 'review');
  assert.equal(order.snappPay.processing, false);
  assert.equal(calls.length, 0);
});

test('پرداخت دیرهنگام روی سفارش منقضی‌شده revert می‌شود', async () => {
  const order = pending('KR-10006', { status: 'cancelled', paymentStatus: 'failed' });
  const res = await callback({ transactionId: 'KR-10006', state: 'OK' });
  assert.match(res.headers.get('location'), /payment\/failed/);
  assert.deepEqual(calls.map(c => c[0]), ['verify-only', 'revert']);
  assert.equal(order.snappPay.status, 'REVERT');
});

test('قفل پردازش: callback هم‌زمان به صفحه در حال بررسی می‌رود', async () => {
  const order = pending('KR-10007');
  order.snappPay.processing = true;
  order.snappPay.processingStartedAt = new Date();
  const res = await callback({ transactionId: 'KR-10007', state: 'OK' });
  assert.match(res.headers.get('location'), /payment\/pending/);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------- reconciler
test('استعلام خودکار: پرداخت بدون بازگشت تسویه، VERIFY تسویه، رهاشده منقضی', async () => {
  const old = new Date(Date.now() - 20 * 60 * 1000);
  const paid = pending('KR-20001', { createdAt: old });
  const verified = pending('KR-20002', { createdAt: old });
  gateway.status.set('tok-KR-20002', 'VERIFY');
  const abandoned = pending('KR-20003', { createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });
  const fresh = pending('KR-20004');
  store.get('id-KR-10007').snappPay.processing = false;

  await ordersRouter.reconcileOpenSnappPayOrders();
  assert.equal(paid.paymentStatus, 'paid');
  assert.equal(verified.paymentStatus, 'paid');
  assert.equal(abandoned.status, 'cancelled');
  assert.equal(fresh.paymentStatus, 'pending');
  assert.ok(!calls.some(([, token]) => token === 'tok-KR-20004'));
});

// ---------------------------------------------------------------- admin update / cancel
test('ادمین: بدون تأیید مجدد هیچ درخواستی به اسنپ‌پی نمی‌رود', async () => {
  const res = await adminPost('KR-10001', 'update', { items: [{ index: 0, qty: 1 }] });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('ادمین: آپدیت دو مرحله‌ای، سپس دکمه آپدیت بسته و کنسل روی سفارش آپدیت‌شده', async () => {
  gateway.status.set('tok-KR-10001', 'SETTLE');
  const order = store.get('id-KR-10001');

  const step1 = await adminPost('KR-10001', 'update', { confirmed: true, items: [{ index: 0, qty: 1 }] });
  assert.equal(step1.status, 200, step1.body.message);
  const update1 = calls.find(c => c[0] === 'update')[1];
  assert.equal(update1.paymentToken, 'tok-KR-10001');
  assert.equal(update1.amount, 250000);
  assert.equal(update1.discountAmount, 250000);
  assert.equal(update1.cartList[0].totalAmount, 500000);
  assert.equal(order.total, 25000);

  calls.length = 0;
  const step2 = await adminPost('KR-10001', 'update', { confirmed: true, items: [{ index: 1, qty: 0 }] });
  assert.equal(step2.status, 200, step2.body.message);
  assert.equal(calls.find(c => c[0] === 'update')[1].amount, 150000);
  assert.equal(order.items.length, 1);
  assert.equal(order.snappPay.updateHistory.length, 2);
  assert.deepEqual(inventory.restocked.filter(r => r[0] === 'KR-10001').map(r => r[1]), [[['پرچم معمولی', 1]], [['پرچم تخفیف‌دار', 1]]]);

  calls.length = 0;
  const blocked = await adminPost('KR-10001', 'update', { confirmed: true, items: [{ index: 0, qty: 0 }] });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.message, /فقط یک آیتم/);
  assert.equal(calls.length, 0);

  const cancelled = await adminPost('KR-10001', 'cancel', { confirmed: true });
  assert.equal(cancelled.status, 200, cancelled.body.message);
  assert.deepEqual(calls.filter(c => c[0] === 'cancel'), [['cancel', 'tok-KR-10001']]);
  assert.equal(order.status, 'cancelled');
  assert.equal(order.paymentStatus, 'refunded');
  assert.equal(order.snappPay.status, 'CANCEL');
});

test('ادمین: افزایش تعداد یا آپدیت سفارش پرداخت‌نشده رد می‌شود', async () => {
  const order = pending('KR-30001', { paymentStatus: 'paid', snappPay: { paymentToken: 'tok-KR-30001', status: 'SETTLE' } });
  gateway.status.set('tok-KR-30001', 'SETTLE');
  const increase = await adminPost('KR-30001', 'update', { confirmed: true, items: [{ index: 0, qty: 3 }] });
  assert.equal(increase.status, 400);
  order.paymentStatus = 'pending';
  const unpaid = await adminPost('KR-30001', 'update', { confirmed: true, items: [{ index: 0, qty: 1 }] });
  assert.equal(unpaid.status, 409);
  assert.ok(!calls.some(c => c[0] === 'update'));
});

// ---------------------------------------------------------------- eligibility
const eligibility = body => fetch(`${baseUrl}/api/orders/snappay/eligibility`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(res => res.json());

test('eligible با مبلغ نهایی محاسبه‌شده در سرور و متن‌های پاسخ بدون تغییر', async () => {
  const cart = { expectedItemCount: 1, expectedCustomRequestIds: [], items: [{ id: 11, qty: 2, size: 'A', fabric: 'مخمل' }] };
  const ok = await eligibility(cart);
  assert.equal(ok.eligible, true);
  assert.equal(ok.title_message, 'پرداخت قسطی و اعتباری با اسنپ‌پی');
  assert.equal(ok.description, '۴ قسط بدون کارمزد، ماهانه ۱۵٬۰۰۰ تومان');
  // 2 × 30,000 toman → 600,000 IRR, ignoring any client-side price.
  assert.deepEqual(calls.find(c => c[0] === 'eligible'), ['eligible', 600000]);

  const tooMuch = await eligibility({ ...cart, items: [{ id: 11, qty: 40, size: 'A', fabric: 'مخمل', price: 1 }] });
  assert.equal(tooMuch.eligible, false);
});
