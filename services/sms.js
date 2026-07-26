const https = require('https');
const env = require('../config/env');

const ORDER_REGISTERED_BODY_ID = 502826;
const ORDER_ADMIN_MOBILES = ['09014968828', '09054243464'];

function normalizeArgs(args) {
  return (Array.isArray(args) ? args : []).map(value => String(value ?? '').trim());
}

function sendPatternSmsWithBodyId(to, args, bodyId) {
  const normalizedArgs = normalizeArgs(args);
  if (!env.melipayamakSharedKey) {
    if (!env.isProduction) {
      console.log(`[DEV SMS] bodyId=${bodyId} to=${to} args=${normalizedArgs.join(',')}`);
    }
    return Promise.resolve({ mocked: true });
  }

  const payload = JSON.stringify({ bodyId, to, args: normalizedArgs });
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
        ? resolve({ mocked: false, body })
        : reject(new Error(`خطای سامانه پیامک: ${response.statusCode}`)));
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

async function sendOrderRegisteredSms(order) {
  const args = [
    order.customer,
    order.orderNumber,
    formatOrderItems(order.items),
    formatOrderAmount(order.total)
  ];
  const recipients = [...new Set([order.phone, ...ORDER_ADMIN_MOBILES].filter(Boolean))];
  const results = await Promise.allSettled(
    recipients.map(to => sendPatternSmsWithBodyId(to, args, ORDER_REGISTERED_BODY_ID))
  );
  const failedRecipients = results
    .map((result, index) => ({ result, to: recipients[index] }))
    .filter(item => item.result.status === 'rejected');

  if (failedRecipients.length) {
    const error = new Error(`ارسال پیامک ثبت سفارش برای ${failedRecipients.map(item => item.to).join('، ')} ناموفق بود`);
    error.causes = failedRecipients.map(item => item.result.reason);
    throw error;
  }

  return { recipients, bodyId: ORDER_REGISTERED_BODY_ID };
}

module.exports = { sendPatternSms, sendOrderRegisteredSms };
