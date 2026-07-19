const mongoose = require('mongoose');
const messageSchema = new mongoose.Schema({ from: { type: String, enum: ['user','admin'] }, text: String, date: String }, { timestamps: true, _id: false });
const ticketSchema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customer: String,
  subject: String,
  department: String,
  priority: { type: String, enum: ['normal','high'], default: 'normal' },
  status: { type: String, enum: ['open','answered','closed'], default: 'open' },
  messages: { type: [messageSchema], default: [] }
}, { timestamps: true });
module.exports = mongoose.model('Ticket', ticketSchema);
