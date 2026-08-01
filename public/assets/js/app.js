const PRODUCT_IMAGE = "/assets/images/ukflag.png";
const DEFAULT_SIZES = window.CribData?.DEFAULT_SIZES || ["۱۵۰ × ۹۰ سانتی‌متر","۱۰۰ × ۷۰ سانتی‌متر","۵۰ × ۷۰ سانتی‌متر"];
const DEFAULT_FABRICS = window.CribData?.DEFAULT_FABRICS || ["ساتن آمریکایی","ساتن براق","مخمل"];

const defaultProducts = [];
let products=(Array.isArray(window.__INITIAL_PRODUCTS__)?window.__INITIAL_PRODUCTS__:defaultProducts).map(normalizeProductPricing);

let categories = Array.isArray(window.__INITIAL_CATEGORIES__) ? window.__INITIAL_CATEGORIES__ : [];
let readyRootCategory = window.__READY_ROOT_CATEGORY__ || null;
let readyDesigns = Array.isArray(window.__READY_DESIGNS__)?window.__READY_DESIGNS__.map(normalizeProductPricing):[];

const faqItems = [
      { q: "بعد از پرداخت امکان تغییر طرح یا برگشت هزینه وجود دارد؟", a: "حتی یک ثانیه بعد از پرداخت وجه، نه امکان تعویض طرح دارید نه برگشت هزینه؛ چون سفارش وارد فرایند چاپ می‌شود و پارچه استفاده‌شده قابل بازگشت به حالت قبل نیست." },
      { q: "ارسال سفارش چقدر زمان می‌برد؟", a: "از زمان ثبت سفارش تا ۴ روز کاری بسته‌ها فقط با تیپاکس ارسال می‌شوند." },
      { q: "اگر کیفیت طرح پایین باشد چه می‌شود؟", a: "ما تمام تلاشمان را در طراحی می‌کنیم که طرح برای چاپ تمیز آماده شود، ولی هرچه طرح اولیه واضح‌تر باشد، خروجی نهایی حرفه‌ای‌تر خواهد بود." },
      { q: "جنس پارچه و کیفیت چاپ چطور است؟", a: "جنس پارچه از میان ساتن آمریکایی، ساتن براق و مخمل قابل انتخاب است و چاپ با کیفیت بالا، طرح را نزدیک به فایل ارسالی شما نمایش می‌دهد." },
      { q: "اگر پرچم موقع رسیدن چروک بود چه کار کنیم؟", a: "چون پرچم‌ها تا می‌شوند، ممکن است وقتی به دستتان می‌رسد کمی چروک باشند. می‌توانید با دمای پایین اتو بزنید." },
      { q: "طراحی رایگان است؟", a: "طراحی تا جایی که در توان ما باشد رایگان انجام می‌شود." },
      { q: "روش شست‌وشوی پرچم چیست؟", a: "برای شست‌وشو از آب ولرم یا سرد استفاده کنید و خیلی آرام با دست تمیزش کنید. نپیچانید، چنگ نزنید و نچلانید." },
      { q: "هر طرحی قابل چاپ است؟", a: "هر طرحی که مشکل امنیتی یا مغایرت با قوانین جمهوری اسلامی ایران نداشته باشد قابل چاپ است." },
      { q: "محصولات آماده برای سفارش دارید؟", a: "همه پرچم‌ها پس از ثبت سفارش چاپ می‌شوند و طرح‌های آماده نیز به همین روش قابل سفارش هستند." },
      { q: "برای نصب پرچم چه چیزی بهتر است؟", a: "پونز بهترین گزینه برای نصب است. چسب دوطرفه و موارد مشابه ممکن است چون محصول پارچه‌ای است، به‌مرور کنده شود." },
      { q: "آیا سایز دلخواه هم چاپ می‌کنید؟", a: "عرض دستگاه ۱.۵ متر است. اگر طرح با سایز دلخواه بخواهید چاپ می‌شود، ولی هزینه آن بیشتر می‌شود." },
      { q: "پرچم‌ها دو رو چاپ می‌شوند؟", a: "پرچم‌ها تک رو چاپ می‌شوند. اگر بخواهید دو رو باشد، باید دو عدد پرچم بگیرید تا از پشت به هم دوخته شوند." }
    ];

const blogPosts = [
      {
        id: 1,
        tag: "راهنمای خرید",
        title: "بهترین سایز پرچم دیواری برای اتاق چیست؟",
        text: "چطور سایزی انتخاب کنیم که نه کوچک دیده شود و نه دیوار را بیش از حد شلوغ کند.",
        date: "۱۴۰۵/۰۴/۱۰",
        read: "۵ دقیقه مطالعه",
        body: `
          <p>انتخاب سایز پرچم دیواری به اندازه دیوار، فاصله دید و سبک دکور اتاق بستگی دارد. اگر دیوار کوچک است، سایز ۱۲۰ در ۷۰ معمولا انتخاب متعادلی است. اگر می‌خواهید پرچم بیشتر دیده شود، سایز ۱۵۰ در ۹۰ جلوه قوی‌تری دارد.</p>
          <h2>سایز ۱۲۰ × ۷۰ برای چه فضاهایی مناسب است؟</h2>
          <p>این سایز برای اتاق خواب، بالای میز کار، کنار کتابخانه و فضاهای متوسط مناسب است. نصب آن ساده‌تر است و پارچه روی دیوار جمع نمی‌شود.</p>
          <h2>سایز ۱۵۰ × ۹۰ برای چه فضاهایی بهتر است؟</h2>
          <p>اگر دیوار بزرگ‌تری دارید یا پرچم قرار است نقطه اصلی دکور باشد، سایز ۱۵۰ در ۹۰ انتخاب چشمگیرتری است. این سایز برای کافه، فروشگاه، باشگاه و استودیو هم مناسب است.</p>
          <p>برای نتیجه بهتر، قبل از سفارش جای نصب را اندازه بگیرید و فضای خالی اطراف پرچم را هم در نظر بگیرید.</p>
        `
      },
      {
        id: 2,
        tag: "نگهداری",
        title: "روش درست شست‌وشوی پارچه ساتن",
        text: "برای حفظ کیفیت چاپ، شست‌وشو باید با آب سرد یا ولرم و بدون چنگ زدن انجام شود.",
        date: "۱۴۰۵/۰۴/۰۸",
        read: "۴ دقیقه مطالعه",
        body: `
          <p>پارچه ساتن برای چاپ پرچم ظاهر براق و جذابی دارد، اما برای حفظ کیفیت چاپ باید با دقت شسته شود. آب خیلی گرم، چنگ زدن و چلاندن می‌تواند به بافت پارچه یا کیفیت چاپ آسیب بزند.</p>
          <h2>روش پیشنهادی شست‌وشو</h2>
          <p>از آب سرد یا ولرم استفاده کنید. پرچم را خیلی آرام با دست تمیز کنید و از پیچاندن یا چنگ زدن خودداری کنید.</p>
          <h2>خشک کردن پرچم</h2>
          <p>پرچم را روی سطح صاف و دور از نور مستقیم خورشید قرار دهید تا آرام خشک شود. خشک‌کن یا گرمای مستقیم توصیه نمی‌شود.</p>
        `
      },
      {
        id: 3,
        tag: "چاپ و طراحی",
        title: "چرا کیفیت عکس برای چاپ پرچم مهم است؟",
        text: "هر چقدر فایل اولیه واضح‌تر باشد، خروجی چاپ تمیزتر، شارپ‌تر و حرفه‌ای‌تر دیده می‌شود.",
        date: "۱۴۰۵/۰۴/۰۶",
        read: "۶ دقیقه مطالعه",
        body: `
          <p>کیفیت چاپ نهایی وابسته به کیفیت تصویر اولیه است. اگر تصویر تار، کوچک یا بی‌کیفیت باشد، چاپ هم نمی‌تواند کاملا شارپ و واضح شود.</p>
          <h2>چه فایلی برای چاپ بهتر است؟</h2>
          <p>طرح واضح، نوشته خوانا و چیدمان مناسب باعث می‌شود چاپ نهایی تمیزتر و حرفه‌ای‌تر دیده شود.</p>
          <h2>قبل از ثبت سفارش چه کنیم؟</h2>
          <p>طرح را روی صفحه بزرگ بررسی کنید، نوشته‌ها را بخوانید و مطمئن شوید جزئیات و اندازه‌ها برای چاپ مناسب هستند.</p>
        `
      },
      {
        id: 4,
        tag: "نصب",
        title: "پونز بهتر است یا چسب دوطرفه؟",
        text: "برای نصب پرچم پارچه‌ای روی دیوار، پونز معمولا انتخاب مطمئن‌تر و تمیزتری است.",
        date: "۱۴۰۵/۰۴/۰۵",
        read: "۳ دقیقه مطالعه",
        body: `
          <p>چون پرچم از جنس پارچه است، چسب دوطرفه ممکن است به‌مرور از پارچه جدا شود یا روی دیوار اثر بگذارد. پونز معمولا نصب محکم‌تر و ساده‌تری ایجاد می‌کند.</p>
          <h2>نکات نصب تمیز</h2>
          <p>پرچم را قبل از نصب صاف کنید. اگر چروک دارد با دمای پایین اتو بزنید. سپس از گوشه‌ها نصب کنید تا پارچه کشیده و مرتب دیده شود.</p>
        `
      }
    ];

const countryCodes = [
      "IR","TR","AE","SA","QA","KW","OM","IQ","AF","PK","IN","CN","JP","KR","RU","US","CA","GB","FR","DE","IT","ES","PT","NL","BE","CH","AT","SE","NO","DK","FI","PL","CZ","GR","BR","AR","MX","CL","CO","PE","ZA","EG","MA","DZ","TN","AU","NZ","MY","ID","TH","VN","PH","SG","LB","SY","JO","YE","BH","AZ","AM","GE","UA","RO","HU","IE","IS","LU","HR","RS","SK","SI","BG","LT","LV","EE","BY","KZ","UZ","TJ","TM","KG","IL"
    ];

    const restrictedCountryCodes = ["IL"];

