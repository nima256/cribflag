const CUSTOM_SIZE_TIERS = Object.freeze([
  Object.freeze({ maxLongSide: 70, maxShortSide: 50, price: 550000 }),
  Object.freeze({ maxLongSide: 100, maxShortSide: 70, price: 800000 }),
  Object.freeze({ maxLongSide: 150, maxShortSide: 90, price: 950000 })
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

function calculateCustomPrice(widthOrSize, maybeHeight) {
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

  return {
    valid: true,
    reason: null,
    price: tier.price,
    width: dimensions.width,
    height: dimensions.height,
    longSide,
    shortSide,
    tier
  };
}

module.exports = {
  CUSTOM_SIZE_TIERS,
  normalizeDigits,
  parseCustomDimensions,
  calculateCustomPrice
};
