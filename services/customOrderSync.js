const CustomRequest = require('../models/CustomRequest');

const CUSTOM_PAYMENT_STATUSES = new Set([
  'unpaid',
  'pending',
  'review',
  'paid',
  'failed',
  'refunded'
]);

const ORDER_PAYMENT_STATUSES = new Set([
  'pending',
  'review',
  'paid',
  'failed',
  'refunded'
]);

function customRequestIdsFromOrder(order) {
  return [...new Set(
    (order?.items || [])
      .map(item => String(item?.customRequestId || '').trim())
      .filter(Boolean)
  )];
}

function orderTimestamp(order) {
  const value = order?.createdAt ? new Date(order.createdAt).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

function hydrateCustomRequestsWithOrders(customRequests = [], orders = []) {
  const latestOrderByRequest = new Map();
  const sortedOrders = [...orders].sort((a, b) => orderTimestamp(b) - orderTimestamp(a));

  for (const order of sortedOrders) {
    for (const publicId of customRequestIdsFromOrder(order)) {
      if (!latestOrderByRequest.has(publicId)) latestOrderByRequest.set(publicId, order);
    }
  }

  return customRequests.map(item => {
    const source = item?.toObject ? item.toObject() : { ...item };
    const linkedOrder = latestOrderByRequest.get(String(source.publicId || '').trim());
    if (!linkedOrder) return source;

    return {
      ...source,
      customer: linkedOrder.customer || source.customer || '',
      phone: linkedOrder.phone || source.phone || '',
      email: linkedOrder.email || source.email || '',
      province: linkedOrder.province || source.province || '',
      city: linkedOrder.city || source.city || '',
      postalCode: linkedOrder.postalCode || source.postalCode || '',
      address: linkedOrder.address || source.address || '',
      shippingMethod: linkedOrder.shippingMethod || source.shippingMethod || '',
      deliveryNote: linkedOrder.customerNote || source.deliveryNote || '',
      orderNumber: linkedOrder.orderNumber || source.orderNumber || '',
      payment: linkedOrder.payment || source.payment || '',
      paymentStatus: linkedOrder.paymentStatus || source.paymentStatus || 'unpaid',
      paymentInfo: linkedOrder.paymentInfo || source.paymentInfo || {},
      orderStatus: source.orderStatus || linkedOrder.status || 'design-review'
    };
  });
}

async function syncCustomRequestsFromOrder(order) {
  const publicIds = customRequestIdsFromOrder(order);
  if (!publicIds.length) return;

  await CustomRequest.updateMany(
    { publicId: { $in: publicIds } },
    {
      $set: {
        orderNumber: String(order.orderNumber || '').trim(),
        orderStatus: String(order.status || 'design-review').trim(),
        payment: String(order.payment || '').trim(),
        paymentStatus: ORDER_PAYMENT_STATUSES.has(order.paymentStatus)
          ? order.paymentStatus
          : 'pending',
        paymentInfo: {
          authority: String(order.paymentInfo?.authority || '').trim(),
          refId: String(order.paymentInfo?.refId || '').trim(),
          cardPan: String(order.paymentInfo?.cardPan || '').trim(),
          paidAt: order.paymentInfo?.paidAt || null
        }
      }
    }
  );

}

module.exports = {
  CUSTOM_PAYMENT_STATUSES,
  ORDER_PAYMENT_STATUSES,
  customRequestIdsFromOrder,
  hydrateCustomRequestsWithOrders,
  syncCustomRequestsFromOrder
};