const PAGE_ROUTES = {
  home: "/", store: "/store", product: "/store", custom: "/custom",
  ready: "/ready", faq: "/faq", blog: "/blog", "blog-detail": "/blog/1",
  cart: "/cart", checkout: "/checkout", success: "/payment/success"
};
const CART_KEY = "cribFlagCartV2";
const CUSTOM_PRICING_VERSION = "20260730-v4";
const CUSTOM_SIZE_TIERS = Object.freeze([
  Object.freeze({ maxLong: 70, maxShort: 50, price: 550000, velvetPrice: 700000 }),
  Object.freeze({ maxLong: 100, maxShort: 70, price: 800000, velvetPrice: 1000000 }),
  Object.freeze({ maxLong: 150, maxShort: 90, price: 950000, velvetPrice: 1200000 })
]);

function normalizeCustomDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/,/g, '.');
}

function parseCustomDimensions(value) {
  const match = normalizeCustomDigits(value).match(/(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function calculateCustomTierPrice(width, height, fabric = 'ساتن آمریکایی') {
  const parsedWidth = Number(normalizeCustomDigits(width));
  const parsedHeight = Number(normalizeCustomDigits(height));
  if (!Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight) || parsedWidth <= 0 || parsedHeight <= 0) {
    return { valid: false, reason: 'invalid-dimensions', price: 0 };
  }
  const longSide = Math.max(parsedWidth, parsedHeight);
  const shortSide = Math.min(parsedWidth, parsedHeight);
  const tier = CUSTOM_SIZE_TIERS.find(item => longSide <= item.maxLong && shortSide <= item.maxShort);
  if (!tier) return { valid: false, reason: 'too-large', price: 0, longSide, shortSide };
  const price = String(fabric || '').trim() === 'مخمل' ? tier.velvetPrice : tier.price;
  return { valid: true, reason: null, price, longSide, shortSide };
}

function isCustomCartItem(item) {
  return ['طرح دلخواه', 'طرح اختصاصی'].includes(String(item?.category || '')) || Boolean(item?.customRequestId);
}

function normalizeStoredCustomItem(item) {
  if (!isCustomCartItem(item)) return item;
  const dimensions = parseCustomDimensions(item?.size);
  if (!dimensions) return item;
  const pricing = calculateCustomTierPrice(dimensions.width, dimensions.height, item.fabric);
  if (!pricing.valid) return item;
  return { ...item, price: pricing.price, old: pricing.price };
}

window.__CUSTOM_PRICING_VERSION__ = CUSTOM_PRICING_VERSION;
const body = document.body;
const overlay = document.querySelector(".overlay");
const toast = document.getElementById("toast");
let cart = loadCart();
let selectedProduct = window.__CURRENT_PRODUCT__ || products[0];
let detailQty = 1;
let discountAmount = 0;
let discountFeedbackMessage = '';
let discountFeedbackType = 'neutral';
let shippingPrice = 0;
function clearAppliedDiscount(message='هنوز کد تخفیفی اعمال نشده است.',type='neutral'){
  discountAmount=0;discountFeedbackType=type;discountFeedbackMessage=message;sessionStorage.removeItem('cribFlagActiveCoupon');
  const input=document.getElementById('discountCodeInput');if(input)input.value='';
  if(document.getElementById('checkoutSummaryItems'))renderCheckout();
}
function invalidateDiscountAfterCartChange(){if(sessionStorage.getItem('cribFlagActiveCoupon'))clearAppliedDiscount('سبد خرید تغییر کرد؛ کد تخفیف را دوباره اعمال کنید.','neutral');}
const CATALOG_PAGE_SIZE = 12;
const storeState = { query:"", categories:[], min:"", max:"", sort:"default", page:1 };
const readyState = { category:"", page:1 };
let currentUser=window.__CURRENT_USER__||null;
const api=(path,options)=>window.CribAPI?.request(path,options);
async function bootstrapRemoteData(){
  if(!window.CribAPI)return;
  const [productResult,categoryResult,authResult]=await Promise.allSettled([
    api('/api/products'),
    api('/api/categories'),
    api('/api/auth/me')
  ]);
  if(productResult.status==='fulfilled'&&Array.isArray(productResult.value.products))products=productResult.value.products.map(normalizeProductPricing);
  else if(productResult.status==='rejected')console.warn('Product API unavailable:',productResult.reason?.message);
  if(categoryResult.status==='fulfilled'&&Array.isArray(categoryResult.value.categories))categories=categoryResult.value.categories;
  else if(categoryResult.status==='rejected')console.warn('Category API unavailable:',categoryResult.reason?.message);
  if(authResult.status==='fulfilled')currentUser=authResult.value.authenticated?authResult.value.user:null;
}
function saveSessionUser(user){currentUser=user||null;try{localStorage.setItem('cribFlagSession',JSON.stringify(user?{userId:user.id,name:user.name,loggedIn:true}:{userId:null,name:'',loggedIn:false}));}catch{}}

const toFa = number => new Intl.NumberFormat("fa-IR").format(Number(number || 0));
const toman = number => `${toFa(number)} تومان`;


function normalizeProductPricing(product={}) {
  const price=Number(product.price||0);
  const rawVariants=Array.isArray(product.variantPrices)?product.variantPrices:[];
  const legacyDiscount=product.hasDiscount===undefined&&Number(product.old)>price;
  const variantDiscount=rawVariants.some(item=>Number(item.oldPrice??item.old)>Number(item.price));
  const hasDiscount=Boolean(product.hasDiscount||legacyDiscount||variantDiscount);
  const oldCandidate=Number(product.old);
  const old=hasDiscount&&Number.isFinite(oldCandidate)&&oldCandidate>price?oldCandidate:null;
  const variantPrices=rawVariants.map(item=>{
    const variantPrice=Number(item.price||0);
    const variantOld=Number(item.oldPrice??item.old);
    const discounted=Boolean(hasDiscount&&Number.isFinite(variantOld)&&variantOld>variantPrice);
    return {size:String(item.size||''),fabric:String(item.fabric||''),price:variantPrice,hasDiscount:discounted,oldPrice:discounted?variantOld:null};
  }).filter(item=>item.size&&item.fabric);
  const rawImages=Array.isArray(product.images)&&product.images.length?product.images:[product.image];
  const images=[...new Set(rawImages.map(image=>String(image||'').trim()).filter(Boolean))];
  if(!images.length)images.push(PRODUCT_IMAGE);
  const productCategories=[...new Set([product.category,...(Array.isArray(product.categories)?product.categories:[])].map(item=>String(item||'').trim()).filter(Boolean))];
  const categorySlugs=[...new Set((Array.isArray(product.categorySlugs)?product.categorySlugs:[]).map(item=>String(item||'').trim()).filter(Boolean))];
  const categoryIds=[...new Set((Array.isArray(product.categoryIds)?product.categoryIds:[]).map(Number).filter(Number.isFinite))];
  const inventoryMode=product.inventoryMode==='managed'?'managed':'unlimited';
  const stock=inventoryMode==='managed'?Math.max(0,Math.trunc(Number(product.stock||0))):null;
  return {...product,category:productCategories[0]||'',categories:productCategories,categorySlugs,categoryIds,price,hasDiscount,old,variantPrices,image:images[0],images,inventoryMode,stock,available:inventoryMode==='unlimited'||stock>0};
}
function isManagedInventory(product){return product?.inventoryMode==='managed';}
function productStock(product){return isManagedInventory(product)?Math.max(0,Math.trunc(Number(product?.stock||0))):Infinity;}
function isOutOfStock(product){return isManagedInventory(product)&&productStock(product)<=0;}
function inventoryText(product){return isManagedInventory(product)?(productStock(product)>0?`فقط ${toFa(productStock(product))} عدد موجود`:'ناموجود'):'موجود';}
function inventoryClass(product){return isManagedInventory(product)?(productStock(product)>0?'limited':'out'):'available';}
function liveProductFor(item){return products.find(product=>Number(product.id)===Number(item?.id))||readyDesigns.find(product=>Number(product.id)===Number(item?.id))||item;}
function cartQuantityForProduct(productId,excludeCartId=''){return cart.filter(item=>!isCustomCartItem(item)&&Number(item.id)===Number(productId)&&item.cartId!==excludeCartId).reduce((sum,item)=>sum+Math.max(1,Number(item.qty||1)),0);}
function remainingProductStock(product,excludeCartId=''){return isManagedInventory(product)?Math.max(0,productStock(product)-cartQuantityForProduct(product.id,excludeCartId)):50;}

function normalizeCategoryKey(value) {
  let key=String(value||'').trim();
  try{key=decodeURIComponent(key);}catch{}
  return normalizeText(key)
    .replace(/[\u200c\u200d\u200e\u200f]/g,'')
    .replace(/[‐‑‒–—−ـ]+/g,'-')
    .replace(/\s*-\s*/g,'-')
    .trim();
}
function categoryKeyVariants(value) {
  const key=normalizeCategoryKey(value);
  if(!key)return [];
  return [...new Set([
    key,
    key.replace(/-/g,' ').replace(/\s+/g,' ').trim(),
    key.replace(/\s+/g,'-')
  ].filter(Boolean))];
}
function productCategoryKeys(product={}) {
  const raw=[
    ...(product.categorySlugs||[]),
    ...(product.categories||[product.category]),
    ...(Array.isArray(product.categoryDetails)?product.categoryDetails.flatMap(item=>[item?.slug,item?.name]):[])
  ];
  return [...new Set(raw.flatMap(categoryKeyVariants))];
}
function getVariantPricing(product,size,fabric) {
  const normalized=normalizeProductPricing(product);
  const variant=normalized.variantPrices.find(item=>item.size===size&&item.fabric===fabric);
  if(variant)return variant;
  return {price:normalized.price,hasDiscount:Boolean(normalized.hasDiscount&&normalized.old>normalized.price),oldPrice:normalized.old};
}
function oldPriceMarkup(price,old,hasDiscount=true) {
  return hasDiscount&&Number(old)>Number(price)?`<span class="old-price">${toman(old)}</span>`:'';
}

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/[ي]/g,"ی").replace(/[ك]/g,"ک")
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/\s+/g," ").trim();
}
function escapeHTML(text) {
  return String(text || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function showToast(message) {
  if (!toast) return;
  toast.textContent = message; toast.classList.add("show"); setTimeout(()=>toast.classList.remove("show"),2400);
}
function loadCart() { try { const c=JSON.parse(localStorage.getItem(CART_KEY)||"[]"); return Array.isArray(c)?c.map(normalizeStoredCustomItem):[]; } catch { return []; } }
function saveCart() { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }

function placeholderImage(label, variant="general", view=0) {
  const palettes=[["#0f172a","#2563eb","#bfdbfe"],["#052e16","#16a34a","#bbf7d0"],["#3f1d0b","#f59e0b","#fde68a"],["#3b0764","#a855f7","#e9d5ff"],["#450a0a","#ef4444","#fecaca"]];
  const seed=[...String(label)+String(variant)].reduce((s,c)=>s+c.charCodeAt(0),0)+Number(view||0)*17;
  const [a,b,c]=palettes[Math.abs(seed)%palettes.length];
  const shift=(Math.abs(seed)%5)*28;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f8fafc"/><stop offset="1" stop-color="#e2e8f0"/></linearGradient><linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset=".6" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#0f172a" flood-opacity=".2"/></filter><clipPath id="cl"><rect x="90" y="120" width="620" height="430" rx="24"/></clipPath></defs><rect width="800" height="800" fill="url(#bg)"/><g filter="url(#s)"><rect x="90" y="120" width="620" height="430" rx="24" fill="url(#f)"/><g clip-path="url(#cl)" fill="none" stroke="#fff" opacity=".17"><path d="M20 ${240+shift} C180 80 300 390 450 220 S700 130 830 290" stroke-width="68"/><path d="M0 ${470-shift/2} C170 320 315 620 500 460 S720 350 850 520" stroke-width="52"/></g></g><ellipse cx="400" cy="615" rx="245" ry="22" fill="#0f172a" opacity=".08"/></svg>`;
  return "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg);
}
function imageSlot(label, small="", id="") { return `<div class="static-image-box"${id?` id="${id}"`:""}><img src="${placeholderImage(label,small)}" alt="${escapeHTML(label)}"></div>`; }
function productImageSrc(productOrImage) {
  const image=typeof productOrImage==='object'?productOrImage?.image:productOrImage;
  return String(image||PRODUCT_IMAGE);
}
function productImageBox(label, image=PRODUCT_IMAGE, id="", loading="lazy") { return `<div class="static-image-box"${id?` id="${id}"`:""}><img src="${escapeHTML(productImageSrc(image))}" alt="${escapeHTML(label)}" width="800" height="800" loading="${loading}" decoding="async"></div>`; }

function productCard(product) {
  const badge=product.badge?`<span class="badge">${escapeHTML(product.badge)}</span>`:"";
  return `<article class="product-card">${badge}
  <button class="product-title-btn open-product" data-id="${product.id}"><div class="product-media">${productImageBox(product.title,product.image)}</div></button>
  <div class="product-content"><button class="product-title-btn open-product" data-id="${product.id}"><h3 class="product-title">${escapeHTML(product.title)}</h3></button>
  <div class="product-meta"><span>${escapeHTML((product.categories||[product.category]).join('، '))}</span><span class="rating">★ ${product.rate}</span></div>
  <div class="product-stock ${inventoryClass(product)}">${inventoryText(product)}</div>
  <div class="price-row"><div class="price">${oldPriceMarkup(product.price,product.old,product.hasDiscount)}<strong class="new-price">${toman(product.price)}</strong></div>
  <button class="add-btn add-cart" data-id="${product.id}" aria-label="افزودن به سبد" ${isOutOfStock(product)?'disabled':''}>${isOutOfStock(product)?'×':'+'}</button></div></div></article>`;
}
function readyCard(item) {
  const rootName=readyRootCategory?.name||'طرح آماده';const tag=(item.categories||[]).find(category=>category!==rootName)||item.category||rootName;
  return `<article class="ready-card"><a class="ready-card-link" href="/product/${item.id}"><div class="ready-card-media">${productImageBox(item.title,item.image)}</div><div class="ready-card-body"><span class="ready-tag">${escapeHTML(tag)}</span><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.description)}</p><div class="product-stock ${inventoryClass(item)}">${inventoryText(item)}</div></div></a><div class="ready-meta"><strong>${oldPriceMarkup(item.price,item.old,item.hasDiscount)}${toman(item.price)}</strong><button class="btn btn-primary add-ready-cart" data-id="${item.id}" ${isOutOfStock(item)?'disabled':''}>${isOutOfStock(item)?'ناموجود':'افزودن به سبد'}</button></div></article>`;
}
function faqTemplate(item) { return `<div class="faq-item"><button class="faq-question"><b>${escapeHTML(item.q)}</b><span>+</span></button><div class="faq-answer">${escapeHTML(item.a)}</div></div>`; }
function blogTemplate(post) { return `<article class="blog-card"><div class="blog-card-media">${imageSlot(post.title,"مجله Crib Flag")}</div><div class="blog-card-body"><span class="blog-tag">${escapeHTML(post.tag)}</span><h3>${escapeHTML(post.title)}</h3><p>${escapeHTML(post.text)}</p><div class="blog-meta"><span>${post.date}</span><button class="view-all open-blog" data-blog-id="${post.id}">${post.read} ←</button></div></div></article>`; }

function closeSuggestions(){ document.querySelectorAll(".search-suggestions").forEach(x=>{x.classList.remove("open");x.innerHTML="";}); }
function closeAllLayers(){ document.querySelectorAll(".mobile-menu,.cart-drawer,.auth-modal,.filter-drawer,.image-lightbox,.custom-preview-overlay,.size-guide-modal").forEach(x=>x.classList.remove("open")); if(document.fullscreenElement?.classList?.contains('image-lightbox'))document.exitFullscreen?.().catch(()=>{}); overlay?.classList.remove("open"); body.classList.remove("no-scroll"); closeSuggestions(); }
function openOverlayLayer(el){ if(!el)return; el.classList.add("open"); overlay?.classList.add("open"); body.classList.add("no-scroll"); }
function requireLogin(nextUrl="/checkout"){if(currentUser)return true;const modal=document.querySelector(".auth-modal");if(modal)modal.dataset.nextUrl=nextUrl;document.querySelector('[data-auth-switch="login"]')?.click();openOverlayLayer(modal);showToast("برای ادامه ابتدا وارد حساب کاربری شوید.");return false;}
function goToPage(page){ const route=PAGE_ROUTES[page]; if(route) location.href=route; }

function catalogPageNumbers(currentPage,totalPages){
  if(totalPages<=7)return Array.from({length:totalPages},(_,index)=>index+1);
  const pages=[1];
  if(currentPage>4)pages.push('start-ellipsis');
  const from=Math.max(2,currentPage-1),to=Math.min(totalPages-1,currentPage+1);
  for(let page=from;page<=to;page++)pages.push(page);
  if(currentPage<totalPages-3)pages.push('end-ellipsis');
  pages.push(totalPages);
  return pages;
}
function syncCatalogPageQuery(page){
  const url=new URL(location.href);
  if(page>1)url.searchParams.set('page',String(page));else url.searchParams.delete('page');
  history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);
}
function renderCatalogPagination(containerId,totalItems,currentPage,onChange){
  const container=document.getElementById(containerId);
  if(!container)return;
  const totalPages=Math.ceil(totalItems/CATALOG_PAGE_SIZE);
  if(totalPages<=1){container.innerHTML='';container.hidden=true;return;}
  container.hidden=false;
  const pageButtons=catalogPageNumbers(currentPage,totalPages).map(page=>{
    if(typeof page!=='number')return '<span class="pagination-ellipsis" aria-hidden="true">…</span>';
    return `<button class="pagination-btn${page===currentPage?' active':''}" type="button" data-page="${page}"${page===currentPage?' aria-current="page"':''}>${toFa(page)}</button>`;
  }).join('');
  container.innerHTML=`<button class="pagination-btn pagination-nav" type="button" data-page="${currentPage-1}"${currentPage===1?' disabled':''}>قبلی</button>${pageButtons}<button class="pagination-btn pagination-nav" type="button" data-page="${currentPage+1}"${currentPage===totalPages?' disabled':''}>بعدی</button>`;
  container.querySelectorAll('[data-page]:not(:disabled)').forEach(button=>button.addEventListener('click',()=>onChange(Number(button.dataset.page))));
}
function scrollToCatalog(gridId){
  const grid=document.getElementById(gridId);
  if(!grid)return;
  const top=grid.getBoundingClientRect().top+window.scrollY-120;
  window.scrollTo({top:Math.max(0,top),behavior:'smooth'});
}

function cartSubtotal(){ return cart.reduce((s,i)=>s+Number(i.price)*Number(i.qty||1),0); }
function discountableCartSubtotal(){ return cart.filter(item=>!isCustomCartItem(item)).reduce((s,i)=>s+Number(i.price)*Number(i.qty||1),0); }
function renderCart(){
  saveCart(); const qty=cart.reduce((sum,item)=>sum+Number(item.qty||1),0); document.querySelectorAll(".cart-count").forEach(x=>x.textContent=toFa(qty));
  const box=document.getElementById("cartBody"), total=document.getElementById("cartTotal"); if(total)total.textContent=toman(cartSubtotal()); if(!box)return;
  if(!cart.length){box.innerHTML='<div class="empty-state"><div><div class="empty-icon">🛒</div><h4>سبد خرید خالی است</h4><p>محصولات موردنظر خود را انتخاب کنید.</p></div></div>';renderCartPage();if(document.getElementById('checkoutSummaryItems'))renderCheckout();return;}
  box.innerHTML=cart.map(item=>`<div class="cart-item"><div class="cart-thumb">${item.preview?`<img src="${item.preview}" alt="${escapeHTML(item.title)}">`:productImageBox(item.title,item.image)}</div><div class="cart-info"><h4>${escapeHTML(item.title)}</h4><small>${toman(item.price)}</small><small class="cart-variant">${item.size?`سایز: ${escapeHTML(item.size)}`:""}${item.size&&item.fabric?" — ":""}${item.fabric?`پارچه: ${escapeHTML(item.fabric)}`:""}</small><div class="cart-row">${isCustomCartItem(item)?'<div class="mini-qty"><span>۱ درخواست</span></div>':`<div class="mini-qty"><button class="cart-plus" data-id="${item.cartId}">+</button><span>${toFa(item.qty)}</span><button class="cart-minus" data-id="${item.cartId}">−</button></div>`}<button class="remove-btn cart-remove" data-id="${item.cartId}">×</button></div></div></div>`).join("");
  renderCartPage(); if(document.getElementById('checkoutSummaryItems'))renderCheckout();
}
function addToCartFromProduct(product,qty=1,options={}){
  const live=normalizeProductPricing(liveProductFor(product));
  const requested=Math.max(1,Math.trunc(Number(qty||1)));
  if(isOutOfStock(live)){showToast('این محصول ناموجود است.');return false;}
  const remaining=remainingProductStock(live);
  if(isManagedInventory(live)&&requested>remaining){showToast(remaining>0?`فقط ${toFa(remaining)} عدد دیگر از این محصول قابل افزودن است.`:'تمام موجودی این محصول در سبد شما قرار دارد.');return false;}
  const size=options.size||live.size||(Array.isArray(live.sizes)?live.sizes[0]:DEFAULT_SIZES[0]);
  const fabric=options.fabric||live.fabric||(Array.isArray(live.fabrics)?live.fabrics[0]:DEFAULT_FABRICS[0]);
  const pricing=getVariantPricing(live,size,fabric);
  cart.push({...live,image:productImageSrc(live),size,fabric,price:pricing.price,hasDiscount:pricing.hasDiscount,old:pricing.oldPrice,cartId:`${live.id}-${Date.now()}-${Math.random()}`,qty:requested});
  invalidateDiscountAfterCartChange();renderCart();showToast("محصول به سبد خرید اضافه شد.");return true;
}

function renderSuggestions(input){ const wrap=input.closest(".search-wrap"),box=wrap?.querySelector(".search-suggestions"),q=normalizeText(input.value); if(!box)return; if(!q){box.classList.remove("open");box.innerHTML="";return;} const res=products.filter(p=>normalizeText(`${p.title} ${(p.categories||[p.category]).join(' ')} ${p.description} ${(p.sizes||[]).join(" ")} ${(p.fabrics||[]).join(" ")}`).includes(q)).slice(0,6);box.classList.add("open");box.innerHTML=res.length?res.map(p=>`<a class="suggestion-item" href="/product/${p.id}"><span class="suggestion-thumb"><img src="${escapeHTML(productImageSrc(p))}" alt="${escapeHTML(p.title)}"></span><span><span class="suggestion-title">${escapeHTML(p.title)}</span><span class="suggestion-meta">${escapeHTML(p.category)} — ${escapeHTML((p.fabrics||DEFAULT_FABRICS)[0])}</span></span><span class="suggestion-price">${toman(p.price)}</span></a>`).join(""):'<div class="suggestion-empty">نتیجه‌ای پیدا نشد.</div>'; }

function initHeader(){
  const current=body.dataset.page;
  document.querySelectorAll('[data-page-link]').forEach(el=>{ if(el.tagName==='A')el.href=PAGE_ROUTES[el.dataset.pageLink]||'#'; if(el.dataset.pageLink===current)el.classList.add('current-page'); });
  document.querySelectorAll('.store-category-link[data-category]').forEach(el=>{el.href=`/store?category=${encodeURIComponent(el.dataset.category)}`;});
  document.addEventListener('click',e=>{
    const p=e.target.closest('[data-page-link]'); if(p&&p.tagName!=='A'){e.preventDefault();goToPage(p.dataset.pageLink);}
    const open=e.target.closest('.open-product'); if(open){e.preventDefault();window.CribLoader?.show('در حال بارگذاری محصول...');location.href=`/product/${open.dataset.id}`;}
    const blog=e.target.closest('.open-blog'); if(blog){e.preventDefault();location.href=`/blog/${blog.dataset.blogId}`;}
    const add=e.target.closest('.add-cart'); if(add){const product=products.find(x=>x.id===Number(add.dataset.id));if(product)addToCartFromProduct(product);}
    const ready=e.target.closest('.add-ready-cart'); if(ready){const item=readyDesigns.find(x=>x.id===Number(ready.dataset.id));if(item)addToCartFromProduct(item);}
    const plus=e.target.closest('.cart-plus'); if(plus){const i=cart.find(x=>x.cartId===plus.dataset.id);if(i&&!isCustomCartItem(i)){const live=normalizeProductPricing(liveProductFor(i));const total=cartQuantityForProduct(i.id);if(isManagedInventory(live)&&total>=productStock(live))showToast(`فقط ${toFa(productStock(live))} عدد از این محصول موجود است.`);else{i.qty=Math.min(50,Number(i.qty||1)+1);invalidateDiscountAfterCartChange();renderCart();}}}
    const minus=e.target.closest('.cart-minus'); if(minus){const i=cart.find(x=>x.cartId===minus.dataset.id);if(i&&!isCustomCartItem(i)&&Number(i.qty||1)>1){i.qty=Math.max(1,Number(i.qty||1)-1);invalidateDiscountAfterCartChange();renderCart();}}
    const remove=e.target.closest('.cart-remove'); if(remove){cart=cart.filter(x=>x.cartId!==remove.dataset.id);invalidateDiscountAfterCartChange();renderCart();}
    if(!e.target.closest('.search-wrap'))closeSuggestions();
    if(!e.target.closest('.nav-item'))document.querySelectorAll('.dropdown,.nested-dropdown').forEach(x=>x.classList.remove('open'));
  });
  document.querySelectorAll('.global-search').forEach(input=>{input.addEventListener('input',()=>renderSuggestions(input));input.addEventListener('focus',()=>renderSuggestions(input));});
  document.querySelectorAll('.search-form').forEach(form=>form.addEventListener('submit',e=>{e.preventDefault();const q=form.querySelector('.global-search')?.value.trim();if(q)location.href=`/store?q=${encodeURIComponent(q)}`;}));
  document.querySelectorAll('.cart-open').forEach(x=>x.addEventListener('click',()=>{location.href='/cart';}));
  document.querySelectorAll('.cart-close,.mobile-menu-close,.auth-close,.filter-close,.lightbox-close,.size-guide-close').forEach(x=>x.addEventListener('click',closeAllLayers));
  document.querySelector('.mobile-menu-open')?.addEventListener('click',()=>openOverlayLayer(document.querySelector('.mobile-menu')));
  document.querySelectorAll('.auth-open').forEach(x=>x.addEventListener('click',()=>{if(currentUser)location.href='/account';else openOverlayLayer(document.querySelector('.auth-modal'));}));
  document.querySelector('.mobile-search-focus')?.addEventListener('click',()=>{openOverlayLayer(document.querySelector('.mobile-menu'));setTimeout(()=>document.querySelector('.mobile-search .global-search')?.focus(),200);});
  document.querySelector('.mobile-accordion-btn')?.addEventListener('click',e=>{const sub=e.currentTarget.nextElementSibling;sub.classList.toggle('open');e.currentTarget.querySelector('span').textContent=sub.classList.contains('open')?'−':'+';});
  document.querySelectorAll('.nav-dropdown-toggle').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();btn.nextElementSibling?.classList.toggle('open');}));
  document.querySelectorAll('.nested-toggle').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const n=btn.nextElementSibling;document.querySelectorAll('.nested-dropdown').forEach(x=>{if(x!==n)x.classList.remove('open')});n?.classList.toggle('open');}));
  overlay?.addEventListener('click',closeAllLayers); document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAllLayers();});
  document.getElementById('continueCheckoutBtn')?.addEventListener('click',()=>{if(!cart.length){showToast('سبد خرید خالی است.');return;}if(!requireLogin('/checkout'))return;window.CribLoader?.show('در حال آماده‌سازی تسویه حساب...');location.href='/checkout';});
  initAuth(); renderCart();
}
function initAuth(){
  const modal=document.querySelector('.auth-modal'),message=document.getElementById('authMessage');
  const titles={login:'ورود به حساب', 'login-otp':'تأیید کد ورود', signup:'ثبت‌نام در Crib Flag','signup-otp':'تأیید شماره موبایل',forgot:'بازیابی رمز عبور','forgot-otp':'تأیید کد بازیابی','reset-password':'رمز عبور جدید'};
  const pending={loginMobile:'',signup:null,forgotMobile:'',resetToken:''};
  const showMessage=(text,type='info')=>{if(!message)return;message.textContent=text||'';message.dataset.type=type;message.classList.toggle('show',!!text);};
  const stateTo=(state)=>{document.querySelectorAll('.auth-state').forEach(x=>x.classList.toggle('active',x.dataset.state===state));const t=document.getElementById('authTitle');if(t)t.textContent=titles[state]||'حساب کاربری';document.querySelectorAll('[data-auth-mobile]').forEach(x=>x.textContent=pending.loginMobile||pending.signup?.mobile||pending.forgotMobile||'');showMessage('');};
  const validateForm=form=>{let valid=true;form.querySelectorAll('[required]').forEach(i=>{const bad=!String(i.value||'').trim();i.classList.toggle('invalid',bad);valid=!bad&&valid;});return valid;};
  const values=form=>Object.fromEntries(new FormData(form).entries());
  const completeAuth=(result)=>{saveSessionUser(result.user);showToast(result.message||'عملیات موفق بود.');const next=modal?.dataset.nextUrl||new URLSearchParams(location.search).get('next')||'';closeAllLayers();if(next&&next.startsWith('/'))location.href=next;else location.reload();};
  document.querySelectorAll('[data-auth-switch]').forEach(btn=>btn.addEventListener('click',()=>stateTo(btn.dataset.authSwitch)));
  document.querySelectorAll('.auth-state').forEach(form=>form.addEventListener('submit',async e=>{
    e.preventDefault();if(!validateForm(form))return;const state=form.dataset.state,data=values(form),submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
    try{
      if(state==='login'){
        const result=await api('/api/auth/signin/start',{method:'POST',body:JSON.stringify(data)});pending.loginMobile=result.mobile||data.mobile;stateTo('login-otp');if(result.debugOtp)showMessage(`کد توسعه: ${result.debugOtp}`,'success');
      }else if(state==='login-otp'){
        const result=await api('/api/auth/signin/verify',{method:'POST',body:JSON.stringify({mobile:pending.loginMobile,otp:data.otp})});completeAuth(result);
      }else if(state==='signup'){
        if(data.password!==data.confirmPassword)throw new Error('رمز عبور و تکرار آن یکسان نیست');
        const result=await api('/api/auth/signup/start',{method:'POST',body:JSON.stringify(data)});pending.signup={...data,mobile:result.mobile||data.mobile};stateTo('signup-otp');if(result.debugOtp)showMessage(`کد توسعه: ${result.debugOtp}`,'success');
      }else if(state==='signup-otp'){
        if(!pending.signup)throw new Error('ابتدا اطلاعات ثبت‌نام را تکمیل کنید');
        const result=await api('/api/auth/signup/verify',{method:'POST',body:JSON.stringify({...pending.signup,otp:data.otp})});completeAuth(result);
      }else if(state==='forgot'){
        const result=await api('/api/auth/password/forgot',{method:'POST',body:JSON.stringify(data)});pending.forgotMobile=result.mobile||data.mobile;stateTo('forgot-otp');if(result.debugOtp)showMessage(`کد توسعه: ${result.debugOtp}`,'success');
      }else if(state==='forgot-otp'){
        const result=await api('/api/auth/password/verify',{method:'POST',body:JSON.stringify({mobile:pending.forgotMobile,otp:data.otp})});pending.resetToken=result.resetToken;stateTo('reset-password');
      }else if(state==='reset-password'){
        if(data.password!==data.confirmPassword)throw new Error('رمز عبور و تکرار آن یکسان نیست');
        await api(`/api/auth/password/reset/${pending.resetToken}`,{method:'PATCH',body:JSON.stringify({password:data.password})});showToast('رمز عبور تغییر کرد؛ اکنون وارد شوید.');stateTo('login');
      }
    }catch(error){showMessage(error.message||'عملیات انجام نشد.','error');showToast(error.message||'عملیات انجام نشد.');}finally{if(submit)submit.disabled=false;}
  }));
  document.querySelectorAll('[data-auth-resend]').forEach(button=>button.addEventListener('click',async()=>{
    button.disabled=true;try{const purpose=button.dataset.authResend;let result;if(purpose==='login'){const form=document.querySelector('.auth-state[data-state="login"]');result=await api('/api/auth/signin/start',{method:'POST',body:JSON.stringify(values(form))});pending.loginMobile=result.mobile||pending.loginMobile;}else if(purpose==='signup'){if(!pending.signup)throw new Error('اطلاعات ثبت‌نام موجود نیست');result=await api('/api/auth/signup/start',{method:'POST',body:JSON.stringify(pending.signup)});}else{result=await api('/api/auth/password/forgot',{method:'POST',body:JSON.stringify({mobile:pending.forgotMobile})});}showMessage(result.debugOtp?`کد توسعه: ${result.debugOtp}`:'کد جدید ارسال شد.','success');}catch(error){showMessage(error.message,'error');}finally{button.disabled=false;}
  }));
  const params=new URLSearchParams(location.search);if(params.get('auth')){stateTo(params.get('auth'));setTimeout(()=>openOverlayLayer(modal),50);}
}

