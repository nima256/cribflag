const Coupon = require('../models/Coupon');

async function consumeCoupon(order) {
  if (!order?.couponCode) return false;
  const result = await Coupon.updateOne(
    { code: order.couponCode, 'usedBy.orderNumber': { $ne: order.orderNumber } },
    {
      $inc: { usedCount: 1 },
      $push: { usedBy: { user: order.user || null, orderNumber: order.orderNumber } }
    }
  );
  return Boolean(result.modifiedCount);
}

module.exports = { consumeCoupon };
