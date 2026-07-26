const https = require('https');
const env = require('../config/env');
const { normalizeMobile } = require('../utils/formatters');

const ORDER_REGISTERED_BODY_ID = 502826;
const ORDER_ADMIN_MOBILES = ['09014968828', '09054243464'];

function normalizeArgs(args) {
  return (Array.isArray(args) ? args : []).map(value => String(value ?? '').trim());
}

function normalizeRecipient(value) {
  const mobile = normalizeMobile(value);
  if (!/^09\d{9}$/.test(mobile)) {
    throw new Error(`شماره موبایل پیامک معتبر نیست: ${String(value ?? '')}`);
  }
  return mobile;
}

function normalizeRecipientList(values) {
  const recipients = [];
  for (const value of Array.isArray(values) ? values : []) {
    try {
      recipients.push(normalizeRecipient(value));
    } catch (_error) {
      // مقادیر قدیمی و نامعتبر نباید مانع تلاش مجدد برای گیرنده‌های معتبر شوند.
    }
  }
  return [...new Set(recipients)];
}

function sendPatternSmsWithBodyId(to, args, bodyId) {
  const recipient = normalizeRecipient(to);
  const normalizedArgs = normalizeArgs(args);
  if (!env.melipayamakSharedKey) {
    if (!env.isProduction) {
      console.log(`[DEV SMS] bodyId=${bodyId} to=${recipient} args=${normalizedArgs.join(',')}`);
    }
    return Promise.resolve({ mocked: true, to: recipient });
  }

  const payload = JSON.stringify({ bodyId, to: recipient, args: normalizedArgs });
  const options = {
    hostname: 'console.melipayamak.com', port: 443,
    path: `/api/send/shared/${env.melipayamakSharedKey}`, method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) }
  };

  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => response.statusCode >= 200 && response.statusCode < 300
        ? resolve({ mocked: false, to: recipient, body })
        : reject(new Error(`خطای سامانه پیامک برای ${recipient}: ${response.statusCode} ${body}`)));
    });
    request.on('error', reject);
    request.write(payload, 'utf8');
    request.end();
  });
}

function sendPatternSms(to, args) {
  return sendPatternSmsWithBodyId(to, args, env.melipayamakBodyId);
}

function formatOrderItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(item => `${String(item?.title || 'کالا').trim()} (${Math.max(1, Number(item?.qty || 1))} عدد)`)
    .join('، ');
}

function formatOrderAmount(amount) {
  const numericAmount = Math.max(0, Number(amount) || 0);
  return `${new Intl.NumberFormat('fa-IR').format(numericAmount)} تومان`;
}

async function sendOrderRegisteredSms(order, options = {}) {
  const customerMobile = normalizeRecipient(options.customerMobile || order.phone);
  const recipients = [...new Set([customerMobile, ...ORDER_ADMIN_MOBILES].map(normalizeRecipient))];
  const alreadySentRecipients = new Set(normalizeRecipientList(options.alreadySentRecipients));
  const attemptedRecipients = recipients.filter(to => !alreadySentRecipients.has(to));
  const args = [
    order.customer,
    order.orderNumber,
    formatOrderItems(order.items),
    formatOrderAmount(order.total)
  ];

  const results = await Promise.allSettled(
    attemptedRecipients.map(to => sendPatternSmsWithBodyId(to, args, ORDER_REGISTERED_BODY_ID))
  );

  const successfulRecipients = [];
  const failedRecipients = [];
  results.forEach((result, index) => {
    const to = attemptedRecipients[index];
    if (result.status === 'fulfilled') successfulRecipients.push(to);
    else failedRecipients.push({ to, error: result.reason });
  });

  return {
    recipients,
    attemptedRecipients,
    successfulRecipients,
    failedRecipients,
    bodyId: ORDER_REGISTERED_BODY_ID
  };
}

module.exports = { sendPatternSms, sendOrderRegisteredSms };