function initHome(){
  const special=document.getElementById('specialProducts'),best=document.getElementById('bestSellerSlider');
  // EJS already rendered these cards. Rebuilding them cancels image work and causes a large repaint.
  if(special&&!special.children.length)special.innerHTML=products.slice(0,4).map(productCard).join('');
  if(best&&!best.children.length)best.innerHTML=products.slice(4,12).map(productCard).join('');
  const track=document.querySelector('.hero-track'),dots=[...document.querySelectorAll('.dot')],slides=[...document.querySelectorAll('.hero-slide')];if(track&&slides.length){let i=0;const update=()=>{track.style.transform=`translateX(-${i*100}%)`;dots.forEach((d,n)=>d.classList.toggle('active',n===i));};document.querySelector('.hero-next')?.addEventListener('click',()=>{i=(i+1)%slides.length;update();});document.querySelector('.hero-prev')?.addEventListener('click',()=>{i=(i-1+slides.length)%slides.length;update();});dots.forEach((d,n)=>d.addEventListener('click',()=>{i=n;update();}));setInterval(()=>{i=(i+1)%slides.length;update();},5600);}
  document.querySelector('.best-next')?.addEventListener('click',()=>best?.scrollBy({left:-320,behavior:'smooth'}));document.querySelector('.best-prev')?.addEventListener('click',()=>best?.scrollBy({left:320,behavior:'smooth'}));
}

