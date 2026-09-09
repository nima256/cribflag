const express = require('express');
const path = require('path');
const fs = require('fs');

const Order = require('../models/Order');
const CustomRequest = require('../models/CustomRequest');
const { requireAdmin } = require('../middlewares/auth');
const { asyncHandler, AppError } = require('../utils/http');

const router = express.Router();
const uploadsDirectory = path.resolve(__dirname, '..', 'uploads');

async function resolveCustomOrderFile(orderId, rawItemIndex) {
  const order = await Order.findById(orderId);
  if (!order) throw new AppError(404, 'سفارش پیدا نشد');

  const itemIndex = Number(rawItemIndex);
  if (!Number.isInteger(itemIndex) || itemIndex < 0) throw new AppError(400, 'شماره آیتم معتبر نیست');
  const item = order.items[itemIndex];
  if (!item) throw new AppError(404, 'آیتم سفارش پیدا نشد');

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

  return { absolutePath, fileName: fileName || 'customer-design-file' };
}

router.get('/custom-file/:orderId/:itemIndex', requireAdmin, asyncHandler(async (req, res) => {
  const file = await resolveCustomOrderFile(req.params.orderId, req.params.itemIndex);
  return res.download(file.absolutePath, file.fileName);
}));

router.get('/custom-preview/:orderId/:itemIndex', requireAdmin, asyncHandler(async (req, res) => {
  const file = await resolveCustomOrderFile(req.params.orderId, req.params.itemIndex);
  const extension = path.extname(file.absolutePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'].includes(extension)) {
    throw new AppError(415, 'این فایل تصویر قابل پیش‌نمایش نیست');
  }
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(extension);
  return res.sendFile(file.absolutePath);
}));

module.exports = router;
