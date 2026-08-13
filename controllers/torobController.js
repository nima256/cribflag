const Product = require('../models/Product');
const {
  getProductVariants,
  findVariant,
  findVariantByKey,
  formatProductForTorob,
  baseUrl
} = require('../helper/torobProductMeta');

const PAGE_SIZE = 100;
const PRODUCT_SELECT = 'publicId title sku category categories price hasDiscount oldPrice variantPrices status inventoryMode stock sizes fabrics image images description createdAt updatedAt';

const buildResponse = ({ products, currentPage = 1, total = products.length, maxPages = 1 }) => ({
  api_version: 'torob_api_v3',
  current_page: currentPage,
  total,
  max_pages: maxPages,
  products
});

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const validateRequestMode = body => {
  const hasUrls = hasOwn(body, 'page_urls');
  const hasUniques = hasOwn(body, 'page_uniques');
  const hasPagination = hasOwn(body, 'page') || hasOwn(body, 'sort');
  const modeCount = [hasUrls, hasUniques, hasPagination].filter(Boolean).length;

  if (modeCount !== 1) return { error: 'Provide exactly one request mode: page_urls, page_uniques, or page with sort' };

  if (hasUrls) {
    if (!Array.isArray(body.page_urls) || body.page_urls.length < 1) return { error: 'page_urls must be a non-empty array' };
    if (body.page_urls.some(value => typeof value !== 'string' || !value.trim())) return { error: 'every page_urls item must be a non-empty string' };
    return { mode: 'urls' };
  }

  if (hasUniques) {
    if (!Array.isArray(body.page_uniques) || body.page_uniques.length < 1) return { error: 'page_uniques must be a non-empty array' };
    if (body.page_uniques.some(value => typeof value !== 'string' || !value.trim())) return { error: 'every page_uniques item must be a non-empty string' };
    return { mode: 'uniques' };
  }

  if (!hasOwn(body, 'page')) return { error: 'page parameter is not provided' };
  if (!hasOwn(body, 'sort')) return { error: 'sort parameter is not provided' };

  const page = Number.parseInt(body.page, 10);
  if (!Number.isInteger(page) || page < 1 || String(page) !== String(body.page).trim()) return { error: 'page must be a positive integer' };
  if (!['date_added_desc', 'date_updated_desc'].includes(body.sort)) return { error: 'sort parameter must be date_added_desc or date_updated_desc' };
  return { mode: 'pagination', page, sort: body.sort };
};

const parseProductPageUrl = rawUrl => {
  try {
    const url = new URL(rawUrl, baseUrl());
    const match = url.pathname.match(/^\/product\/(\d+)\/?$/i);
    if (!match) return null;
    const publicId = Number(match[1]);
    if (!Number.isInteger(publicId) || publicId < 1) return null;
    return {
      publicId,
      size: String(url.searchParams.get('size') || '').trim(),
      fabric: String(url.searchParams.get('fabric') || '').trim()
    };
  } catch {
    return null;
  }
};

const findActiveProductByPublicId = publicId => Product.findOne({ publicId, status: 'active' }).select(PRODUCT_SELECT).lean();

