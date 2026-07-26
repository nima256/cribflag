const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { AppError } = require('../utils/http');

const LEGACY_SETTINGS = {
  'فلگ دیواری': { sortOrder: 10, showInMenu: true, showInStore: true, showInHome: true, image: '/assets/images/divari.png' },
  'پرچم ایران': { sortOrder: 20, showInMenu: true, showInStore: true, showInHome: true },
  'پرچم کشورها': { sortOrder: 30, showInMenu: true, showInStore: true, showInHome: true, image: '/assets/images/rotakhti.png' },
  'پرچم تشریفات': { sortOrder: 40, showInMenu: true, showInStore: true, showInHome: true, image: '/assets/images/makhmal.png' },
  'پرچم رومیزی': { sortOrder: 50, showInMenu: true, showInStore: true, showInHome: true, image: '/assets/images/poster.png' },
  'پرچم ساحلی': { sortOrder: 60, showInMenu: true, showInStore: true, showInHome: true, image: '/assets/images/robaleshti.png' },
  'پرچم مناسبتی': { sortOrder: 70, showInMenu: true, showInStore: true, showInHome: true, showInReady: true },
  'سفارش عمده': { sortOrder: 80, showInMenu: true, showInStore: true, showInHome: false },
  'دکور اتاق': { sortOrder: 90, showInMenu: false, showInStore: false, showInHome: false, showInReady: true },
  'مینیمال': { sortOrder: 100, showInMenu: false, showInStore: false, showInHome: false, showInReady: true },
  'باشگاهی': { sortOrder: 110, showInMenu: false, showInStore: false, showInHome: false, showInReady: true },
  'برندینگ': { sortOrder: 120, showInMenu: false, showInStore: false, showInHome: false, showInReady: true },
  'طرح آماده': { sortOrder: 999, showInMenu: false, showInStore: false, showInHome: false, showInReady: false, isReadyRoot: true }
};

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))];
}

function categoryPayload(category, productCount = 0) {
  if (!category) return null;
  return {
    id: category.publicId,
    mongoId: String(category._id),
    name: category.name,
    slug: category.slug,
    description: category.description || '',
    image: category.image || '',
    status: category.status,
    sortOrder: Number(category.sortOrder || 0),
    showInMenu: Boolean(category.showInMenu),
    showInStore: Boolean(category.showInStore),
    showInHome: Boolean(category.showInHome),
    showInReady: Boolean(category.showInReady),
    isReadyRoot: Boolean(category.isReadyRoot),
    productCount: Number(productCount || 0)
  };
}

async function nextCategoryId() {
  const last = await Category.findOne().sort({ publicId: -1 }).select('publicId').lean();
  return Number(last?.publicId || 0) + 1;
}

async function ensureLegacyCategories() {
  const productRows = await Product.find().select('category categories primaryCategory categoryRefs').lean();
  const productNames = uniqueStrings(productRows.flatMap(product => [product.category, ...(product.categories || [])]));

  let categories = await Category.find().sort({ sortOrder: 1, publicId: 1 }).lean();
  // در نصب‌های قدیمی ممکن است کالکشن Category کاملاً خالی باشد. در این حالت
  // دسته‌های پایه را هم می‌سازیم تا پنل محصول هیچ‌وقت بدون گزینه نماند.
  const names = uniqueStrings([
    ...(categories.length ? [] : Object.keys(LEGACY_SETTINGS)),
    ...productNames
  ]);

  const existingNames = new Set(categories.map(category => category.name));
  const existingSlugs = new Set(categories.map(category => category.slug));
  let nextId = Math.max(0, ...categories.map(category => Number(category.publicId || 0))) + 1;

  for (const name of names) {
    const slug = Category.normalizeSlug(name);
    if (existingNames.has(name) || existingSlugs.has(slug)) continue;
    const settings = LEGACY_SETTINGS[name] || {};
    try {
      const created = await Category.create({ publicId: nextId++, name, slug, ...settings });
      existingNames.add(created.name);
      existingSlugs.add(created.slug);
    } catch (error) {
      // اگر دو درخواست هم‌زمان مهاجرت را اجرا کردند، رکورد ساخته‌شده توسط
      // درخواست دیگر معتبر است و نباید bootstrap پنل را خراب کند.
      if (error?.code !== 11000) throw error;
    }
  }

  categories = await Category.find().sort({ sortOrder: 1, publicId: 1 }).lean();
  const byName = new Map(categories.map(category => [category.name, category]));
  const operations = [];

  for (const product of productRows) {
    const productNamesForRow = uniqueStrings([product.category, ...(product.categories || [])]);
    const refs = productNamesForRow.map(name => byName.get(name)?._id).filter(Boolean);
    if (!refs.length) continue;
    const primary = byName.get(product.category)?._id || refs[0];
    const currentRefs = (product.categoryRefs || []).map(String);
    const nextRefs = refs.map(String);
    const needsLink = String(product.primaryCategory || '') !== String(primary) || currentRefs.join('|') !== nextRefs.join('|');
    if (needsLink) {
      operations.push({
        updateOne: {
          filter: { _id: product._id },
          update: { $set: { primaryCategory: primary, categoryRefs: refs } }
        }
      });
    }
  }
  if (operations.length) await Product.bulkWrite(operations);
  return categories;
}

