const { faDate } = require('../utils/formatters');

const product = (p) => {
  const price = Number(p.price || 0);
  const rawOldPrice = Number(p.oldPrice);
  const rawVariants = Array.isArray(p.variantPrices) ? p.variantPrices : [];
  const legacyDiscount = p.hasDiscount === undefined && Number.isFinite(rawOldPrice) && rawOldPrice > price;
  const hasDiscount = Boolean(
    p.hasDiscount ||
    legacyDiscount ||
    rawVariants.some(item => Number(item.oldPrice) > Number(item.price))
  );
  const old = hasDiscount && Number.isFinite(rawOldPrice) && rawOldPrice > price ? rawOldPrice : null;
  const variantPrices = rawVariants.map(item => {
    const variantPrice = Number(item.price || 0);
    const variantOldPrice = Number(item.oldPrice);
    const variantHasDiscount = Boolean(hasDiscount && Number.isFinite(variantOldPrice) && variantOldPrice > variantPrice);
    return {
      size: item.size,
      fabric: item.fabric,
      price: variantPrice,
      hasDiscount: variantHasDiscount,
      oldPrice: variantHasDiscount ? variantOldPrice : null
    };
  });

  const rawImages = Array.isArray(p.images) && p.images.length ? p.images : [p.image];
  const images = [...new Set(rawImages.map(item => String(item || '').trim()).filter(Boolean))];
  if (!images.length) images.push('assets/images/ukflag.png');

  const categories = [...new Set([
    p.category,
    ...(Array.isArray(p.categories) ? p.categories : [])
  ].map(item => String(item || '').trim()).filter(Boolean))];

  return {
    id: p.publicId,
    title: p.title,
    sku: p.sku,
    category: categories[0] || p.category || '',
    categories,
    price,
    hasDiscount,
    old,
    variantPrices,
    badge: p.badge || '',
    date: p.sortDate || 1,
    rate: p.rate || 4.7,
    status: p.status,
    sales: p.sales || 0,
    sizes: p.sizes || [],
    fabrics: p.fabrics || [],
    image: images[0],
    images,
    description: p.description || '',
    stock: p.stock
  };
};


const user = (u, stats = {}) => ({
  id: u.publicId, name: u.fullName, phone: u.mobile, email: u.email || '', joined: faDate(u.createdAt),
  orders: stats.orders || 0, total: stats.total || 0, role: u.role, status: u.isActive ? 'active' : 'blocked'
});

const order = (o) => ({
  id: o.orderNumber, userId: o.user && typeof o.user === 'object' ? o.user.publicId : o.userPublicId,
  customer: o.customer, phone: o.phone, email: o.email || '', date: faDate(o.createdAt), createdAt: o.createdAt,
  total: o.total, subtotal: o.subtotal, shipping: o.shipping, discount: o.discount, couponCode: o.couponCode || '',
  customerNote: o.customerNote || '', status: o.status,
  payment: o.payment, paymentStatus: o.paymentStatus, shippingMethod: o.shippingMethod, tracking: o.tracking || '',
  address: o.address, adminNote: o.adminNote || '', items: (o.items || []).map((item, index) => {
    const value = item.toObject ? item.toObject() : item;
    return { ...value, id: value.productId ?? value.customRequestId ?? `order-item-${index}` };
  })
});

const coupon = (c) => ({
  id: c.publicId, code: c.code, type: c.type, value: c.value, min: c.minOrderAmount || 0,
  limit: c.usageLimit || 0, used: c.usedCount || 0, expires: c.displayExpires || (c.expiresAt ? faDate(c.expiresAt) : ''),
  status: c.status
});

const ticket = (t) => ({
  id: t.publicId, userId: t.user?.publicId, customer: t.customer, subject: t.subject,
  department: t.department, priority: t.priority, status: t.status, date: faDate(t.createdAt), messages: t.messages || []
});

const custom = (c) => ({
  id: c.publicId,
  userId: c.user?.publicId,
  customer: c.customer,
  phone: c.phone || '',
  email: c.email || '',
  province: c.province || '',
  city: c.city || '',
  postalCode: c.postalCode || '',
  address: c.address || '',
  shippingMethod: c.shippingMethod || '',
  deliveryNote: c.deliveryNote || '',
  createdAt: c.createdAt,
  fileName: c.fileName,

  size: c.size,
  fabric: c.fabric,
  notes: c.notes || '',
  status: c.status,
  price: c.price || 0,
  date: faDate(c.createdAt),
  adminNote: c.adminNote || '',

  /*
   * فقط Route امن ادمین ارسال می‌شود؛
   * مسیر واقعی فایل برای مرورگر فاش نمی‌شود.
   */
  downloadUrl: c.filePath
    ? `/api/admin/custom/${encodeURIComponent(c.publicId)}/download`
    : ''
});

const notification = (n) => ({ id: String(n._id), title: n.title, text: n.text, date: faDate(n.createdAt), read: n.read });
const address = (a, userPublicId) => ({ id: a.publicId, userId: userPublicId, title: a.title, receiver: a.receiver, phone: a.phone, postal: a.postal, province: a.province, city: a.city, address: a.address, default: a.default });
module.exports = { product, user, order, coupon, ticket, custom, notification, address };