function getFilteredProducts(){
  let r=[...products];
  if(storeState.query){const q=normalizeText(storeState.query);r=r.filter(p=>normalizeText(`${p.title} ${(p.categories||[p.category]).join(' ')} ${p.description} ${(p.sizes||[]).join(" ")} ${(p.fabrics||[]).join(" ")}`).includes(q));}
  if(storeState.categories.length){const selectedKeys=[...new Set(storeState.categories.flatMap(categoryKeyVariants))];r=r.filter(p=>{const productKeys=productCategoryKeys(p);return selectedKeys.some(category=>productKeys.includes(category));});}
  if(storeState.min)r=r.filter(p=>p.price>=Number(storeState.min));if(storeState.max)r=r.filter(p=>p.price<=Number(storeState.max));
  if(storeState.sort==='cheap')r.sort((a,b)=>a.price-b.price);if(storeState.sort==='expensive')r.sort((a,b)=>b.price-a.price);if(storeState.sort==='newest')r.sort((a,b)=>b.date-a.date);if(storeState.sort==='popular')r.sort((a,b)=>b.rate-a.rate);return r;
}
function renderStoreProducts({scroll=false}={}){
  const box=document.getElementById('storeProducts');if(!box)return;
  const list=getFilteredProducts();
  const totalPages=Math.max(1,Math.ceil(list.length/CATALOG_PAGE_SIZE));
  storeState.page=Math.min(Math.max(1,storeState.page),totalPages);
  const start=(storeState.page-1)*CATALOG_PAGE_SIZE;
  const visibleProducts=list.slice(start,start+CATALOG_PAGE_SIZE);
  const count=document.getElementById('productsCount');if(count)count.textContent=`${toFa(list.length)} محصول`;
  const pill=document.getElementById('storeQueryPill');if(pill){pill.textContent=storeState.query?`جستجو: ${storeState.query}`:'';pill.classList.toggle('show',!!storeState.query);}
  box.innerHTML=visibleProducts.length?visibleProducts.map(productCard).join(''):'<div class="results-empty"><div><h3>محصولی پیدا نشد</h3><p>فیلترها یا عبارت جستجو را تغییر دهید.</p></div></div>';
  renderCatalogPagination('storePagination',list.length,storeState.page,page=>{storeState.page=page;renderStoreProducts({scroll:true});});
  syncCatalogPageQuery(storeState.page);
  if(scroll)scrollToCatalog('storeProducts');
}
function syncDesktopFilters(){storeState.min=document.querySelector('.price-min')?.value||'';storeState.max=document.querySelector('.price-max')?.value||'';storeState.categories=[...document.querySelectorAll('.category-filter:checked')].map(x=>x.value);storeState.sort=document.getElementById('sortSelect')?.value||'default';}
function resetFilters(){storeState.query='';storeState.categories=[];storeState.min='';storeState.max='';storeState.sort='default';storeState.page=1;document.querySelectorAll('.price-min,.price-max,.price-min-mobile,.price-max-mobile').forEach(x=>x.value='');document.querySelectorAll('.category-filter,.category-filter-mobile').forEach(x=>x.checked=false);document.querySelectorAll('.store-chip').forEach(x=>x.classList.toggle('active',!x.dataset.category));const sort=document.getElementById('sortSelect');if(sort)sort.value='default';renderStoreProducts();}
function initStore(){
  const params=new URLSearchParams(location.search);storeState.query=normalizeText(params.get('q')||'');storeState.page=Math.max(1,Number(params.get('page'))||1);const cat=params.get('category')||'';if(cat)storeState.categories=[cat];
  document.querySelectorAll('.store-chip').forEach(chip=>{chip.classList.toggle('active',chip.dataset.category===cat||(!cat&&!chip.dataset.category));chip.addEventListener('click',()=>{const category=chip.dataset.category||'';storeState.categories=category?[category]:[];storeState.page=1;document.querySelectorAll('.store-chip').forEach(x=>x.classList.remove('active'));chip.classList.add('active');document.querySelectorAll('.category-filter,.category-filter-mobile').forEach(x=>x.checked=category&&x.value===category);renderStoreProducts();});});
  document.querySelector('.apply-filters')?.addEventListener('click',()=>{syncDesktopFilters();storeState.page=1;renderStoreProducts();});document.querySelectorAll('.reset-filters').forEach(x=>x.addEventListener('click',resetFilters));document.getElementById('sortSelect')?.addEventListener('change',()=>{syncDesktopFilters();storeState.page=1;renderStoreProducts();});
  document.querySelector('.filter-open')?.addEventListener('click',()=>openOverlayLayer(document.querySelector('.filter-drawer')));document.querySelector('.apply-mobile-filters')?.addEventListener('click',()=>{storeState.min=document.querySelector('.price-min-mobile')?.value||'';storeState.max=document.querySelector('.price-max-mobile')?.value||'';storeState.categories=[...document.querySelectorAll('.category-filter-mobile:checked')].map(x=>x.value);storeState.page=1;closeAllLayers();renderStoreProducts();});
  renderStoreProducts();
}

