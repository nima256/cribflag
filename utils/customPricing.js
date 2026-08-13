const {
  PILLOW_FABRIC,
  customRequestPillowMode,
  findPillowVariant
} = require('./pillowPricing');

const CUSTOM_PRODUCT_TYPES = Object.freeze(['پرچم', 'روبالشتی', 'داکیماکورا بالشت قدی']);
const CUSTOM_FLAG_FABRICS = Object.freeze(['ساتن آمریکایی', 'ساتن براق', 'مخمل']);

const CUSTOM_SIZE_TIERS = Object.freeze([
  Object.freeze({ maxLongSide: 70, maxShortSide: 50, price: 550000, americanSatinPrice: 550000, velvetPrice: 700000 }),
  Object.freeze({ maxLongSide: 100, maxShortSide: 70, price: 800000, americanSatinPrice: 1000, velvetPrice: 1000000 }),
  Object.freeze({ maxLongSide: 150, maxShortSide: 90, price: 990000, americanSatinPrice: 2000, velvetPrice: 1200000 })
]);

const normalizeDigits = value => String(value ?? '')
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/,/g, '.');

function parseCustomDimensions(value) {
  const normalized = normalizeDigits(value);
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  return { width, height };
}

function normalizeCustomProductType(value) {
  const type = String(value || '').trim();
  if (!type || type === 'چاپ مستقیم') return 'پرچم';
  const pillowMode = customRequestPillowMode(type);
  if (pillowMode === 'pillowcase') return 'روبالشتی';
  if (pillowMode === 'dakimakura') return 'داکیماکورا بالشت قدی';
  return 'پرچم';
}

function isCustomPillow(requestType) {
  return normalizeCustomProductType(requestType) !== 'پرچم';
}

function calculateCustomPrice(widthOrSize, maybeHeight, fabric = CUSTOM_FLAG_FABRICS[0], requestType = 'پرچم', pillowOption = '') {
  const normalizedType = normalizeCustomProductType(requestType);
  const pillowMode = customRequestPillowMode(normalizedType);

  if (pillowMode) {
    const sizeValue = maybeHeight === undefined ? widthOrSize : `${widthOrSize} × ${maybeHeight}`;
    const variant = findPillowVariant(pillowMode, sizeValue, pillowOption);
    if (!variant) {
      return { valid: false, reason: 'invalid-pillow-variant', price: 0 };
    }
    return {
      valid: true,
      reason: null,
      price: variant.price,
      width: parseCustomDimensions(variant.size)?.width,
      height: parseCustomDimensions(variant.size)?.height,
      fabric: PILLOW_FABRIC,
      pillowOption: variant.option,
      size: variant.size,
      variantSize: variant.variantSize,
      pillowMode
    };
  }

  const dimensions = maybeHeight === undefined
    ? parseCustomDimensions(widthOrSize)
    : { width: Number(widthOrSize), height: Number(maybeHeight) };

  if (!dimensions || !Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) {
    return { valid: false, reason: 'invalid-dimensions', price: 0 };
  }

  const longSide = Math.max(dimensions.width, dimensions.height);
  const shortSide = Math.min(dimensions.width, dimensions.height);
  const tier = CUSTOM_SIZE_TIERS.find(item => longSide <= item.maxLongSide && shortSide <= item.maxShortSide);

  if (!tier) {
    return {
      valid: false,
      reason: 'too-large',
      price: 0,
      width: dimensions.width,
      height: dimensions.height,
      longSide,
      shortSide
    };
  }

  const normalizedFabric = String(fabric || '').trim();
  const price = normalizedFabric === 'مخمل'
    ? tier.velvetPrice
    : normalizedFabric === 'ساتن آمریکایی'
      ? tier.americanSatinPrice
      : tier.price;

  return {
    valid: true,
    reason: null,
    price,
    width: dimensions.width,
    height: dimensions.height,
    longSide,
    shortSide,
    tier
  };
}

module.exports = {
  CUSTOM_PRODUCT_TYPES,
  CUSTOM_FLAG_FABRICS,
  CUSTOM_SIZE_TIERS,
  normalizeCustomProductType,
  isCustomPillow,
  normalizeDigits,
  parseCustomDimensions,
  calculateCustomPrice
};
