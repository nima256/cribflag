const faDate = (date = new Date()) => new Intl.DateTimeFormat('fa-IR').format(new Date(date));
const orderNumber = () => `KR-${Math.floor(10000 + Math.random() * 89999)}`;
const publicCode = (prefix) => `${prefix}-${Math.floor(10000 + Math.random() * 89999)}`;
const normalizeMobile = (value = '') => {
  let mobile = String(value)
    .trim()
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\d+]/g, '');

  mobile = mobile
    .replace(/^\+98/, '0')
    .replace(/^0098/, '0')
    .replace(/^98(?=9\d{9}$)/, '0');

  if (/^9\d{9}$/.test(mobile)) mobile = `0${mobile}`;
  return mobile;
};

module.exports = { faDate, orderNumber, publicCode, normalizeMobile };
