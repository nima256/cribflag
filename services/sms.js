const https = require('https');
const env = require('../config/env');
const { normalizeMobile } = require('../utils/formatters');

const ORDER_CUSTOMER_BODY_ID = 503938;
const ORDER_ADMIN_BODY_ID = 547795;
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
    request.setTimeout(10_000, () => request.destroy(new Error('مهلت اتصال به سامانه پیامک تمام شد')));
    request.on('error', reject);
    request.write(payload, 'utf8');
    request.end();
  });
}

function sendPatternSms(to, args) {
  return sendPatternSmsWithBodyId(to, args, env.melipayamakBodyId);
}

async function sendOrderRegisteredSms(order, options = {}) {
  const customerMobile = normalizeRecipient(options.customerMobile || order.phone);
  const adminMobiles = normalizeRecipientList(ORDER_ADMIN_MOBILES);
  const recipients = [...new Set([customerMobile, ...adminMobiles])];
  const alreadySentRecipients = new Set(normalizeRecipientList(options.alreadySentRecipients));

  const messages = [];
  if (!alreadySentRecipients.has(customerMobile)) {
    messages.push({
      to: customerMobile,
      bodyId: ORDER_CUSTOMER_BODY_ID,
      args: [order.customer, order.orderNumber]
    });
  }
  for (const to of adminMobiles) {
    if (!alreadySentRecipients.has(to)) {
      messages.push({ to, bodyId: ORDER_ADMIN_BODY_ID, args: [order.orderNumber] });
    }
  }

  const results = await Promise.allSettled(
    messages.map(message => sendPatternSmsWithBodyId(message.to, message.args, message.bodyId))
  );

  const successfulRecipients = [];
  const failedRecipients = [];
  results.forEach((result, index) => {
    const message = messages[index];
    if (result.status === 'fulfilled') successfulRecipients.push(message.to);
    else failedRecipients.push({ to: message.to, bodyId: message.bodyId, error: result.reason });
  });

  return {
    recipients,
    attemptedRecipients: messages.map(message => message.to),
    successfulRecipients,
    failedRecipients,
    customerBodyId: ORDER_CUSTOMER_BODY_ID,
    adminBodyId: ORDER_ADMIN_BODY_ID
  };
}

async function sendDeliveredReviewSms(order, reviewUrl) {
  if (!env.reviewSmsEnabled) return { skipped: true };
  if (!Number.isInteger(env.reviewSmsBodyId) || env.reviewSmsBodyId <= 0) {
    throw new Error('REVIEW_SMS_BODY_ID تنظیم نشده است');
  }
  const args = [
    String(order.customer || 'مشتری').trim(),
    String(order.orderNumber || '').trim(),
    String(reviewUrl || '').trim()
  ];
  return sendPatternSmsWithBodyId(order.phone, args, env.reviewSmsBodyId);
}

module.exports = { sendPatternSms, sendOrderRegisteredSms, sendDeliveredReviewSms };
