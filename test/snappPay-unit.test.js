// SnappPay: API client contract, payload formula, partial-return discount and
// Get Payment Status decisions.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const requests = [];
const verifyAttempts = new Map();
const settleAttempts = new Map();
let server;

const json = (res, value, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
};

test.before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const token = body.startsWith('{') ? JSON.parse(body).paymentToken : null;
      if (req.url === '/api/online/v1/oauth/token') return json(res, { access_token: 'access', expires_in: 3600 });
      if (req.url.startsWith('/api/online/offer/v1/eligible')) {
        return json(res, { successful: true, response: { eligible: true, title_message: 'پرداخت قسطی و اعتباری با اسنپ‌پی', description: '۴ قسط بدون کارمزد، ماهانه ۱٬۰۰۰ تومان' } });
      }
      if (req.url === '/api/online/payment/v1/token') return json(res, { successful: true, response: { paymentToken: 'tok', paymentPageUrl: 'https://pay.example/tok' } });
      if (req.url.startsWith('/api/online/payment/v1/status')) {
        const t = new URL(req.url, 'http://x').searchParams.get('paymentToken');
        const status = { 'lost-verify': 'VERIFY', 'pending-once': 'PENDING', 'lost-settle': 'SETTLE', 'retry-settle': 'VERIFY' }[t] || 'PENDING';
        return json(res, { successful: true, response: { status, transactionId: 'KR-1' } });
      }
      if (req.url === '/api/online/payment/v1/verify') {
        const n = (verifyAttempts.get(token) || 0) + 1;
        verifyAttempts.set(token, n);
        if (token === 'lost-verify' || (token === 'pending-once' && n === 1)) return json(res, { successful: false, errorData: { message: 'lost' } });
        return json(res, { successful: true, response: { transactionId: 'KR-1' } });
      }
      if (req.url === '/api/online/payment/v1/settle') {
        const n = (settleAttempts.get(token) || 0) + 1;
        settleAttempts.set(token, n);
        if (token === 'lost-settle' || (token === 'retry-settle' && n === 1)) return json(res, { successful: false, errorData: { message: 'lost' } });
        return json(res, { successful: true, response: { transactionId: 'KR-1' } });
      }
      return json(res, { successful: true, response: { transactionId: 'KR-1' } });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, {
    SNAPPPAY_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    SNAPPPAY_CLIENT_ID: 'client', SNAPPPAY_CLIENT_SECRET: 'secret',
    SNAPPPAY_USERNAME: 'user', SNAPPPAY_PASSWORD: 'pass'
  });
  delete require.cache[require.resolve('../config/env')];
  delete require.cache[require.resolve('../services/snappPay')];
});
test.after(() => new Promise(resolve => server.close(resolve)));

const service = () => require('../services/snappPay');
const bodyOf = path => JSON.parse(requests.find(r => r.url === path).body);

test('eligible و token دقیقاً طبق قرارداد اسنپ‌پی ارسال می‌شوند', async () => {
  const snappPay = service();
  const eligibility = await snappPay.eligible(40000);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.title_message, 'پرداخت قسطی و اعتباری با اسنپ‌پی');
  assert.ok(requests.some(r => r.url === '/api/online/offer/v1/eligible?amount=40000'));

  const auth = requests.find(r => r.url === '/api/online/v1/oauth/token');
  assert.match(auth.headers.authorization, /^Basic /);
  assert.match(auth.body, /grant_type=password/);
  assert.match(auth.body, /scope=online-merchant/);

  await snappPay.createPaymentToken({ amount: 1000, forcedPaymentMethodTypes: ['INSTALLMENT'] });
  // SnappPay review #2: forcedPaymentMethodTypes is never sent.
  assert.deepEqual(bodyOf('/api/online/payment/v1/token'), { amount: 1000, paymentMethodTypeDto: 'INSTALLMENT' });

  await snappPay.update({ paymentToken: 'tok', amount: 900 });
  assert.deepEqual(bodyOf('/api/online/payment/v1/update'), { paymentToken: 'tok', amount: 900, paymentMethodTypeDto: 'INSTALLMENT' });
  await snappPay.revert('tok');
  await snappPay.cancel('tok');
  assert.deepEqual(bodyOf('/api/online/payment/v1/revert'), { paymentToken: 'tok' });
  assert.deepEqual(bodyOf('/api/online/payment/v1/cancel'), { paymentToken: 'tok' });
});

test('بازیابی Get Payment Status برای verify و settle', async () => {
  const snappPay = service();
  assert.equal((await snappPay.verifyWithRecovery('ok')).status, 'VERIFY');
  assert.equal((await snappPay.verifyWithRecovery('lost-verify')).status, 'VERIFY');
  assert.equal((await snappPay.verifyWithRecovery('pending-once')).status, 'VERIFY');
  assert.equal(verifyAttempts.get('pending-once'), 2);
  assert.equal((await snappPay.settleWithStatusRecovery('lost-settle')).status, 'SETTLE');
  assert.equal((await snappPay.settleWithStatusRecovery('retry-settle')).status, 'SETTLE');
  assert.equal(settleAttempts.get('retry-settle'), 2);
});

