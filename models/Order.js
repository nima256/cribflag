const mongoose = require('mongoose');
const itemSchema = new mongoose.Schema({
  productId: Number,
  title: String,
  category: String,
  categories: { type: [String], default: [] },
  price: Number,
  qty: Number,
  size: String,
  fabric: String,
  requestType: String,
  notes: String,
  fileName: String,
  filePath: String,
  customRequestId: String,
  inventoryManaged: { type: Boolean, default: false }
}, { _id: false });
const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  customer: { type: String, required: true },
  phone: { type: String, required: true },
  email: String,
  province: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  address: { type: String, required: true },
  postalCode: String,
  items: { type: [itemSchema], default: [] },
  subtotal: Number,
  shipping: Number,
  discount: Number,
  tax: { type: Number, default: 0 },
  total: Number,
  couponCode: String,
  customerNote: { type: String, trim: true, default: '' },
  acquisition: {
    source: { type: String, trim: true, default: '' },
    medium: { type: String, trim: true, default: '' },
    campaign: { type: String, trim: true, default: '' },
    term: { type: String, trim: true, default: '' },
    content: { type: String, trim: true, default: '' },
    referrer: { type: String, trim: true, default: '' },
    landingPage: { type: String, trim: true, default: '' },
    capturedAt: Date
  },
  status: { type: String, enum: ['processing','design-review','print-preparation','printed','packed','shipped','delivered','cancelled'], default: 'processing' },
  payment: { type: String, default: 'پرداخت آنلاین' },
  paymentStatus: { type: String, enum: ['pending','review','paid','failed','refunded'], default: 'pending' },
  shippingMethod: String,
  tracking: String,
  adminNote: String,
  inventoryApplied: { type: Boolean, default: false },
  orderRegisteredSmsRecipients: { type: [String], default: [] },
  orderRegisteredSmsSentAt: Date,
  orderRegisteredSmsLockAt: Date,
  reviewRequest: {
    eligibleAt: Date,
    smsSentAt: Date,
    smsLockAt: Date,
    smsAttempts: { type: Number, default: 0 },
    smsLastError: { type: String, default: '' }
  },
  paymentInfo: {
    authority: String,
    url: String,
    refId: String,
    cardPan: String,
    paidAt: Date,
    torobPaymentToken: String,
    torobTransactionId: String,
    torobStatus: String,
    torobVerifiedAt: Date,
    torobSettledAt: Date
  },
  snappPay: {
    paymentToken: { type: String, index: true, sparse: true },
    transactionId: { type: String, index: true, sparse: true },
    status: { type: String, enum: ['PENDING', 'VERIFY', 'SETTLE', 'CANCEL', 'REVERT', 'FAILED', 'UNKNOWN'] },
    eligibleTitle: String,
    eligibleDescription: String,
    callbackState: String,
    callbackAmount: Number,
    // Per-order lock: callback, reconciler and admin actions never overlap.
    processing: { type: Boolean, default: false },
    processingStartedAt: Date,
    lastStatusCheckAt: Date,
    lastError: String,
    verifiedAt: Date,
    settledAt: Date,
    revertedAt: Date,
    cancelledAt: Date,
    updateHistory: {
      type: [{
        _id: false,
        amount: Number,
        discount: Number,
        changedAt: { type: Date, default: Date.now },
        changedBy: String,
        items: [{ _id: false, title: String, qty: Number, price: Number }]
      }],
      default: []
    }
  }
}, { timestamps: true });
module.exports = mongoose.model('Order', orderSchema);
