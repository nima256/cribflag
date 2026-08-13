const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { AppError } = require('../utils/http');

const MIME_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf']
]);

const uploadsRoot = path.join(__dirname, '..', 'uploads');
const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    // فایل‌های اختصاصی مشتری خصوصی می‌مانند. تصاویر محصول و دسته ابتدا
    // وارد پوشه موقت می‌شوند و پس از اعتبارسنجی توسط Sharp پردازش می‌شوند.
    const folder = file.fieldname === 'file' ? 'custom' : '.incoming';
    const destination = path.join(uploadsRoot, folder);
    fs.mkdir(destination, { recursive: true }, error => cb(error, destination));
  },
  filename: (_req, file, cb) => {
    const ext = MIME_EXTENSIONS.get(file.mimetype);
    if (!ext) return cb(new AppError(400, 'فرمت فایل مجاز نیست'));
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
  }
});

const createUpload = fileSize => multer({
  storage,
  limits: { fileSize, files: 12 },
  fileFilter: (_req, file, cb) => MIME_EXTENSIONS.has(file.mimetype)
    ? cb(null, true)
    : cb(new AppError(400, 'فرمت فایل مجاز نیست'))
});

const upload = createUpload(20 * 1024 * 1024);
// فایل طرح دلخواه جداگانه محدود می‌شود تا آپلود تصاویر مدیریت همچنان سقف قبلی را داشته باشد.
upload.customDesign = createUpload(3 * 1024 * 1024);

module.exports = upload;
