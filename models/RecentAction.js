const mongoose = require('mongoose');
const recentActionSchema = new mongoose.Schema({
  action: String, targetType: String, targetId: String, targetName: String,
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }, adminName: String, ipAddress: String
}, { timestamps: true });
module.exports = mongoose.model('RecentAction', recentActionSchema);
