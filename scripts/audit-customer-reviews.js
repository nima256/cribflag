const mongoose = require('mongoose');
const env = require('../config/env');
const CustomerReview = require('../models/CustomerReview');
const Order = require('../models/Order');

(async () => {
  await mongoose.connect(env.mongodbUri);
  const [reviewGroups, eligible, sent, failed, recent] = await Promise.all([
    CustomerReview.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Order.countDocuments({ status: 'delivered', 'reviewRequest.eligibleAt': { $exists: true } }),
    Order.countDocuments({ 'reviewRequest.smsSentAt': { $exists: true } }),
    Order.countDocuments({ 'reviewRequest.smsLastError': { $nin: ['', null], $exists: true } }),
    Order.find({ status: 'delivered', 'reviewRequest.eligibleAt': { $exists: true } })
      .select('orderNumber phone reviewRequest')
      .sort({ 'reviewRequest.eligibleAt': -1 })
      .limit(5)
      .lean()
  ]);
  const counts = Object.fromEntries(reviewGroups.map(item => [item._id, item.count]));
  console.log(JSON.stringify({
    mode: 'READ ONLY',
    database: mongoose.connection.name,
    sms: {
      enabled: env.reviewSmsEnabled,
      bodyId: env.reviewSmsBodyId || null,
      apiKeyPresent: Boolean(env.melipayamakSharedKey),
      ready: Boolean(env.reviewSmsEnabled && env.reviewSmsBodyId > 0 && env.melipayamakSharedKey)
    },
    reviews: {
      pending: Number(counts.pending || 0),
      approved: Number(counts.approved || 0),
      rejected: Number(counts.rejected || 0),
      total: Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0)
    },
    deliveredReviewRequests: {
      eligible,
      smsSent: sent,
      withLastError: failed,
      recent: recent.map(order => ({
        orderNumber: order.orderNumber,
        eligibleAt: order.reviewRequest?.eligibleAt || null,
        smsSentAt: order.reviewRequest?.smsSentAt || null,
        attempts: Number(order.reviewRequest?.smsAttempts || 0),
        lastError: order.reviewRequest?.smsLastError || ''
      }))
    }
  }, null, 2));
  await mongoose.disconnect();
})().catch(async error => {
  console.error(error);
  try { await mongoose.disconnect(); } catch {}
  process.exitCode = 1;
});