function initProduct(){
  const pathId=Number(location.pathname.split('/').filter(Boolean).pop());const id=Number(window.__CURRENT_PRODUCT__?.id||pathId||new URLSearchParams(location.search).get('id'))||1;
  const ready=readyDesigns.find(product=>product.id===id);
  selectedProduct=normalizeProductPricing(window.__CURRENT_PRODUCT__||products.find(product=>product.id===id)||ready||products[0]);
  selectedProduct.sizes=Array.isArray(selectedProduct.sizes)&&selectedProduct.sizes.length?selectedProduct.sizes:[...DEFAULT_SIZES];
  selectedProduct.fabrics=Array.isArray(selectedProduct.fabrics)&&selectedProduct.fabrics.length?selectedProduct.fabrics:[...DEFAULT_FABRICS];
  detailQty=1; const set=(id,value)=>{const element=document.getElementById(id);if(element)element.textContent=value};
  set('breadcrumbProduct',selectedProduct.title);set('detailCategory',(selectedProduct.categories||[selectedProduct.category]).join('، '));set('detailTitle',selectedProduct.title);set('detailDescription',selectedProduct.description);set('detailQty',toFa(detailQty));set('detailFabricSummary',selectedProduct.fabrics.join('، '));set('detailSizeSummary',selectedProduct.sizes.join('، '));
  const stockStatus=document.getElementById('detailStockStatus');if(stockStatus){stockStatus.textContent=inventoryText(selectedProduct);stockStatus.className=`detail-stock-status ${inventoryClass(selectedProduct)}`;}
  const galleryImages=Array.isArray(selectedProduct.images)&&selectedProduct.images.length?selectedProduct.images:[selectedProduct.image||PRODUCT_IMAGE];
  const main=document.getElementById('productMainImageImg'),light=document.getElementById('lightboxProductImg');
  const mainFrame=document.getElementById('productZoomFrame'),lightFrame=document.getElementById('lightboxProductBox');
  const thumbs=document.getElementById('productThumbs'),lightThumbs=document.getElementById('lightboxThumbs');
  const counter=document.getElementById('lightboxCounter');
  let galleryIndex=0,lightboxZoomed=false,touchStartX=null;
  const thumbMarkup=(image,index,lightbox=false)=>lightbox
    ?`<button aria-label="نمایش تصویر ${toFa(index+1)}" class="lightbox-thumb${index===galleryIndex?' active':''}" data-gallery-index="${index}" type="button"><img alt="${escapeHTML(selectedProduct.title)} - نمای ${toFa(index+1)}" src="${escapeHTML(image)}"></button>`
    :`<button aria-label="نمایش تصویر ${toFa(index+1)}" class="thumb${index===galleryIndex?' active':''}" data-gallery-index="${index}" type="button"><div class="static-image-box"><img alt="${escapeHTML(selectedProduct.title)} - نمای ${toFa(index+1)}" class="product-thumb-img" src="${escapeHTML(image)}"></div></button>`;
  if(thumbs)thumbs.innerHTML=galleryImages.map((image,index)=>thumbMarkup(image,index,false)).join('');
  if(lightThumbs)lightThumbs.innerHTML=galleryImages.map((image,index)=>thumbMarkup(image,index,true)).join('');
  const setLightboxZoom=enabled=>{lightboxZoomed=Boolean(enabled);lightFrame?.classList.toggle('is-zoomed',lightboxZoomed);const button=document.querySelector('.lightbox-zoom-toggle');if(button)button.textContent=lightboxZoomed?'اندازه عادی':'زوم';};
  const setGallery=index=>{
    galleryIndex=(Number(index)+galleryImages.length)%galleryImages.length;
    const image=galleryImages[galleryIndex];
    if(main){main.src=image;main.alt=`${selectedProduct.title} - نمای ${toFa(galleryIndex+1)}`;main.style.transformOrigin='center center';}
    if(light){light.src=image;light.alt=`${selectedProduct.title} - نمای بزرگ ${toFa(galleryIndex+1)}`;}
    if(counter)counter.textContent=`${toFa(galleryIndex+1)} از ${toFa(galleryImages.length)}`;
    document.querySelectorAll('[data-gallery-index]').forEach(thumb=>thumb.classList.toggle('active',Number(thumb.dataset.galleryIndex)===galleryIndex));
    setLightboxZoom(false);
  };
  const moveGallery=step=>setGallery(galleryIndex+step);
  document.querySelectorAll('[data-gallery-index]').forEach(thumb=>thumb.addEventListener('click',()=>setGallery(Number(thumb.dataset.galleryIndex))));
  document.querySelector('.gallery-prev')?.addEventListener('click',()=>moveGallery(-1));
  document.querySelector('.gallery-next')?.addEventListener('click',()=>moveGallery(1));
  document.querySelector('.lightbox-prev')?.addEventListener('click',()=>moveGallery(-1));
  document.querySelector('.lightbox-next')?.addEventListener('click',()=>moveGallery(1));
  document.querySelectorAll('.gallery-nav,.lightbox-nav').forEach(button=>button.hidden=galleryImages.length<2);
  const openGallery=()=>{setGallery(galleryIndex);openOverlayLayer(document.querySelector('.image-lightbox'));};
  document.querySelector('.lightbox-open')?.addEventListener('click',openGallery);
  mainFrame?.addEventListener('click',event=>{if(!matchMedia('(hover:hover)').matches)openGallery();});
  mainFrame?.addEventListener('mousemove',event=>{
    if(!matchMedia('(hover:hover)').matches||!main)return;
    const rect=mainFrame.getBoundingClientRect();
    main.style.transformOrigin=`${((event.clientX-rect.left)/rect.width)*100}% ${((event.clientY-rect.top)/rect.height)*100}%`;
    mainFrame.classList.add('is-zoomed');
  });
  mainFrame?.addEventListener('mouseleave',()=>{mainFrame.classList.remove('is-zoomed');if(main)main.style.transformOrigin='center center';});
  document.querySelector('.lightbox-zoom-toggle')?.addEventListener('click',()=>setLightboxZoom(!lightboxZoomed));
  lightFrame?.addEventListener('click',()=>setLightboxZoom(!lightboxZoomed));
  const lightboxElement=document.querySelector('.image-lightbox');
  const fullscreenButton=document.querySelector('.lightbox-fullscreen-toggle');
  fullscreenButton?.addEventListener('click',async()=>{
    try{if(!document.fullscreenElement)await lightboxElement?.requestFullscreen?.();else await document.exitFullscreen?.();}catch{}
  });
  lightboxElement?.addEventListener('click',event=>{if(event.target===lightboxElement)closeAllLayers();});
  document.addEventListener('fullscreenchange',()=>{if(fullscreenButton)fullscreenButton.textContent=document.fullscreenElement?'خروج از تمام‌صفحه':'تمام‌صفحه';});
  lightFrame?.addEventListener('touchstart',event=>{touchStartX=event.changedTouches?.[0]?.clientX??null;},{passive:true});
  lightFrame?.addEventListener('touchend',event=>{if(touchStartX==null)return;const delta=(event.changedTouches?.[0]?.clientX??touchStartX)-touchStartX;touchStartX=null;if(Math.abs(delta)>45)moveGallery(delta>0?-1:1);},{passive:true});
  document.addEventListener('keydown',event=>{const box=document.querySelector('.image-lightbox');if(!box?.classList.contains('open'))return;if(event.key==='ArrowLeft')moveGallery(1);if(event.key==='ArrowRight')moveGallery(-1);});
  setGallery(0);
  const renderOptions=(containerId,name,values)=>{const box=document.getElementById(containerId);if(!box)return;box.innerHTML=values.map((value,index)=>`<label class="detail-option"><input type="radio" name="${name}" value="${escapeHTML(value)}" ${index===0?'checked':''}><span>${escapeHTML(value)}</span></label>`).join('');};
  renderOptions('detailSizeOptions','detailSize',selectedProduct.sizes);renderOptions('detailFabricOptions','detailFabric',selectedProduct.fabrics);
  const updateDetailPrice=()=>{
    const size=document.querySelector('input[name="detailSize"]:checked')?.value||selectedProduct.sizes[0];
    const fabric=document.querySelector('input[name="detailFabric"]:checked')?.value||selectedProduct.fabrics[0];
    const pricing=getVariantPricing(selectedProduct,size,fabric);
    set('detailPrice',toman(pricing.price));
    const oldElement=document.getElementById('detailOldPrice');
    if(oldElement){oldElement.textContent=pricing.hasDiscount&&pricing.oldPrice>pricing.price?toman(pricing.oldPrice):'';oldElement.hidden=!(pricing.hasDiscount&&pricing.oldPrice>pricing.price);}
  };
  document.querySelectorAll('input[name="detailSize"],input[name="detailFabric"]').forEach(input=>input.addEventListener('change',updateDetailPrice));
  updateDetailPrice();
  const detailAddButton=document.querySelector('.detail-add-cart');const detailMax=()=>isManagedInventory(selectedProduct)?remainingProductStock(selectedProduct):50;
  if(detailAddButton){const unavailable=detailMax()<=0;detailAddButton.disabled=unavailable;detailAddButton.textContent=unavailable?'ناموجود':'افزودن به سبد خرید';}
  document.querySelector('.detail-plus')?.addEventListener('click',()=>{const max=detailMax();if(detailQty>=max){showToast(isManagedInventory(selectedProduct)?`فقط ${toFa(productStock(selectedProduct))} عدد از این محصول موجود است.`:'حداکثر تعداد قابل سفارش ۵۰ عدد است.');return;}detailQty=Math.min(50,detailQty+1);set('detailQty',toFa(detailQty));});document.querySelector('.detail-minus')?.addEventListener('click',()=>{detailQty=Math.max(1,detailQty-1);set('detailQty',toFa(detailQty));});
  detailAddButton?.addEventListener('click',()=>{const size=document.querySelector('input[name="detailSize"]:checked')?.value;const fabric=document.querySelector('input[name="detailFabric"]:checked')?.value;if(!size||!fabric){showToast('سایز و جنس پارچه را انتخاب کنید.');return;}if(addToCartFromProduct(selectedProduct,detailQty,{size,fabric})){detailQty=1;set('detailQty',toFa(detailQty));const unavailable=detailMax()<=0;detailAddButton.disabled=unavailable;detailAddButton.textContent=unavailable?'تمام موجودی در سبد':'افزودن به سبد خرید';}});
  document.querySelector('.size-guide-btn')?.addEventListener('click',()=>openOverlayLayer(document.querySelector('.size-guide-modal')));
  document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.tab-btn').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));btn.classList.add('active');document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');}));
}
function initFaq(){const box=document.getElementById('fullFaqList');if(box)box.innerHTML=faqItems.map(faqTemplate).join('');document.addEventListener('click',e=>{const q=e.target.closest('.faq-question');if(q){const item=q.closest('.faq-item');item.classList.toggle('open');q.querySelector('span').textContent=item.classList.contains('open')?'−':'+';}});}
function initReady(){
  const box=document.getElementById('readyGrid');if(!box)return;
  const params=new URLSearchParams(location.search);readyState.page=Math.max(1,Number(params.get('page'))||1);
  const draw=({scroll=false}={})=>{
    const list=readyState.category?readyDesigns.filter(item=>productCategoryKeys(item).includes(readyState.category)):readyDesigns;
    const totalPages=Math.max(1,Math.ceil(list.length/CATALOG_PAGE_SIZE));
    readyState.page=Math.min(Math.max(1,readyState.page),totalPages);
    const start=(readyState.page-1)*CATALOG_PAGE_SIZE;
    const visibleDesigns=list.slice(start,start+CATALOG_PAGE_SIZE);
    box.innerHTML=visibleDesigns.length?visibleDesigns.map(readyCard).join(''):'<div class="results-empty"><div><h3>طرح آماده‌ای پیدا نشد</h3></div></div>';
    renderCatalogPagination('readyPagination',list.length,readyState.page,page=>{readyState.page=page;draw({scroll:true});});
    syncCatalogPageQuery(readyState.page);
    if(scroll)scrollToCatalog('readyGrid');
  };
  document.querySelectorAll('.ready-chip').forEach(chip=>chip.addEventListener('click',()=>{document.querySelectorAll('.ready-chip').forEach(x=>x.classList.remove('active'));chip.classList.add('active');readyState.category=chip.dataset.readyCategory||'';readyState.page=1;draw();}));
  draw();
}
function initBlog(){const box=document.getElementById('blogGrid');if(box)box.innerHTML=blogPosts.map(blogTemplate).join('');}
function initBlogDetail(){const id=Number(location.pathname.split('/').filter(Boolean).pop())||Number(new URLSearchParams(location.search).get('id'))||1;const p=blogPosts.find(x=>x.id===id)||blogPosts[0];const set=(id,v,html=false)=>{const e=document.getElementById(id);if(e)html?e.innerHTML=v:e.textContent=v;};set('blogDetailBreadcrumb',p.title);set('blogDetailCategory',p.tag);set('blogDetailDate',p.date);set('blogDetailTitle',p.title);set('blogDetailBody',p.body,true);const img=document.getElementById('articleCoverImg');if(img){img.src=placeholderImage(p.title,'مجله Crib Flag');img.alt=p.title;}const rel=document.getElementById('relatedPosts');if(rel)rel.innerHTML=blogPosts.filter(x=>x.id!==p.id).slice(0,3).map(x=>`<a class="related-post" href="/blog/${x.id}">${imageSlot(x.title,'مجله Crib Flag')}<span><h4>${escapeHTML(x.title)}</h4><small>${x.read}</small></span></a>`).join('');}

