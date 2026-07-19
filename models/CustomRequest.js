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
  fileName: String,
  filePath: String,
  mimeType: String,
  size: String,
  fabric: String,
  requestType: String,
  notes: String,
  status: { type: String, enum: ['draft','review','preview-ready','approved'], default: 'review' },
  price: { type: Number, default: 0 },
  adminNote: String
}, { timestamps: true });
module.exports = mongoose.model('CustomRequest', customRequestSchema);
