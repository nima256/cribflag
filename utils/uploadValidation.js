const fs = require('fs');
const { AppError } = require('./http');

function hasValidSignature(mimetype, header) {
  if (mimetype === 'image/png') {
    return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimetype === 'image/jpeg') {
    return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (mimetype === 'image/webp') {
    return header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (mimetype === 'application/pdf') {
    return header.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  return false;
}

async function assertUploadedFile(file, allowedMimeTypes) {
  if (!file?.path || !allowedMimeTypes.has(file.mimetype)) {
    throw new AppError(400, 'فرمت فایل مجاز نیست');
  }

  const handle = await fs.promises.open(file.path, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!hasValidSignature(file.mimetype, header.subarray(0, bytesRead))) {
      throw new AppError(400, 'محتوای فایل با فرمت اعلام‌شده مطابقت ندارد');
    }
  } finally {
    await handle.close();
  }
}

module.exports = { assertUploadedFile };
