const asPrice = value => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const asBoolean = value => value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
const variantKey = (size, fabric) => `${String(size || '').trim()}\u0000${String(fabric || '').trim()}`;

const AMERICAN_SATIN_PRICES = Object.freeze({
  '150x90': 990000,
  '100x70': 800000,
  '70x50': 550000
});

const normalizeSizeKey = value => {
  const normalized = String(value || '')
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)/i);
  if (!match) return '';
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  return `${Math.max(a, b)}x${Math.min(a, b)}`;
};

const fixedAmericanSatinPrice = (size, fabric) => {
  if (String(fabric || '').trim() !== 'ساتن آمریکایی') return null;
  return AMERICAN_SATIN_PRICES[normalizeSizeKey(size)] ?? null;
};

function normalizeVariantPrices(list, hasDiscount = false) {
  if (!Array.isArray(list)) return [];
  const unique = new Map();

  for (const item of list) {
    const size = String(item?.size || '').trim();
    const fabric = String(item?.fabric || '').trim();
    const submittedPrice = asPrice(item?.price);
    if (!size || !fabric || submittedPrice === null) continue;
    const price = submittedPrice;

    const candidateOldPrice = asPrice(item?.oldPrice ?? item?.old);
    const variantHasDiscount = Boolean(hasDiscount && candidateOldPrice !== null && candidateOldPrice > price);
    unique.set(variantKey(size, fabric), {
      size,
      fabric,
      price,
      hasDiscount: variantHasDiscount,
      oldPrice: variantHasDiscount ? candidateOldPrice : null
    });
  }

  return [...unique.values()];
}

function prepareProductPricing(raw = {}) {
  const requestedDiscount = asBoolean(raw.hasDiscount);
  const variantPrices = normalizeVariantPrices(raw.variantPrices, requestedDiscount);
  let price = asPrice(raw.price) ?? 0;
  let oldPrice = asPrice(raw.oldPrice ?? raw.old);

  if (variantPrices.length) {
    const cheapest = variantPrices.reduce((best, current) => current.price < best.price ? current : best);
    price = cheapest.price;
    if (cheapest.hasDiscount) oldPrice = cheapest.oldPrice;
  }

  const hasDiscount = requestedDiscount && (
    (oldPrice !== null && oldPrice > price) ||
    variantPrices.some(item => item.hasDiscount)
  );

  return {
    price,
    hasDiscount,
    oldPrice: hasDiscount && oldPrice !== null && oldPrice > price ? oldPrice : null,
    variantPrices: hasDiscount
      ? variantPrices
      : variantPrices.map(item => ({ ...item, hasDiscount: false, oldPrice: null }))
  };
}

function findVariantPricing(product, size, fabric) {
  const selectedSize = String(size || '').trim();
  const selectedFabric = String(fabric || '').trim();
  const variants = normalizeVariantPrices(product?.variantPrices, Boolean(product?.hasDiscount));
  if (!variants.length) return null;
  return variants.find(item => item.size === selectedSize && item.fabric === selectedFabric) || null;
}

function fallbackPricing(product) {
  const price = asPrice(product?.price) ?? 0;
  const oldPrice = asPrice(product?.oldPrice ?? product?.old);
  const hasDiscount = Boolean(product?.hasDiscount && oldPrice !== null && oldPrice > price);
  return { price, oldPrice: hasDiscount ? oldPrice : null, hasDiscount };
}

module.exports = {
  asPrice,
  asBoolean,
  variantKey,
  normalizeVariantPrices,
  prepareProductPricing,
  findVariantPricing,
  fallbackPricing,
  fixedAmericanSatinPrice
};
