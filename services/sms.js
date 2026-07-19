const https = require('https');
const env = require('../config/env');

function sendPatternSms(to, args) {
  if (!env.melipayamakSharedKey) {
    if (!env.isProduction) console.log(`[DEV SMS] to=${to} args=${args.join(',')}`);
    return Promise.resolve({ mocked: true });
  }
  const payload = JSON.stringify({ bodyId: env.melipayamakBodyId, to, args });
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
module.exports = { sendPatternSms };
