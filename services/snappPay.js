// SnappPay (اسنپ‌پی) online merchant API client.
// Endpoints: oauth/token, offer/v1/eligible, payment/v1/{token,verify,settle,revert,status,update,cancel}.
const env = require('../config/env');

class SnappPayError extends Error {
  constructor(message, { status = 502, code, data, isTimeout = false } = {}) {
    super(message);
    this.name = 'SnappPayError';
    this.status = status;
    this.code = code;
    this.data = data;
    this.isTimeout = isTimeout;
  }
}

const toRial = toman => Math.round(Number(toman || 0) * 10);

function missingSettings() {
  const missing = [];
  if (!env.snappPayBaseUrl) missing.push('SNAPPPAY_BASE_URL');
  if (!env.snappPayClientId) missing.push('SNAPPPAY_CLIENT_ID');
  if (!env.snappPayClientSecret) missing.push('SNAPPPAY_CLIENT_SECRET');
  if (!env.snappPayUsername) missing.push('SNAPPPAY_USERNAME');
  if (!env.snappPayPassword) missing.push('SNAPPPAY_PASSWORD');
  return missing;
}

const isConfigured = () => missingSettings().length === 0;

function assertConfigured() {
  const missing = missingSettings();
  if (missing.length) throw new SnappPayError(`تنظیمات اسنپ‌پی ناقص است: ${missing.join('، ')}`, { status: 503 });
}

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = { raw: text }; }

  if (!response.ok || body?.successful === false) {
    const error = body?.errorData || body?.error || {};
    const message = error.message || body?.message || `خطای اسنپ‌پی با کد HTTP ${response.status}`;
    throw new SnappPayError(message, {
      status: response.ok ? 400 : response.status,
      code: error.errorCode ?? error.code,
      data: body
    });
  }
  return body;
}

async function fetchJson(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.snappPayTimeoutMs || 30000);
  timer.unref?.();
  try {
    const response = await fetch(`${env.snappPayBaseUrl}${path}`, { ...options, signal: controller.signal });
    return await parseResponse(response);
  } catch (error) {
    if (error?.name === 'AbortError') throw new SnappPayError('مهلت پاسخ‌گویی اسنپ‌پی به پایان رسید', { isTimeout: true });
    if (error instanceof SnappPayError) throw error;
    throw new SnappPayError(`ارتباط با اسنپ‌پی برقرار نشد: ${error?.message || 'خطای شبکه'}`);
  } finally {
    clearTimeout(timer);
  }
}

let cachedToken = '';
let cachedTokenExpiresAt = 0;
let tokenPromise = null;

async function getAccessToken({ force = false } = {}) {
  assertConfigured();
  if (!force && cachedToken && cachedTokenExpiresAt - Date.now() > 60 * 1000) return cachedToken;
  if (!force && tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    const basic = Buffer.from(`${env.snappPayClientId}:${env.snappPayClientSecret}`, 'utf8').toString('base64');
    const body = await fetchJson('/api/online/v1/oauth/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'password',
        scope: 'online-merchant',
        username: env.snappPayUsername,
        password: env.snappPayPassword
      }).toString()
    });
    if (!body?.access_token) throw new SnappPayError('توکن دسترسی معتبر از اسنپ‌پی دریافت نشد', { data: body });
    const expiresIn = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    cachedToken = body.access_token;
    cachedTokenExpiresAt = Date.now() + expiresIn * 1000;
    return cachedToken;
  })();

  try { return await tokenPromise; }
  finally { tokenPromise = null; }
}

