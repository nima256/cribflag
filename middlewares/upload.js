const path = require('path');
const multer = require('multer');
const { AppError } = require('../utils/http');

const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => allowed.has(file.mimetype) ? cb(null, true) : cb(new AppError(400, 'فرمت فایل مجاز نیست'))
});

module.exports = upload;
