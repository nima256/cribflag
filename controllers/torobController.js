const Product = require('../models/Product');
const {
  getProductVariants,
  findVariantByKey,
  resolveVariant,
  parsePageUnique,
  parseProductPageUrl,
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
  next_cursor: null,
  products
});

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const validateLookupArray = (body, key) => {
  if (!Array.isArray(body[key]) || body[key].length < 1 || body[key].length > PAGE_SIZE) {
    return `${key} must contain between 1 and ${PAGE_SIZE} items`;
  }
  if (body[key].some(value => typeof value !== 'string' || !value.trim())) {
    return `every ${key} item must be a non-empty string`;
  }
  return '';
};

const validateRequestMode = body => {
  const hasUrls = hasOwn(body, 'page_urls');
  const hasUniques = hasOwn(body, 'page_uniques');
  const hasPagination = hasOwn(body, 'page') || hasOwn(body, 'sort');
  const modeCount = [hasUrls, hasUniques, hasPagination].filter(Boolean).length;

  if (modeCount !== 1) return { error: 'Provide exactly one request mode: page_urls, page_uniques, or page with sort' };

  if (hasUrls) {
    const error = validateLookupArray(body, 'page_urls');
    return error ? { error } : { mode: 'urls' };
  }

  if (hasUniques) {
    const error = validateLookupArray(body, 'page_uniques');
    return error ? { error } : { mode: 'uniques' };
  }

  if (!hasOwn(body, 'page')) return { error: 'page parameter is not provided' };
  if (!hasOwn(body, 'sort')) return { error: 'sort parameter is not provided' };

  const page = Number.parseInt(body.page, 10);
  if (!Number.isInteger(page) || page < 1 || page > 100000 || String(page) !== String(body.page).trim()) {
    return { error: 'page must be a positive integer' };
  }
  if (!['date_added_desc', 'date_updated_desc', 'product_id_desc'].includes(body.sort)) {
    return { error: 'sort parameter must be date_added_desc, date_updated_desc or product_id_desc' };
  }
  return { mode: 'pagination', page, sort: body.sort };
};

const findActiveProducts = async publicIds => {
  const ids = [...new Set(publicIds.filter(id => Number.isInteger(id) && id > 0))];
  if (!ids.length) return new Map();
  const rows = await Product.find({ publicId: { $in: ids }, status: 'active' })
    .select(PRODUCT_SELECT)
    .lean();
  return new Map(rows.map(product => [Number(product.publicId), product]));
};

exports.torobApiV3 = async (req, res) => {
  try {
    const requestBody = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const validation = validateRequestMode(requestBody);
    if (validation.error) return res.status(400).json({ error: validation.error });

    if (validation.mode === 'urls') {
      const requests = requestBody.page_urls.map(parseProductPageUrl);
      const lookup = await findActiveProducts(requests.filter(Boolean).map(item => item.publicId));
      const products = requests.map(request => {
        if (!request) return null;
        const product = lookup.get(request.publicId);
        if (!product) return null;
        const variant = resolveVariant(product, request);
        return variant ? formatProductForTorob(product, variant) : null;
      }).filter(Boolean);
      return res.json(buildResponse({ products }));
    }

    if (validation.mode === 'uniques') {
      const requests = requestBody.page_uniques.map(parsePageUnique);
      const lookup = await findActiveProducts(requests.filter(Boolean).map(item => item.publicId));
      const products = requests.map(request => {
        if (!request) return null;
        const product = lookup.get(request.publicId);
        if (!product) return null;
        const variant = findVariantByKey(product, request.variantKey);
        if (!variant) return null;
        const formatted = formatProductForTorob(product, variant);
        return formatted.page_unique === request.raw ? formatted : null;
      }).filter(Boolean);
      return res.json(buildResponse({ products }));
    }

    const sortQuery = validation.sort === 'date_added_desc'
      ? { createdAt: -1, _id: -1 }
      : validation.sort === 'product_id_desc'
        ? { publicId: -1, _id: -1 }
        : { updatedAt: -1, _id: -1 };

    const sourceProducts = await Product.find({ status: 'active' })
      .select(PRODUCT_SELECT)
      .sort(sortQuery)
      .lean();

    // Torob pagination is over individual size × fabric offers, not parent products.
    const allVariants = [];
    for (const product of sourceProducts) {
      for (const variant of getProductVariants(product)) {
        allVariants.push(formatProductForTorob(product, variant));
      }
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

const sitemapUrlEntry = ({ loc, lastmod = '', changefreq = 'weekly', priority = '0.5' }) => {
  const lastmodLine = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : '';
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmodLine}\n    <changefreq>${escapeXml(changefreq)}</changefreq>\n    <priority>${escapeXml(priority)}</priority>\n  </url>`;
};

exports.siteSitemapXml = async (_req, res) => {
  try {
    const variants = await loadAllFormattedVariants();
    const base = baseUrl();
    const staticPages = [
      { loc: `${base}/`, changefreq: 'daily', priority: '1.0' },
      { loc: `${base}/store`, changefreq: 'daily', priority: '0.9' },
      { loc: `${base}/custom`, changefreq: 'weekly', priority: '0.7' },
      { loc: `${base}/ready`, changefreq: 'weekly', priority: '0.7' },
      { loc: `${base}/blog`, changefreq: 'weekly', priority: '0.6' },
      { loc: `${base}/faq`, changefreq: 'monthly', priority: '0.4' }
    ];
    const productPages = variants.map(item => ({
      loc: item.page_url,
      lastmod: item.date_updated,
      changefreq: 'daily',
      priority: '0.8'
    }));
    const seen = new Set();
    const urls = [...staticPages, ...productPages]
      .filter(item => {
        if (!item.loc || seen.has(item.loc)) return false;
        seen.add(item.loc);
        return true;
      })
      .map(sitemapUrlEntry)
      .join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.send(xml);
  } catch (error) {
    console.error('Site Sitemap Error:', error);
    return res.status(500).type('text/plain').send('خطا در تولید نقشه سایت');
  }
};

exports.robotsTxt = (_req, res) => {
  const base = baseUrl();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    `Sitemap: ${base}/sitemap.xml`,
    `Sitemap: ${base}/torob-sitemap.xml`
  ].join('\n'));
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