async function apiRequest(path, { method = 'GET', body, retryAuth = true } = {}) {
  const token = await getAccessToken();
  try {
    const result = await fetchJson(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return result?.response ?? result;
  } catch (error) {
    if (retryAuth && error instanceof SnappPayError && error.status === 401) {
      cachedToken = '';
      cachedTokenExpiresAt = 0;
      await getAccessToken({ force: true });
      return apiRequest(path, { method, body, retryAuth: false });
    }
    throw error;
  }
}

// SnappPay review: `forcedPaymentMethodTypes` must never be sent to payment/v1/token.
// `paymentMethodTypeDto` is added here only, so SNAPPPAY_PAYMENT_METHOD_TYPE_DTO= can switch it off.
function paymentBody(payload = {}) {
  const { forcedPaymentMethodTypes: _forced, paymentMethodTypeDto: _dto, ...rest } = payload;
  return {
    ...rest,
    ...(env.snappPayPaymentMethodTypeDto ? { paymentMethodTypeDto: env.snappPayPaymentMethodTypeDto } : {})
  };
}

// Called exactly like SnappPay's sample: offer/v1/eligible?amount=<IRR>.
async function eligible(amountIrr) {
  const amount = Math.round(Number(amountIrr));
  if (!Number.isInteger(amount) || amount <= 0) throw new SnappPayError('مبلغ بررسی اسنپ‌پی معتبر نیست', { status: 400 });
  return apiRequest(`/api/online/offer/v1/eligible?amount=${encodeURIComponent(amount)}`);
}

const createPaymentToken = payload => apiRequest('/api/online/payment/v1/token', { method: 'POST', body: paymentBody(payload) });
const verify = paymentToken => apiRequest('/api/online/payment/v1/verify', { method: 'POST', body: { paymentToken } });
const settle = paymentToken => apiRequest('/api/online/payment/v1/settle', { method: 'POST', body: { paymentToken } });
// Revert is only valid between a successful verify and settle.
const revert = paymentToken => apiRequest('/api/online/payment/v1/revert', { method: 'POST', body: { paymentToken } });
const update = payload => apiRequest('/api/online/payment/v1/update', { method: 'POST', body: paymentBody(payload) });
const cancel = paymentToken => apiRequest('/api/online/payment/v1/cancel', { method: 'POST', body: { paymentToken } });
const getPaymentStatus = paymentToken =>
  apiRequest(`/api/online/payment/v1/status?paymentToken=${encodeURIComponent(paymentToken)}`);

const normalizeStatus = value => String(value || '').trim().toUpperCase();

async function statusAfterUnknown(paymentToken, originalError) {
  try {
    const result = await getPaymentStatus(paymentToken);
    return { result, status: normalizeStatus(result?.status) };
  } catch (statusError) {
    originalError.statusRecoveryError = statusError;
    throw originalError;
  }
}

// Get Payment Status recovery for verify:
// verify → no/unknown response → status: VERIFY or SETTLE ⇒ already verified, PENDING ⇒ verify once more.
async function verifyWithRecovery(paymentToken) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await verify(paymentToken);
      return { ...result, status: 'VERIFY' };
    } catch (error) {
      lastError = error;
      const { result, status } = await statusAfterUnknown(paymentToken, error);
      if (status === 'VERIFY' || status === 'SETTLE') return { ...result, status };
      if (status === 'PENDING' && attempt === 0) continue;
      throw error;
    }
  }
  throw lastError;
}

// settle → no/unknown response → status: SETTLE ⇒ done, VERIFY ⇒ settle once more.
async function settleWithStatusRecovery(paymentToken) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await settle(paymentToken);
      return { ...result, status: 'SETTLE' };
    } catch (error) {
      lastError = error;
      const { result, status } = await statusAfterUnknown(paymentToken, error);
      if (status === 'SETTLE') return { ...result, status };
      if (status === 'VERIFY' && attempt === 0) continue;
      throw error;
    }
  }
  throw lastError;
}

module.exports = {
  SnappPayError,
  toRial,
  isConfigured,
  eligible,
  createPaymentToken,
  verify,
  settle,
  revert,
  update,
  cancel,
  getPaymentStatus,
  verifyWithRecovery,
  settleWithStatusRecovery,
  normalizeStatus
};