exports.torobApiV3 = async (req, res) => {
  try {
    const requestBody = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const validation = validateRequestMode(requestBody);
    if (validation.error) return res.status(400).json({ error: validation.error });

    if (validation.mode === 'urls') {
      const products = [];
      for (const rawUrl of requestBody.page_urls.slice(0, PAGE_SIZE)) {
        const parsed = parseProductPageUrl(rawUrl);
        if (!parsed) continue;
        const product = await findActiveProductByPublicId(parsed.publicId);
        if (!product) continue;
        const variant = findVariant(product, parsed.size, parsed.fabric);
        if (!variant) continue;
        products.push(formatProductForTorob(product, variant));
      }
      return res.json(buildResponse({ products }));
    }

    if (validation.mode === 'uniques') {
      const products = [];
      for (const unique of requestBody.page_uniques.slice(0, PAGE_SIZE)) {
        const match = String(unique).match(/^(\d+)_(.+)$/);
        if (!match) continue;
        const publicId = Number(match[1]);
        const key = match[2];
        const product = await findActiveProductByPublicId(publicId);
        if (!product) continue;
        const variant = findVariantByKey(product, key);
        if (!variant) continue;
        products.push(formatProductForTorob(product, variant));
      }
      return res.json(buildResponse({ products }));
    }

    const sortQuery = validation.sort === 'date_added_desc'
      ? { createdAt: -1, _id: -1 }
      : { updatedAt: -1, _id: -1 };
    const sourceProducts = await Product.find({ status: 'active' }).select(PRODUCT_SELECT).sort(sortQuery).lean();
    const allVariants = [];
    for (const product of sourceProducts) {
      for (const variant of getProductVariants(product)) allVariants.push(formatProductForTorob(product, variant));
    }

    const total = allVariants.length;
    const maxPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start = (validation.page - 1) * PAGE_SIZE;
    return res.json(buildResponse({
      products: allVariants.slice(start, start + PAGE_SIZE),
      currentPage: validation.page,
      total,
      maxPages
    }));
  } catch (error) {
    console.error('Torob API Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' ? { details: error.message } : {})
    });
  }
};

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const escapeXml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const loadAllFormattedVariants = async () => {
  const sourceProducts = await Product.find({ status: 'active' })
    .select(PRODUCT_SELECT)
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  const variants = [];
  for (const product of sourceProducts) {
    for (const variant of getProductVariants(product)) variants.push(formatProductForTorob(product, variant));
  }
  return variants;
};

exports.torobSitemapXml = async (_req, res) => {
  try {
    const variants = await loadAllFormattedVariants();
    const urls = variants.map(item => `  <url>\n    <loc>${escapeXml(item.page_url)}</loc>\n    <lastmod>${escapeXml(item.date_updated)}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.send(xml);
  } catch (error) {
    console.error('Torob XML Sitemap Error:', error);
    return res.status(500).type('text/plain').send('خطا در تولید نقشه سایت ترب');
  }
};

exports.torobSitemapHtml = async (_req, res) => {
  try {
    const variants = await loadAllFormattedVariants();
    const items = variants.map((item, index) => `
      <li class="product-item">
        <span>${index + 1}.</span>
        <a href="${escapeHtml(item.page_url)}">${escapeHtml(item.title)}</a>
        <span class="date">${escapeHtml(new Date(item.date_updated).toLocaleDateString('fa-IR'))}</span>
      </li>`).join('');
    const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow"><title>فهرست تنوع‌های ترب</title>
<style>body{font-family:Tahoma,Arial,sans-serif;margin:20px;background:#f5f5f5}.container{max-width:1200px;margin:auto;background:#fff;padding:20px;border-radius:8px}h1{color:#333;border-bottom:2px solid #3157d5;padding-bottom:10px}.product-list{list-style:none;padding:0}.product-item{margin:10px 0;padding:10px;border-bottom:1px solid #eee}.product-item a{text-decoration:none;color:#3157d5;font-size:16px}.date{color:#666;font-size:12px;margin-right:15px}.count{background:#3157d5;color:#fff;padding:5px 10px;border-radius:20px}</style>
</head><body><div class="container"><h1>فهرست محصولات و تنوع‌های سایز/پارچه</h1><p>تعداد کل URLها: <span class="count">${variants.length}</span></p><p><a href="/torob-sitemap.xml">مشاهده sitemap XML</a></p><ul class="product-list">${items}</ul></div></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (error) {
    console.error('Torob HTML Sitemap Error:', error);
    return res.status(500).send('خطا در تولید فهرست ترب');
  }
};

exports.torobSitemap = exports.torobSitemapXml;
exports._private = { buildResponse, validateRequestMode, parseProductPageUrl, loadAllFormattedVariants };