async function listCategories({ activeOnly = false, withCounts = false } = {}) {
  const filter = activeOnly ? { status: 'active' } : {};
  const categories = await Category.find(filter).sort({ sortOrder: 1, publicId: 1 }).lean();
  if (!withCounts) return categories.map(category => categoryPayload(category));

  const counts = await Product.aggregate([
    { $unwind: { path: '$categoryRefs', preserveNullAndEmptyArrays: false } },
    { $group: { _id: '$categoryRefs', count: { $sum: 1 } } }
  ]);
  const countMap = new Map(counts.map(item => [String(item._id), item.count]));
  return categories.map(category => categoryPayload(category, countMap.get(String(category._id)) || 0));
}

async function resolveCategorySelection(input = {}) {
  const rawIds = Array.isArray(input.categoryIds) ? input.categoryIds : [];
  const numericIds = uniqueStrings(rawIds).map(Number).filter(Number.isFinite);
  const objectIds = uniqueStrings(rawIds).filter(value => mongoose.isValidObjectId(value));
  const slugs = uniqueStrings(input.categorySlugs || []);
  const names = uniqueStrings(input.categories || (input.category ? [input.category] : []));

  const or = [];
  if (numericIds.length) or.push({ publicId: { $in: numericIds } });
  if (objectIds.length) or.push({ _id: { $in: objectIds } });
  if (slugs.length) or.push({ slug: { $in: slugs } });
  if (names.length) or.push({ name: { $in: names } });
  if (!or.length) throw new AppError(400, 'حداقل یک دسته‌بندی معتبر انتخاب کنید');

  const found = await Category.find({ $or: or }).sort({ sortOrder: 1, publicId: 1 }).lean();
  const byPublicId = new Map(found.map(category => [String(category.publicId), category]));
  const byObjectId = new Map(found.map(category => [String(category._id), category]));
  const bySlug = new Map(found.map(category => [category.slug, category]));
  const byName = new Map(found.map(category => [category.name, category]));
  const ordered = [];
  const push = category => { if (category && !ordered.some(item => String(item._id) === String(category._id))) ordered.push(category); };

  rawIds.forEach(value => push(byPublicId.get(String(value)) || byObjectId.get(String(value))));
  slugs.forEach(value => push(bySlug.get(value)));
  names.forEach(value => push(byName.get(value)));
  found.forEach(push);

  if (!ordered.length) throw new AppError(400, 'دسته‌بندی انتخاب‌شده در دیتابیس پیدا نشد');
  return {
    primaryCategory: ordered[0]._id,
    categoryRefs: ordered.map(category => category._id),
    category: ordered[0].name,
    categories: ordered.map(category => category.name),
    categoryIds: ordered.map(category => category.publicId),
    categorySlugs: ordered.map(category => category.slug)
  };
}

async function syncProductCategoryNames() {
  const categories = await Category.find().lean();
  const byId = new Map(categories.map(category => [String(category._id), category]));
  const products = await Product.find({ categoryRefs: { $exists: true, $ne: [] } });
  for (const product of products) {
    const selected = (product.categoryRefs || []).map(id => byId.get(String(id))).filter(Boolean);
    if (!selected.length) continue;
    const primary = byId.get(String(product.primaryCategory)) || selected[0];
    product.primaryCategory = primary._id;
    product.categoryRefs = [primary, ...selected.filter(category => String(category._id) !== String(primary._id))].map(category => category._id);
    product.category = primary.name;
    product.categories = [primary, ...selected.filter(category => String(category._id) !== String(primary._id))].map(category => category.name);
    await product.save();
  }
}

module.exports = {
  LEGACY_SETTINGS,
  categoryPayload,
  ensureLegacyCategories,
  listCategories,
  nextCategoryId,
  resolveCategorySelection,
  syncProductCategoryNames,
  uniqueStrings
};
