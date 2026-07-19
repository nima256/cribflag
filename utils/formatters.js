const faDate = (date = new Date()) => new Intl.DateTimeFormat('fa-IR').format(new Date(date));
const orderNumber = () => `KR-${Math.floor(10000 + Math.random() * 89999)}`;
const publicCode = (prefix) => `${prefix}-${Math.floor(10000 + Math.random() * 89999)}`;
const normalizeMobile = (value = '') => String(value)
  .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[\s-]/g, '').replace(/^\+98/, '0');

module.exports = { faDate, orderNumber, publicCode, normalizeMobile };