function renderCartPage(){
  const box=document.getElementById('cartPageItems');if(!box)return;const qty=cart.reduce((sum,item)=>sum+Number(item.qty||1),0);
  document.getElementById('cartPageCount').textContent=toFa(qty);document.getElementById('cartPageTotal').textContent=toman(cartSubtotal());
  const checkoutLink=document.getElementById('cartCheckoutLink');if(checkoutLink)checkoutLink.classList.toggle('disabled',!cart.length);
  box.innerHTML=cart.length?cart.map(item=>`<article class="cart-page-item"><div class="cart-page-image">${item.preview?`<img src="${item.preview}" alt="${escapeHTML(item.title)}">`:productImageBox(item.title,item.image)}</div><div class="cart-page-info"><span>${escapeHTML(item.category||'محصول')}</span><h3>${escapeHTML(item.title)}</h3>${item.size?`<small>سایز: ${escapeHTML(item.size)}</small>`:''}${item.fabric?`<small>جنس پارچه: ${escapeHTML(item.fabric)}</small>`:''}${item.notes?`<p>${escapeHTML(item.notes)}</p>`:''}</div><div class="cart-page-controls"><strong>${toman(item.price*item.qty)}</strong>${isCustomCartItem(item)?'<div class="mini-qty"><span>۱ درخواست</span></div>':`<div class="mini-qty"><button class="cart-plus" data-id="${item.cartId}">+</button><span>${toFa(item.qty)}</span><button class="cart-minus" data-id="${item.cartId}">−</button></div>`}<button class="cart-page-remove cart-remove" data-id="${item.cartId}">حذف</button></div></article>`).join(''):'<div class="cart-page-empty"><div class="empty-bag"></div><h3>سبد خرید شما خالی است</h3><p>از فروشگاه یا بخش طرح‌های آماده محصولی انتخاب کنید.</p><a class="btn btn-primary" href="/store">رفتن به فروشگاه</a></div>';
}
function initCart(){renderCartPage();document.getElementById('cartCheckoutLink')?.addEventListener('click',e=>{if(!cart.length){e.preventDefault();showToast('سبد خرید خالی است.');return;}if(!currentUser){e.preventDefault();requireLogin('/checkout');return;}window.CribLoader?.show('در حال آماده‌سازی تسویه حساب...');});}

