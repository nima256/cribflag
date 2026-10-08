const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { AppError } = require('./http');

const uploadsRoot = path.join(__dirname, '..', 'uploads');
const MAX_INPUT_PIXELS = 25_000_000;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

const IMAGE_PROFILES = Object.freeze({
  product: {
    folder: 'products',
    original: { width: 1600, height: 1600, quality: 84 },
    thumbnail: { width: 640, height: 640, quality: 78 }
  },
  category: {
    folder: 'categories',
    original: { width: 1000, height: 1000, quality: 84 },
    thumbnail: { width: 400, height: 400, quality: 78 }
  },
  review: {
    folder: 'reviews',
    original: { width: 1600, height: 1600, quality: 84 },
    thumbnail: { width: 560, height: 560, quality: 78 }
  }
});

function cleanBaseName(value) {
  const raw = path.parse(String(value || '')).name.replace(/[^a-zA-Z0-9_-]/g, '');
  return raw || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function ensureDirectory(directory) {
  await fs.promises.mkdir(directory, { recursive: true });
}

async function unlinkQuietly(filePath) {
  if (!filePath) return;
  await fs.promises.unlink(filePath).catch(() => {});
}

function publicUrl(folder, fileName, thumbnail = false) {
  return `/uploads/${folder}/${thumbnail ? 'thumbs/' : ''}${fileName}`;
}

async function processUploadedImage(file, profileName) {
  const profile = IMAGE_PROFILES[profileName];
  if (!profile) throw new AppError(500, 'پروفایل پردازش تصویر تعریف نشده است');
  if (!file?.path) throw new AppError(400, 'فایل تصویر دریافت نشد');

  const baseName = cleanBaseName(file.filename || file.originalname);
  const outputName = `${baseName}.webp`;
  const originalDirectory = path.join(uploadsRoot, profile.folder);
  const thumbnailDirectory = path.join(originalDirectory, 'thumbs');
  const originalPath = path.join(originalDirectory, outputName);
  const thumbnailPath = path.join(thumbnailDirectory, outputName);

  await Promise.all([ensureDirectory(originalDirectory), ensureDirectory(thumbnailDirectory)]);

  try {
    const metadata = await sharp(file.path, { failOn: 'error' }).metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    const pixels = width * height;

    if (!ALLOWED_FORMATS.has(metadata.format)) {
      throw new AppError(400, 'فرمت واقعی تصویر باید PNG، JPG یا WEBP باشد');
    }
    if (!width || !height) throw new AppError(400, 'ابعاد تصویر قابل تشخیص نیست');
    if (pixels > MAX_INPUT_PIXELS) {
      throw new AppError(400, `ابعاد تصویر بیش از حد بزرگ است؛ حداکثر ${MAX_INPUT_PIXELS.toLocaleString('fa-IR')} پیکسل مجاز است`);
    }

    const inputOptions = { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS };
    const commonWebp = {
      effort: 4,
      smartSubsample: true,
      alphaQuality: 90
    };

    const originalInfo = await sharp(file.path, inputOptions)
      .rotate()
      .resize({
        width: profile.original.width,
        height: profile.original.height,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ ...commonWebp, quality: profile.original.quality })
      .toFile(originalPath);

    const thumbnailInfo = await sharp(file.path, inputOptions)
      .rotate()
      .resize({
        width: profile.thumbnail.width,
        height: profile.thumbnail.height,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ ...commonWebp, quality: profile.thumbnail.quality })
      .toFile(thumbnailPath);

    return {
      image: publicUrl(profile.folder, outputName),
      thumbnail: publicUrl(profile.folder, outputName, true),
      original: {
        width: originalInfo.width,
        height: originalInfo.height,
        bytes: originalInfo.size
      },
      thumb: {
        width: thumbnailInfo.width,
        height: thumbnailInfo.height,
        bytes: thumbnailInfo.size
      }
    };
  } catch (error) {
    await Promise.all([unlinkQuietly(originalPath), unlinkQuietly(thumbnailPath)]);
    if (error instanceof AppError) throw error;
    if (/pixel limit|Input image exceeds pixel limit/i.test(String(error?.message || ''))) {
      throw new AppError(400, 'ابعاد تصویر بیش از حد بزرگ است');
    }
    throw new AppError(400, 'پردازش تصویر انجام نشد؛ فایل سالم PNG، JPG یا WEBP ارسال کنید');
  } finally {
    await unlinkQuietly(file.path);
  }
}

function stripQuery(value) {
  return String(value || '').split('?')[0].trim();
}

function managedImagePaths(value) {
  const image = stripQuery(value);
  const match = image.match(/^\/uploads\/(products|categories|reviews)\/(?!thumbs\/)([^/]+)$/i);
  if (!match) return [];

  const folder = match[1].toLowerCase();
  const fileName = path.posix.basename(match[2]);
  if (!/^[a-zA-Z0-9_-]+\.webp$/i.test(fileName)) return [];

  return [
    path.join(uploadsRoot, folder, fileName),
    path.join(uploadsRoot, folder, 'thumbs', fileName)
  ];
}

async function removeManagedImage(value) {
  await Promise.all(managedImagePaths(value).map(unlinkQuietly));
}

async function removeManagedImages(values) {
  const unique = [...new Set((Array.isArray(values) ? values : [values]).map(stripQuery).filter(Boolean))];
  await Promise.all(unique.map(removeManagedImage));
}

module.exports = {
  IMAGE_PROFILES,
  MAX_INPUT_PIXELS,
  processUploadedImage,
  removeManagedImage,
  removeManagedImages,
  unlinkQuietly
};