const { buildSnappPayPayload, recalculateDiscount, countUnits, snappPayMobile, snappItemId } = require('../services/snappPayPricing');
const { resolveSnappPayAction } = require('../services/snappPayReconciler');

// SnappPay test scenario: regular product ×2, discounted product ×1, high-percent coupon.
const regular = { productId: 11, title: 'پرچم معمولی', category: 'پرچم', price: 30000, qty: 2, size: 'A', fabric: 'مخمل' };
const special = { productId: 12, title: 'پرچم تخفیف‌دار', category: 'پرچم', price: 20000, qty: 1, size: 'A', fabric: 'مخمل' };

test('payload سناریوی تست با فرمول total/amount اسنپ‌پی یکی است', () => {
  const items = [regular, special];
  const subtotal = 80000;
  const discount = Math.round(subtotal * 50 / 100);
  const payload = buildSnappPayPayload({ orderNumber: 'KR-12345', items, shipping: 0, discount, total: subtotal - discount });
  const cart = payload.cartList[0];
  assert.equal(cart.totalAmount, cart.cartItems.reduce((sum, item) => sum + item.count * item.amount, 0));
  assert.equal(payload.amount, cart.totalAmount - payload.discountAmount - payload.externalSourceAmount);
  assert.equal(payload.amount, 400000);
  assert.equal(cart.isTaxIncluded, true);
  assert.equal(cart.isShipmentIncluded, true);
  assert.equal(cart.shippingAmount, 0);
  assert.equal(cart.taxAmount, 0);
  assert.deepEqual(cart.cartItems.map(i => [i.count, i.amount]), [[2, 300000], [1, 200000]]);
  assert.ok(Number.isInteger(cart.cartId) && cart.cartId > 0);
  assert.equal('forcedPaymentMethodTypes' in payload, false);
});

test('هزینه ارسال آنلاین (در صورت وجود) جدا و طبق فرمول اضافه می‌شود', () => {
  const payload = buildSnappPayPayload({ orderNumber: 'KR-1', items: [regular], shipping: 5000, discount: 0 });
  const cart = payload.cartList[0];
  assert.equal(cart.isShipmentIncluded, false);
  assert.equal(cart.shippingAmount, 50000);
  assert.equal(cart.totalAmount, 650000);
  assert.equal(payload.amount, 650000);
});

test('شناسه آیتم برای تنوع‌های مختلف یک محصول و طرح اختصاصی یکتا و پایدار است', () => {
  const a = snappItemId(regular);
  assert.equal(a, snappItemId({ ...regular }));
  assert.notEqual(a, snappItemId({ ...regular, size: 'B' }));
  assert.notEqual(a, snappItemId({ customRequestId: 'CR-1' }));
  assert.equal(snappPayMobile('09121234567'), '+989121234567');
});

test('آپدیت دو مرحله‌ای سناریو: تخفیف درصدی بازمحاسبه و تک‌آیتم فقط کنسل', () => {
  const coupon = { type: 'percent', value: 50 };
  const step1 = [{ ...regular, qty: 1 }, special];
  const d1 = recalculateDiscount({ coupon, previousItems: [regular, special], nextItems: step1, previousDiscount: 40000 });
  assert.equal(d1, 25000);
  const step2 = [{ ...regular, qty: 1 }];
  const d2 = recalculateDiscount({ coupon, previousItems: step1, nextItems: step2, previousDiscount: d1 });
  assert.equal(d2, 15000);
  assert.equal(buildSnappPayPayload({ orderNumber: 'KR-1', items: step2, shipping: 0, discount: d2 }).amount, 150000);
  assert.equal(countUnits(step2), 1);
});

test('کد مبلغ ثابت به نسبت سرشکن و کد محدود به تنوع فقط روی اقلام مجاز حساب می‌شود', () => {
  const fixed = recalculateDiscount({
    coupon: { type: 'fixed', value: 50000 },
    previousItems: [{ price: 70000, qty: 1 }, { price: 30000, qty: 1 }],
    nextItems: [{ price: 70000, qty: 1 }],
    previousDiscount: 50000
  });
  assert.equal(fixed, 35000);
  const limited = recalculateDiscount({
    coupon: { type: 'percent', value: 10, applicability: 'variants' },
    previousItems: [regular, special],
    nextItems: [special],
    previousDiscount: 6000,
    isEligible: (_coupon, item) => item.productId === 11
  });
  assert.equal(limited, 0);
});

test('تصمیم‌های Get Payment Status خودکار', () => {
  const fresh = 20 * 60 * 1000, old = 3 * 60 * 60 * 1000;
  assert.equal(resolveSnappPayAction({ status: 'SETTLE', ageMs: old }), 'settled');
  assert.equal(resolveSnappPayAction({ status: 'VERIFY', ageMs: fresh }), 'settle');
  assert.equal(resolveSnappPayAction({ status: 'PENDING', ageMs: fresh }), 'verify');
  assert.equal(resolveSnappPayAction({ status: 'PENDING', ageMs: old }), 'expire');
  assert.equal(resolveSnappPayAction({ status: 'REVERT', ageMs: fresh }), 'cancelled');
  assert.equal(resolveSnappPayAction({ status: '', ageMs: fresh }), 'wait');
});
