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
  notes: String,
  fileName: String,
  filePath: String,
  customRequestId: String
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
  total: Number,
  couponCode: String,
  customerNote: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['processing','design-review','shipped','delivered','cancelled'], default: 'processing' },
  payment: { type: String, default: 'پرداخت آنلاین' },
  paymentStatus: { type: String, enum: ['pending','review','paid','failed','refunded'], default: 'pending' },
  shippingMethod: String,
  tracking: String,
  adminNote: String,
  inventoryApplied: { type: Boolean, default: false },
  orderRegisteredSmsSentAt: Date,
  paymentInfo: {
    authority: String,
    url: String,
    refId: String,
    cardPan: String,
    paidAt: Date
  }
}, { timestamps: true });
module.exports = mongoose.model('Order', orderSchema);
