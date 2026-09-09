const env = require('../config/env');

let cachedAccessToken = '';
let accessTokenExpiresAt = 0;

class TorobPayError extends Error {
  constructor(message, { status = 502, code, data } = {}) {
    super(message);
    this.name = 'TorobPayError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

const toRial = toman => Math.round(Number(toman || 0) * 10);

function assertConfigured() {
  const missing = [];
  if (!env.torobPayClientId) missing.push('TOROBPAY_CLIENT_ID');
  if (!env.torobPayClientSecret) missing.push('TOROBPAY_CLIENT_SECRET');
  if (!env.torobPayUsername) missing.push('TOROBPAY_USERNAME');
  if (!env.torobPayPassword) missing.push('TOROBPAY_PASSWORD');
  if (missing.length) throw new TorobPayError(`تنظیمات ترب‌پی ناقص است: ${missing.join('، ')}`, { status: 500 });
}

function withTimeout(ms = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = { raw: text }; }

  if (!response.ok || body?.successful === false) {
    const error = body?.error || {};
    const message = error.user_message || error.message || body?.message || `خطای ترب‌پی با کد HTTP ${response.status}`;
    throw new TorobPayError(message, {
      status: response.status >= 400 && response.status < 600 ? response.status : 502,
      code: error.code,
      data: body
    });
  }
  return body;
}

async function fetchJson(url, options = {}) {
  const timeout = withTimeout();
  try {
    const response = await fetch(url, { ...options, signal: timeout.signal });
    return await parseResponse(response);
  } catch (error) {
    if (error?.name === 'AbortError') throw new TorobPayError('زمان پاسخ‌گویی ترب‌پی به پایان رسید');
    if (error instanceof TorobPayError) throw error;
    throw new TorobPayError(`ارتباط با ترب‌پی برقرار نشد: ${error?.message || 'خطای شبکه'}`);
  } finally {
    timeout.clear();
  }
}

async function getAccessToken({ force = false } = {}) {
  assertConfigured();
  if (!force && cachedAccessToken && Date.now() < accessTokenExpiresAt) return cachedAccessToken;

  const basic = Buffer.from(`${env.torobPayClientId}:${env.torobPayClientSecret}`, 'utf8').toString('base64');
  const body = await fetchJson(`${env.torobPayBaseUrl}/api/online/v1/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: env.torobPayUsername,
      password: env.torobPayPassword
    })
  });

  const token = body?.access_token || body?.response?.access_token;
  if (!token) throw new TorobPayError('توکن دسترسی معتبر از ترب‌پی دریافت نشد');

  cachedAccessToken = token;
  // مستندات اعتبار یک‌ساعته اعلام کرده‌اند؛ ۵ دقیقه حاشیه امن در نظر گرفته شده است.
  accessTokenExpiresAt = Date.now() + 55 * 60 * 1000;
  return token;
}

async function authenticatedRequest(path, { method = 'GET', body, retryAuth = true } = {}) {
  const token = await getAccessToken();
  try {
    return await fetchJson(`${env.torobPayBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch (error) {
    if (retryAuth && error instanceof TorobPayError && error.status === 401) {
      cachedAccessToken = '';
      accessTokenExpiresAt = 0;
      await getAccessToken({ force: true });
      return authenticatedRequest(path, { method, body, retryAuth: false });
    }
    throw error;
  }
}

function responsePayload(body) {
  return body?.response ?? body;
}

async function checkEligibility(tomanAmount) {
  const amount = toRial(tomanAmount);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new TorobPayError('مبلغ بررسی صلاحیت ترب‌پی معتبر نیست', { status: 400 });
  }
  const result = await authenticatedRequest(`/api/online/offer/v1/eligible?amount=${encodeURIComponent(amount)}`);
  return responsePayload(result);
}

function cartForOrder(order) {
  return [{
    cartId: String(order.orderNumber),
    totalAmount: toRial(order.subtotal),
    taxAmount: toRial(order.tax),
    shippingAmount: toRial(order.shipping),
    isTaxIncluded: false,
    isShipmentIncluded: Number(order.shipping || 0) > 0,
    cartItems: (order.items || []).map((item, index) => ({
      id: String(item.productId ?? item.customRequestId ?? `${order.orderNumber}-${index + 1}`),
      name: String(item.title || 'محصول').slice(0, 250),
      count: Math.max(1, Number(item.qty || 1)),
      amount: toRial(item.price),
      category: String(item.category || 'سایر').slice(0, 120),
      commissionType: 0
    }))
  }];
}

async function createPayment(order) {
  const result = await authenticatedRequest('/api/online/payment/v1/token', {
    method: 'POST',
    body: {
      amount: toRial(order.total),
      discountAmount: toRial(order.discount),
      externalSourceAmount: 0,
      mobile: order.phone,
      paymentMethodTypeDto: 'ONLINE_CREDIT',
      returnURL: `${env.siteUrl}/api/orders/torobpay/callback`,
      transactionId: String(order.orderNumber),
      cartList: cartForOrder(order),
      address: order.address,
      postalCode: order.postalCode,
      customer_full_name: order.customer,
      city: order.city,
      province: order.province,
      registration_phone_number: order.phone
    }
  });
  return responsePayload(result);
}

async function verifyPayment(paymentToken) {
  const result = await authenticatedRequest('/api/online/payment/v1/verify', {
    method: 'POST', body: { paymentToken }
  });
  return responsePayload(result);
}

async function settlePayment(paymentToken) {
  const result = await authenticatedRequest('/api/online/payment/v1/settle', {
    method: 'POST', body: { paymentToken }
  });
  return responsePayload(result);
}

async function revertPayment(paymentToken) {
  const result = await authenticatedRequest('/api/online/payment/v1/revert', {
    method: 'POST', body: { paymentToken }
  });
  return responsePayload(result);
}

async function cancelPayment(paymentToken) {
  const result = await authenticatedRequest('/api/online/payment/v1/cancel', {
    method: 'POST', body: { paymentToken }
  });
  return responsePayload(result);
}

async function getPaymentStatus(paymentToken) {
  const result = await authenticatedRequest(`/api/online/payment/v1/status?paymentToken=${encodeURIComponent(paymentToken)}`);
  return responsePayload(result);
}

async function updatePayment(paymentToken, order) {
  const result = await authenticatedRequest('/api/online/payment/v1/update', {
    method: 'POST',
    body: {
      paymentToken,
      amount: toRial(order.total),
      discountAmount: toRial(order.discount),
      externalSourceAmount: 0,
      paymentMethodTypeDto: 'ONLINE_CREDIT',
      cartList: cartForOrder(order),
      address: order.address,
      postalCode: order.postalCode,
      customer_full_name: order.customer,
      city: order.city,
      province: order.province,
      registration_phone_number: order.phone
    }
  });
  return responsePayload(result);
}

module.exports = {
  TorobPayError,
  toRial,
  checkEligibility,
  createPayment,
  verifyPayment,
  settlePayment,
  revertPayment,
  cancelPayment,
  getPaymentStatus,
  updatePayment
};
