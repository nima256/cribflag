const test = require('node:test');
const assert = require('node:assert/strict');
const { publicReview, adminReview, SOURCE_LABELS } = require('../services/customerReviews');

test('public review exposes safe public fields and image thumbnails', () => {
  const review = publicReview({
    _id: 'abc', productId: 2, productTitle: 'پرچم ایران', customerName: 'سارا',
    text: 'عالی بود', images: [{ image: '/uploads/reviews/a.webp', thumbnail: '/uploads/reviews/thumbs/a.webp' }],
    source: 'customer', verifiedPurchase: true, createdAt: new Date('2026-10-01T00:00:00Z')
  });
  assert.equal(review.id, 'abc');
  assert.equal(review.productId, 2);
  assert.equal(review.verifiedPurchase, true);
  assert.equal(review.sourceLabel, SOURCE_LABELS.customer);
  assert.equal(review.images[0].thumbnail, '/uploads/reviews/thumbs/a.webp');
  assert.equal('status' in review, false);
});

test('admin review adds moderation fields without exposing internal document data', () => {
  const review = adminReview({
    _id: 'def', productId: 4, productTitle: 'پرچم اسپانیا', customerName: 'مشتری',
    text: '', images: [], source: 'instagram', verifiedPurchase: false, status: 'pending',
    orderNumber: '', moderationNote: 'check', createdAt: new Date('2026-10-01T00:00:00Z')
  });
  assert.equal(review.status, 'pending');
  assert.equal(review.sourceLabel, SOURCE_LABELS.instagram);
  assert.equal(review.moderationNote, 'check');
});

test('review source labels cover supported manual sources', () => {
  for (const source of ['admin', 'instagram', 'telegram', 'whatsapp', 'other']) {
    assert.ok(SOURCE_LABELS[source]);
  }
});

test('custom-design review has no product link identity but stays public', () => {
  const review = publicReview({
    _id: 'custom-1', reviewType: 'custom_design', product: null, productId: null,
    productTitle: 'طرح دلخواه', customerName: 'مریم', text: 'چاپ عالی بود',
    images: [{ image: '/uploads/reviews/custom.webp', thumbnail: '' }],
    source: 'instagram', verifiedPurchase: false, status: 'approved',
    createdAt: new Date('2026-10-01T00:00:00Z')
  });
  assert.equal(review.reviewType, 'custom_design');
  assert.equal(review.isCustomDesign, true);
  assert.equal(review.productId, 0);
  assert.equal(review.productTitle, 'طرح دلخواه');
  assert.equal(review.images.length, 1);
});
