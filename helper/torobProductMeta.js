const crypto = require('crypto');
const { prepareProductPricing, fallbackPricing } = require('../utils/productPricing');

const BASE_VARIANT_ID = 'base';
const MAX_PAGE_UNIQUE_LENGTH = 200;
const clean = value => String(value ?? '').trim();
const unique = values => [...new Set((values || []).map(clean).filter(Boolean))];

// IMPORTANT: this is a feed identity, not an inventory key. CribFlag intentionally
// keeps stock at parent-product level; size/fabric combinations only split Torob offers.
const variantKey = (size = '', fabric = '') => {
  const normalizedSize = clean(size);
  const normalizedFabric = clean(fabric);
  if (!normalizedSize && !normalizedFabric) return BASE_VARIANT_ID;
  return `v-${crypto.createHash('sha256').update(`${normalizedSize}\u0000${normalizedFabric}`, 'utf8').digest('hex').slice(0, 24)}`;
};

const variantDescriptor = (size, fabric, pricing, index) => ({
  size: clean(size),
  fabric: clean(fabric),
  variantKey: variantKey(size, fabric),
  pricing,
  index
});

const sortVariants = variants => [...variants].sort((a, b) =>
  String(a.variantKey).localeCompare(String(b.variantKey), 'en')
);

const getProductVariants = product => {
  const prepared = prepareProductPricing(product || {});
  const pricedVariants = Array.isArray(prepared.variantPrices)
    ? prepared.variantPrices.filter(item => clean(item?.size) && clean(item?.fabric))
    : [];

  // Explicit variant prices are also an explicit list of valid combinations.
  if (pricedVariants.length) {
    const seen = new Set();
    const rows = [];
    for (const item of pricedVariants) {
      const key = variantKey(item.size, item.fabric);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(variantDescriptor(item.size, item.fabric, {
        price: Number(item.price || 0),
        hasDiscount: Boolean(item.hasDiscount),
        oldPrice: item.hasDiscount && Number(item.oldPrice) > Number(item.price) ? Number(item.oldPrice) : null
      }, rows.length));
    }
    return sortVariants(rows);
  }

  // In this business every configured size can be produced in every configured fabric.
  // Therefore, unlike Kidle, there is deliberately NO per-combination availability list.
  const sizes = unique(Array.isArray(product?.sizes) ? product.sizes : []);
  const fabrics = unique(Array.isArray(product?.fabrics) ? product.fabrics : []);
  if (!sizes.length && !fabrics.length) {
    return [variantDescriptor('', '', fallbackPricing(product), 0)];
  }

  const sizeOptions = sizes.length ? sizes : [''];
  const fabricOptions = fabrics.length ? fabrics : [''];
  const pricing = fallbackPricing(product);
  const variants = [];
  for (const size of sizeOptions) {
    for (const fabric of fabricOptions) {
      variants.push(variantDescriptor(size, fabric, pricing, variants.length));
    }
  }
  return sortVariants(variants);
};

const findVariant = (product, size = '', fabric = '') => {
  const variants = getProductVariants(product);
  const wantedSize = clean(size);
  const wantedFabric = clean(fabric);
  if (!wantedSize && !wantedFabric) return variants[0] || null;
  return variants.find(item =>
    (!wantedSize || item.size === wantedSize) &&
    (!wantedFabric || item.fabric === wantedFabric)
  ) || null;
};

const findVariantByKey = (product, key) => {
  const wanted = clean(key);
  if (!wanted || wanted.length > MAX_PAGE_UNIQUE_LENGTH) return null;
  return getProductVariants(product).find(item => item.variantKey === wanted) || null;
};

const resolveVariant = (product, { variant = '', size = '', fabric = '' } = {}) => {
  const wantedVariant = clean(variant);
  const wantedSize = clean(size);
  const wantedFabric = clean(fabric);

  if (wantedVariant) {
    const matched = findVariantByKey(product, wantedVariant);
    if (!matched) return null;
    if (wantedSize && matched.size !== wantedSize) return null;
    if (wantedFabric && matched.fabric !== wantedFabric) return null;
    return matched;
  }
  return findVariant(product, wantedSize, wantedFabric);
};

