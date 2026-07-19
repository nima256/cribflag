const asPrice = value => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const asBoolean = value => value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
const variantKey = (size, fabric) => `${String(size || '').trim()}\u0000${String(fabric || '').trim()}`;

function normalizeVariantPrices(list, hasDiscount = false) {
  if (!Array.isArray(list)) return [];
  const unique = new Map();

  for (const item of list) {
    const size = String(item?.size || '').trim();
    const fabric = String(item?.fabric || '').trim();
    const price = asPrice(item?.price);
    if (!size || !fabric || price === null) continue;

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
  fallbackPricing
};