function initCustomOrder(){
  const input=document.getElementById('customFileInput'), preview=document.getElementById('customUploadPreview'), nameBox=document.getElementById('customFileName'), dims=document.getElementById('customDimensionFields'), priceBox=document.getElementById('customOrderPrice'), addButton=document.getElementById('addCustomOrder'), fabricSelect=document.getElementById('customOrderFabric');let uploadData='';let fileName='';let customDimensionError='';
  const selected=()=>document.querySelector('input[name="customOrderSize"]:checked');
  const calcPrice=()=>{const radio=selected(),fabric=fabricSelect?.value||DEFAULT_FABRICS[0];let price=0;customDimensionError='';if(radio?.value==='custom'){const w=document.getElementById('customOrderWidth').value,h=document.getElementById('customOrderHeight').value,pricing=calculateCustomTierPrice(w,h,fabric);if(!pricing.valid){customDimensionError=pricing.reason==='too-large'?'حداکثر سایز قابل ثبت ۱۵۰ × ۹۰ سانتی‌متر است.':'ابعاد معتبر را وارد کنید.';}else price=pricing.price;}else if(radio){const dimensions=parseCustomDimensions(radio.value),pricing=dimensions?calculateCustomTierPrice(dimensions.width,dimensions.height,fabric):{valid:false,reason:'invalid-dimensions'};if(pricing.valid)price=pricing.price;}if(addButton)addButton.disabled=Boolean(radio?.value==='custom'&&customDimensionError);priceBox.textContent=customDimensionError&&radio?.value==='custom'?customDimensionError:(price?toman(price):'پس از ورود ابعاد');return price;};
  document.querySelectorAll('input[name="customOrderSize"]').forEach(r=>r.addEventListener('change',()=>{dims.classList.toggle('show',r.value==='custom'&&r.checked);calcPrice();}));document.querySelectorAll('#customOrderWidth,#customOrderHeight').forEach(x=>x.addEventListener('input',calcPrice));fabricSelect?.addEventListener('change',calcPrice);
  input?.addEventListener('change',()=>{const file=input.files?.[0];if(!file)return;if(file.size>20*1024*1024){showToast('حجم فایل باید کمتر از ۲۰ مگابایت باشد.');input.value='';return;}fileName=file.name;nameBox.textContent=`${file.name} — ${toFa((file.size/1024/1024).toFixed(2))} مگابایت`;if(file.type.startsWith('image/')){const reader=new FileReader();reader.onload=()=>{uploadData=String(reader.result);preview.innerHTML=`<img src="${uploadData}" alt="پیش‌نمایش طرح آپلودشده">`;};reader.readAsDataURL(file);}else{uploadData='';preview.innerHTML='<div class="pdf-preview"><span>PDF</span><strong>فایل PDF آماده ثبت است</strong></div>';}});
  document.getElementById('addCustomOrder')?.addEventListener('click',async()=>{
    if(!fileName){showToast('ابتدا فایل طرح را انتخاب کنید.');return;}
    if(!currentUser){showToast('برای ثبت و نگهداری فایل طرح ابتدا وارد حساب شوید.');openOverlayLayer(document.querySelector('.auth-modal'));return;}
    const radio=selected(),price=calcPrice();if(!radio||!price){showToast(customDimensionError||'ابعاد معتبر را وارد کنید.');return;}
    const size=radio.value==='custom'?`${document.getElementById('customOrderWidth').value} × ${document.getElementById('customOrderHeight').value} سانتی‌متر`:radio.value.replace('x',' × ')+' سانتی‌متر';
    const notes=document.getElementById('customOrderNotes').value.trim(),fabric=document.getElementById('customOrderFabric')?.value||DEFAULT_FABRICS[0],safePreview=uploadData.length<450000?uploadData:'';
    let customId=`DS-${Math.floor(10000+Math.random()*89999)}`;
    if(currentUser&&input.files?.[0]){try{const fd=new FormData();fd.append('file',input.files[0]);fd.append('size',size);fd.append('fabric',fabric);fd.append('notes',notes);fd.append('requestType','چاپ مستقیم');const saved=await api('/api/account/custom',{method:'POST',body:fd});customId=saved.request.id;}catch(error){showToast(error.message||'آپلود فایل انجام نشد.');return;}}
    cart.push({id:`custom-${Date.now()}`,cartId:`custom-${Date.now()}-${Math.random()}`,title:`چاپ طرح اختصاصی — ${fileName}`,category:'طرح دلخواه',price,old:price,qty:1,size,fabric,notes,preview:safePreview,fileName,customRequestId:customId});
    renderCart();showToast(currentUser?'فایل و سفارش اختصاصی ثبت شد.':'سفارش به سبد اضافه شد؛ برای ذخیره فایل وارد حساب شوید.');setTimeout(()=>location.href='/cart',500);
  });
  calcPrice();
}

