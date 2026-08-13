const PILLOW_FABRIC = 'مخمل';
const PILLOW_OPTIONS = Object.freeze(['فقط کاور', 'با الیاف']);

const makeVariantSize = (option, size) => `${option} — ${size}`;

const PILLOW_CONFIGS = Object.freeze({
  pillowcase: Object.freeze({
    key: 'pillowcase',
    title: 'روبالشتی',
    sizes: Object.freeze(['۵۰ × ۷۰ سانتی‌متر']),
    variants: Object.freeze([
      Object.freeze({ option: 'فقط کاور', size: '۵۰ × ۷۰ سانتی‌متر', price: 650000 }),
      Object.freeze({ option: 'با الیاف', size: '۵۰ × ۷۰ سانتی‌متر', price: 950000 })
    ])
  }),
  dakimakura: Object.freeze({
    key: 'dakimakura',
    title: 'داکیماکورا بالشت قدی',
    sizes: Object.freeze(['۳۵ × ۱۰۰ سانتی‌متر', '۵۰ × ۱۵۰ سانتی‌متر']),
    variants: Object.freeze([
      Object.freeze({ option: 'فقط کاور', size: '۳۵ × ۱۰۰ سانتی‌متر', price: 700000 }),
      Object.freeze({ option: 'با الیاف', size: '۳۵ × ۱۰۰ سانتی‌متر', price: 1050000 }),
      Object.freeze({ option: 'فقط کاور', size: '۵۰ × ۱۵۰ سانتی‌متر', price: 990000 }),
      Object.freeze({ option: 'با الیاف', size: '۵۰ × ۱۵۰ سانتی‌متر', price: 1450000 })
    ])
  })
});

function normalizePersianText(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[\u200c\u200d\u200e\u200f]/g, '')
    .replace(/[‐‑‒–—−ـ_|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactPersianText(value = '') {
  return normalizePersianText(value).replace(/[^a-z0-9\u0600-\u06FF]+/g, '');
}

function detectPillowMode(values) {
  const list = Array.isArray(values) ? values : [values];
  const compact = list.map(compactPersianText).filter(Boolean);
  if (compact.some(value => value.includes('داکیماکورا') || value.includes('بالشتقدی') || value.includes('روبالشتیقدی'))) {
    return 'dakimakura';
  }
  if (compact.some(value => value.includes('روبالشتی') || value.includes('بالشتی'))) {
    return 'pillowcase';
  }
  return null;
}

function customRequestPillowMode(requestType) {
  const compact = compactPersianText(requestType);
  if (!compact || compact === 'پرچم' || compact === 'چاپمستقیم') return null;
  if (compact.includes('داکیماکورا') || compact.includes('قدی')) return 'dakimakura';
  if (compact.includes('روبالشتی') || compact.includes('بالشتی')) return 'pillowcase';
  return null;
}

function getPillowConfig(mode) {
  const config = PILLOW_CONFIGS[mode];
  if (!config) return null;
  const variants = config.variants.map(item => ({
    ...item,
    fabric: PILLOW_FABRIC,
    variantSize: makeVariantSize(item.option, item.size)
  }));
  return {
    key: config.key,
    title: config.title,
    sizes: variants.map(item => item.variantSize),
    displaySizes: [...config.sizes],
    fabrics: [PILLOW_FABRIC],
    options: [...PILLOW_OPTIONS],
    variants
  };
}

function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
}

function dimensionsKey(value) {
  const match = normalizeDigits(value).match(/(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)/i);
  if (!match) return '';
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return '';
  return `${Math.min(first, second)}x${Math.max(first, second)}`;
}

function parsePillowVariantSize(value) {
  const text = String(value || '').trim();
  const option = text.includes('با الیاف') ? 'با الیاف' : (text.includes('کاور') ? 'فقط کاور' : '');
  const key = dimensionsKey(text);
  return { option, dimensionsKey: key };
}

function findPillowVariant(mode, sizeValue, optionValue = '') {
  const config = getPillowConfig(mode);
  if (!config) return null;
  const parsed = parsePillowVariantSize(sizeValue);
  const option = String(optionValue || parsed.option || '').trim();
  const key = parsed.dimensionsKey || dimensionsKey(sizeValue);
  return config.variants.find(item => item.option === option && dimensionsKey(item.size) === key) || null;
}

function fixedProductPricing(mode) {
  const config = getPillowConfig(mode);
  if (!config) return null;
  const variantPrices = config.variants.map(item => ({
    size: item.variantSize,
    fabric: PILLOW_FABRIC,
    price: item.price,
    hasDiscount: false,
    oldPrice: null
  }));
  return {
    sizes: [...config.sizes],
    fabrics: [...config.fabrics],
    price: Math.min(...variantPrices.map(item => item.price)),
    hasDiscount: false,
    oldPrice: null,
    variantPrices
  };
}

module.exports = {
  PILLOW_FABRIC,
  PILLOW_OPTIONS,
  PILLOW_CONFIGS,
  makeVariantSize,
  normalizePersianText,
  compactPersianText,
  detectPillowMode,
  customRequestPillowMode,
  getPillowConfig,
  dimensionsKey,
  parsePillowVariantSize,
  findPillowVariant,
  fixedProductPricing
};