const buildVariantTitle = (product, descriptor = null) => {
  const variant = descriptor || getProductVariants(product)[0] || {};
  const parts = [clean(product?.title || product?.name)];
  if (variant.size) parts.push(`سایز ${variant.size}`);
  if (variant.fabric) parts.push(`پارچه ${variant.fabric}`);
  return parts.filter(Boolean).join(' - ');
};

const baseUrl = () => {
  let configured = process.env.SITE_BASE_URL || process.env.SITE_URL || '';
  if (!configured) {
    try { configured = require('../config/env').siteUrl; } catch {}
  }
  return clean(configured || 'https://cribflag.ir').replace(/\/+$/, '');
};

const buildPageUrl = (product, descriptor = null) => {
  const id = Number(product?.publicId ?? product?.id);
  const url = new URL(`/product/${encodeURIComponent(id)}`, baseUrl());
  const variant = descriptor || getProductVariants(product)[0] || {};

  if (variant.variantKey && variant.variantKey !== BASE_VARIANT_ID) {
    url.searchParams.set('variant', variant.variantKey);
  }
  if (variant.size) url.searchParams.set('size', variant.size);
  if (variant.fabric) url.searchParams.set('fabric', variant.fabric);
  return url.toString();
};

const parseProductPageUrl = rawUrl => {
  try {
    const requested = new URL(rawUrl, baseUrl());
    const expected = new URL(baseUrl());
    const normalizeHost = value => String(value || '').replace(/^www\./i, '').toLowerCase();
    if (!['http:', 'https:'].includes(requested.protocol)) return null;
    if (normalizeHost(requested.hostname) !== normalizeHost(expected.hostname)) return null;

    const match = requested.pathname.match(/^\/product\/(\d+)\/?$/i);
    if (!match) return null;
    const publicId = Number(match[1]);
    if (!Number.isInteger(publicId) || publicId < 1) return null;
    if (requested.searchParams.getAll('variant').length > 1) return null;
    if (requested.searchParams.getAll('size').length > 1) return null;
    if (requested.searchParams.getAll('fabric').length > 1) return null;

    return {
      publicId,
      variant: clean(requested.searchParams.get('variant')),
      size: clean(requested.searchParams.get('size')),
      fabric: clean(requested.searchParams.get('fabric'))
    };
  } catch {
    return null;
  }
};

const pageUnique = (product, descriptor = null) => {
  const variant = descriptor || getProductVariants(product)[0] || {};
  const productId = String(product?.publicId ?? product?.id ?? '');
  return `${productId}_${variant.variantKey || BASE_VARIANT_ID}`;
};

const parsePageUnique = value => {
  const raw = clean(value);
  if (!raw || raw.length > MAX_PAGE_UNIQUE_LENGTH) return null;
  const match = raw.match(/^(\d+)_(base|v-[a-f0-9]{24})$/i);
  if (!match) return null;
  const publicId = Number(match[1]);
  if (!Number.isInteger(publicId) || publicId < 1) return null;
  return { publicId, variantKey: match[2].toLowerCase(), raw };
};

