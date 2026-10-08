'use strict';
process.env.NODE_ENV = 'development';
process.env.SITE_URL = 'https://cribflag.ir';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getProductVariants,
  formatProductForTorob,
  buildProductPageMeta,
  parsePageUnique,
  parseProductPageUrl,
  resolveVariant
} = require('../helper/torobProductMeta');

const baseProduct = overrides => ({
  publicId: 42,
  id: 42,
  title: 'پرچم تست',
  sku: 'TEST-42',
  category: 'پرچم',
  price: 500000,
  hasDiscount: false,
  oldPrice: null,
  variantPrices: [],
  status: 'active',
  inventoryMode: 'unlimited',
  stock: 0,
  sizes: ['70×50', '100×70'],
  fabrics: ['ساتن', 'مخمل'],
  image: '/assets/images/test.webp',
  images: ['/assets/images/test.webp'],
  description: 'توضیح تست',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  ...overrides
});

test('size x fabric combinations are expanded and stable', () => {
  const p = baseProduct();
  const a = getProductVariants(p);
  const b = getProductVariants({ ...p, stock: 999, price: 999999 });
  assert.equal(a.length, 4);
  assert.deepEqual(a.map(x => x.variantKey), b.map(x => x.variantKey));
  assert.equal(new Set(a.map(x => x.variantKey)).size, 4);
});

test('explicit variant prices define combinations and prices', () => {
  const p = baseProduct({
    variantPrices: [
      { size: '70×50', fabric: 'ساتن', price: 600000 },
      { size: '100×70', fabric: 'مخمل', price: 900000 }
    ]
  });
  const variants = getProductVariants(p);
  assert.equal(variants.length, 2);
  assert.deepEqual(variants.map(x => x.pricing.price).sort((a,b)=>a-b), [600000, 900000]);
});

test('all variants follow only the parent stock state', () => {
  const inStock = baseProduct({ inventoryMode: 'managed', stock: 1 });
  const outOfStock = baseProduct({ inventoryMode: 'managed', stock: 0 });
  const a = getProductVariants(inStock).map(v => formatProductForTorob(inStock, v));
  const b = getProductVariants(outOfStock).map(v => formatProductForTorob(outOfStock, v));
  assert.ok(a.every(x => x.availability === true && x.current_price > 0));
  assert.ok(b.every(x => x.availability === false && x.current_price === 0));
});

test('every variant has unique id, group id and size/fabric landing URL', () => {
  const p = baseProduct();
  const items = getProductVariants(p).map(v => formatProductForTorob(p, v));
  assert.equal(new Set(items.map(x => x.page_unique)).size, 4);
  assert.ok(items.every(x => x.product_group_id === '42'));
  for (const item of items) {
    const parsed = parsePageUnique(item.page_unique);
    assert.equal(parsed.publicId, 42);
    const url = parseProductPageUrl(item.page_url);
    assert.equal(url.publicId, 42);
    const variant = resolveVariant(p, url);
    assert.ok(variant);
    assert.equal(item.spec['سایز'], variant.size);
    assert.equal(item.spec['جنس پارچه'], variant.fabric);
  }
});

test('variant parameter resolves exact landing selection', () => {
  const p = baseProduct();
  const wanted = getProductVariants(p)[2];
  const meta = buildProductPageMeta(p, wanted.size, wanted.fabric, wanted.variantKey);
  assert.equal(meta.requestedSize, wanted.size);
  assert.equal(meta.requestedFabric, wanted.fabric);
  assert.equal(meta.variantKey, wanted.variantKey);
});

test('mismatched variant/size/fabric request fails exact resolver', () => {
  const p = baseProduct();
  const wanted = getProductVariants(p)[0];
  const other = getProductVariants(p)[1];
  assert.equal(resolveVariant(p, { variant: wanted.variantKey, size: other.size, fabric: other.fabric }), null);
});
