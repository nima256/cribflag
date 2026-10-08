const mongoose = require('mongoose');

const reviewImageSchema = new mongoose.Schema({
  image: { type: String, required: true, trim: true },
  thumbnail: { type: String, default: '', trim: true }
}, { _id: false });

const customerReviewSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  orderNumber: { type: String, default: '', trim: true, index: true },
  reviewType: { type: String, enum: ['product', 'custom_design'], default: 'product', index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null, index: true },
  productId: { type: Number, default: null, index: true },
  productTitle: { type: String, required: true, trim: true },
  customerName: { type: String, required: true, trim: true },
  text: { type: String, default: '', trim: true, maxlength: 2000 },
  images: { type: [reviewImageSchema], default: [] },
  source: {
    type: String,
    enum: ['customer', 'admin', 'instagram', 'telegram', 'whatsapp', 'other'],
    default: 'customer',
    index: true
  },
  verifiedPurchase: { type: Boolean, default: false },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  approvedAt: { type: Date, default: null, index: true },
  moderatedAt: { type: Date, default: null },
  moderationNote: { type: String, default: '', trim: true, maxlength: 1000 }
}, { timestamps: true });

customerReviewSchema.index(
  { user: 1, order: 1, productId: 1 },
  {
    unique: true,
    partialFilterExpression: { source: 'customer' },
    name: 'one_customer_review_per_order_product'
  }
);

module.exports = mongoose.model('CustomerReview', customerReviewSchema);