const absoluteImageUrl = image => {
  const raw = clean(image);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${baseUrl()}${raw.startsWith('/') ? raw : `/${raw.replace(/^\/+/, '')}`}`;
};

const imageLinks = product => {
  const sources = Array.isArray(product?.images) && product.images.length ? product.images : [product?.image];
  return [...new Set(sources.map(absoluteImageUrl).filter(Boolean))];
};

// This is intentionally parent-level only. A size/fabric combination never becomes
// unavailable independently. If the whole product is out of stock, every Torob offer
// becomes unavailable together.
const isAvailable = product => product?.status !== 'draft' && (
  product?.inventoryMode !== 'managed' || Number(product?.stock || 0) > 0
);

const categoryName = product => {
  if (clean(product?.category)) return clean(product.category);
  if (Array.isArray(product?.categories)) return clean(product.categories[0]);
  return '';
};

const buildSpec = (product, descriptor = null) => {
  const variant = descriptor || getProductVariants(product)[0] || {};
  const spec = {};
  if (variant.size) spec['سایز'] = variant.size;
  if (variant.fabric) spec['جنس پارچه'] = variant.fabric;
  if (clean(product?.sku)) spec['کد کالا'] = clean(product.sku);
  return spec;
};

const compactDescription = value => clean(value).replace(/\s+/g, ' ').slice(0, 500);

const safeIsoDate = value => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const formatProductForTorob = (product, descriptor = null) => {
  const variant = descriptor || getProductVariants(product)[0];
  if (!variant) throw new Error(`No Torob variant for product ${product?.publicId ?? product?.id ?? '?'}`);

  const availability = isAvailable(product);
  const pricing = variant.pricing || fallbackPricing(product);
  const currentPrice = availability ? Number(pricing.price || 0) : 0;
  const oldPrice = availability && pricing.hasDiscount && Number(pricing.oldPrice) > currentPrice
    ? Number(pricing.oldPrice)
    : null;
  const productId = String(product?.publicId ?? product?.id ?? '');
  const description = compactDescription(product?.description);
  const subtitleParts = [];
  if (variant.size) subtitleParts.push(`سایز ${variant.size}`);
  if (variant.fabric) subtitleParts.push(`پارچه ${variant.fabric}`);

  return {
    page_unique: pageUnique(product, variant),
    page_url: buildPageUrl(product, variant),
    product_group_id: productId,
    title: buildVariantTitle(product, variant),
    subtitle: subtitleParts.join(' - '),
    current_price: Math.max(0, Math.trunc(currentPrice)),
    old_price: oldPrice === null ? null : Math.max(0, Math.trunc(oldPrice)),
    availability,
    category_name: categoryName(product),
    image_links: imageLinks(product),
    spec: buildSpec(product, variant),
    guarantee: 'تضمین سلامت و کیفیت کالا',
    short_desc: description,
    date_added: safeIsoDate(product?.createdAt),
    date_updated: safeIsoDate(product?.updatedAt || product?.createdAt)
  };
};

const buildProductPageMeta = (product, requestedSize = '', requestedFabric = '', requestedVariant = '') => {
  const variant = resolveVariant(product, {
    variant: requestedVariant,
    size: requestedSize,
    fabric: requestedFabric
  }) || getProductVariants(product)[0];
  const pricing = variant?.pricing || fallbackPricing(product);
  const availability = isAvailable(product);
  const canonicalUrl = buildPageUrl(product, variant);
  const images = imageLinks(product);
  const description = compactDescription(product?.description) || buildVariantTitle(product, variant);
  const productId = String(product?.id ?? product?.publicId ?? '');
  const title = buildVariantTitle(product, variant);
  const currentPrice = availability ? Number(pricing.price || 0) : 0;
  const oldPrice = availability && pricing.hasDiscount && Number(pricing.oldPrice) > currentPrice ? Number(pricing.oldPrice) : null;

  return {
    requestedSize: variant?.size || '',
    requestedFabric: variant?.fabric || '',
    title,
    description,
    canonicalUrl,
    image: images[0] || `${baseUrl()}/assets/images/ukflag.png`,
    currentPrice: Math.max(0, Math.trunc(currentPrice)),
    oldPrice: oldPrice === null ? null : Math.max(0, Math.trunc(oldPrice)),
    availability,
    pageUnique: pageUnique(product, variant),
    variantKey: variant?.variantKey || BASE_VARIANT_ID,
    productGroupId: productId,
    categoryName: categoryName(product),
    spec: buildSpec(product, variant)
  };
};

module.exports = {
  BASE_VARIANT_ID,
  variantKey,
  pageUnique,
  parsePageUnique,
  parseProductPageUrl,
  getProductVariants,
  findVariant,
  findVariantByKey,
  resolveVariant,
  buildVariantTitle,
  buildPageUrl,
  formatProductForTorob,
  buildProductPageMeta,
  buildSpec,
  imageLinks,
  isAvailable,
  baseUrl
};
