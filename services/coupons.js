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

async function releaseCoupon(order) {
  if (!order?.couponCode || !order?.orderNumber) return false;

  const filter = {
    code: order.couponCode,
    'usedBy.orderNumber': order.orderNumber
  };

  const result = await Coupon.updateOne(
    { ...filter, usedCount: { $gt: 0 } },
    {
      $inc: { usedCount: -1 },
      $pull: { usedBy: { orderNumber: order.orderNumber } }
    }
  );

  if (result.modifiedCount) return true;

  // اگر شمارنده قدیمی ناسازگار باشد، حداقل اتصال سفارش از تاریخچه مصرف پاک می‌شود.
  const cleanup = await Coupon.updateOne(
    filter,
    { $pull: { usedBy: { orderNumber: order.orderNumber } } }
  );
  return Boolean(cleanup.modifiedCount);
}

module.exports = { consumeCoupon, releaseCoupon };
