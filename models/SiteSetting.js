const mongoose = require('mongoose');

const siteSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true, trim: true },
  value: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('SiteSetting', siteSettingSchema);
