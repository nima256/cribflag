'use strict';

function normalizePersianText(value) {
  return String(value || '')
    .trim()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک');
}

function slugifyArticle(value) {
  const slug = normalizePersianText(value)
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `article-${Date.now()}`;
}

function sanitizeArticleHtml(value) {
  let html = String(value || '').trim();
  html = html
    .replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select|option|link|meta)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select|option|link|meta)\b[^>]*\/?\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, ' $1="#"')
    .replace(/<!--([\s\S]*?)-->/g, '');

  const allowedTags = new Set(['p', 'br', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'blockquote', 'a', 'hr']);
  html = html.replace(/<\/?([a-z0-9-]+)(?:\s[^>]*)?>/gi, match => {
    const tag = String(match.match(/^<\/?\s*([a-z0-9-]+)/i)?.[1] || '').toLowerCase();
    if (!allowedTags.has(tag)) return '';
    if (tag !== 'a' || /^<\//.test(match)) return match.replace(/\s[^>]*>/, '>');
    const hrefMatch = match.match(/href\s*=\s*(["'])(.*?)\1/i);
    const href = hrefMatch?.[2] || '#';
    const safeHref = /^(https?:\/\/|\/|#|mailto:)/i.test(href) ? href : '#';
    return `<a href="${safeHref.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">`;
  });

  if (!/<[a-z][\s\S]*>/i.test(html)) {
    html = html
      .split(/\n{2,}/)
      .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }
  return html;
}

module.exports = { normalizePersianText, slugifyArticle, sanitizeArticleHtml };
