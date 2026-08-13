const express = require('express');
const path = require('path');
const fs = require('fs');

const Order = require('../models/Order');
const CustomRequest = require('../models/CustomRequest');
const { requireAdmin } = require('../middlewares/auth');
const { asyncHandler, AppError } = require('../utils/http');

const router = express.Router();
const uploadsDirectory = path.resolve(__dirname, '..', 'uploads');

router.get('/custom-file/:orderId/:itemIndex', requireAdmin, asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.orderId);
  if (!order) throw new AppError(404, 'سفارش پیدا نشد');

  const itemIndex = Number(req.params.itemIndex);
  if (!Number.isInteger(itemIndex) || itemIndex < 0) throw new AppError(400, 'شماره آیتم معتبر نیست');
  const item = order.items[itemIndex];
  if (!item) throw new AppError(404, 'آیتم سفارش پیدا نشد');

  // سفارش‌های جدید مسیر فایل را داخل خود Order نگه می‌دارند. برای سفارش‌های
  // قدیمی‌تر، اگر فقط customRequestId موجود باشد فایل را از CustomRequest پیدا می‌کنیم.
  let filePath = String(item.filePath || '').trim();
  let fileName = String(item.fileName || '').trim();
  if (!filePath && item.customRequestId) {
    const customRequest = await CustomRequest.findOne({
      publicId: String(item.customRequestId).trim()
    }).select('filePath fileName').lean();
    filePath = String(customRequest?.filePath || '').trim();
    fileName = fileName || String(customRequest?.fileName || '').trim();
  }
  if (!filePath) throw new AppError(404, 'فایل برای این سفارش وجود ندارد');

  const absolutePath = path.resolve(filePath);
  if (absolutePath !== uploadsDirectory && !absolutePath.startsWith(`${uploadsDirectory}${path.sep}`)) {
    throw new AppError(403, 'مسیر فایل معتبر نیست');
  }
  if (!fs.existsSync(absolutePath)) throw new AppError(404, 'فایل روی سرور پیدا نشد');

  return res.download(absolutePath, fileName || 'customer-design-file');
}));

module.exports = router;
