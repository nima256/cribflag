const faDate = (date = new Date()) => new Intl.DateTimeFormat('fa-IR').format(new Date(date));

const normalizeDigits = (value = '') => String(value)
  .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

const persianCalendar = new Intl.DateTimeFormat('en-US-u-ca-persian', {
  year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Tehran'
});

function parsePersianDate(value) {
  const normalized = normalizeDigits(value).trim();
  if (!normalized) return null;
  const match = normalized.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!match) return null;
  const targetYear = Number(match[1]);
  const targetMonth = Number(match[2]);
  const targetDay = Number(match[3]);
  if (targetMonth < 1 || targetMonth > 12 || targetDay < 1 || targetDay > 31) return null;

  if (targetYear >= 1700) {
    const result = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, 23, 59, 59, 999));
    return Number.isNaN(result.getTime()) || result.getUTCMonth() !== targetMonth - 1 ? null : result;
  }
  if (targetYear < 1200 || targetYear > 1700) return null;

  const start = Date.UTC(targetYear + 621, 2, 1);
  for (let offset = 0; offset < 400; offset += 1) {
    const candidate = new Date(start + offset * 86400000);
    const parts = Object.fromEntries(
      persianCalendar.formatToParts(candidate)
        .filter(part => ['year', 'month', 'day'].includes(part.type))
        .map(part => [part.type, Number(part.value)])
    );
    if (parts.year === targetYear && parts.month === targetMonth && parts.day === targetDay) {
      return new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate(), 23, 59, 59, 999));
    }
  }
  return null;
}

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

module.exports = { faDate, orderNumber, publicCode, normalizeMobile, normalizeDigits, parsePersianDate };
