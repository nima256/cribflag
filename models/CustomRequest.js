const mongoose = require('mongoose');
const customRequestSchema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customer: { type: String, trim: true },
  phone: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  province: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  postalCode: { type: String, trim: true, default: '' },
  address: { type: String, trim: true, default: '' },
  shippingMethod: { type: String, trim: true, default: '' },
  deliveryNote: { type: String, trim: true, default: '' },
  fileName: String,
  filePath: String,
  mimeType: String,
  size: String,
  fabric: String,
  requestType: String,
  notes: String,
  status: { type: String, enum: ['draft','review','preview-ready','approved'], default: 'review' },
  orderStatus: { type: String, enum: ['processing','design-review','print-preparation','printed','packed','shipped','delivered','cancelled'], default: 'design-review' },
  price: { type: Number, default: 0 },
  orderNumber: { type: String, trim: true, default: '', index: true },
  payment: { type: String, trim: true, default: 'ثبت نشده' },
  paymentStatus: {
    type: String,
    enum: ['unpaid','pending','review','paid','failed','refunded'],
    default: 'unpaid'
  },
  paymentInfo: {
    authority: { type: String, default: '' },
    refId: { type: String, default: '' },
    cardPan: { type: String, default: '' },
    paidAt: { type: Date, default: null }
  },
  adminNote: String
}, { timestamps: true });
module.exports = mongoose.model('CustomRequest', customRequestSchema);
