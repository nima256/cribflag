'use strict';

const PERSIAN_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

const faToEn = value => String(value || '')
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

const persianFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric'
});

function persianYearMonth(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const parts = persianFormatter.formatToParts(date);
  const year = Number(faToEn(parts.find(part => part.type === 'year')?.value));
  const month = Number(faToEn(parts.find(part => part.type === 'month')?.value));
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
}

function lastPersianMonths(count = 7, now = new Date()) {
  const current = persianYearMonth(now) || { year: 1400, month: 1 };
  const buckets = [];
  let year = current.year;
  let month = current.month;
  for (let index = 0; index < count; index += 1) {
    buckets.unshift({
      year,
      month,
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: `${PERSIAN_MONTHS[month - 1]} ${new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(year)}`,
      shortLabel: PERSIAN_MONTHS[month - 1]
    });
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return buckets;
}

function isPaidSale(order) {
  return order &&
    order.status !== 'cancelled' &&
    order.paymentStatus === 'paid' &&
    Number(order.total || 0) > 0;
}

function customerKey(order) {
  const populatedUser = order.user && typeof order.user === 'object' ? order.user : null;
  return String(
    populatedUser?.publicId ||
    populatedUser?._id ||
    order.user ||
    order.phone ||
    order.email ||
    order.customer ||
    order.orderNumber
  );
}

function buildAnalytics({ orders = [], products = [], users = [], now = new Date() } = {}) {
  const allOrders = Array.isArray(orders) ? orders : [];
  const paidOrders = allOrders.filter(isPaidSale);
  const monthly = lastPersianMonths(7, now).map(bucket => ({ ...bucket, revenue: 0, orders: 0 }));
  const monthlyByKey = new Map(monthly.map(bucket => [bucket.key, bucket]));

  const topProductMap = new Map();
  const topCustomerMap = new Map();

  for (const order of paidOrders) {
    const dateParts = persianYearMonth(order.createdAt);
    const bucket = dateParts ? monthlyByKey.get(dateParts.key) : null;
    if (bucket) {
      bucket.revenue += Number(order.total || 0);
      bucket.orders += 1;
    }

    for (const item of order.items || []) {
      const key = String(item.productId ?? item.title ?? 'unknown');
      const qty = Math.max(0, Number(item.qty || 0));
      const revenue = Math.max(0, Number(item.price || 0)) * qty;
      const current = topProductMap.get(key) || {
        id: item.productId ?? key,
        title: item.title || 'محصول بدون نام',
        quantity: 0,
        revenue: 0
      };
      current.quantity += qty;
      current.revenue += revenue;
      topProductMap.set(key, current);
    }

    const key = customerKey(order);
    const populatedUser = order.user && typeof order.user === 'object' ? order.user : null;
    const currentCustomer = topCustomerMap.get(key) || {
      id: populatedUser?.publicId || key,
      name: populatedUser?.fullName || order.customer || 'مشتری بدون نام',
      phone: populatedUser?.mobile || order.phone || '',
      orders: 0,
      total: 0
    };
    currentCustomer.orders += 1;
    currentCustomer.total += Number(order.total || 0);
    topCustomerMap.set(key, currentCustomer);
  }

  const totalRevenue = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const nonCancelled = allOrders.filter(order => order.status !== 'cancelled');
  const deliveredCount = allOrders.filter(order => order.status === 'delivered').length;
  const currentRevenue = monthly.at(-1)?.revenue || 0;
  const previousRevenue = monthly.at(-2)?.revenue || 0;
  const revenueGrowth = previousRevenue > 0
    ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100)
    : currentRevenue > 0 ? 100 : 0;

  const currentMonthKey = monthly.at(-1)?.key;
  const newCustomers = users.filter(user => persianYearMonth(user.createdAt)?.key === currentMonthKey).length;
  const statusCounts = {
    processing: 0,
    'design-review': 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0
  };
  for (const order of allOrders) {
    if (Object.prototype.hasOwnProperty.call(statusCounts, order.status)) statusCounts[order.status] += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    salesBasis: 'paid',
    totals: {
      revenue: totalRevenue,
      orders: allOrders.length,
      paidOrders: paidOrders.length,
      customers: users.length,
      products: products.length,
      activeProducts: products.filter(product => (product.status || 'active') === 'active').length,
      averageOrderValue: paidOrders.length ? Math.round(totalRevenue / paidOrders.length) : 0,
      completionRate: nonCancelled.length ? Math.round((deliveredCount / nonCancelled.length) * 100) : 0,
      newCustomers,
      revenueGrowth
    },
    monthlySales: monthly.map(({ key, label, shortLabel, year, month, revenue, orders: orderCount }) => ({
      key,
      label,
      shortLabel,
      year,
      month,
      revenue,
      orders: orderCount
    })),
    orderStatuses: statusCounts,
    topProducts: [...topProductMap.values()]
      .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
      .slice(0, 10),
    topCustomers: [...topCustomerMap.values()]
      .sort((a, b) => b.total - a.total || b.orders - a.orders)
      .slice(0, 10)
  };
}

module.exports = {
  PERSIAN_MONTHS,
  persianYearMonth,
  lastPersianMonths,
  isPaidSale,
  buildAnalytics
};
