'use strict';

const PERSIAN_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

const ORDER_STATUSES = ['processing', 'design-review', 'print-preparation', 'shipped', 'delivered', 'cancelled'];
const ANALYTICS_TIME_ZONE = 'Asia/Tehran';

const faToEn = value => String(value || '')
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

const persianFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: ANALYTICS_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric'
});

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function persianYearMonth(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const parts = persianFormatter.formatToParts(date);
  const year = Number(faToEn(parts.find(part => part.type === 'year')?.value));
  const month = Number(faToEn(parts.find(part => part.type === 'month')?.value));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
}

function lastPersianMonths(count = 7, now = new Date()) {
  const normalizedCount = Math.max(1, Math.min(24, Number(count) || 7));
  const current = persianYearMonth(now) || { year: 1400, month: 1 };
  const buckets = [];
  let year = current.year;
  let month = current.month;

  for (let index = 0; index < normalizedCount; index += 1) {
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
  return Boolean(
    order &&
    order.status !== 'cancelled' &&
    order.paymentStatus === 'paid' &&
    safeNumber(order.total) > 0
  );
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
    order.orderNumber ||
    'unknown'
  );
}

function buildAnalytics({ orders = [], products = [], users = [], now = new Date() } = {}) {
  const allOrders = Array.isArray(orders) ? orders : [];
  const allProducts = Array.isArray(products) ? products : [];
  const allUsers = Array.isArray(users) ? users : [];
  const paidOrders = allOrders.filter(isPaidSale);
  const monthly = lastPersianMonths(7, now).map(bucket => ({ ...bucket, revenue: 0, orders: 0 }));
  const monthlyByKey = new Map(monthly.map(bucket => [bucket.key, bucket]));
  const topProductMap = new Map();
  const topCustomerMap = new Map();

  for (const order of paidOrders) {
    const dateParts = persianYearMonth(order.createdAt);
    const bucket = dateParts ? monthlyByKey.get(dateParts.key) : null;
    if (bucket) {
      bucket.revenue += safeNumber(order.total);
      bucket.orders += 1;
    }

    for (const item of order.items || []) {
      const key = String(item.productId ?? item.title ?? 'unknown');
      const quantity = Math.max(0, safeNumber(item.qty ?? 1));
      const lineRevenue = Math.max(0, safeNumber(item.price)) * quantity;
      const current = topProductMap.get(key) || {
        id: item.productId ?? key,
        title: item.title || 'محصول بدون نام',
        quantity: 0,
        revenue: 0
      };
      current.quantity += quantity;
      current.revenue += lineRevenue;
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
    currentCustomer.total += safeNumber(order.total);
    topCustomerMap.set(key, currentCustomer);
  }

  const totalRevenue = paidOrders.reduce((sum, order) => sum + safeNumber(order.total), 0);
  const nonCancelled = allOrders.filter(order => order.status !== 'cancelled');
  const deliveredCount = nonCancelled.filter(order => order.status === 'delivered').length;
  const currentRevenue = monthly.at(-1)?.revenue || 0;
  const previousRevenue = monthly.at(-2)?.revenue || 0;
  const revenueGrowth = previousRevenue > 0
    ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100)
    : currentRevenue > 0 ? 100 : 0;

  const currentMonthKey = monthly.at(-1)?.key;
  const newCustomers = allUsers.filter(user => persianYearMonth(user.createdAt)?.key === currentMonthKey).length;
  const statusCounts = Object.fromEntries(ORDER_STATUSES.map(status => [status, 0]));
  for (const order of allOrders) {
    if (Object.prototype.hasOwnProperty.call(statusCounts, order.status)) {
      statusCounts[order.status] += 1;
    }
  }

  return {
    generatedAt: new Date(now).toISOString(),
    salesBasis: 'paid',
    totals: {
      revenue: totalRevenue,
      orders: allOrders.length,
      paidOrders: paidOrders.length,
      customers: allUsers.length,
      products: allProducts.length,
      activeProducts: allProducts.filter(product => (product.status || 'active') === 'active').length,
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
  ORDER_STATUSES,
  ANALYTICS_TIME_ZONE,
  persianYearMonth,
  lastPersianMonths,
  isPaidSale,
  buildAnalytics
};
