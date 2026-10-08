const { faDate } = require('../utils/formatters');

const SOURCE_LABELS = Object.freeze({
  customer: 'خریدار سایت',
  admin: 'ثبت توسط فروشگاه',
  instagram: 'اینستاگرام',
  telegram: 'تلگرام',
  whatsapp: 'واتساپ',
  other: 'سایر'
});

function reviewImageList(review) {
  return (Array.isArray(review?.images) ? review.images : [])
    .map(item => ({
      image: String(item?.image || '').trim(),
      thumbnail: String(item?.thumbnail || item?.image || '').trim()
    }))
    .filter(item => item.image);
}

function publicReview(review) {
  const value = review?.toObject ? review.toObject() : review;
  return {
    id: String(value?._id || ''),
    reviewType: value?.reviewType === 'custom_design' ? 'custom_design' : 'product',
    isCustomDesign: value?.reviewType === 'custom_design',
    productId: Number(value?.productId || 0),
    productTitle: String(value?.productTitle || '').trim(),
    customerName: String(value?.customerName || 'مشتری Crib Flag').trim(),
    text: String(value?.text || '').trim(),
    images: reviewImageList(value),
    verifiedPurchase: Boolean(value?.verifiedPurchase),
    source: String(value?.source || 'customer'),
    sourceLabel: SOURCE_LABELS[value?.source] || SOURCE_LABELS.other,
    date: faDate(value?.approvedAt || value?.createdAt),
    createdAt: value?.createdAt || null,
    approvedAt: value?.approvedAt || null
  };
}

function adminReview(review) {
  const value = review?.toObject ? review.toObject() : review;
  return {
    ...publicReview(value),
    status: String(value?.status || 'pending'),
    orderNumber: String(value?.orderNumber || '').trim(),
    userId: value?.user ? String(value.user?._id || value.user) : '',
    moderationNote: String(value?.moderationNote || '').trim(),
    updatedAt: value?.updatedAt || null
  };
}

module.exports = { SOURCE_LABELS, publicReview, adminReview, reviewImageList };
