const crypto = require('crypto');
const env = require('../config/env');
const { prepareProductPricing, fallbackPricing } = require('../utils/productPricing');

const BASE_VARIANT_ID = 'base';
const clean = value => String(value ?? '').trim();
const unique = values => [...new Set(values.map(clean).filter(Boolean))];

const variantKey = (size = '', fabric = '') => {
  const normalizedSize = clean(size);
  const normalizedFabric = clean(fabric);
  if (!normalizedSize && !normalizedFabric) return BASE_VARIANT_ID;
  return `v-${crypto.createHash('sha256').update(`${normalizedSize}\u0000${normalizedFabric}`).digest('hex').slice(0, 24)}`;
};

const getProductVariants = product => {
  const prepared = prepareProductPricing(product || {});
  const pricedVariants = Array.isArray(prepared.variantPrices)
    ? prepared.variantPrices.filter(item => clean(item?.size) && clean(item?.fabric))
    : [];

  if (pricedVariants.length) {
    return pricedVariants.map((item, index) => ({
      size: clean(item.size),
      fabric: clean(item.fabric),
      variantKey: variantKey(item.size, item.fabric),
      pricing: {
        price: Number(item.price || 0),
        hasDiscount: Boolean(item.hasDiscount),
        oldPrice: item.hasDiscount && Number(item.oldPrice) > Number(item.price) ? Number(item.oldPrice) : null
      },
      index
    }));
  }

  const sizes = unique(Array.isArray(product?.sizes) ? product.sizes : []);
  const fabrics = unique(Array.isArray(product?.fabrics) ? product.fabrics : []);
  if (!sizes.length && !fabrics.length) {
    return [{ size: '', fabric: '', variantKey: BASE_VARIANT_ID, pricing: fallbackPricing(product), index: 0 }];
  }

  const sizeOptions = sizes.length ? sizes : [''];
  const fabricOptions = fabrics.length ? fabrics : [''];
  const pricing = fallbackPricing(product);
  const variants = [];
  for (const size of sizeOptions) {
    for (const fabric of fabricOptions) {
      variants.push({ size, fabric, variantKey: variantKey(size, fabric), pricing, index: variants.length });
    }
  }
  return variants;
};

const findVariant = (product, size = '', fabric = '') => {
  const variants = getProductVariants(product);
  const wantedSize = clean(size);
  const wantedFabric = clean(fabric);
  if (!wantedSize && !wantedFabric) return variants[0] || null;
  return variants.find(item => (!wantedSize || item.size === wantedSize) && (!wantedFabric || item.fabric === wantedFabric)) || null;
};

const findVariantByKey = (product, key) =>
  getProductVariants(product).find(item => item.variantKey === clean(key)) || null;

const buildVariantTitle = (product, descriptor = null) => {
  const variant = descriptor || getProductVariants(product)[0] || {};
  const parts = [clean(product?.title || product?.name)];
  if (variant.size) parts.push(`سایز ${variant.size}`);
  if (variant.fabric) parts.push(`پارچه ${variant.fabric}`);
  return parts.filter(Boolean).join(' - ');
};

const baseUrl = () => clean(process.env.SITE_BASE_URL || env.siteUrl || process.env.SITE_URL || 'https://cribflag.ir').replace(/\/+$/, '');

const buildPageUrl = (product, descriptor = null) => {
  const id = Number(product?.publicId ?? product?.id);
  const url = new URL(`/product/${encodeURIComponent(id)}`, baseUrl());
  const variant = descriptor || getProductVariants(product)[0] || {};

  // ترب برای هر تنوع، شناسه و URL مستقل می‌خواهد. variantKey شناسه پایدار
  // ترکیب سایز + جنس است؛ size/fabric هم برای رندر مستقیم همان انتخاب حفظ می‌شوند.
  if (variant.variantKey && variant.variantKey !== BASE_VARIANT_ID) {
    url.searchParams.set('variant', variant.variantKey);
  }
  if (variant.size) url.searchParams.set('size', variant.size);
  if (variant.fabric) url.searchParams.set('fabric', variant.fabric);
  return url.toString();
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

const isAvailable = product => product?.inventoryMode !== 'managed' || Number(product?.stock || 0) > 0;

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

const formatProductForTorob = (product, descriptor = null) => {
  const variant = descriptor || getProductVariants(product)[0];
  const availability = isAvailable(product);
  const pricing = variant?.pricing || fallbackPricing(product);
  const currentPrice = availability ? Number(pricing.price || 0) : 0;
  const oldPrice = availability && pricing.hasDiscount && Number(pricing.oldPrice) > currentPrice
    ? Number(pricing.oldPrice)
    : null;
  const productId = String(product?.publicId ?? product?.id ?? '');
  const description = compactDescription(product?.description);
  const subtitleParts = [];
  if (variant?.size) subtitleParts.push(`سایز ${variant.size}`);
  if (variant?.fabric) subtitleParts.push(`پارچه ${variant.fabric}`);

  return {
    page_unique: `${productId}_${variant?.variantKey || BASE_VARIANT_ID}`,
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

function safeIsoDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

const buildProductPageMeta = (product, requestedSize = '', requestedFabric = '') => {
  const variant = findVariant(product, requestedSize, requestedFabric) || getProductVariants(product)[0];
  const pricing = variant?.pricing || fallbackPricing(product);
  const availability = isAvailable(product);
  const canonicalUrl = buildPageUrl(product, variant);
  const images = imageLinks(product);
  const description = compactDescription(product?.description) || buildVariantTitle(product, variant);
  const productId = String(product?.id ?? product?.publicId ?? '');
  const pageUnique = `${productId}_${variant?.variantKey || BASE_VARIANT_ID}`;
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
    pageUnique,
    variantKey: variant?.variantKey || BASE_VARIANT_ID,
    productGroupId: productId,
    categoryName: categoryName(product),
    spec: buildSpec(product, variant)
  };
};

module.exports = {
  BASE_VARIANT_ID,
  variantKey,
  getProductVariants,
  findVariant,
  findVariantByKey,
  buildVariantTitle,
  buildPageUrl,
  formatProductForTorob,
  buildProductPageMeta,
  buildSpec,
  imageLinks,
  isAvailable,
  baseUrl
};
