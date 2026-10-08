// Builds SnappPay payment/v1/token and payment/v1/update payloads from a Crib Flag order.
//
// SnappPay formula (support message):
//   cart totalAmount = Σ count × item amount (+ shipping if not included) (+ tax if not included)
//   amount           = totalAmount − (discountAmount + externalSourceAmount)
// All amounts are sent in IRR (order amounts are stored in toman).
const crypto = require('crypto');

const toRial = toman => Math.round(Number(toman || 0) * 10);

// SnappPay item/cart ids are numeric: derive a stable positive int32 from any string.
function stableNumericId(value) {
  const digest = crypto.createHash('sha256').update(String(value ?? '')).digest();
  return (digest.readUInt32BE(0) % 2147483646) + 1;
}

// SnappPay expects the customer mobile as +989XXXXXXXXX.
function snappPayMobile(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) return `+98${digits.slice(1)}`;
  if (/^989\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+98${digits}`;
  throw new Error('شماره موبایل برای اسنپ‌پی معتبر نیست');
}

const itemQty = item => Math.max(1, Number(item?.qty || 1));
const itemsSubtotal = items => (items || []).reduce((sum, item) => sum + Number(item?.price || 0) * itemQty(item), 0);
const countUnits = items => (items || []).reduce((sum, item) => sum + itemQty(item), 0);

// The same product can be in the cart in several size/fabric combinations, so
// the id covers the variant; custom designs use their request id.
function snappItemId(item) {
  if (item?.customRequestId) return stableNumericId(`custom:${item.customRequestId}`);
  return stableNumericId(`product:${item?.productId}:${item?.size || ''}:${item?.fabric || ''}`);
}

function buildCartItem(item) {
  return {
    id: snappItemId(item),
    name: String(item?.title || 'محصول').slice(0, 100),
    category: String(item?.category || 'سایر').slice(0, 100),
    count: itemQty(item),
    amount: toRial(item?.price),
    commissionType: 100
  };
}

function buildSnappPayPayload(order, { items = order.items, discount = order.discount } = {}) {
  const itemsToman = itemsSubtotal(items);
  const shippingToman = Math.max(0, Number(order.shipping || 0));
  const discountToman = Math.max(0, Number(discount || 0));
  // SnappPay review #1: prices are sent tax-inclusive (Crib Flag adds no tax for SnappPay).
  const totalToman = itemsToman + shippingToman;
  const amountToman = totalToman - discountToman;
  if (amountToman <= 0) throw new Error('مبلغ نهایی سفارش اسنپ‌پی باید بزرگ‌تر از صفر باشد');

  return {
    amount: toRial(amountToman),
    discountAmount: toRial(discountToman),
    externalSourceAmount: 0,
    cartList: [{
      cartId: stableNumericId(`cart:${order.orderNumber}`),
      totalAmount: toRial(totalToman),
      // Shipping is paid on delivery today (shipping = 0) → "included" with 0, as in
      // SnappPay's own sample. If shipping is ever charged online it is sent separately.
      isShipmentIncluded: shippingToman === 0,
      shippingAmount: toRial(shippingToman),
      isTaxIncluded: true,
      taxAmount: 0,
      cartItems: (items || []).map(buildCartItem)
    }]
  };
}

// Discount for a partially returned order (payment/v1/update):
// - percent coupons are recalculated with the original rule (variant-limited coupons
//   only count eligible lines) on the remaining items;
// - fixed coupons are spread proportionally, so returned lines take their share.
// Never more than the previous discount or the remaining item value.
function recalculateDiscount({ coupon, previousItems, nextItems, previousDiscount, isEligible = () => true }) {
  const previous = Math.max(0, Number(previousDiscount || 0));
  const previousSubtotal = itemsSubtotal(previousItems);
  const nextSubtotal = itemsSubtotal(nextItems);
  if (previous <= 0 || nextSubtotal <= 0 || previousSubtotal <= 0) return 0;

  let next;
  if (coupon?.type === 'percent') {
    const base = itemsSubtotal((nextItems || []).filter(item => isEligible(coupon, item)));
    next = Math.round(base * Math.max(0, Number(coupon.value || 0)) / 100);
  } else {
    next = Math.floor(previous * nextSubtotal / previousSubtotal);
  }
  return Math.max(0, Math.min(next, previous, nextSubtotal));
}

module.exports = {
  toRial,
  stableNumericId,
  snappPayMobile,
  itemsSubtotal,
  countUnits,
  snappItemId,
  buildSnappPayPayload,
  recalculateDiscount
};
