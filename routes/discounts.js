const express = require('express');
const Coupon = require('../models/Coupon');
const { asyncHandler, ok, AppError } = require('../utils/http');
const router = express.Router();

async function calculate(code, subtotal, userId) {
  const coupon = await Coupon.findOne({ code: String(code || '').trim().toUpperCase() });
  if (!coupon || coupon.status !== 'active') throw new AppError(400, 'کد تخفیف معتبر نیست');
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new AppError(400, 'کد تخفیف منقضی شده است');
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) throw new AppError(400, 'سقف استفاده از کد تخفیف تکمیل شده است');
  if (Number(subtotal) < coupon.minOrderAmount) throw new AppError(400, `حداقل مبلغ سفارش ${coupon.minOrderAmount} تومان است`);
  if (coupon.oneTimePerUser && userId && coupon.usedBy.some(x => String(x.user) === String(userId))) throw new AppError(400, 'قبلاً از این کد استفاده کرده‌اید');
  const amount = coupon.type === 'fixed' ? Math.min(coupon.value, subtotal) : Math.round(subtotal * coupon.value / 100);
  return { coupon, amount };
}
router.post('/validate', asyncHandler(async (req, res) => { const result = await calculate(req.body.code, Number(req.body.subtotal || 0), req.session?.userId); ok(res, { discount: result.amount, code: result.coupon.code }); }));
module.exports = router; module.exports.calculate = calculate;
