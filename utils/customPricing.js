const SiteSetting = require('../models/SiteSetting');
const {
  PILLOW_FABRIC,
  customRequestPillowMode,
  dimensionsKey
} = require('./pillowPricing');

const CUSTOM_PRODUCT_TYPES = Object.freeze(['پرچم', 'روبالشتی', 'داکیماکورا بالشت قدی']);
const CUSTOM_FLAG_FABRICS = Object.freeze(['ساتن آمریکایی', 'ساتن براق', 'مخمل']);
const CUSTOM_PRICING_SETTING_KEY = 'custom-pricing';

const DEFAULT_CUSTOM_PRICING = Object.freeze({
  flagTiers: Object.freeze([
    Object.freeze({ key: '70x50', maxLongSide: 70, maxShortSide: 50, price: 550000, americanSatinPrice: 550000, velvetPrice: 700000 }),
    Object.freeze({ key: '100x70', maxLongSide: 100, maxShortSide: 70, price: 800000, americanSatinPrice: 800000, velvetPrice: 1000000 }),
    Object.freeze({ key: '150x90', maxLongSide: 150, maxShortSide: 90, price: 990000, americanSatinPrice: 990000, velvetPrice: 1200000 })
  ]),
  pillows: Object.freeze({
    pillowcase: Object.freeze({
      title: 'روبالشتی',
      variants: Object.freeze([
        Object.freeze({ option: 'فقط کاور', size: '۵۰ × ۷۰ سانتی‌متر', price: 650000 }),
        Object.freeze({ option: 'با الیاف', size: '۵۰ × ۷۰ سانتی‌متر', price: 950000 })
      ])
    }),
    dakimakura: Object.freeze({
      title: 'داکیماکورا بالشت قدی',
      variants: Object.freeze([
        Object.freeze({ option: 'فقط کاور', size: '۳۵ × ۱۰۰ سانتی‌متر', price: 700000 }),
        Object.freeze({ option: 'با الیاف', size: '۳۵ × ۱۰۰ سانتی‌متر', price: 1050000 }),
        Object.freeze({ option: 'فقط کاور', size: '۵۰ × ۱۵۰ سانتی‌متر', price: 990000 }),
        Object.freeze({ option: 'با الیاف', size: '۵۰ × ۱۵۰ سانتی‌متر', price: 1450000 })
      ])
    })
  })
});

const CUSTOM_SIZE_TIERS = DEFAULT_CUSTOM_PRICING.flagTiers;

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

function validPrice(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normalizeCustomPricingConfig(raw = {}) {
  const sourceTiers = Array.isArray(raw.flagTiers) ? raw.flagTiers : [];
  const flagTiers = DEFAULT_CUSTOM_PRICING.flagTiers.map(defaultTier => {
    const submitted = sourceTiers.find(item => String(item?.key || '') === defaultTier.key)
      || sourceTiers.find(item => Number(item?.maxLongSide) === defaultTier.maxLongSide && Number(item?.maxShortSide) === defaultTier.maxShortSide)
      || {};
    return {
      ...defaultTier,
      price: validPrice(submitted.price, defaultTier.price),
      americanSatinPrice: validPrice(submitted.americanSatinPrice, defaultTier.americanSatinPrice),
      velvetPrice: validPrice(submitted.velvetPrice, defaultTier.velvetPrice)
    };
  });

  const pillows = {};
  for (const [mode, defaultConfig] of Object.entries(DEFAULT_CUSTOM_PRICING.pillows)) {
    const submittedConfig = raw.pillows?.[mode] || {};
    const submittedVariants = Array.isArray(submittedConfig.variants) ? submittedConfig.variants : [];
    pillows[mode] = {
      title: defaultConfig.title,
      variants: defaultConfig.variants.map(defaultVariant => {
        const submitted = submittedVariants.find(item =>
          String(item?.option || '').trim() === defaultVariant.option &&
          dimensionsKey(item?.size) === dimensionsKey(defaultVariant.size)
        ) || {};
        return {
          ...defaultVariant,
          price: validPrice(submitted.price, defaultVariant.price)
        };
      })
    };
  }

  return { flagTiers, pillows };
}

async function getCustomPricingConfig() {
  const setting = await SiteSetting.findOne({ key: CUSTOM_PRICING_SETTING_KEY }).lean();
  return normalizeCustomPricingConfig(setting?.value || DEFAULT_CUSTOM_PRICING);
}

async function saveCustomPricingConfig(raw) {
  const value = normalizeCustomPricingConfig(raw);
  await SiteSetting.findOneAndUpdate(
    { key: CUSTOM_PRICING_SETTING_KEY },
    { $set: { value } },
    { upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
  return value;
}

function findConfiguredPillowVariant(config, mode, sizeValue, optionValue = '') {
  const pillow = config?.pillows?.[mode];
  if (!pillow) return null;
  const parsedOption = String(optionValue || '').trim()
    || (String(sizeValue || '').includes('با الیاف') ? 'با الیاف' : String(sizeValue || '').includes('کاور') ? 'فقط کاور' : '');
  const key = dimensionsKey(sizeValue);
  return (pillow.variants || []).find(item => item.option === parsedOption && dimensionsKey(item.size) === key) || null;
}

function calculateCustomPrice(widthOrSize, maybeHeight, fabric = CUSTOM_FLAG_FABRICS[0], requestType = 'پرچم', pillowOption = '', pricingConfig = DEFAULT_CUSTOM_PRICING) {
  const config = normalizeCustomPricingConfig(pricingConfig);
  const normalizedType = normalizeCustomProductType(requestType);
  const pillowMode = customRequestPillowMode(normalizedType);

  if (pillowMode) {
    const sizeValue = maybeHeight === undefined ? widthOrSize : `${widthOrSize} × ${maybeHeight}`;
    const variant = findConfiguredPillowVariant(config, pillowMode, sizeValue, pillowOption);
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
      variantSize: `${variant.option} — ${variant.size}`,
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
  const tier = config.flagTiers.find(item => longSide <= item.maxLongSide && shortSide <= item.maxShortSide);

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
  DEFAULT_CUSTOM_PRICING,
  normalizeCustomPricingConfig,
  getCustomPricingConfig,
  saveCustomPricingConfig,
  normalizeCustomProductType,
  isCustomPillow,
  normalizeDigits,
  parseCustomDimensions,
  calculateCustomPrice
};