function renderCheckout(){
  const box=document.getElementById('checkoutSummaryItems');if(!box)return;const sub=cartSubtotal(),discountableSubtotal=discountableCartSubtotal(),total=Math.max(0,sub-discountAmount);
  box.innerHTML=cart.length?cart.map(item=>`<div class="summary-item"><div class="summary-thumb">${item.preview?`<img src="${item.preview}" alt="${escapeHTML(item.title)}">`:productImageBox(item.title,item.image)}</div><span><h4>${escapeHTML(item.title)}</h4><small>تعداد: ${toFa(item.qty)}${item.size?` — سایز: ${escapeHTML(item.size)}`:''}${item.fabric?` — پارچه: ${escapeHTML(item.fabric)}`:''}</small></span><strong class="summary-price">${toman(item.price*item.qty)}</strong></div>`).join(''):'<div class="empty-state"><p>سبد خرید خالی است.</p></div>';
  document.getElementById('checkoutSubtotal').textContent=toman(sub);document.getElementById('checkoutDiscount').textContent=discountAmount?`− ${toman(discountAmount)}`:toman(0);document.getElementById('checkoutShipping').textContent='پرداخت جداگانه';document.getElementById('checkoutTotal').textContent=toman(total);
  const code=sessionStorage.getItem('cribFlagActiveCoupon')||'';
  const feedback=document.getElementById('discountFeedback');if(feedback){feedback.className=`discount-feedback ${discountFeedbackType}`;feedback.textContent=discountableSubtotal===0?'کد تخفیف روی درخواست طرح اختصاصی اعمال نمی‌شود.':(discountFeedbackMessage||(code&&discountAmount?`کد ${code} اعمال شد و ${toman(discountAmount)} از سفارش کم شد.`:'هنوز کد تخفیفی اعمال نشده است.'));}
  const removeButton=document.getElementById('removeDiscountBtn');if(removeButton)removeButton.hidden=!code;
}
function initCheckout(){
  let current=1;
  const get=id=>document.getElementById(id);

  const showStep=n=>{
    current=n;
    document.querySelectorAll('.checkout-step').forEach(section=>section.classList.toggle('active',Number(section.dataset.step)===n));
    document.querySelectorAll('.checkout-step-indicator').forEach(indicator=>{
      const value=Number(indicator.dataset.indicator);
      indicator.classList.toggle('active',value===n);
      indicator.classList.toggle('done',value<n);
    });
    window.scrollTo({top:0,behavior:'smooth'});

    if(n===3){
      const review=get('checkoutCustomerReview');
      if(review){
        review.innerHTML=`<h3>اطلاعات تحویل</h3>
          <p><strong>${escapeHTML(get('checkoutName')?.value)}</strong> — ${escapeHTML(get('checkoutPhone')?.value)}</p>
          <p>${escapeHTML(get('checkoutProvince')?.value)}، ${escapeHTML(get('checkoutCity')?.value)}، ${escapeHTML(get('checkoutAddress')?.value)}، ${escapeHTML(get('checkoutUnit')?.value)}</p>${get('checkoutNote')?.value.trim()?`<p><strong>یادداشت سفارش:</strong> ${escapeHTML(get('checkoutNote').value.trim())}</p>`:''}`;
      }
      renderCheckout();
    }
  };

  const validateStep1=()=>{
    let valid=true;
    document.querySelectorAll('.checkout-step[data-step="1"] [required]').forEach(input=>{
      const bad=!String(input.value||'').trim();
      input.classList.toggle('invalid',bad);
      valid=valid&&!bad;
    });

    const postal=String(get('checkoutPostal')?.value||'')
      .replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      .replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    if(postal && !/^\d{10}$/.test(postal)){
      get('checkoutPostal')?.classList.add('invalid');
      showToast('کد پستی باید دقیقاً ۱۰ رقم باشد.');
      return false;
    }

    if(!valid)showToast('لطفاً اطلاعات ضروری را کامل کنید.');
    return valid;
  };

  renderCheckout();
  document.querySelectorAll('.checkout-next').forEach(button=>button.addEventListener('click',()=>{
    const next=Number(button.dataset.next);
    if(current===1&&!validateStep1())return;
    if(next===3&&!cart.length){showToast('سبد خرید خالی است.');return;}
    showStep(next);
  }));
  document.querySelectorAll('.checkout-back').forEach(button=>button.addEventListener('click',()=>showStep(Number(button.dataset.back))));
  document.querySelectorAll('input[name="shipping"]').forEach(input=>input.addEventListener('change',()=>{
    shippingPrice=Number(document.querySelector('input[name="shipping"]:checked')?.dataset.shippingPrice||0);
    renderCheckout();
  }));

  const validateDiscount=async(code,{silent=false}={})=>{
    const normalized=String(code||'').trim();
    if(!normalized){discountAmount=0;sessionStorage.removeItem('cribFlagActiveCoupon');discountFeedbackType='error';discountFeedbackMessage='ابتدا کد تخفیف را وارد کنید.';renderCheckout();if(!silent)showToast(discountFeedbackMessage);return false;}
    const subtotal=discountableCartSubtotal();
    if(subtotal<=0){discountAmount=0;sessionStorage.removeItem('cribFlagActiveCoupon');discountFeedbackType='neutral';discountFeedbackMessage='کد تخفیف روی درخواست طرح اختصاصی اعمال نمی‌شود.';renderCheckout();if(!silent)showToast(discountFeedbackMessage);return false;}
    try{
      const discountItems=cart.filter(item=>!isCustomCartItem(item)).map(item=>({id:item.id,qty:item.qty,size:item.size,fabric:item.fabric}));
      const request=()=>api('/api/discounts/validate',{method:'POST',body:JSON.stringify({code:normalized,subtotal,items:discountItems})});
      const result=silent?await request():await window.CribLoader.during(request,'در حال بررسی کد تخفیف...');
      discountAmount=Number(result.discount||0);
      const activeCode=result.code||normalized.toUpperCase();
      sessionStorage.setItem('cribFlagActiveCoupon',activeCode);
      const input=get('discountCodeInput');if(input)input.value=activeCode;
      discountFeedbackType='success';
      const restricted=result.applicability==='variants'&&Number(result.eligibleSubtotal||0)<subtotal;
      discountFeedbackMessage=restricted
        ?`کد ${activeCode} فقط روی محصولات واجد شرایط اعمال شد؛ ${toman(discountAmount)} از سفارش کم شد.`
        :`کد ${activeCode} با موفقیت اعمال شد؛ ${toman(discountAmount)} از سفارش کم شد.`;
      if(!silent)showToast(discountFeedbackMessage);
      renderCheckout();return true;
    }catch(error){
      discountAmount=0;sessionStorage.removeItem('cribFlagActiveCoupon');
      discountFeedbackType='error';discountFeedbackMessage=error.message||'کد تخفیف معتبر نیست یا اعمال نشد.';
      if(!silent)showToast(discountFeedbackMessage);
      renderCheckout();return false;
    }
  };
  get('applyDiscountBtn')?.addEventListener('click',()=>validateDiscount(get('discountCodeInput').value));
  get('removeDiscountBtn')?.addEventListener('click',()=>{clearAppliedDiscount('کد تخفیف از سفارش حذف شد.','neutral');showToast('کد تخفیف حذف شد.');});
  const savedCoupon=sessionStorage.getItem('cribFlagActiveCoupon');if(savedCoupon){get('discountCodeInput').value=savedCoupon;validateDiscount(savedCoupon,{silent:true});}

  get('finalPaymentBtn')?.addEventListener('click',async()=>{
    if(!currentUser){requireLogin('/checkout');return;}
    if(!cart.length){showToast('سبد خرید خالی است.');return;}
    if(!validateStep1()){showStep(1);return;}

    const button=get('finalPaymentBtn');
    if(button.disabled)return;
    button.disabled=true;

    try{
      const shippingMethod=document.querySelector('input[name="shipping"]:checked')?.value||'tipax';
      const paymentMethod=document.querySelector('input[name="payment"]:checked')?.value||'online';
      const province=get('checkoutProvince')?.value.trim()||'';
      const city=get('checkoutCity')?.value.trim()||'';
      const addressLine=get('checkoutAddress')?.value.trim()||'';
      const unit=get('checkoutUnit')?.value.trim()||'';

      const payload={
        email:get('checkoutEmail')?.value.trim()||'',
        province,
        city,
        postalCode:get('checkoutPostal')?.value.trim()||'',
        address:`${province}، ${city}، ${addressLine}، ${unit}`,
        shippingMethod,
        paymentMethod,
        note:get('checkoutNote')?.value.trim()||'',
        couponCode:sessionStorage.getItem('cribFlagActiveCoupon')||'',
        items:cart.map(item=>({
          id:item.id,
          title:item.title,
          category:item.category,
          price:item.price,
          qty:item.qty,
          size:item.size,
          fabric:item.fabric,
          notes:item.notes,
          fileName:item.fileName,
          customRequestId:item.customRequestId
        }))
      };

      const result=await window.CribLoader.during(
        ()=>api('/api/orders',{method:'POST',body:JSON.stringify(payload)}),
        'در حال ثبت و پردازش سفارش...'
      );

      const lastId=result.orderNumber||result.customRequestId||'';
      sessionStorage.setItem('cribFlagLastOrder',JSON.stringify({
        id:lastId,
        shipping:shippingMethod==='tipax'?'تیپاکس':'ارسال فوری از کرج'
      }));
      cart=[];
      renderCart();
      sessionStorage.removeItem('cribFlagActiveCoupon');
      window.CribLoader?.show(result.paymentUrl?'در حال انتقال به درگاه...':'در حال نمایش نتیجه سفارش...');
      location.href=result.paymentUrl||result.successUrl||'/payment/success';
    }catch(error){
      window.CribLoader?.hide(true);
      showToast(error.message||'ثبت سفارش انجام نشد.');
      button.disabled=false;
    }
  });
}
function initSuccess(){try{const params=new URLSearchParams(location.search),o=JSON.parse(sessionStorage.getItem('cribFlagLastOrder')||'{}');const id=params.get('order')||o.id,shipping=params.get('shipping')||o.shipping;if(id)document.getElementById('successOrderId').textContent=id;if(shipping)document.getElementById('successShipping').textContent=shipping;if(params.get('failed')||window.__PAYMENT_FAILED__)showToast('پرداخت ناموفق بود؛ سفارش لغو شد.');}catch{}}

function initPage(){initHeader();const p=body.dataset.page;if(p==='home')initHome();if(p==='store')initStore();if(p==='product')initProduct();if(p==='custom')initCustomOrder();if(p==='cart')initCart();if(p==='faq')initFaq();if(p==='ready')initReady();if(p==='blog')initBlog();if(p==='blog-detail')initBlogDetail();if(p==='checkout')initCheckout();if(p==='success')initSuccess();}
document.addEventListener('DOMContentLoaded',async()=>{
  // Public pages are server-rendered with products, categories and the current user.
  // Initialize immediately instead of blocking first interaction behind three duplicate API calls.
  if(window.__SSR_DATA_READY__){initPage();return;}
  window.CribLoader?.show('در حال دریافت اطلاعات...');
  try{await bootstrapRemoteData();initPage();}finally{window.CribLoader?.hide(true);}
});

window.CribLoader = (() => {
  const element = document.getElementById('appLoading');
  const textElement = document.getElementById('appLoadingText');

  let openRequests = 0;

  function show(text = 'در حال بارگذاری...') {
    openRequests += 1;

    if (textElement) {
      textElement.textContent = text;
    }

    element?.classList.add('is-active');
    element?.setAttribute('aria-hidden', 'false');

    document.body.classList.add('has-app-loading');
  }

  function hide(force = false) {
    openRequests = force
      ? 0
      : Math.max(0, openRequests - 1);

    if (openRequests > 0) return;

    element?.classList.remove('is-active');
    element?.setAttribute('aria-hidden', 'true');

    document.body.classList.remove('has-app-loading');
  }

  async function during(callback, text) {
    show(text);

    try {
      return await callback();
    } finally {
      hide();
    }
  }

  return {
    show,
    hide,
    during
  };
})();

window.addEventListener('pageshow', () => {
  window.CribLoader?.hide(true);
});