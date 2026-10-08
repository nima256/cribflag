const Order = require('../models/Order');
const Notification = require('../models/Notification');
const env = require('../config/env');
const { sendDeliveredReviewSms } = require('./sms');

const LOCK_STALE_MS = 10 * 60 * 1000;
const WORKER_INTERVAL_MS = 5 * 60 * 1000;
let workerTimer = null;

function reviewUrl(order) {
  return `${env.siteUrl}/account?review=${encodeURIComponent(order.orderNumber)}`;
}

async function markReviewRequestEligible(order, previousStatus) {
  if (!order?._id || order.status !== 'delivered' || previousStatus === 'delivered') return false;

  const now = new Date();
  const result = await Order.updateOne(
    { _id: order._id, 'reviewRequest.eligibleAt': { $exists: false } },
    {
      $set: {
        'reviewRequest.eligibleAt': now,
        'reviewRequest.smsAttempts': 0,
        'reviewRequest.smsLastError': ''
      }
    }
  );

  if (!result.modifiedCount) return false;

  if (order.user) {
    await Notification.create({
      user: order.user,
      title: 'نظرت درباره خریدت چیه؟',
      text: `سفارش ${order.orderNumber} تحویل شده. از پنل کاربری می‌تونی نظرت و عکس خریدت رو برای ما بفرستی.`
    }).catch(error => console.error('[REVIEW NOTIFICATION]', error));
  }

  setImmediate(() => {
    notifyDeliveredReviewSms(order._id).catch(error => console.error('[REVIEW SMS]', error));
  });
  return true;
}

async function notifyDeliveredReviewSms(orderId) {
  if (!env.reviewSmsEnabled || !Number.isInteger(env.reviewSmsBodyId) || env.reviewSmsBodyId <= 0) return { skipped: true };

  const staleLock = new Date(Date.now() - LOCK_STALE_MS);
  const lockAt = new Date();
  const locked = await Order.findOneAndUpdate(
    {
      _id: orderId,
      status: 'delivered',
      'reviewRequest.eligibleAt': { $exists: true },
      'reviewRequest.smsSentAt': { $exists: false },
      $or: [
        { 'reviewRequest.smsLockAt': { $exists: false } },
        { 'reviewRequest.smsLockAt': { $lt: staleLock } }
      ]
    },
    {
      $set: { 'reviewRequest.smsLockAt': lockAt },
      $inc: { 'reviewRequest.smsAttempts': 1 }
    },
    { new: true }
  );
  if (!locked) return { skipped: true };

  try {
    const result = await sendDeliveredReviewSms(locked, reviewUrl(locked));
    await Order.updateOne(
      { _id: locked._id, 'reviewRequest.smsLockAt': lockAt },
      {
        $set: {
          'reviewRequest.smsSentAt': new Date(),
          'reviewRequest.smsLastError': ''
        },
        $unset: { 'reviewRequest.smsLockAt': 1 }
      }
    );
    return result;
  } catch (error) {
    await Order.updateOne(
      { _id: locked._id, 'reviewRequest.smsLockAt': lockAt },
      {
        $set: { 'reviewRequest.smsLastError': String(error?.message || error).slice(0, 1000) },
        $unset: { 'reviewRequest.smsLockAt': 1 }
      }
    ).catch(() => {});
    throw error;
  }
}

async function processPendingReviewSms(limit = 20) {
  if (!env.reviewSmsEnabled || !Number.isInteger(env.reviewSmsBodyId) || env.reviewSmsBodyId <= 0) return 0;
  const orders = await Order.find({
    status: 'delivered',
    'reviewRequest.eligibleAt': { $exists: true },
    'reviewRequest.smsSentAt': { $exists: false }
  }).select('_id').sort({ 'reviewRequest.eligibleAt': 1 }).limit(limit).lean();

  for (const order of orders) {
    await notifyDeliveredReviewSms(order._id).catch(error => console.error('[REVIEW SMS RETRY]', error));
  }
  return orders.length;
}

function startReviewSmsWorker() {
  if (workerTimer) return workerTimer;
  if (!env.reviewSmsEnabled || !Number.isInteger(env.reviewSmsBodyId) || env.reviewSmsBodyId <= 0) {
    console.warn('[REVIEW SMS] غیرفعال است؛ REVIEW_SMS_BODY_ID را برای پیامک پس از تحویل تنظیم کنید.');
    return null;
  }
  setImmediate(() => processPendingReviewSms().catch(error => console.error('[REVIEW SMS WORKER]', error)));
  workerTimer = setInterval(() => {
    processPendingReviewSms().catch(error => console.error('[REVIEW SMS WORKER]', error));
  }, WORKER_INTERVAL_MS);
  workerTimer.unref?.();
  return workerTimer;
}

module.exports = {
  markReviewRequestEligible,
  notifyDeliveredReviewSms,
  processPendingReviewSms,
  startReviewSmsWorker,
  reviewUrl
};
