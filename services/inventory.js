const Product = require('../models/Product');
const Order = require('../models/Order');
const { AppError } = require('../utils/http');

function isManagedItem(item) {
  return item?.inventoryManaged === true;
}

async function applyInventory(order) {
  const claim = await Order.updateOne(
    { _id: order._id, inventoryApplied: { $ne: true } },
    { $set: { inventoryApplied: true } }
  );
  if (!claim.modifiedCount) {
    order.inventoryApplied = true;
    return false;
  }

  const applied = [];
  try {
    for (const item of order.items || []) {
      if (!item.productId) continue;
      const qty = Math.max(1, Number(item.qty || 1));
      const managed = isManagedItem(item);
      const filter = managed
        ? { publicId: item.productId, inventoryMode: 'managed', stock: { $gte: qty } }
        : { publicId: item.productId };
      const update = managed
        ? { $inc: { stock: -qty, sales: qty } }
        : { $inc: { sales: qty } };
      const result = await Product.updateOne(filter, update);
      if (!result.modifiedCount) {
        throw new AppError(409, managed
          ? `موجودی ${item.title} در زمان پرداخت تغییر کرده است`
          : `محصول ${item.title} دیگر در دسترس نیست`);
      }
      const snapshot = typeof item.toObject === 'function' ? item.toObject() : item;
      applied.push({ ...snapshot, qty, managed });
    }
    order.inventoryApplied = true;
    await order.save();
    return true;
  } catch (error) {
    for (const item of applied.reverse()) {
      const update = item.managed
        ? { $inc: { stock: item.qty, sales: -item.qty } }
        : { $inc: { sales: -item.qty } };
      await Product.updateOne({ publicId: item.productId }, update)
        .catch(rollbackError => console.error('[INVENTORY ROLLBACK]', rollbackError));
    }
    await Order.updateOne({ _id: order._id }, { $set: { inventoryApplied: false } });
    order.inventoryApplied = false;
    throw error;
  }
}

async function releaseInventory(order) {
  const claim = await Order.updateOne(
    { _id: order._id, inventoryApplied: true },
    { $set: { inventoryApplied: false } }
  );
  if (!claim.modifiedCount) {
    order.inventoryApplied = false;
    return false;
  }

  for (const item of order.items || []) {
    if (!item.productId) continue;
    const qty = Math.max(1, Number(item.qty || 1));
    const update = isManagedItem(item)
      ? { $inc: { stock: qty, sales: -qty } }
      : { $inc: { sales: -qty } };
    await Product.updateOne({ publicId: item.productId }, update);
  }
  order.inventoryApplied = false;
  return true;
}

// Puts partially returned quantities back (SnappPay update). Only for orders whose
// inventory was applied; `returned` is [{ productId, qty, inventoryManaged }].
async function restockReturnedItems(order, returned) {
  if (!order?.inventoryApplied) return false;
  for (const item of returned || []) {
    if (!item.productId) continue;
    const qty = Math.max(0, Number(item.qty || 0));
    if (!qty) continue;
    const update = isManagedItem(item)
      ? { $inc: { stock: qty, sales: -qty } }
      : { $inc: { sales: -qty } };
    await Product.updateOne({ publicId: item.productId }, update);
  }
  return true;
}

module.exports = { applyInventory, releaseInventory, restockReturnedItems };
