const ZarinPal = require('zarinpal-checkout');
const env = require('../config/env');

let client = null;
function getClient() {
  if (!env.zarinpalMerchantId) throw new Error('ZARINPAL_MERCHANT_ID تنظیم نشده است');
  if (!client) client = ZarinPal.create(env.zarinpalMerchantId, env.zarinpalSandbox);
  return client;
}
function gatewayAmount(tomanAmount) {
  return env.zarinpalAmountUnit === 'rial' ? Number(tomanAmount) * 10 : Number(tomanAmount);
}
async function requestPayment(order) {
  return getClient().PaymentRequest({
    Amount: gatewayAmount(order.total),
    CallbackURL: `${env.siteUrl}/api/orders/verify`,
    Description: `سفارش ${order.orderNumber} - ${order.customer}`.slice(0, 250),
    Email: order.email || undefined,
    Mobile: order.phone
  });
}
async function verifyPayment(order, authority) {
  return getClient().PaymentVerification({ Amount: gatewayAmount(order.total), Authority: authority });
}
module.exports = { requestPayment, verifyPayment };
