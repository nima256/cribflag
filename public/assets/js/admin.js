(function(){
'use strict';

const D=window.CribData;
if(!D){
  console.error('CribData بارگذاری نشده است؛ فایل portal-data.js باید قبل از admin.js لود شود.');
  return;
}
D.ensure();

const q=selector=>document.querySelector(selector);
const qa=selector=>[...document.querySelectorAll(selector)];
const labels={
  processing:'در حال آماده‌سازی','design-review':'بررسی طراحی','print-preparation':'آماده‌سازی برای چاپ',shipped:'ارسال شده',delivered:'تحویل شده',cancelled:'لغو شده',
  active:'فعال',draft:'پیش‌نویس',expired:'منقضی',open:'باز',answered:'پاسخ داده شده',closed:'بسته',review:'در حال بررسی',
  'preview-ready':'پیش‌نمایش آماده',approved:'تأیید شده',unpaid:'پرداخت نشده',pending:'در انتظار پرداخت',paid:'پرداخت شده',failed:'پرداخت ناموفق',refunded:'مسترد شده'
};
const ORDER_STATUS_CHART=[
  {key:'processing',label:'در حال آماده‌سازی',color:'#f2a51a'},
  {key:'design-review',label:'بررسی طراحی',color:'#8b5cf6'},
  {key:'print-preparation',label:'آماده‌سازی برای چاپ',color:'#0ea5a4'},
  {key:'shipped',label:'ارسال شده',color:'#3157d5'},
  {key:'delivered',label:'تحویل شده',color:'#22a881'},
  {key:'cancelled',label:'لغو شده',color:'#e95b70'}
];
let activeOrder=null,activeCustomer=null,activeTicket=null,activeCustom=null;
let productImageItems=[];
let categoryImageFile=null;
let categoryImagePreviewUrl='';
const PRODUCT_IMAGE_LIMIT=12;
const ADMIN_PRODUCT_PAGE_SIZE=12;
let adminProductPage=1;
const DEFAULT_PRODUCT_SIZE_PRICES=Object.freeze({
  '150x90':990000,
  '100x70':800000,
  '70x50':550000
});
const DEFAULT_VELVET_PRODUCT_SIZE_PRICES=Object.freeze({
  '150x90':2000,
  '100x70':1000,
  '70x50':700000
});
const STANDARD_PRODUCT_SIZES=Object.freeze([
  Object.freeze({value:'۱۵۰ × ۹۰ سانتی‌متر',title:'۱۵۰ × ۹۰',hint:'بزرگ و چشمگیر'}),
  Object.freeze({value:'۱۰۰ × ۷۰ سانتی‌متر',title:'۱۰۰ × ۷۰',hint:'سایز متعادل'}),
  Object.freeze({value:'۵۰ × ۷۰ سانتی‌متر',title:'۵۰ × ۷۰',hint:'جمع‌وجور'})
]);
const STANDARD_PRODUCT_FABRICS=Object.freeze([
  Object.freeze({value:'ساتن آمریکایی',title:'ساتن آمریکایی',hint:'مناسب چاپ و استفاده عمومی'}),
  Object.freeze({value:'ساتن براق',title:'ساتن براق',hint:'ظاهر درخشان‌تر'}),
  Object.freeze({value:'مخمل',title:'مخمل',hint:'ظاهر رسمی و سنگین'})
]);
const PILLOW_PRODUCT_CONFIGS=Object.freeze({
  pillowcase:Object.freeze({title:'روبالشتی',variants:Object.freeze([
    Object.freeze({option:'فقط کاور',size:'۵۰ × ۷۰ سانتی‌متر',price:650000}),
    Object.freeze({option:'با الیاف',size:'۵۰ × ۷۰ سانتی‌متر',price:990000})
  ])}),
  dakimakura:Object.freeze({title:'داکیماکورا بالشت قدی',variants:Object.freeze([
    Object.freeze({option:'فقط کاور',size:'۳۵ × ۱۰۰ سانتی‌متر',price:700000}),
    Object.freeze({option:'با الیاف',size:'۳۵ × ۱۰۰ سانتی‌متر',price:1050000}),
    Object.freeze({option:'فقط کاور',size:'۵۰ × ۱۵۰ سانتی‌متر',price:990000}),
    Object.freeze({option:'با الیاف',size:'۵۰ × ۱۵۰ سانتی‌متر',price:1450000})
  ])})
});
const pillowVariantSize=(option,size)=>`${option} — ${size}`;
let activeProductPillowMode=null;

async function optimizeProductUpload(file){
  if(!file||!String(file.type||'').startsWith('image/'))return file;
  if(!('createImageBitmap' in window))return file;

  let bitmap;
  try{
    bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
    const maxDimension=1600;
    const largest=Math.max(bitmap.width,bitmap.height);
    if(largest<=maxDimension)return file;

    const scale=maxDimension/largest;
    const width=Math.max(1,Math.round(bitmap.width*scale));
    const height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement('canvas');
    canvas.width=width;
    canvas.height=height;
    const context=canvas.getContext('2d',{alpha:true});
    if(!context)return file;
    context.imageSmoothingEnabled=true;
    context.imageSmoothingQuality='high';
    context.drawImage(bitmap,0,0,width,height);

    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.86));
    if(!blob)return file;
    const baseName=String(file.name||'product').replace(/\.[^.]+$/,'');
    return new File([blob],`${baseName}.webp`,{
      type:'image/webp',
      lastModified:file.lastModified||Date.now()
    });
  }catch(error){
    console.warn('بهینه‌سازی تصویر در مرورگر انجام نشد؛ فایل اصلی ارسال می‌شود.',error);
    return file;
  }finally{
    bitmap?.close?.();
  }
}

function releaseProductImageItems(){
  productImageItems.forEach(item=>{if(item.type==='file'&&item.preview)URL.revokeObjectURL(item.preview);});
  productImageItems=[];
}
function releaseCategoryImageSelection(){
  if(categoryImagePreviewUrl)URL.revokeObjectURL(categoryImagePreviewUrl);
  categoryImagePreviewUrl='';
  categoryImageFile=null;
  const input=q('#categoryImageFile');
  if(input)input.value='';
}
function renderCategoryImagePreview(source=''){
  const preview=q('#categoryImagePreview');
  const empty=q('#categoryImageEmpty');
  const label=q('#categoryImageFileName');
  const resolved=source||q('#categoryImage')?.value||'';
  if(preview){preview.src=resolved||D.PRODUCT_IMAGE;preview.hidden=!resolved;}
  if(empty)empty.hidden=Boolean(resolved);
  if(label)label.textContent=categoryImageFile?categoryImageFile.name:(resolved?'تصویر فعلی دسته‌بندی':'هنوز تصویری انتخاب نشده است.');
}
function existingProductImages(product){
  const list=Array.isArray(product?.images)&&product.images.length?product.images:[product?.image];
  const unique=[...new Set(list.map(value=>String(value||'').trim()).filter(Boolean))];
  return unique.length?unique:[D.PRODUCT_IMAGE];
}
function renderProductImageEditor(){
  const preview=q('#productImagePreview'),hidden=q('#productImage'),box=q('#productImagesEditor'),label=q('#productImageFileName');
  const first=productImageItems[0];
  const firstSource=first?(first.preview||first.value):D.PRODUCT_IMAGE;
  if(preview)preview.src=firstSource;
  if(hidden)hidden.value=first?.value||'';
  if(label)label.textContent=productImageItems.length?`${D.fa(productImageItems.length)} تصویر در گالری قرار دارد.`:'هنوز تصویری انتخاب نشده است.';
  if(!box)return;
  box.innerHTML=productImageItems.map((item,index)=>`<article class="product-image-item${index===0?' is-primary':''}" data-image-index="${index}">
    <img src="${D.esc(item.preview||item.value||D.PRODUCT_IMAGE)}" alt="تصویر ${D.fa(index+1)} محصول">
    <span class="product-image-order">${index===0?'اصلی':D.fa(index+1)}</span>
    <div class="product-image-actions">
      ${index>0?'<button type="button" data-image-action="primary" title="انتخاب به‌عنوان تصویر اصلی">★</button>':''}
      ${index>0?'<button type="button" data-image-action="right" title="انتقال به راست">→</button>':''}
      ${index<productImageItems.length-1?'<button type="button" data-image-action="left" title="انتقال به چپ">←</button>':''}
      <button type="button" data-image-action="remove" title="حذف تصویر">×</button>
    </div>
  </article>`).join('')||'<div class="product-images-empty">تصاویر انتخاب‌شده اینجا نمایش داده می‌شوند.</div>';
}

function status(value){return `<span class="portal-status status-${D.esc(value)}">${D.esc(labels[value]||value)}</span>`;}
function registrationDateTime(item={}){
  const formatted=String(item.dateTime||item.registeredAt||'').trim();
  if(formatted)return formatted;

  const raw=String(item.createdAt||'').trim();
  if(raw){
    const value=new Date(raw);
    if(!Number.isNaN(value.getTime())){
      try{
        return new Intl.DateTimeFormat('fa-IR-u-ca-persian',{
          year:'numeric',month:'2-digit',day:'2-digit',
          hour:'2-digit',minute:'2-digit',hourCycle:'h23',
          timeZone:'Asia/Tehran'
        }).format(value).replace(/[،,]/,' -');
      }catch(error){
        console.warn('نمایش ساعت ثبت سفارش ناموفق بود.',error);
      }
    }
  }

  return String(item.date||'—');
}
function openModal(selector){q(selector)?.classList.add('open');}
function closeModals(){const productWasOpen=q('#productModal')?.classList.contains('open');const categoryWasOpen=q('#categoryModal')?.classList.contains('open');qa('.portal-modal-backdrop').forEach(item=>item.classList.remove('open'));if(productWasOpen)releaseProductImageItems();if(categoryWasOpen)releaseCategoryImageSelection();}
function productThumb(title='محصول',image=D.PRODUCT_IMAGE){
  return `<span class="product-mini-img"><img src="${D.esc(image||D.PRODUCT_IMAGE)}" alt="${D.esc(title)}"></span>`;
}
function productImage(id){return D.get('products').find(product=>Number(product.id)===Number(id))?.image||D.PRODUCT_IMAGE;}
function parsePillowSelection(value){
  const text=String(value||'').trim();if(!text||(!text.includes('کاور')&&!text.includes('الیاف')))return null;
  const option=text.includes('با الیاف')?'با الیاف':'فقط کاور';
  const size=text.replace(/^.*?—\s*/,'').trim();
  return size?{option,size}:null;
}
function orderItemOptions(item){
  const pillow=parsePillowSelection(item?.size),parts=[];
  if(pillow)parts.push(`نوع سفارش: ${D.esc(pillow.option)}`,`سایز: ${D.esc(pillow.size)}`);
  else if(item?.size)parts.push(`سایز: ${D.esc(item.size)}`);
  if(item?.fabric)parts.push(`جنس: ${D.esc(item.fabric)}`);
  parts.push(`تعداد ${D.fa(item?.qty||1)}`);
  return parts.join(' — ');
}
function orderItemDownloadMarkup(item={}){
  const customRequestId=String(item?.customRequestId||'').trim();
  if(!customRequestId)return '';
  const downloadUrl=String(item?.downloadUrl||'').trim();
  const fileName=String(item?.fileName||'').trim();
  const fileMeta=`<small>کد طرح: ${D.esc(customRequestId)}${fileName?` — فایل: ${D.esc(fileName)}`:''}</small>`;
  if(!downloadUrl)return `${fileMeta}<small style="color:var(--portal-danger)">فایل طرح روی سرور در دسترس نیست.</small>`;
  return `${fileMeta}<a href="${D.esc(downloadUrl)}" class="portal-btn portal-btn-soft" style="display:inline-flex;width:max-content;margin-top:7px">دانلود فایل طرح</a>`;
}

function customRequestIdsFromDisplayOrder(order={}){
  return [...new Set(
    (order.items||[])
      .map(item=>String(item?.customRequestId||'').trim())
      .filter(Boolean)
  )];
}
function getOrdersForDisplay() {
  const realOrders = Array.isArray(D.get('orders'))
    ? D.get('orders').map(order => ({
        ...order,
        displayType: 'order',
        sourceCollection: 'orders'
      }))
    : [];

  const customRequests = Array.isArray(D.get('custom')) ? D.get('custom') : [];
  const orderByNumber = new Map(realOrders.map(order => [String(order.id || '').trim(), order]));
  const orderByCustomRequestId = new Map();

  for (const order of realOrders) {
    for (const customRequestId of customRequestIdsFromDisplayOrder(order)) {
      if (!orderByCustomRequestId.has(customRequestId)) orderByCustomRequestId.set(customRequestId, order);
    }
  }

  /*
   * هر پرداخت نهایی دقیقاً یک ردیف KR است و تمام اقلام همان Order را نشان می‌دهد؛
   * فرقی ندارد همه اختصاصی باشند، همه عادی باشند یا ترکیبی از هر دو.
   * درخواست‌های DS فقط زمانی در لیست سفارش‌ها ردیف جدا می‌گیرند که هنوز به هیچ
   * Order نهایی وصل نشده باشند (مثلاً طرحی که هنوز در مرحله بررسی/سبد است).
   */
  const standaloneCustomRows = customRequests.flatMap(item => {
    const customRequestId = String(item.id || '').trim();
    const directOrderNumber = String(item.orderNumber || '').trim();
    const linkedOrder = (directOrderNumber ? orderByNumber.get(directOrderNumber) : null)
      || orderByCustomRequestId.get(customRequestId)
      || null;

    if (linkedOrder) return [];

    const customGross = Number(item.price || 0);
    const customStatus = item.status || 'review';
    const mappedOrderStatus = item.orderStatus || (customStatus === 'approved' ? 'processing' : 'design-review');

    return [{
      id: item.id,
      customRequestId: item.id,
      linkedOrderNumber: '',
      displayType: 'custom',
      sourceCollection: 'customRequests',

      customer: item.customer || 'مشتری طرح اختصاصی',
      phone: item.phone || '—',
      email: item.email || '',

      date: item.date || '—',
      dateTime: item.dateTime || '',
      createdAt: item.createdAt || '',

      subtotal: customGross,
      shipping: 0,
      discount: 0,
      total: customGross,
      linkedPaymentTotal: customGross,
      payment: item.payment || 'ثبت نشده',
      paymentStatus: item.paymentStatus || 'unpaid',

      status: mappedOrderStatus,
      orderStatus: mappedOrderStatus,
      customStatus,
      shippingMethod: item.shippingMethod || 'طرح اختصاصی',

      province: item.province || '',
      city: item.city || '',
      postalCode: item.postalCode || '',
      address: item.address || '',
      customerNote: item.deliveryNote || '',
      tracking: '',

      fileName: item.fileName || '',
      size: item.size || '',
      fabric: item.fabric || '',
      notes: item.notes || '',
      adminNote: item.adminNote || '',
      items: []
    }];
  });

  return [...realOrders, ...standaloneCustomRows];
}

function paidOrdersValue(orders=[]){
  return orders.reduce((state,order)=>{
    if(order.paymentStatus!=='paid'||order.status==='cancelled')return state;
    const saleKey=String(order.linkedOrderNumber||order.id||'').trim();
    if(!saleKey||state.keys.has(saleKey))return state;
    state.keys.add(saleKey);
    state.total+=Number(order.total||0);
    return state;
  },{total:0,keys:new Set()}).total;
}

function showView(view){
  qa('[data-admin-section]').forEach(section=>section.classList.toggle('active',section.dataset.adminSection===view));
  qa('[data-admin-view]').forEach(button=>button.classList.toggle('active',button.dataset.adminView===view));
  const button=q(`[data-admin-view="${view}"]`);
  q('#adminViewTitle').textContent=button?.dataset.viewTitle||'مدیریت';
  q('#adminSidebar')?.classList.remove('open');
  q('#adminSideOverlay')?.classList.remove('open');
  window.scrollTo({top:0,behavior:'smooth'});
}
function getAnalytics(){
  const value=D.get('analytics');
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
}
function monthlyChart(selector,rows=[]){
  const el=q(selector);
  if(!el)return;
  const data=Array.isArray(rows)?rows:[];
  if(!data.length){
    el.innerHTML='<div class="empty-panel" style="width:100%;align-self:center">داده ماهانه‌ای برای نمایش وجود ندارد.</div>';
    return;
  }
  const max=Math.max(0,...data.map(item=>Number(item.revenue||0)));
  el.innerHTML=data.map(item=>{
    const revenue=Math.max(0,Number(item.revenue||0));
    const orderCount=Math.max(0,Number(item.orders||0));
    const height=max>0&&revenue>0?Math.max(6,Math.round(revenue/max*88)):0;
    const tooltip=`${D.toman(revenue)} · ${D.fa(orderCount)} سفارش`;
    return `<div class="chart-col" title="${D.esc(item.label||item.shortLabel||'')}"><div class="chart-bar" style="height:${height}%;min-height:${revenue>0?'12px':'0'}" data-value="${D.esc(tooltip)}"></div><span class="chart-label">${D.esc(item.shortLabel||item.label||'—')}</span></div>`;
  }).join('');
}
function renderOrderDonut(statusCounts={}){
  const donut=q('#adminOrderDonut');
  const legend=q('#adminOrderStatusLegend');
  const counts=ORDER_STATUS_CHART.map(item=>({...item,count:Math.max(0,Number(statusCounts[item.key]||0))}));
  const total=counts.reduce((sum,item)=>sum+item.count,0);
  if(donut){
    if(!total){
      donut.style.background='#edf0f6';
    }else{
      let cursor=0;
      const segments=[];
      for(const item of counts){
        if(!item.count)continue;
        const start=cursor;
        cursor+=item.count/total*100;
        segments.push(`${item.color} ${start.toFixed(3)}% ${cursor.toFixed(3)}%`);
      }
      donut.style.background=`conic-gradient(${segments.join(',')})`;
    }
  }
  if(legend){
    legend.innerHTML=counts.map(item=>`<div><i style="background:${item.color}"></i>${D.esc(item.label)} <b>${D.fa(item.count)}</b></div>`).join('');
  }
  const totalEl=q('#donutOrders');
  if(totalEl)totalEl.textContent=D.fa(total);
}
function paymentGatewayLabel(order = {}) {
  const raw = String(order.payment || '').trim();
  if (/ترب|torob/i.test(raw)) return 'ترب‌پی';
  if (/زرین|zarin/i.test(raw)) return 'زرین‌پال';
  if (/کارت\s*به\s*کارت/i.test(raw)) return 'کارت به کارت';
  if (/ثبت دستی/i.test(raw)) return 'ثبت دستی مدیر';
  if (!raw || raw === 'ثبت نشده') return 'ثبت نشده';
  if (raw === 'پرداخت آنلاین') return 'درگاه آنلاین';
  return raw;
}

function orderRow(order, compact = false) {
  const isCustom = order.displayType === 'custom';

  const orderStatus = status(order.status || (isCustom ? 'design-review' : 'processing'));

  const paymentStatus = status(order.paymentStatus || (isCustom ? 'unpaid' : 'pending'));

  const customItemCount = isCustom ? 1 : customRequestIdsFromDisplayOrder(order).length;
  const normalItemCount = isCustom ? 0 : Math.max(0, (order.items || []).length - customItemCount);
  const orderKindBadge = isCustom
    ? `
      <span class="portal-status status-design-review" style="margin-top:6px">
        درخواست اختصاصی بدون سفارش نهایی
      </span>
    `
    : customItemCount
      ? `<span class="portal-status status-design-review" style="margin-top:6px">${normalItemCount ? 'سفارش ترکیبی' : 'سفارش اختصاصی'} — ${D.fa(customItemCount)} طرح</span>`
      : '';

  const actionButton = isCustom
    ? `
      <button
        type="button"
        class="table-action open-custom-from-orders"
        data-id="${D.esc(order.customRequestId)}"
        title="مشاهده سفارش اختصاصی"
      >
        <svg viewBox="0 0 24 24">
          <path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>
          <path d="M14 3v6h6M8 15l2-2 2 2 3-4 3 4"/>
        </svg>
      </button>
    `
    : `
      <button
        type="button"
        class="table-action admin-order-view"
        data-id="${D.esc(order.id)}"
        title="مشاهده سفارش"
      >
        <svg viewBox="0 0 24 24">
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
    `;

  const deleteButton = `
    <button
      type="button"
      class="table-action delete-order"
      data-id="${D.esc(order.id)}"
      data-source="${isCustom ? 'custom' : 'order'}"
      title="حذف ${isCustom ? 'سفارش اختصاصی' : 'سفارش'}"
      style="color:var(--portal-danger)"
    >
      <svg viewBox="0 0 24 24">
        <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>
      </svg>
    </button>
  `;

  if (compact) {
    return `
      <tr>
        <td>
          <span class="table-primary">
            ${D.esc(order.id)}
          </span>

          <span class="table-secondary">
            ${D.esc(registrationDateTime(order))}
          </span>

          ${orderKindBadge}
        </td>

        <td>
          <b>${D.esc(order.customer || '—')}</b>

          <span class="table-secondary">
            ${D.esc(order.phone || '—')}
          </span>
        </td>

        <td>
          <b>${D.toman(order.total || 0)}</b>${Number(order.discount||0)>0?`<span class="table-secondary">تخفیف: ${D.toman(order.discount)}</span>`:''}
        </td>

        <td>
          ${orderStatus}
        </td>

        <td>
          ${actionButton}
        </td>
      </tr>
    `;
  }

  return `
    <tr>
      <td>
        <span class="table-primary">
          ${D.esc(order.id)}
        </span>

        <span class="table-secondary">
          ${D.esc(order.shippingMethod || '—')}
        </span>

        ${orderKindBadge}
      </td>

      <td>
        <b>${D.esc(order.customer || '—')}</b>

        <span class="table-secondary">
          ${D.esc(order.phone || '—')}
        </span>
      </td>

      <td>
        ${D.esc(registrationDateTime(order))}
      </td>

      <td>
        <b>${D.toman(order.total || 0)}</b>${Number(order.discount||0)>0?`<span class="table-secondary">تخفیف: ${D.toman(order.discount)}</span>`:''}
      </td>

      <td>
        ${paymentStatus}
        <span class="table-secondary">درگاه: ${D.esc(paymentGatewayLabel(order))}</span>
      </td>

      <td>
        ${orderStatus}
      </td>

      <td>
        <div class="table-actions">
          ${actionButton}

          ${
            !isCustom
              ? `
                <button
                  type="button"
                  class="table-action admin-order-print"
                  data-id="${D.esc(order.id)}"
                  title="چاپ"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6v-7Z"/>
                  </svg>
                </button>
              `
              : ''
          }

          ${deleteButton}
        </div>
      </td>
    </tr>
  `;
}

async function deleteAdminOrder(id, source = 'order', trigger = null) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return false;

  const isCustom = source === 'custom';
  const customItem = isCustom
    ? D.get('custom').find(item => String(item.id) === normalizedId)
    : null;
  const relatedOrder = customItem?.orderNumber
    ? ` و سفارش مرتبط ${customItem.orderNumber}`
    : '';
  const warning = isCustom
    ? `سفارش اختصاصی ${normalizedId}${relatedOrder} برای همیشه حذف شود؟ فایل طرح و اطلاعات مرتبط نیز پاک می‌شوند.`
    : `سفارش ${normalizedId} برای همیشه حذف شود؟ موجودی و مصرف کد تخفیف این سفارش در صورت نیاز برگردانده می‌شود.`;

  if (!confirm(warning)) return false;

  if (trigger) trigger.disabled = true;
  try {
    const result = await window.CribAPI.request(
      `/api/admin/orders/${encodeURIComponent(normalizedId)}?source=${encodeURIComponent(isCustom ? 'custom' : 'order')}`,
      { method: 'DELETE' }
    );
    activeOrder = null;
    activeCustom = null;
    await D.syncFromApi('admin');
    closeModals();
    renderAll();
    D.toast(result.message || (isCustom ? 'سفارش اختصاصی حذف شد.' : 'سفارش حذف شد.'));
    return true;
  } catch (error) {
    D.toast(error.message || 'حذف سفارش انجام نشد.', 'error');
    return false;
  } finally {
    if (trigger?.isConnected) trigger.disabled = false;
  }
}
function productRow(product){
  const sizes=(product.sizes||[]).map(item=>item.replace(' سانتی‌متر','')).join('، ')||'—';
  const categories=(product.categories||[product.category]).filter(Boolean);
  const fabrics=(product.fabrics||[]).join('، ')||'—';
  const inventory=product.inventoryMode==='managed'?(Number(product.stock)>0?`${D.fa(product.stock)} عدد`:'ناموجود'):'موجود';
  const inventoryClass=product.inventoryMode==='managed'&&Number(product.stock)<=0?'expired':'active';
  return `<tr><td><div class="table-product">${productThumb(product.title,product.image)}<span><b>${D.esc(product.title)}</b><small class="table-secondary">${D.esc(product.badge||'بدون نشان')}</small></span></div></td><td>${D.esc(product.sku||`CF-${product.id}`)}</td><td>${D.esc(categories.join('، '))}</td><td><b>${D.toman(product.price)}</b></td><td><span class="portal-status status-${inventoryClass}">${D.esc(inventory)}</span></td><td><span class="table-primary">${D.esc(sizes)}</span><span class="table-secondary">${D.esc(fabrics)}</span></td><td>${D.fa(product.sales||0)}</td><td>${status(product.status||'active')}</td><td><div class="table-actions"><button class="table-action edit-product" data-id="${product.id}" title="ویرایش"><svg viewBox="0 0 24 24"><path d="m4 16-1 5 5-1L19 9l-4-4L4 16ZM13 7l4 4"/></svg></button><button class="table-action clone-product" data-id="${product.id}" title="کپی"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg></button><button class="table-action delete-product" data-id="${product.id}" title="حذف"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></svg></button></div></td></tr>`;
}
function renderDashboard(){
  const analytics=getAnalytics();
  const totals=analytics.totals||{};
  const statusCounts=analytics.orderStatuses||{};
  const monthlySales=analytics.monthlySales||[];
  const topProducts=analytics.topProducts||[];
  const orders=getOrdersForDisplay();
  const products=D.get('products');

  q('#statRevenue').textContent=D.toman(totals.revenue||0);
  q('#statOrders').textContent=D.fa(totals.orders||0);
  q('#statCustomers').textContent=D.fa(totals.customers||0);
  q('#statProducts').textContent=D.fa(totals.products||0);
  q('#statStockChange').textContent=`${D.fa(totals.activeProducts||0)} فعال`;
  q('#statOrdersChange').textContent=`${D.fa(totals.paidOrders||0)} پرداخت‌شده`;
  q('#statCustomersChange').textContent=`${D.fa(totals.newCustomers||0)} مشتری جدید`;

  const growth=Number(totals.revenueGrowth||0);
  const growthEl=q('#statRevenueChange');
  if(growthEl){
    growthEl.textContent=growth>0?`${D.fa(growth)}٪ رشد`:growth<0?`${D.fa(Math.abs(growth))}٪ کاهش`:'بدون تغییر';
    growthEl.classList.toggle('down',growth<0);
  }

  q('#adminRecentOrders').innerHTML=[...orders]
    .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
    .slice(0,5)
    .map(order=>orderRow(order,true)).join('')||'<tr><td colspan="5"><div class="empty-panel">سفارشی ثبت نشده است.</div></td></tr>';

  q('#adminTopProductsList').innerHTML=topProducts.slice(0,5).map((item,index)=>{
    const product=products.find(entry=>Number(entry.id)===Number(item.id));
    const image=product?.image||D.PRODUCT_IMAGE;
    const categories=(product?.categories||[product?.category]).filter(Boolean).join('، ');
    return `<div class="list-item">${productThumb(item.title,image)}<span class="list-content"><strong>${D.esc(item.title)}</strong><small>${D.esc(categories||'فروش قطعی دیتابیس')} — ${D.toman(item.revenue||0)}</small></span><span class="list-value"><strong>${D.fa(item.quantity||0)} فروش</strong><small>رتبه ${D.fa(index+1)}</small></span></div>`;
  }).join('')||'<div class="empty-panel">هنوز فروش پرداخت‌شده‌ای ثبت نشده است.</div>';

  monthlyChart('#adminRevenueChart',monthlySales);
  renderOrderDonut(statusCounts);
  q('#adminNewOrders').textContent=D.fa(Number(statusCounts.processing||0)+Number(statusCounts['design-review']||0));
  q('#adminOpenTickets').textContent=D.fa(D.get('tickets').filter(ticket=>ticket.status==='open').length);
}

function renderOrders() {
  const term = (
    q('#adminOrderSearch')?.value || ''
  ).trim().toLowerCase();

  const orderStatus =
    q('#adminOrderStatus')?.value || '';

  const paymentStatus =
    q('#adminPaymentStatus')?.value || '';

  let list = getOrdersForDisplay().sort((a, b) => {
    const firstDate = String(a.createdAt || a.date || '');
    const secondDate = String(b.createdAt || b.date || '');

    return secondDate.localeCompare(firstDate);
  });

  if (term) {
    list = list.filter(order => {
      const itemSearch=(order.items||[]).map(item=>[
        item?.title,
        item?.customRequestId,
        item?.fileName,
        item?.size,
        item?.fabric
      ].filter(Boolean).join(' ')).join(' ');
      const searchableText = `
        ${order.id || ''}
        ${order.customer || ''}
        ${order.phone || ''}
        ${order.fileName || ''}
        ${order.linkedOrderNumber || ''}
        ${itemSearch}
      `.toLowerCase();

      return searchableText.includes(term);
    });
  }

  if (orderStatus) {
    list = list.filter(order => order.status === orderStatus);
  }

  if (paymentStatus) {
    list = list.filter(order =>
      (order.paymentStatus || (order.displayType === 'custom' ? 'unpaid' : 'pending')) === paymentStatus
    );
  }

  const table = q('#adminOrdersTable');

  if (!table) return;

  table.innerHTML =
    list.map(order => orderRow(order)).join('') ||
    `
      <tr>
        <td colspan="7">
          <div class="empty-panel">
            سفارشی پیدا نشد.
          </div>
        </td>
      </tr>
    `;

  const all = getOrdersForDisplay();

  q('#orderStatToday').textContent = D.fa(
    all.filter(order => ['processing', 'design-review', 'print-preparation'].includes(order.status)).length
  );

  q('#orderStatProcessing').textContent = D.fa(
    all.filter(order => order.status === 'processing').length
  );

  q('#orderStatShipping').textContent = D.fa(
    all.filter(order =>
      order.displayType !== 'custom' &&
      order.status === 'shipped'
    ).length
  );

  q('#orderStatValue').textContent = D.toman(
    paidOrdersValue(all)
  );
}
function productCategoryIds(product){
  const ids=Array.isArray(product?.categoryIds)?product.categoryIds.map(Number).filter(Number.isFinite):[];
  if(ids.length)return ids;
  const names=new Set((product?.categories||[product?.category]).filter(Boolean));
  return D.get('categories').filter(category=>names.has(category.name)).map(category=>Number(category.id));
}
function adminProductPageNumbers(currentPage,totalPages){
  if(totalPages<=7)return Array.from({length:totalPages},(_,index)=>index+1);
  const pages=[1];
  if(currentPage>4)pages.push('start-ellipsis');
  const from=Math.max(2,currentPage-1),to=Math.min(totalPages-1,currentPage+1);
  for(let page=from;page<=to;page++)pages.push(page);
  if(currentPage<totalPages-3)pages.push('end-ellipsis');
  pages.push(totalPages);
  return pages;
}
function renderAdminProductsPagination(totalItems){
  const container=q('#adminProductsPagination');if(!container)return;
  const totalPages=Math.ceil(totalItems/ADMIN_PRODUCT_PAGE_SIZE);
  if(totalPages<=1){container.innerHTML='';container.hidden=true;return;}
  container.hidden=false;
  const pageButtons=adminProductPageNumbers(adminProductPage,totalPages).map(page=>{
    if(typeof page!=='number')return '<span class="portal-page-ellipsis" aria-hidden="true">…</span>';
    return `<button class="portal-page-btn${page===adminProductPage?' active':''}" type="button" data-admin-product-page="${page}"${page===adminProductPage?' aria-current="page"':''}>${D.fa(page)}</button>`;
  }).join('');
  container.innerHTML=`<button class="portal-page-btn portal-page-nav" type="button" data-admin-product-page="${adminProductPage-1}"${adminProductPage===1?' disabled':''}>قبلی</button>${pageButtons}<button class="portal-page-btn portal-page-nav" type="button" data-admin-product-page="${adminProductPage+1}"${adminProductPage===totalPages?' disabled':''}>بعدی</button>`;
  container.querySelectorAll('[data-admin-product-page]:not(:disabled)').forEach(button=>button.addEventListener('click',()=>{
    adminProductPage=Number(button.dataset.adminProductPage)||1;
    renderProducts();
    q('[data-admin-section="products"] .portal-card')?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
}
function renderProducts(){
  const term=(q('#adminProductSearch')?.value||'').toLowerCase();
  const categoryId=Number(q('#adminProductCategory')?.value||0);
  const productStatus=q('#adminProductStatus')?.value||'';
  let list=D.get('products');
  if(term)list=list.filter(product=>`${product.title} ${product.sku} ${(product.categories||[product.category]).join(' ')} ${(product.categorySlugs||[]).join(' ')}`.toLowerCase().includes(term));
  if(categoryId)list=list.filter(product=>productCategoryIds(product).includes(categoryId));
  if(productStatus)list=list.filter(product=>(product.status||'active')===productStatus);
  const totalPages=Math.max(1,Math.ceil(list.length/ADMIN_PRODUCT_PAGE_SIZE));
  adminProductPage=Math.min(Math.max(1,adminProductPage),totalPages);
  const start=(adminProductPage-1)*ADMIN_PRODUCT_PAGE_SIZE;
  const visibleProducts=list.slice(start,start+ADMIN_PRODUCT_PAGE_SIZE);
  q('#adminProductsTable').innerHTML=visibleProducts.map(productRow).join('')||'<tr><td colspan="9"><div class="empty-panel">محصولی پیدا نشد.</div></td></tr>';
  renderAdminProductsPagination(list.length);
  const categories=D.get('categories');
  const select=q('#adminProductCategory'),oldValue=select?.value||'';
  if(select){
    select.innerHTML='<option value="">همه دسته‌ها</option>'+categories.map(item=>`<option value="${D.esc(item.id)}">${D.esc(item.name)}</option>`).join('');
    if([...select.options].some(option=>option.value===oldValue))select.value=oldValue;
  }
}
function categoryPlacements(category){
  const items=[];
  if(category.showInMenu)items.push('منو');
  if(category.showInStore)items.push('فروشگاه');
  if(category.showInHome)items.push('خانه');
  if(category.showInReady)items.push('فیلتر آماده');
  if(category.isReadyRoot)items.push('ریشه طرح آماده');
  return items;
}
function renderCategories(){
  const categories=D.get('categories');
  const term=(q('#adminCategorySearch')?.value||'').trim().toLowerCase();
  const categoryStatus=q('#adminCategoryStatus')?.value||'';
  const placement=q('#adminCategoryPlacement')?.value||'';
  let list=categories;
  if(term)list=list.filter(category=>`${category.name} ${category.slug} ${category.description||''}`.toLowerCase().includes(term));
  if(categoryStatus)list=list.filter(category=>category.status===categoryStatus);
  if(placement){
    const field={menu:'showInMenu',store:'showInStore',home:'showInHome',ready:'showInReady'}[placement];
    if(field)list=list.filter(category=>Boolean(category[field]));
  }
  q('#categoryStatAll').textContent=D.fa(categories.length);
  q('#categoryStatActive').textContent=D.fa(categories.filter(category=>category.status==='active').length);
  q('#categoryStatMenu').textContent=D.fa(categories.filter(category=>category.showInMenu).length);
  q('#categoryStatProducts').textContent=D.fa(categories.reduce((sum,category)=>sum+Number(category.productCount||0),0));
  q('#adminCategoriesTable').innerHTML=list.map(category=>{
    const placements=categoryPlacements(category);
    return `<tr>
      <td><div class="table-product">${category.image?`<span class="product-mini-img"><img src="${D.esc(category.image)}" alt="${D.esc(category.name)}"></span>`:'<span class="category-table-icon">▦</span>'}<span><b>${D.esc(category.name)}</b><small class="table-secondary">ID ${D.fa(category.id)}</small></span></div></td>
      <td><code class="category-slug">${D.esc(category.slug)}</code></td>
      <td>${D.fa(category.sortOrder)}</td>
      <td><div class="category-flags">${placements.map(item=>`<span>${D.esc(item)}</span>`).join('')||'<small class="table-secondary">بدون محل نمایش</small>'}</div></td>
      <td><b>${D.fa(category.productCount||0)}</b></td>
      <td>${status(category.status||'active')}</td>
      <td><div class="table-actions"><button class="table-action edit-category" data-id="${category.id}" title="ویرایش"><svg viewBox="0 0 24 24"><path d="m4 16-1 5 5-1L19 9l-4-4L4 16ZM13 7l4 4"/></svg></button><button class="table-action delete-category" data-id="${category.id}" title="حذف"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></svg></button></div></td>
    </tr>`;
  }).join('')||'<tr><td colspan="7"><div class="empty-panel">دسته‌بندی‌ای پیدا نشد.</div></td></tr>';
}
const COUPON_VARIANT_GROUPS=Object.freeze([
  Object.freeze({key:'pillowcase',title:'روبالشتی',icon:'▣',hint:'سایز ۵۰ × ۷۰ · فقط جنس مخمل',variants:Object.freeze([
    Object.freeze({title:'فقط کاور',size:pillowVariantSize('فقط کاور','۵۰ × ۷۰ سانتی‌متر'),displaySize:'۵۰ × ۷۰',fabric:'مخمل'}),
    Object.freeze({title:'با الیاف',size:pillowVariantSize('با الیاف','۵۰ × ۷۰ سانتی‌متر'),displaySize:'۵۰ × ۷۰',fabric:'مخمل'})
  ])}),
  Object.freeze({key:'dakimakura',title:'داکیماکورا',icon:'▯',hint:'دو سایز · فقط جنس مخمل',variants:Object.freeze([
    Object.freeze({title:'فقط کاور',size:pillowVariantSize('فقط کاور','۳۵ × ۱۰۰ سانتی‌متر'),displaySize:'۱۰۰ × ۳۵',fabric:'مخمل'}),
    Object.freeze({title:'با الیاف',size:pillowVariantSize('با الیاف','۳۵ × ۱۰۰ سانتی‌متر'),displaySize:'۱۰۰ × ۳۵',fabric:'مخمل'}),
    Object.freeze({title:'فقط کاور',size:pillowVariantSize('فقط کاور','۵۰ × ۱۵۰ سانتی‌متر'),displaySize:'۱۵۰ × ۵۰',fabric:'مخمل'}),
    Object.freeze({title:'با الیاف',size:pillowVariantSize('با الیاف','۵۰ × ۱۵۰ سانتی‌متر'),displaySize:'۱۵۰ × ۵۰',fabric:'مخمل'})
  ])}),
  Object.freeze({key:'flag',title:'پرچم',icon:'⚑',hint:'سه سایز · سه جنس',variants:Object.freeze([
    Object.freeze({title:'۱۵۰ × ۹۰',size:'۱۵۰ × ۹۰ سانتی‌متر',displaySize:'۱۵۰ × ۹۰',fabric:'ساتن آمریکایی'}),
    Object.freeze({title:'۱۵۰ × ۹۰',size:'۱۵۰ × ۹۰ سانتی‌متر',displaySize:'۱۵۰ × ۹۰',fabric:'ساتن براق'}),
    Object.freeze({title:'۱۵۰ × ۹۰',size:'۱۵۰ × ۹۰ سانتی‌متر',displaySize:'۱۵۰ × ۹۰',fabric:'مخمل'}),
    Object.freeze({title:'۱۰۰ × ۷۰',size:'۱۰۰ × ۷۰ سانتی‌متر',displaySize:'۱۰۰ × ۷۰',fabric:'ساتن آمریکایی'}),
    Object.freeze({title:'۱۰۰ × ۷۰',size:'۱۰۰ × ۷۰ سانتی‌متر',displaySize:'۱۰۰ × ۷۰',fabric:'ساتن براق'}),
    Object.freeze({title:'۱۰۰ × ۷۰',size:'۱۰۰ × ۷۰ سانتی‌متر',displaySize:'۱۰۰ × ۷۰',fabric:'مخمل'}),
    Object.freeze({title:'۵۰ × ۷۰',size:'۵۰ × ۷۰ سانتی‌متر',displaySize:'۵۰ × ۷۰',fabric:'ساتن آمریکایی'}),
    Object.freeze({title:'۵۰ × ۷۰',size:'۵۰ × ۷۰ سانتی‌متر',displaySize:'۵۰ × ۷۰',fabric:'ساتن براق'}),
    Object.freeze({title:'۵۰ × ۷۰',size:'۵۰ × ۷۰ سانتی‌متر',displaySize:'۵۰ × ۷۰',fabric:'مخمل'})
  ])})
]);
const COUPON_VARIANTS=Object.freeze(COUPON_VARIANT_GROUPS.flatMap(group=>group.variants.map(variant=>Object.freeze({...variant,groupKey:group.key,groupTitle:group.title}))));
function normalizedCouponProductId(value){const id=Number(value);return Number.isInteger(id)&&id>0?id:null;}
function couponVariantKey(productId,size,fabric){return `${normalizedCouponProductId(productId)||'*'}\u0000${String(size||'').trim()}\u0000${String(fabric||'').trim()}`;}
function couponVariantParts(size){
  const text=String(size||'').trim();
  const parts=text.split(/\s+[—–-]\s+/);
  if(parts.length>1&&(parts[0].includes('کاور')||parts[0].includes('الیاف'))){return {option:parts[0],size:parts.slice(1).join(' — ')};}
  return {option:'',size:text};
}
function configuredCouponVariant(size,fabric){
  return COUPON_VARIANTS.find(item=>item.size===String(size||'').trim()&&item.fabric===String(fabric||'').trim())||null;
}
function couponVariantTitle(item,{includeProduct=false}={}){
  const configured=configuredCouponVariant(item?.size,item?.fabric);
  if(configured){
    const variantTitle=configured.groupKey==='flag'?configured.displaySize:`${configured.title} · ${configured.displaySize}`;
    return [includeProduct?configured.groupTitle:'',variantTitle,configured.fabric].filter(Boolean).join(' · ');
  }
  const parts=couponVariantParts(item?.size);
  const variantTitle=parts.option?`${parts.option} · ${parts.size.replace(' سانتی‌متر','')}`:parts.size.replace(' سانتی‌متر','');
  return [includeProduct?'ترکیب قدیمی':'',variantTitle,item?.fabric].filter(Boolean).join(' · ');
}
function couponScopeMarkup(coupon){
  if(coupon.applicability!=='variants')return '<span class="portal-status status-active">همه محصولات</span>';
  const variants=Array.isArray(coupon.eligibleVariants)?coupon.eligibleVariants:[];
  if(!variants.length)return '<span class="portal-status status-cancelled">بدون انتخاب</span>';
  const groups=new Set(variants.map(item=>configuredCouponVariant(item?.size,item?.fabric)?.groupTitle).filter(Boolean));
  const labels=variants.slice(0,2).map(item=>couponVariantTitle(item,{includeProduct:true}));
  const more=variants.length>2?`<small class="table-secondary">+ ${D.fa(variants.length-2)} حالت دیگر${groups.size?` از ${D.fa(groups.size)} گروه`:''}</small>`:'';
  return `<div class="coupon-scope-summary">${labels.map(label=>`<span>${D.esc(label)}</span>`).join('')}${more}</div>`;
}
function selectedCouponVariants(){
  return qa('.coupon-variant-option:checked').map(input=>({size:input.dataset.size||'',fabric:input.dataset.fabric||''}));
}
function updateCouponVariantCount(){
  const selected=qa('.coupon-variant-option:checked').length;
  const total=qa('.coupon-variant-option').length;
  const counter=q('#couponVariantCount');
  if(counter)counter.textContent=`${D.fa(selected)} از ${D.fa(total)} حالت انتخاب شده`;
  const selectAll=q('#couponSelectAllVariants');
  if(selectAll)selectAll.textContent=selected&&selected===total?'لغو انتخاب همه':'انتخاب همه';
}
function filterCouponVariantOptions(){
  const term=String(q('#couponVariantSearch')?.value||'').trim().toLowerCase();
  qa('.coupon-product-scope').forEach(group=>{
    const productMatch=!term||String(group.dataset.search||'').includes(term);
    let visible=0;
    group.querySelectorAll('.coupon-variant-option-label').forEach(label=>{
      const show=productMatch||!term||String(label.dataset.search||'').includes(term);
      label.hidden=!show;
      if(show)visible+=1;
    });
    group.classList.toggle('is-filter-empty',visible===0);
  });
}
function renderCouponVariantOptions(selectedVariants=[]){
  const box=q('#couponVariantProducts');if(!box)return;
  // کدهای نسخه قبلی ممکن است productId داشته باشند؛ اینجا عمداً فقط سایز و جنس
  // مقایسه می‌شود تا پس از ذخیره به یکی از ۱۵ حالت ثابت تبدیل شوند.
  const selected=new Set((Array.isArray(selectedVariants)?selectedVariants:[]).map(item=>couponVariantKey(null,item?.size,item?.fabric)));
  const groups=COUPON_VARIANT_GROUPS.map(group=>{
    const options=group.variants.map(item=>{
      const checked=selected.has(couponVariantKey(null,item.size,item.fabric));
      const title=group.key==='flag'?`${item.displaySize} · ${item.fabric}`:item.title;
      const details=group.key==='flag'?[`سایز ${item.displaySize}`,`جنس ${item.fabric}`]:[`سایز ${item.displaySize}`,`جنس ${item.fabric}`];
      const search=`${group.title} ${group.hint} ${item.title} ${item.displaySize} ${item.size} ${item.fabric}`.toLowerCase();
      return `<label class="coupon-variant-option-label" data-search="${D.esc(search)}"><input class="coupon-variant-option" data-size="${D.esc(item.size)}" data-fabric="${D.esc(item.fabric)}" type="checkbox" ${checked?'checked':''}/><span><b>${D.esc(title)}</b><small class="coupon-variant-detail">${details.map(detail=>`<em>${D.esc(detail)}</em>`).join('')}</small></span></label>`;
    }).join('');
    const groupSearch=`${group.title} ${group.hint} ${group.variants.map(item=>`${item.title} ${item.displaySize} ${item.fabric}`).join(' ')}`.toLowerCase();
    return `<section class="coupon-product-scope" data-group="${D.esc(group.key)}" data-search="${D.esc(groupSearch)}"><div class="coupon-product-head"><div class="coupon-product-meta"><span aria-hidden="true" style="display:grid;place-items:center;width:42px;height:42px;border-radius:10px;background:#eef2ff;color:#3157d5;font-size:22px;flex:0 0 auto">${D.esc(group.icon)}</span><span><b>${D.esc(group.title)}</b><small>${D.esc(group.hint)} · ${D.fa(group.variants.length)} حالت</small></span></div><div class="coupon-product-actions"><button type="button" data-coupon-product-action="select">انتخاب گروه</button><button type="button" data-coupon-product-action="clear">پاک کردن</button></div></div><div class="coupon-variant-grid">${options}</div></section>`;
  });
  box.innerHTML=groups.join('');
  filterCouponVariantOptions();
  updateCouponVariantCount();
}
function syncCouponVariantScope(){
  const restricted=q('#couponApplicability')?.value==='variants';
  const scope=q('#couponVariantScope');
  if(scope)scope.hidden=!restricted;
  qa('.coupon-variant-option').forEach(input=>{input.disabled=!restricted;});
  if(restricted&&!qa('.coupon-variant-option').length)renderCouponVariantOptions([]);
  updateCouponVariantCount();
}

function renderCoupons(){
  const term=(q('#couponSearch')?.value||'').toLowerCase(),couponStatus=q('#couponStatus')?.value||'';
  let list=D.get('coupons');
  if(term)list=list.filter(coupon=>coupon.code.toLowerCase().includes(term));
  if(couponStatus)list=list.filter(coupon=>coupon.status===couponStatus);
  q('#adminCouponsTable').innerHTML=list.map(coupon=>`<tr><td><b>${D.esc(coupon.code)}</b></td><td>${coupon.type==='percent'?`${D.fa(coupon.value)} درصد`:D.toman(coupon.value)}</td><td>${D.toman(coupon.min)}</td><td>${couponScopeMarkup(coupon)}</td><td><b>${D.fa(coupon.used)}</b> از ${coupon.limit?D.fa(coupon.limit):'نامحدود'}${coupon.limit?`<div class="progress" style="width:110px"><span style="width:${Math.min(100,coupon.used/coupon.limit*100)}%"></span></div>`:''}</td><td>${D.esc(coupon.expires)}</td><td>${status(coupon.status)}</td><td><div class="table-actions"><button class="table-action edit-coupon" data-id="${coupon.id}">✎</button><button class="table-action delete-coupon" data-id="${coupon.id}">×</button></div></td></tr>`).join('')||'<tr><td colspan="8"><div class="empty-panel">کدی پیدا نشد.</div></td></tr>';
}
function renderCustomers(){
  const term=(q('#customerSearch')?.value||'').toLowerCase(),role=q('#customerRole')?.value||'';
  let list=D.get('users');
  if(term)list=list.filter(user=>`${user.name} ${user.phone} ${user.email}`.toLowerCase().includes(term));
  if(role)list=list.filter(user=>user.role===role);
  q('#adminCustomersTable').innerHTML=list.map(user=>`<tr><td><div class="table-product"><span class="portal-avatar" style="width:38px;height:38px;border-radius:12px">${D.esc(user.name[0])}</span><span><b>${D.esc(user.name)}</b><small class="table-secondary">ID ${D.fa(user.id)}</small></span></div></td><td>${D.esc(user.phone)}<span class="table-secondary">${D.esc(user.email)}</span></td><td>${D.esc(user.joined)}</td><td>${D.fa(user.orders)}</td><td><b>${D.toman(user.total)}</b></td><td>${user.role==='business'?'سازمانی':'شخصی'}</td><td><button class="portal-btn portal-btn-soft customer-view" data-id="${user.id}">پرونده</button></td></tr>`).join('')||'<tr><td colspan="7"><div class="empty-panel">مشتری پیدا نشد.</div></td></tr>';
}
function renderTickets(){
  const term=(q('#adminTicketSearch')?.value||'').toLowerCase(),ticketStatus=q('#adminTicketStatus')?.value||'',priority=q('#adminTicketPriority')?.value||'';
  let list=D.get('tickets');
  if(term)list=list.filter(ticket=>`${ticket.id} ${ticket.subject} ${ticket.customer}`.toLowerCase().includes(term));
  if(ticketStatus)list=list.filter(ticket=>ticket.status===ticketStatus);
  if(priority)list=list.filter(ticket=>ticket.priority===priority);
  q('#adminTicketsTable').innerHTML=list.map(ticket=>`<tr><td><b>${D.esc(ticket.id)}</b><span class="table-secondary">${D.esc(ticket.date)}</span></td><td><span class="table-primary">${D.esc(ticket.subject)}</span><span class="table-secondary">${D.fa(ticket.messages?.length||0)} پیام</span></td><td>${D.esc(ticket.department)}</td><td>${ticket.priority==='high'?'<span class="portal-status status-cancelled">فوری</span>':'عادی'}</td><td>${D.esc((ticket.messages||[]).at(-1)?.date||'—')}</td><td>${status(ticket.status)}</td><td><button class="portal-btn portal-btn-soft admin-ticket-view" data-id="${ticket.id}">پاسخ</button></td></tr>`).join('')||'<tr><td colspan="7"><div class="empty-panel">تیکتی پیدا نشد.</div></td></tr>';
  q('#adminOpenTickets').textContent=D.fa(D.get('tickets').filter(ticket=>ticket.status==='open').length);
}
function renderCustom() {
  const term = (q('#adminCustomSearch')?.value || '')
    .trim()
    .toLowerCase();

  const customStatus = q('#adminCustomStatus')?.value || '';
  const customPaymentStatus = q('#adminCustomPaymentStatus')?.value || '';

  let list = Array.isArray(D.get('custom'))
    ? [...D.get('custom')]
    : [];

  if (term) {
    list = list.filter(item => {
      const searchableText = `
        ${item.id || ''}
        ${item.customer || ''}
        ${item.phone || ''}
        ${item.province || ''}
        ${item.city || ''}
        ${item.fileName || ''}
        ${item.requestType || ''}
      `.toLowerCase();

      return searchableText.includes(term);
    });
  }

  if (customStatus) {
    list = list.filter(item => item.status === customStatus);
  }

  if (customPaymentStatus) {
    list = list.filter(item => (item.paymentStatus || 'unpaid') === customPaymentStatus);
  }

  const table = q('#adminCustomTable');

  if (!table) return;

  table.innerHTML = list.map(item => {
    /*
     * downloadUrl مربوط به Route امن ادمین است.
     * fileUrl برای سازگاری با خروجی فعلی API نگه داشته شده است.
     */
    const downloadUrl = item.downloadUrl || item.fileUrl || '';

    const fileSection = downloadUrl
      ? `
        <div style="display:flex;flex-direction:column;align-items:flex-start;gap:7px">
          <b>${D.esc(item.fileName || 'فایل طرح')}</b>

          <a
            href="${D.esc(downloadUrl)}"
            class="portal-btn portal-btn-soft"
            style="display:inline-flex;align-items:center;gap:5px"
            title="دانلود فایل اصلی کاربر"
          >
            دانلود فایل
          </a>

          <span class="table-secondary">
            ${D.esc(item.requestType || 'پرچم')}
            —
            ${D.esc(item.size || '—')}
            —
            ${D.esc(item.fabric || 'ساتن آمریکایی')}
          </span>
        </div>
      `
      : `
        <div style="display:flex;flex-direction:column;gap:5px">
          <b>${D.esc(item.fileName || 'بدون فایل')}</b>

          <span class="table-secondary">
            فایل روی سرور موجود نیست
          </span>

          <span class="table-secondary">
            ${D.esc(item.requestType || 'پرچم')}
            —
            ${D.esc(item.size || '—')}
            —
            ${D.esc(item.fabric || 'ساتن آمریکایی')}
          </span>
        </div>
      `;

    return `
      <tr>
        <td>
          <b>${D.esc(item.id || '—')}</b>

          <span class="table-secondary">
            ${D.esc(registrationDateTime(item))}
          </span>
        </td>

        <td>
          <b>${D.esc(item.customer || 'بدون نام')}</b>
          <span class="table-secondary">${D.esc(item.phone || 'بدون شماره')}</span>
          <span class="table-secondary">${D.esc([item.province,item.city].filter(Boolean).join('، ') || 'آدرس ثبت نشده')}</span>
        </td>

        <td>
          ${fileSection}
        </td>

        <td>
          ${D.esc(item.notes || 'بدون توضیح')}
        </td>

        <td>
          <b>${D.toman(item.price || 0)}</b>
        </td>

        <td>
          ${status(item.paymentStatus || 'unpaid')}
          ${item.orderNumber ? `<span class="table-secondary">سفارش ${D.esc(item.orderNumber)}</span>` : '<span class="table-secondary">بدون سفارش نهایی</span>'}
        </td>

        <td>
          ${status(item.status || 'review')}
        </td>

        <td>
          <button
            type="button"
            class="portal-btn portal-btn-soft custom-admin-view"
            data-id="${D.esc(item.id || '')}"
          >
            مدیریت
          </button>
        </td>
      </tr>
    `;
  }).join('') || `
    <tr>
      <td colspan="8">
        <div class="empty-panel">
          درخواستی پیدا نشد.
        </div>
      </td>
    </tr>
  `;
}
function renderReports(){
  const analytics=getAnalytics();
  const totals=analytics.totals||{};
  const products=analytics.topProducts||[];
  const users=analytics.topCustomers||[];

  q('#reportAov').textContent=D.toman(totals.averageOrderValue||0);
  q('#reportCompletion').textContent=`${D.fa(totals.completionRate||0)}٪`;
  q('#reportTopCustomer').textContent=D.toman(users[0]?.total||0);

  const max=Math.max(1,...products.map(product=>Number(product.quantity||0)));
  q('#reportTopProducts').innerHTML=products.slice(0,6).map(product=>`<div class="top-product-bar"><span>${D.esc(product.title)}</span><div class="bar-track"><span style="width:${Math.round(Number(product.quantity||0)/max*100)}%"></span></div><b title="${D.esc(D.toman(product.revenue||0))}">${D.fa(product.quantity||0)}</b></div>`).join('')||'<div class="empty-panel">هنوز محصول فروخته‌شده‌ای وجود ندارد.</div>';

  q('#reportTopCustomers').innerHTML=users.slice(0,6).map((user,index)=>`<div class="list-item"><span class="list-icon">${D.fa(index+1)}</span><span class="list-content"><strong>${D.esc(user.name)}</strong><small>${D.fa(user.orders)} سفارش پرداخت‌شده${user.phone?` — ${D.esc(user.phone)}`:''}</small></span><span class="list-value"><strong>${D.toman(user.total)}</strong></span></div>`).join('')||'<div class="empty-panel">هنوز مشتری دارای خرید قطعی وجود ندارد.</div>';

  monthlyChart('#reportRevenueChart',analytics.monthlySales||[]);
}

function renderNotifications(){
  const orders=D.get('orders').filter(order=>['processing','design-review','print-preparation'].includes(order.status));
  const tickets=D.get('tickets').filter(ticket=>ticket.status==='open');
  const items=[
    ...orders.slice(0,4).map(order=>({title:'سفارش نیازمند اقدام',text:`سفارش ${order.id} در وضعیت ${labels[order.status]} است.`,date:registrationDateTime(order)})),
    ...tickets.slice(0,4).map(ticket=>({title:'تیکت باز',text:ticket.subject,date:ticket.date}))
  ];
  q('#adminNotificationList').innerHTML=items.map(item=>`<div class="notification-item unread"><span class="notification-mark"></span><div><strong>${D.esc(item.title)}</strong><p>${D.esc(item.text)}</p><small>${D.esc(item.date)}</small></div></div>`).join('')||'<div class="empty-panel">اعلان جدیدی وجود ندارد.</div>';
}
function renderAll(){renderDashboard();renderOrders();renderProducts();renderCategories();renderCoupons();renderCustomers();renderTickets();renderCustom();renderReports();renderNotifications();}

function ensureSelectOption(select,value){
  if(!select||!value)return;
  if(![...select.options].some(option=>option.value===value))select.add(new Option(value,value));
}
function setChecked(selector,values){
  const selected=Array.isArray(values)?values:[];
  qa(selector).forEach(input=>{input.checked=selected.includes(input.value);});
}
function normalizeCategorySlug(value=''){
  return String(value).trim().toLowerCase().replace(/[ي]/g,'ی').replace(/[ك]/g,'ک').replace(/[^a-z0-9\u0600-\u06FF]+/g,'-').replace(/^-+|-+$/g,'');
}
function renderProductCategoryOptions(product=null){
  const box=q('#productCategories');if(!box)return;
  const categories=D.get('categories');
  const selectedIds=new Set(productCategoryIds(product));
  const fallbackPrimary=selectedIds.values().next().value;
  const primaryId=Number(product?.primaryCategoryId||fallbackPrimary||0);
  box.innerHTML=categories.map(category=>{
    const id=Number(category.id),checked=selectedIds.has(id),isPrimary=checked&&id===primaryId;
    return `<article class="product-category-choice${category.status==='draft'?' is-draft':''}">
      <label class="product-choice"><input class="product-category-option" type="checkbox" value="${D.esc(id)}" ${checked?'checked':''}/><span><b>${D.esc(category.name)}</b><small>${D.esc(category.slug)}${category.status==='draft'?' — پیش‌نویس':''}</small></span></label>
      <label class="category-primary-toggle"><input class="product-primary-category" name="productPrimaryCategory" type="radio" value="${D.esc(id)}" ${isPrimary?'checked':''} ${checked?'':'disabled'}/><span>دسته اصلی</span></label>
    </article>`;
  }).join('')||'<div class="variant-pricing-empty">هنوز دسته‌بندی‌ای ساخته نشده است؛ ابتدا از بخش «دسته‌بندی‌ها» یک دسته ایجاد کنید.</div>';
}
function categoryModal(id=null){
  const category=id?D.get('categories').find(item=>Number(item.id)===Number(id)):null;
  releaseCategoryImageSelection();
  q('#categoryForm')?.reset();
  q('#categoryModalTitle').textContent=category?'ویرایش دسته‌بندی':'افزودن دسته‌بندی';
  q('#categoryId').value=category?.id||'';
  q('#categoryName').value=category?.name||'';
  q('#categorySlug').value=category?.slug||'';
  q('#categorySortOrder').value=category?.sortOrder??0;
  q('#categoryStatus').value=category?.status||'active';
  q('#categoryImage').value=category?.image||'';
  renderCategoryImagePreview(category?.image||'');
  q('#categoryDescription').value=category?.description||'';
  q('#categoryShowInMenu').checked=category?Boolean(category.showInMenu):true;
  q('#categoryShowInStore').checked=category?Boolean(category.showInStore):true;
  q('#categoryShowInHome').checked=category?Boolean(category.showInHome):true;
  q('#categoryShowInReady').checked=Boolean(category?.showInReady);
  q('#categoryIsReadyRoot').checked=Boolean(category?.isReadyRoot);
  q('#categorySlug').dataset.manual=category?'true':'false';
  openModal('#categoryModal');
}
function generateRandomSku(excludeId=null){
  const used=new Set(D.get('products').filter(item=>Number(item.id)!==Number(excludeId)).map(item=>String(item.sku||'').toUpperCase()));
  for(let attempt=0;attempt<50;attempt++){
    const sku=`CF-${Math.floor(100000+Math.random()*900000)}`;
    if(!used.has(sku))return sku;
  }
  return `CF-${String(Date.now()).slice(-9)}`;
}
function compactPillowCategory(value=''){
  return String(value||'').trim().toLowerCase()
    .replace(/[ي]/g,'ی').replace(/[ك]/g,'ک')
    .replace(/[\u200c\u200d\u200e\u200f]/g,'')
    .replace(/[^a-z0-9\u0600-\u06FF]+/g,'');
}
function detectPillowProductMode(categories=[]){
  const values=(Array.isArray(categories)?categories:[categories]).map(compactPillowCategory).filter(Boolean);
  if(values.some(value=>value.includes('داکیماکورا')||value.includes('بالشتقدی')||value.includes('روبالشتیقدی')))return 'dakimakura';
  if(values.some(value=>value.includes('روبالشتی')||value.includes('بالشتی')))return 'pillowcase';
  return null;
}
function selectedProductPillowMode(){
  const categoryMap=new Map(D.get('categories').map(category=>[Number(category.id),category]));
  const selected=qa('.product-category-option:checked').map(input=>categoryMap.get(Number(input.value))).filter(Boolean);
  return detectPillowProductMode(selected.flatMap(category=>[category.name,category.slug]));
}
function pillowFixedVariants(mode){
  const config=PILLOW_PRODUCT_CONFIGS[mode];
  return config?config.variants.map(item=>({
    size:pillowVariantSize(item.option,item.size),fabric:'مخمل',price:item.price,oldPrice:null,hasDiscount:false,
    option:item.option,displaySize:item.size
  })):[];
}
function renderProductOptionChoices(mode=null,selectedSizes=[],selectedFabrics=[]){
  activeProductPillowMode=mode||null;
  const sizeBox=q('#productSizeChoices'),fabricBox=q('#productFabricChoices');
  if(!sizeBox||!fabricBox)return;
  const selectedSizeSet=new Set(Array.isArray(selectedSizes)?selectedSizes:[]);
  const selectedFabricSet=new Set(Array.isArray(selectedFabrics)?selectedFabrics:[]);
  const special=Boolean(mode&&PILLOW_PRODUCT_CONFIGS[mode]);
  if(special){
    const variants=pillowFixedVariants(mode);
    sizeBox.innerHTML=variants.map(item=>`<label class="product-choice"><input class="product-size-option" type="checkbox" value="${D.esc(item.size)}" ${(selectedSizeSet.size?selectedSizeSet.has(item.size):true)?'checked':''}/><span><b>${D.esc(item.option)} — ${D.esc(item.displaySize.replace(' سانتی‌متر',''))}</b><small>${D.toman(item.price)} · مقدار پیش‌فرض قابل ویرایش</small></span></label>`).join('');
    fabricBox.innerHTML=`<label class="product-choice"><input class="product-fabric-option" type="checkbox" value="مخمل" ${(selectedFabricSet.size?selectedFabricSet.has('مخمل'):true)?'checked':''}/><span><b>مخمل</b><small>جنس مخصوص این دسته و قابل ثبت در محصول</small></span></label>`;
  }else{
    sizeBox.innerHTML=STANDARD_PRODUCT_SIZES.map((item,index)=>`<label class="product-choice"><input class="product-size-option" type="checkbox" value="${D.esc(item.value)}" ${(selectedSizeSet.size?selectedSizeSet.has(item.value):index<STANDARD_PRODUCT_SIZES.length)?'checked':''}/><span><b>${D.esc(item.title)}</b><small>${D.esc(item.hint)}</small></span></label>`).join('');
    fabricBox.innerHTML=STANDARD_PRODUCT_FABRICS.map(item=>`<label class="product-choice"><input class="product-fabric-option" type="checkbox" value="${D.esc(item.value)}" ${(selectedFabricSet.size?selectedFabricSet.has(item.value):true)?'checked':''}/><span><b>${D.esc(item.title)}</b><small>${D.esc(item.hint)}</small></span></label>`).join('');
  }
  q('#productOptionsTitle').textContent=special?'نوع سفارش، سایز و جنس':'سایزبندی و جنس پارچه';
  q('#productOptionsDescription').textContent=special?'گزینه‌های پیشنهادی این دسته آماده‌اند؛ موارد لازم را انتخاب و ذخیره کنید.':'یک یا چند گزینه برای مشتری قابل انتخاب باشد';
  q('#productSizesLabel').textContent=special?'حالت و سایزهای قابل سفارش':'سایزهای قابل سفارش';
  q('#variantPricingLabel').textContent=special?'قیمت هر حالت':'قیمت هر سایز و جنس';
  q('#variantPricingHelp').textContent=special?'قیمت‌های فعلی به‌صورت مقدار پیش‌فرض وارد شده‌اند و مثل محصولات پرچم قابل ویرایش و ذخیره هستند.':'برای هر ترکیب مثل ۱۵۰×۹۰ مخمل یا ۱۰۰×۷۰ ساتن، قیمت دقیق وارد کنید.';
  const hint=q('#productPillowRuleHint');if(hint)hint.hidden=!special;
  const discount=q('#productHasDiscount');if(discount)discount.disabled=false;
  const base=q('#productPrice');if(base){base.readOnly=false;if(special&&!base.value)base.value=Math.min(...pillowFixedVariants(mode).map(item=>item.price));}
  const fill=q('#fillVariantPrices');if(fill)fill.disabled=false;
  toggleDiscountFields();
}
function applyProductCategoryRules(seed={}){
  const mode=selectedProductPillowMode();
  const modeChanged=mode!==activeProductPillowMode;
  const sizes=seed.sizes||(modeChanged?[]:qa('.product-size-option:checked').map(input=>input.value));
  const fabrics=seed.fabrics||(modeChanged?[]:qa('.product-fabric-option:checked').map(input=>input.value));
  renderProductOptionChoices(mode,sizes,fabrics);
  renderVariantPricing(seed.variants||null);
}
function variantPricingKey(size,fabric){return `${size}|||${fabric}`;}
function defaultProductPriceForVariant(size,fabric){
  if(activeProductPillowMode){
    const fixed=pillowFixedVariants(activeProductPillowMode).find(item=>item.size===String(size||'').trim()&&item.fabric===String(fabric||'').trim());
    if(fixed)return fixed.price;
  }
  const normalized=String(size||'')
    .replace(/[۰-۹]/g,digit=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g,digit=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const match=normalized.match(/(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)/i);
  if(!match)return null;
  const first=Number(match[1]),second=Number(match[2]);
  if(!Number.isFinite(first)||!Number.isFinite(second))return null;
  const key=`${Math.max(first,second)}x${Math.min(first,second)}`;
  const isVelvet=String(fabric||'').trim().includes('مخمل');
  const prices=isVelvet?DEFAULT_VELVET_PRODUCT_SIZE_PRICES:DEFAULT_PRODUCT_SIZE_PRICES;
  return prices[key]??null;
}
function readVariantPricingRows(){
  return qa('.variant-price-row').map(row=>({
    size:row.dataset.size||'',fabric:row.dataset.fabric||'',
    price:row.querySelector('.variant-price-input')?.value===''?null:Number(row.querySelector('.variant-price-input')?.value),
    oldPrice:row.querySelector('.variant-old-price-input')?.value===''?null:Number(row.querySelector('.variant-old-price-input')?.value)
  }));
}
function toggleInventoryFields(){
  const managed=q('#productInventoryMode')?.value==='managed';
  const field=q('#productStockField'),input=q('#productStock');
  field?.classList.toggle('is-disabled',!managed);
  if(input){input.disabled=!managed;if(!managed)input.value='0';}
}
function toggleDiscountFields(){
  const enabled=Boolean(q('#productHasDiscount')?.checked);
  const oldField=q('#productOldPriceField'),oldInput=q('#productOldPrice');
  oldField?.classList.toggle('is-disabled',!enabled);
  if(oldInput)oldInput.disabled=!enabled;
  qa('.variant-old-price-wrap').forEach(item=>item.classList.toggle('is-hidden',!enabled));
  qa('.variant-old-price-input').forEach(input=>{input.disabled=!enabled;});
}
function renderVariantPricing(seedVariants=null){
  const box=q('#productVariantPricing');if(!box)return;
  const current=Array.isArray(seedVariants)?seedVariants:readVariantPricingRows();
  const byKey=new Map(current.map(item=>[variantPricingKey(item.size,item.fabric),item]));
  const sizes=qa('.product-size-option:checked').map(input=>input.value);
  const fabrics=qa('.product-fabric-option:checked').map(input=>input.value);
  const basePrice=q('#productPrice')?.value||'';
  const baseOld=q('#productOldPrice')?.value||'';
  const hasDiscount=Boolean(q('#productHasDiscount')?.checked);
  if(!sizes.length||!fabrics.length){box.innerHTML='<div class="variant-pricing-empty">برای نمایش قیمت‌ها، حداقل یک سایز و یک جنس پارچه انتخاب کنید.</div>';return;}
  box.innerHTML=sizes.flatMap(size=>fabrics.map(fabric=>{
    const saved=byKey.get(variantPricingKey(size,fabric));
    const variantDefaultPrice=defaultProductPriceForVariant(size,fabric);
    const price=saved?.price??variantDefaultPrice??basePrice;
    const oldPrice=saved?.oldPrice??saved?.old??baseOld;
    const fixed=Boolean(activeProductPillowMode);
    const parts=String(size||'').split(' — ');
    const sizeLabel=fixed&&parts.length>1?parts.slice(1).join(' — '):size;
    const optionLabel=fixed?parts[0]:fabric;
    return `<div class="variant-price-row" data-size="${D.esc(size)}" data-fabric="${D.esc(fabric)}">
      <div class="variant-label"><small>${fixed?'نوع سفارش':'سایز'}</small><strong>${D.esc(fixed?optionLabel:sizeLabel)}</strong></div>
      <div class="variant-label"><small>${fixed?'سایز':'جنس'}</small><strong>${D.esc(fixed?sizeLabel:fabric)}</strong></div>
      <label class="variant-price-input-wrap">قیمت فروش<input class="variant-price-input" min="0" type="number" value="${price===''?'':D.esc(price)}" required></label>
      <label class="variant-old-price-wrap${hasDiscount?'':' is-hidden'}">قیمت قبل تخفیف<input class="variant-old-price-input" min="0" type="number" value="${oldPrice==null?'':D.esc(oldPrice)}" ${hasDiscount?'':'disabled'}></label>
    </div>`;
  })).join('');
  toggleDiscountFields();
}
function productModal(id=null){
  const product=id?D.get('products').find(item=>Number(item.id)===Number(id)):null;
  const form=q('#productForm');form?.reset();
  q('#productModalTitle').textContent=product?'ویرایش محصول':'افزودن محصول';
  q('#productId').value=product?.id||'';
  q('#productTitle').value=product?.title||'';
  q('#productSku').value=product?.sku||generateRandomSku(product?.id);
  renderProductCategoryOptions(product);
  q('#productPrice').value=product?.price??Math.min(...Object.values(DEFAULT_PRODUCT_SIZE_PRICES));
  q('#productHasDiscount').checked=Boolean(product?.hasDiscount);
  q('#productOldPrice').value=product?.old??'';
  ensureSelectOption(q('#productBadge'),product?.badge);q('#productBadge').value=product?.badge||'';
  q('#productStatus').value=product?.status||'active';
  q('#productInventoryMode').value=product?.inventoryMode==='managed'?'managed':'unlimited';
  q('#productStock').value=product?.inventoryMode==='managed'?Math.max(0,Number(product?.stock||0)):0;
  releaseProductImageItems();
  productImageItems=product?existingProductImages(product).map(value=>({type:'existing',value,preview:value})):[];
  q('#productImageFile').value='';
  renderProductImageEditor();
  activeProductPillowMode=null;
  applyProductCategoryRules({sizes:product?.sizes||D.DEFAULT_SIZES,fabrics:product?.fabrics||D.DEFAULT_FABRICS,variants:product?.variantPrices||[]});
  toggleDiscountFields();toggleInventoryFields();openModal('#productModal');
}
function orderModal(id){
  const order=getOrdersForDisplay().find(item=>item.displayType==='order'&&item.id===id)||D.get('orders').find(item=>item.id===id);if(!order)return;activeOrder=id;
  const discount=Number(order.discount||0),shipping=Number(order.shipping||0),subtotal=Number.isFinite(Number(order.subtotal))?Number(order.subtotal):Math.max(0,Number(order.total||0)+discount-shipping);
  const orderItems=(order.items||[]);
  const customCount=orderItems.filter(item=>String(item?.customRequestId||'').trim()).length;
  const normalCount=orderItems.length-customCount;
  const itemTypeLabel=customCount&&normalCount?'ترکیبی (عادی + اختصاصی)':customCount?'اختصاصی':'عادی';
  q('#adminOrderModalBody').innerHTML=`
    <div class="detail-summary">
      <div class="detail-chip"><small>سفارش</small><strong>${D.esc(order.id)}</strong></div>
      <div class="detail-chip"><small>زمان ثبت</small><strong>${D.esc(registrationDateTime(order))}</strong></div>
      <div class="detail-chip"><small>مشتری</small><strong>${D.esc(order.customer)}</strong></div>
      <div class="detail-chip"><small>نوع سفارش</small><strong>${D.esc(itemTypeLabel)}</strong></div>
      <div class="detail-chip"><small>تعداد اقلام</small><strong>${D.fa(orderItems.length)}</strong></div>
      <div class="detail-chip"><small>مبلغ نهایی</small><strong>${D.toman(order.total)}</strong></div>
      <div class="detail-chip"><small>وضعیت پرداخت</small><strong>${labels[order.paymentStatus]||order.paymentStatus}</strong></div>
      <div class="detail-chip"><small>درگاه پرداخت</small><strong>${D.esc(paymentGatewayLabel(order))}</strong></div>
    </div>
    <div class="portal-grid-equal"><div>
      <h4>اقلام سفارش</h4>
      <div class="order-items-mini">${orderItems.map(item=>{
        const qty=Math.max(1,Number(item?.qty||1));
        const customId=String(item?.customRequestId||'').trim();
        const thumb=customId?`<span class="list-icon">DS</span>`:productThumb(item.title,productImage(item.id));
        const customAdminNote=customId?String(item?.adminNote||'').trim():'';
        return `<div class="order-item-mini">${thumb}<span><strong>${D.esc(item.title)}</strong><small>${orderItemOptions(item)}</small>${item.notes?`<small>یادداشت کالا: ${D.esc(item.notes)}</small>`:''}${customAdminNote?`<small><strong>یادداشت ادمین:</strong> ${D.esc(customAdminNote)}</small>`:''}${orderItemDownloadMarkup(item)}</span><b>${D.toman(Number(item?.price||0)*qty)}</b></div>`;
      }).join('')||'<div class="empty-panel">آیتمی برای این سفارش ثبت نشده است.</div>'}</div>
      <h4 style="margin-top:16px">صورتحساب و تخفیف</h4>
      <div class="order-payment-breakdown">
        <div><span>جمع محصولات</span><strong>${D.toman(subtotal)}</strong></div>
        <div><span>کد تخفیف</span><strong>${order.couponCode?D.esc(order.couponCode):'استفاده نشده'}</strong></div>
        <div class="discount-line"><span>مبلغ کسرشده</span><strong>${discount?`− ${D.toman(discount)}`:D.toman(0)}</strong></div>
        <div><span>هزینه ارسال</span><strong>${shipping?D.toman(shipping):'پرداخت جداگانه'}</strong></div>
        <div class="total-line"><span>مبلغ نهایی</span><strong>${D.toman(order.total)}</strong></div>
      </div>
      <h4 style="margin-top:16px">یادداشت ثبت‌شده توسط کاربر</h4>
      <p class="order-customer-note ${order.customerNote?'':'is-empty'}">${order.customerNote?D.esc(order.customerNote):'کاربر یادداشتی برای این سفارش ثبت نکرده است.'}</p>
      <h4 style="margin-top:16px">نشانی تحویل</h4><p style="font-size:11px;line-height:2;color:var(--portal-muted)">${D.esc(order.address)}<br>${D.esc(order.phone)} — ${D.esc(order.email||'')}</p>
    </div><div><div class="form-grid"><div class="field full"><label>وضعیت سفارش</label><select id="modalOrderStatus"><option value="processing">در حال آماده‌سازی</option><option value="design-review">بررسی طراحی</option><option value="print-preparation">آماده‌سازی برای چاپ</option><option value="shipped">ارسال شده</option><option value="delivered">تحویل شده</option><option value="cancelled">لغو شده</option></select></div><div class="field full"><label>وضعیت پرداخت</label><select id="modalPaymentStatus"><option value="paid">پرداخت شده</option><option value="review">در انتظار بررسی</option><option value="refunded">مسترد شده</option></select></div><div class="field full"><label>کد رهگیری</label><input id="modalTracking" value="${D.esc(order.tracking||'')}"></div><div class="field full"><label>یادداشت داخلی</label><textarea id="modalAdminNote">${D.esc(order.adminNote||'')}</textarea></div></div></div></div>`;
  q('#modalOrderStatus').value=order.status;q('#modalPaymentStatus').value=order.paymentStatus;openModal('#adminOrderModal');
}

function customerModal(id){
  const user=D.get('users').find(item=>Number(item.id)===Number(id));if(!user)return;activeCustomer=id;
  const orders=D.get('orders').filter(order=>Number(order.userId)===Number(id));
  q('#customerModalBody').innerHTML=`<div class="profile-hero" style="margin-bottom:15px"><div class="portal-avatar">${D.esc(user.name[0])}</div><div><h2>${D.esc(user.name)}</h2><p>${D.esc(user.phone)} — ${D.esc(user.email)}</p></div></div><div class="detail-summary customer-summary"><div class="detail-chip"><small>تاریخ عضویت</small><strong>${D.esc(user.joined)}</strong></div><div class="detail-chip"><small>تعداد سفارش</small><strong>${D.fa(orders.length||user.orders)}</strong></div><div class="detail-chip"><small>ارزش خرید</small><strong>${D.toman(user.total)}</strong></div><div class="detail-chip"><small>نوع حساب</small><strong>${user.role==='business'?'سازمانی':'شخصی'}</strong></div></div><h4>سفارش‌های اخیر</h4><div class="order-items-mini">${orders.map(order=>`<div class="order-item-mini"><span class="list-icon">${D.esc(order.id.slice(-2))}</span><span><strong>${D.esc(order.id)} — ${labels[order.status]}</strong><small>${D.esc(registrationDateTime(order))}</small></span><b>${D.toman(order.total)}</b></div>`).join('')||'<div class="empty-panel">سفارشی ندارد.</div>'}</div>`;
  openModal('#customerModal');
}
function ticketModal(id){
  const ticket=D.get('tickets').find(item=>item.id===id);if(!ticket)return;activeTicket=id;
  q('#adminTicketModalBody').innerHTML=`<div class="detail-summary"><div class="detail-chip"><small>تیکت</small><strong>${D.esc(ticket.id)}</strong></div><div class="detail-chip"><small>مشتری</small><strong>${D.esc(ticket.customer)}</strong></div><div class="detail-chip"><small>بخش</small><strong>${D.esc(ticket.department)}</strong></div><div class="detail-chip"><small>وضعیت</small><strong>${labels[ticket.status]}</strong></div></div><h4>${D.esc(ticket.subject)}</h4><div class="message-list">${(ticket.messages||[]).map(message=>`<div class="message ${message.from}">${D.esc(message.text)}<small>${D.esc(message.date)}</small></div>`).join('')}</div><div class="ticket-compose"><textarea id="adminTicketReply" placeholder="پاسخ مدیر..."></textarea><button class="portal-btn portal-btn-primary" id="sendAdminTicketReply">ارسال</button></div><div style="display:flex;gap:8px;margin-top:12px"><button class="portal-btn portal-btn-light" id="closeTicketBtn">بستن تیکت</button><button class="portal-btn portal-btn-soft" id="reopenTicketBtn">بازگشایی</button></div>`;
  openModal('#adminTicketModal');
}
function customModal(id) {
  const item = D.get('custom').find(
    entry => entry.id === id
  );

  if (!item) return;

  activeCustom = id;
  const linkedOrder = (item.orderNumber
    ? D.get('orders').find(order=>String(order.id||'')===String(item.orderNumber||''))
    : D.get('orders').find(order=>customRequestIdsFromDisplayOrder(order).includes(String(id)))) || null;
  const displayRow = getOrdersForDisplay().find(row=>row.displayType==='custom'&&row.customRequestId===id) || null;
  const customOrderStatus = linkedOrder?.status || displayRow?.orderStatus || item.orderStatus || 'design-review';

  const downloadUrl = item.downloadUrl || item.fileUrl || '';

  const fileContent = downloadUrl
    ? `
      <div class="upload-zone">
        <strong>${D.esc(item.fileName || 'فایل طرح')}</strong>

        <p>فایل اصلی آپلودشده توسط مشتری</p>

        <a
          href="${D.esc(downloadUrl)}"
          class="portal-btn portal-btn-primary"
          style="display:inline-flex;margin-top:10px"
        >
          دانلود فایل اصلی
        </a>
      </div>
    `
    : `
      <div class="upload-zone">
        <strong>${D.esc(item.fileName || 'بدون فایل')}</strong>

        <p>فایل روی سرور موجود نیست.</p>
      </div>
    `;

  q('#customAdminModalBody').innerHTML = `
    <div class="detail-summary">
      <div class="detail-chip">
        <small>کد</small>
        <strong>${D.esc(item.id)}</strong>
      </div>

      <div class="detail-chip">
        <small>زمان ثبت</small>
        <strong>${D.esc(registrationDateTime(item))}</strong>
      </div>

      <div class="detail-chip">
        <small>مشتری</small>
        <strong>${D.esc(item.customer)}</strong>
      </div>

      <div class="detail-chip">
        <small>شماره تماس</small>
        <strong>${D.esc(item.phone || '—')}</strong>
      </div>

      <div class="detail-chip">
        <small>نوع محصول</small>
        <strong>${D.esc(item.requestType || 'پرچم')}</strong>
      </div>

      ${parsePillowSelection(item.size)?`<div class="detail-chip"><small>نوع سفارش</small><strong>${D.esc(parsePillowSelection(item.size).option)}</strong></div>`:''}
      <div class="detail-chip">
        <small>سایز</small>
        <strong>${D.esc(parsePillowSelection(item.size)?.size || item.size || '—')}</strong>
      </div>

      <div class="detail-chip">
        <small>جنس پارچه</small>
        <strong>${D.esc(item.fabric || 'ساتن آمریکایی')}</strong>
      </div>

      <div class="detail-chip">
        <small>قیمت</small>
        <strong>${D.toman(item.price || 0)}</strong>
      </div>

      <div class="detail-chip">
        <small>وضعیت پرداخت</small>
        <strong>${D.esc(labels[item.paymentStatus || 'unpaid'] || item.paymentStatus || 'پرداخت نشده')}</strong>
      </div>

      ${item.orderNumber ? `<div class="detail-chip"><small>تراکنش مرتبط</small><strong>${D.esc(item.orderNumber)}</strong></div>` : ''}
      ${linkedOrder?`<div class="detail-chip"><small>پرداخت کل سبد</small><strong>${D.toman(linkedOrder.total||0)}</strong></div>`:(displayRow&&Number(displayRow.linkedPaymentTotal||0)!==Number(displayRow.total||0)?`<div class="detail-chip"><small>پرداخت کل سبد</small><strong>${D.toman(displayRow.linkedPaymentTotal||0)}</strong></div>`:'')}
    </div>

    ${fileContent}

    <div class="form-grid" style="margin-top:15px">
      <div class="field full">
        <label>نشانی تحویل</label>
        <textarea disabled>${D.esc(item.address || 'هنوز در مرحله تسویه ثبت نشده است')}</textarea>
      </div>
      <div class="field">
        <label>استان / شهر</label>
        <input disabled value="${D.esc([item.province,item.city].filter(Boolean).join('، ') || '—')}">
      </div>
      <div class="field">
        <label>کد پستی</label>
        <input disabled value="${D.esc(item.postalCode || '—')}">
      </div>
    </div>

    <div class="form-grid" style="margin-top:15px">
      <div class="field">
        <label>وضعیت سفارش</label>
        <select id="modalCustomOrderStatus">
          <option value="design-review">بررسی طراحی</option>
          <option value="processing">در حال آماده‌سازی</option>
          <option value="print-preparation">آماده‌سازی برای چاپ</option>
          <option value="shipped">ارسال شده</option>
          <option value="delivered">تحویل شده</option>
          <option value="cancelled">لغو شده</option>
        </select>
        <small class="field-help">این وضعیت مخصوص همین سفارش DS است و مستقل از وضعیت درخواست طراحی نگه‌داری می‌شود.</small>
      </div>
      <div class="field">
        <label>وضعیت درخواست</label>

        <select id="modalCustomStatus">
          <option value="draft">پیش‌نویس سبد</option>
          <option value="review">در حال بررسی</option>
          <option value="preview-ready">پیش‌نمایش آماده</option>
          <option value="approved">تأیید شده</option>
        </select>
      </div>

      <div class="field">
        <label>قیمت نهایی</label>

        <input
          id="modalCustomPrice"
          type="number"
          value="${Number(item.price || 0)}"
        >
      </div>

      <div class="field">
        <label>وضعیت پرداخت</label>
        <select id="modalCustomPaymentStatus">
          ${item.orderNumber ? '' : '<option value="unpaid">پرداخت نشده</option>'}
          <option value="pending">در انتظار پرداخت</option>
          <option value="review">در انتظار بررسی</option>
          <option value="paid">پرداخت شده</option>
          <option value="failed">پرداخت ناموفق</option>
          <option value="refunded">مسترد شده</option>
        </select>
        <small class="field-help">${item.orderNumber ? 'این وضعیت با سفارش مرتبط همگام می‌شود.' : 'هنوز سفارش نهایی برای این درخواست ثبت نشده است.'}</small>
      </div>

      <div class="field full">
        <label>توضیحات طرح مشتری</label>

        <textarea disabled>${D.esc(item.notes || '')}</textarea>
      </div>

      <div class="field full">
        <label>یادداشت تحویل سفارش</label>

        <textarea disabled>${D.esc(item.deliveryNote || 'کاربر یادداشتی برای تحویل ثبت نکرده است.')}</textarea>
      </div>

      <div class="field full">
        <label>یادداشت مدیر / پیام به مشتری</label>

        <textarea id="modalCustomAdminNote">${D.esc(item.adminNote || '')}</textarea>
      </div>
    </div>
  `;

  q('#modalCustomOrderStatus').value = customOrderStatus;
  q('#modalCustomStatus').value = item.status || 'review';
  q('#modalCustomPaymentStatus').value = item.paymentStatus || (item.orderNumber ? 'pending' : 'unpaid');

  openModal('#customAdminModal');
}
function couponModal(id=null){
  const coupon=id?D.get('coupons').find(item=>Number(item.id)===Number(id)):null;
  q('#couponForm')?.reset();
  q('#couponModalTitle').textContent=coupon?'ویرایش کد تخفیف':'کد تخفیف جدید';
  q('#couponId').value=coupon?.id||'';
  q('#couponCode').value=coupon?.code||'';
  q('#couponType').value=coupon?.type||'percent';
  q('#couponValue').value=coupon?.value||'';
  q('#couponMin').value=coupon?.min||'';
  q('#couponApplicability').value=coupon?.applicability==='variants'?'variants':'all';
  if(q('#couponVariantSearch'))q('#couponVariantSearch').value='';
  renderCouponVariantOptions(coupon?.eligibleVariants||[]);
  q('#couponLimit').value=coupon?.limit||'';
  q('#couponExpires').value=coupon?.expires||'';
  q('#couponStatusField').value=coupon?.status||'active';
  syncCouponVariantScope();
  openModal('#couponModal');
}

qa('[data-admin-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.adminView)));
qa('[data-open-admin-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.openAdminView)));
qa('[data-open-product-modal]').forEach(button=>button.addEventListener('click',()=>productModal()));
q('#adminMenuToggle')?.addEventListener('click',()=>{q('#adminSidebar')?.classList.add('open');q('#adminSideOverlay')?.classList.add('open');});
q('#adminSideOverlay')?.addEventListener('click',()=>{q('#adminSidebar')?.classList.remove('open');q('#adminSideOverlay')?.classList.remove('open');});
qa('[data-close-modal]').forEach(button=>button.addEventListener('click',closeModals));
qa('.portal-modal-backdrop').forEach(backdrop=>backdrop.addEventListener('click',event=>{if(event.target===backdrop)closeModals();}));
q('#adminNotificationBtn')?.addEventListener('click',event=>{event.stopPropagation();q('#adminNotificationPanel')?.classList.toggle('open');});
q('#productSkuGenerate')?.addEventListener('click',()=>{q('#productSku').value=generateRandomSku(q('#productId')?.value);});
q('#productImageFile')?.addEventListener('change',async event=>{
  const selected=[...(event.target.files||[])];
  event.target.value='';
  if(!selected.length)return;
  const allowed=new Set(['image/png','image/jpeg','image/webp']);
  if(selected.some(file=>!allowed.has(file.type)))return D.toast('فقط تصویر PNG، JPG یا WEBP مجاز است.','error');
  if(selected.some(file=>file.size>20*1024*1024))return D.toast('حجم هر تصویر باید کمتر از ۲۰ مگابایت باشد.','error');
  const remaining=Math.max(0,PRODUCT_IMAGE_LIMIT-productImageItems.length);
  if(!remaining)return D.toast(`حداکثر ${D.fa(PRODUCT_IMAGE_LIMIT)} تصویر می‌توانید ثبت کنید.`,'error');

  const candidates=selected.slice(0,remaining);
  const optimizedFiles=await Promise.all(candidates.map(optimizeProductUpload));
  optimizedFiles.forEach(file=>{
    const duplicate=productImageItems.some(item=>item.type==='file'&&item.file.name===file.name&&item.file.size===file.size&&item.file.lastModified===file.lastModified);
    if(!duplicate)productImageItems.push({type:'file',file,preview:URL.createObjectURL(file),value:''});
  });
  renderProductImageEditor();
  if(optimizedFiles.some((file,index)=>file!==candidates[index]))D.toast('تصاویر بزرگ پیش از آپلود برای سرعت سایت بهینه شدند.');
  if(selected.length>remaining)D.toast(`فقط ${D.fa(remaining)} تصویر اول اضافه شد؛ سقف گالری ${D.fa(PRODUCT_IMAGE_LIMIT)} تصویر است.`,'error');
});
q('#productImagesEditor')?.addEventListener('click',event=>{
  const button=event.target.closest('[data-image-action]');if(!button)return;
  const item=button.closest('[data-image-index]');const index=Number(item?.dataset.imageIndex);if(!Number.isInteger(index)||!productImageItems[index])return;
  const action=button.dataset.imageAction;
  if(action==='remove'){
    const [removed]=productImageItems.splice(index,1);
    if(removed?.type==='file'&&removed.preview)URL.revokeObjectURL(removed.preview);
  }else if(action==='primary'){
    const [selected]=productImageItems.splice(index,1);productImageItems.unshift(selected);
  }else if(action==='right'&&index>0){
    [productImageItems[index-1],productImageItems[index]]=[productImageItems[index],productImageItems[index-1]];
  }else if(action==='left'&&index<productImageItems.length-1){
    [productImageItems[index+1],productImageItems[index]]=[productImageItems[index],productImageItems[index+1]];
  }
  renderProductImageEditor();
});
q('#productHasDiscount')?.addEventListener('change',()=>{toggleDiscountFields();renderVariantPricing();});
q('#productInventoryMode')?.addEventListener('change',toggleInventoryFields);
document.addEventListener('change',event=>{
  if(event.target.closest('.product-size-option,.product-fabric-option'))renderVariantPricing();
});
q('#fillVariantPrices')?.addEventListener('click',()=>{
  const price=q('#productPrice')?.value||'';const oldPrice=q('#productOldPrice')?.value||'';
  qa('.variant-price-input').forEach(input=>{input.value=price;});
  if(q('#productHasDiscount')?.checked)qa('.variant-old-price-input').forEach(input=>{input.value=oldPrice;});
});
document.addEventListener('change',event=>{
  const checkbox=event.target.closest('.product-category-option');
  if(!checkbox)return;
  const radio=checkbox.closest('.product-category-choice')?.querySelector('.product-primary-category');
  if(radio)radio.disabled=!checkbox.checked;
  if(!checkbox.checked&&radio?.checked){
    radio.checked=false;
    const next=q('.product-category-option:checked')?.closest('.product-category-choice')?.querySelector('.product-primary-category');
    if(next)next.checked=true;
  }else if(checkbox.checked&&!q('.product-primary-category:checked')&&radio){radio.checked=true;}
  applyProductCategoryRules();
});
document.addEventListener('click',event=>{if(!event.target.closest('#adminNotificationPanel')&&!event.target.closest('#adminNotificationBtn'))q('#adminNotificationPanel')?.classList.remove('open');});

[
  ['#adminOrderSearch','input',renderOrders],['#adminOrderStatus','change',renderOrders],['#adminPaymentStatus','change',renderOrders],
  ['#adminProductSearch','input',()=>{adminProductPage=1;renderProducts();}],['#adminProductCategory','change',()=>{adminProductPage=1;renderProducts();}],['#adminProductStatus','change',()=>{adminProductPage=1;renderProducts();}],
  ['#adminCategorySearch','input',renderCategories],['#adminCategoryStatus','change',renderCategories],['#adminCategoryPlacement','change',renderCategories],
  ['#couponSearch','input',renderCoupons],['#couponStatus','change',renderCoupons],['#customerSearch','input',renderCustomers],['#customerRole','change',renderCustomers],
  ['#adminTicketSearch','input',renderTickets],['#adminTicketStatus','change',renderTickets],['#adminTicketPriority','change',renderTickets],
  ['#adminCustomSearch','input',renderCustom],['#adminCustomStatus','change',renderCustom],['#adminCustomPaymentStatus','change',renderCustom]
].forEach(([selector,eventName,handler])=>q(selector)?.addEventListener(eventName,handler));

q('#productForm')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const selectedCategoryIds=qa('.product-category-option:checked').map(input=>Number(input.value)).filter(Number.isFinite);
  const selectedPrimary=Number(q('.product-primary-category:checked')?.value||selectedCategoryIds[0]||0);
  const categoryIds=[selectedPrimary,...selectedCategoryIds.filter(id=>id!==selectedPrimary)].filter(Boolean);
  const categoryMap=new Map(D.get('categories').map(category=>[Number(category.id),category]));
  const selectedCategories=categoryIds.map(id=>categoryMap.get(id)).filter(Boolean);
  const categories=selectedCategories.map(category=>category.name);
  const categorySlugs=selectedCategories.map(category=>category.slug);
  const sizes=qa('.product-size-option:checked').map(input=>input.value);
  const fabrics=qa('.product-fabric-option:checked').map(input=>input.value);
  if(!categories.length)return D.toast('حداقل یک دسته‌بندی را انتخاب کنید.','error');
  if(!sizes.length)return D.toast('حداقل یک سایز را انتخاب کنید.','error');
  if(!fabrics.length)return D.toast('حداقل یک جنس پارچه را انتخاب کنید.','error');

  const hasDiscount=Boolean(q('#productHasDiscount')?.checked);
  const inventoryMode=q('#productInventoryMode')?.value==='managed'?'managed':'unlimited';
  const stock=inventoryMode==='managed'?Number(q('#productStock')?.value):0;
  if(inventoryMode==='managed'&&(!Number.isInteger(stock)||stock<0))return D.toast('تعداد موجودی باید عدد صحیح صفر یا بیشتر باشد.','error');
  const variantPrices=readVariantPricingRows();
  if(variantPrices.length!==sizes.length*fabrics.length)return D.toast('قیمت همه ترکیب‌های سایز و جنس را کامل کنید.','error');
  if(variantPrices.some(item=>!Number.isFinite(item.price)||item.price<0))return D.toast('قیمت فروش همه ترکیب‌ها باید معتبر باشد.','error');
  if(hasDiscount&&variantPrices.some(item=>!Number.isFinite(item.oldPrice)||item.oldPrice<=item.price))return D.toast('قیمت قبل تخفیف هر ترکیب باید از قیمت فروش بیشتر باشد.','error');

  let all=D.get('products');
  const id=Number(q('#productId').value)||Math.max(0,...all.map(product=>Number(product.id)||0))+1;
  const previous=all.find(product=>Number(product.id)===id);
  const cheapest=variantPrices.reduce((best,item)=>item.price<best.price?item:best,variantPrices[0]);
  const sku=(q('#productSku').value.trim()||generateRandomSku(id)).toUpperCase();
  if(all.some(item=>Number(item.id)!==id&&String(item.sku||'').toUpperCase()===sku))return D.toast('این کد محصول قبلاً استفاده شده است.','error');

  if(!productImageItems.length)return D.toast('حداقل یک تصویر برای محصول انتخاب کنید.','error');
  const pendingImages=productImageItems.filter(item=>item.type==='file');
  let uploadedImages=[];
  if(pendingImages.length){
    try{
      const formData=new FormData();
      pendingImages.forEach(item=>formData.append('images',item.file));
      const uploaded=await window.CribAPI.request('/api/admin/products/upload-image',{method:'POST',body:formData});
      uploadedImages=Array.isArray(uploaded.images)?uploaded.images:uploaded.image?[uploaded.image]:[];
      if(uploadedImages.length!==pendingImages.length)throw new Error('تعداد تصاویر آپلودشده کامل نیست.');
    }catch(error){
      return D.toast(error.message||'آپلود تصاویر محصول انجام نشد.','error');
    }
  }
  let uploadIndex=0;
  const images=productImageItems.map(item=>item.type==='file'?uploadedImages[uploadIndex++]:item.value).filter(Boolean);
  const image=images[0]||D.PRODUCT_IMAGE;

  const data={
    ...previous,id,title:q('#productTitle').value.trim(),sku,category:categories[0],categories,
    primaryCategoryId:categoryIds[0],categoryIds,categorySlugs,
    price:cheapest.price,hasDiscount,old:hasDiscount?cheapest.oldPrice:null,
    variantPrices:variantPrices.map(item=>({...item,hasDiscount,oldPrice:hasDiscount?item.oldPrice:null})),
    badge:q('#productBadge').value,status:q('#productStatus').value,inventoryMode,stock,sizes,fabrics,
    rate:previous?.rate||4.7,date:previous?.date||15,sales:previous?.sales||0,image,images
  };
  delete data.description;
  const index=all.findIndex(product=>Number(product.id)===id);
  if(index>=0)all[index]=data;else all.unshift(data);
  D.set('products',all);releaseProductImageItems();closeModals();renderAll();event.target.reset();D.toast('محصول، گالری تصاویر و قیمت‌های انتخابی ذخیره شد.');
});
q('#saveOrderChanges')?.addEventListener('click',()=>{
  const all=D.get('orders'),order=all.find(item=>item.id===activeOrder);if(!order)return;
  order.status=q('#modalOrderStatus').value;order.paymentStatus=q('#modalPaymentStatus').value;order.tracking=q('#modalTracking').value.trim();order.adminNote=q('#modalAdminNote').value.trim();
  D.set('orders',all);closeModals();renderAll();D.toast('وضعیت سفارش به‌روزرسانی شد.');
});
q('#deleteOrderFromModal')?.addEventListener('click',event=>{
  if(activeOrder)deleteAdminOrder(activeOrder,'order',event.currentTarget);
});
q('#saveCustomChanges')?.addEventListener('click',()=>{
  const all=D.get('custom'),item=all.find(entry=>entry.id===activeCustom);if(!item)return;
  item.orderStatus=q('#modalCustomOrderStatus').value;item.status=q('#modalCustomStatus').value;item.paymentStatus=q('#modalCustomPaymentStatus').value;item.price=Number(q('#modalCustomPrice').value);item.adminNote=q('#modalCustomAdminNote').value.trim();D.set('custom',all);
  closeModals();renderAll();D.toast('درخواست طراحی به‌روزرسانی شد.');
});
q('#deleteCustomOrderFromModal')?.addEventListener('click',event=>{
  if(activeCustom)deleteAdminOrder(activeCustom,'custom',event.currentTarget);
});
q('#addCategoryBtn')?.addEventListener('click',()=>categoryModal());
q('#categoryName')?.addEventListener('input',event=>{
  const slug=q('#categorySlug');
  if(slug&&slug.dataset.manual!=='true')slug.value=normalizeCategorySlug(event.target.value);
});
q('#categorySlug')?.addEventListener('input',event=>{event.target.dataset.manual='true';});
q('#categorySlug')?.addEventListener('blur',event=>{event.target.value=normalizeCategorySlug(event.target.value);});
q('#categoryImageFile')?.addEventListener('change',event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){
    releaseCategoryImageSelection();
    renderCategoryImagePreview();
    return D.toast('فرمت تصویر دسته باید PNG، JPG یا WEBP باشد.','error');
  }
  if(file.size>20*1024*1024){
    releaseCategoryImageSelection();
    renderCategoryImagePreview();
    return D.toast('حجم تصویر دسته باید کمتر از ۲۰ مگابایت باشد.','error');
  }
  if(categoryImagePreviewUrl)URL.revokeObjectURL(categoryImagePreviewUrl);
  categoryImageFile=file;
  categoryImagePreviewUrl=URL.createObjectURL(file);
  renderCategoryImagePreview(categoryImagePreviewUrl);
});
q('#categoryForm')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const id=Number(q('#categoryId').value||0);
  let categoryImage=q('#categoryImage').value.trim();
  try{
    if(categoryImageFile){
      const formData=new FormData();
      formData.append('image',categoryImageFile);
      const uploaded=await window.CribAPI.request('/api/admin/categories/upload-image',{method:'POST',body:formData});
      categoryImage=uploaded.image||'';
      if(!categoryImage)throw new Error('مسیر تصویر بهینه‌شده دریافت نشد.');
      q('#categoryImage').value=categoryImage;
    }
    const payload={
      name:q('#categoryName').value.trim(),slug:normalizeCategorySlug(q('#categorySlug').value||q('#categoryName').value),
      sortOrder:Number(q('#categorySortOrder').value||0),status:q('#categoryStatus').value,
      image:categoryImage,description:q('#categoryDescription').value.trim(),
      showInMenu:q('#categoryShowInMenu').checked,showInStore:q('#categoryShowInStore').checked,
      showInHome:q('#categoryShowInHome').checked,showInReady:q('#categoryShowInReady').checked,
      isReadyRoot:q('#categoryIsReadyRoot').checked
    };
    await window.CribAPI.request(id?`/api/admin/categories/${id}`:'/api/admin/categories',{method:id?'PUT':'POST',body:JSON.stringify(payload)});
    await D.syncFromApi('admin');closeModals();renderAll();D.toast(id?'دسته‌بندی ویرایش شد.':'دسته‌بندی ایجاد شد.');
  }catch(error){D.toast(error.message||'ذخیره دسته‌بندی انجام نشد.','error');}
});
q('#addCouponBtn')?.addEventListener('click',()=>couponModal());
q('#couponApplicability')?.addEventListener('change',syncCouponVariantScope);
q('#couponSelectAllVariants')?.addEventListener('click',()=>{
  const options=qa('.coupon-variant-option');
  const shouldCheck=options.some(input=>!input.checked);
  options.forEach(input=>{input.checked=shouldCheck;});
  updateCouponVariantCount();
});
q('#couponVariantSearch')?.addEventListener('input',filterCouponVariantOptions);
q('#couponVariantProducts')?.addEventListener('change',event=>{
  if(event.target.matches('.coupon-variant-option'))updateCouponVariantCount();
});
q('#couponVariantProducts')?.addEventListener('click',event=>{
  const button=event.target.closest('[data-coupon-product-action]');if(!button)return;
  const group=button.closest('.coupon-product-scope');if(!group)return;
  const shouldCheck=button.dataset.couponProductAction==='select';
  group.querySelectorAll('.coupon-variant-option').forEach(input=>{input.checked=shouldCheck;});
  updateCouponVariantCount();
});
q('#couponForm')?.addEventListener('submit',event=>{
  event.preventDefault();let all=D.get('coupons');const id=Number(q('#couponId').value)||Date.now(),old=all.find(coupon=>Number(coupon.id)===id);
  const minimum=Number(q('#couponMin').value||0);
  const applicability=q('#couponApplicability').value==='variants'?'variants':'all';
  const eligibleVariants=applicability==='variants'?selectedCouponVariants():[];
  if(!Number.isInteger(minimum)||minimum<0)return D.toast('حداقل مبلغ خرید باید عدد صحیح صفر یا بیشتر باشد.','error');
  if(applicability==='variants'&&!eligibleVariants.length)return D.toast('حداقل یک محصول و ترکیب سایز، جنس یا حالت سفارش را انتخاب کنید.','error');
  const data={id,code:q('#couponCode').value.trim().toUpperCase(),type:q('#couponType').value,value:Number(q('#couponValue').value),min:minimum,applicability,eligibleVariants,limit:Number(q('#couponLimit').value||0),used:old?.used||0,expires:q('#couponExpires').value.trim(),status:q('#couponStatusField').value};
  const index=all.findIndex(coupon=>Number(coupon.id)===id);if(index>=0)all[index]=data;else all.unshift(data);D.set('coupons',all);closeModals();renderCoupons();event.target.reset();D.toast('کد تخفیف ذخیره شد.');
});
q('#refreshDashboard')?.addEventListener('click',()=>{D.syncFromApi('admin').then(()=>{renderAll();D.toast('اطلاعات داشبورد به‌روزرسانی شد.');}).catch(error=>D.toast(error.message,'error'));});
q('#createOrderBtn')?.addEventListener('click',async()=>{const customer=prompt('نام مشتری:');if(!customer)return;const phone=prompt('شماره تماس مشتری:');if(!phone)return;const productId=prompt('شناسه عددی محصول:','1');if(!productId)return;const qty=prompt('تعداد:','1');if(!qty)return;try{await window.CribAPI.request('/api/admin/orders/manual',{method:'POST',body:JSON.stringify({customer,phone,productId:Number(productId),qty:Number(qty),paymentStatus:'paid'})});await D.syncFromApi('admin');renderAll();D.toast('سفارش دستی ثبت شد.');}catch(error){D.toast(error.message,'error');}});
q('#adminGlobalSearch')?.addEventListener('keydown',event=>{if(event.key==='Enter'){const value=event.target.value.trim();if(!value)return;showView('orders');q('#adminOrderSearch').value=value;renderOrders();}});

document.addEventListener('click',async event=>{
  const deleteOrderButton=event.target.closest('.delete-order');
  if(deleteOrderButton){
    await deleteAdminOrder(deleteOrderButton.dataset.id,deleteOrderButton.dataset.source,deleteOrderButton);
    return;
  }
  const orderView = event.target.closest('.admin-order-view');


  if (orderView) {
    orderModal(orderView.dataset.id);
  }
  const orderPrint=event.target.closest('.admin-order-print');if(orderPrint)D.toast(`نسخه چاپی سفارش ${orderPrint.dataset.id} آماده شد.`);
  const editProduct=event.target.closest('.edit-product');if(editProduct)productModal(Number(editProduct.dataset.id));
  const editCategory=event.target.closest('.edit-category');if(editCategory)categoryModal(Number(editCategory.dataset.id));
  const deleteCategory=event.target.closest('.delete-category');if(deleteCategory){
    const category=D.get('categories').find(item=>Number(item.id)===Number(deleteCategory.dataset.id));
    if(category&&confirm(`دسته‌بندی «${category.name}» حذف شود؟`)){
      try{await window.CribAPI.request(`/api/admin/categories/${category.id}`,{method:'DELETE'});await D.syncFromApi('admin');renderAll();D.toast('دسته‌بندی حذف شد.');}
      catch(error){D.toast(error.message||'حذف دسته‌بندی انجام نشد.','error');}
    }
  }
  const cloneProduct=event.target.closest('.clone-product');if(cloneProduct){const all=D.get('products'),product=all.find(item=>Number(item.id)===Number(cloneProduct.dataset.id));if(product){const id=Math.max(...all.map(item=>Number(item.id)))+1;all.unshift({...product,id,sku:generateRandomSku(id),title:`${product.title} — کپی`,status:'draft',sales:0,image:product.image||D.PRODUCT_IMAGE,images:[...(product.images||[product.image||D.PRODUCT_IMAGE])]});D.set('products',all);renderAll();D.toast('یک نسخه پیش‌نویس از محصول ساخته شد.');}}
  const deleteProduct=event.target.closest('.delete-product');if(deleteProduct){const all=D.get('products');if(all.length<=1)return D.toast('حداقل یک محصول باید باقی بماند.','error');D.set('products',all.filter(product=>Number(product.id)!==Number(deleteProduct.dataset.id)));renderAll();D.toast('محصول حذف شد.');}
  const editCoupon=event.target.closest('.edit-coupon');if(editCoupon)couponModal(Number(editCoupon.dataset.id));
  const deleteCoupon=event.target.closest('.delete-coupon');if(deleteCoupon){const next=D.get('coupons').filter(coupon=>Number(coupon.id)!==Number(deleteCoupon.dataset.id));if(!next.length&&!confirm('آخرین کد تخفیف حذف شود؟'))return;D.set('coupons',next,{confirmEmpty:!next.length});renderCoupons();D.toast('کد تخفیف حذف شد.');}
  const customerView=event.target.closest('.customer-view');if(customerView)customerModal(Number(customerView.dataset.id));
  const ticketView=event.target.closest('.admin-ticket-view');if(ticketView)ticketModal(ticketView.dataset.id);
  const customView=event.target.closest('.custom-admin-view');if(customView)customModal(customView.dataset.id);
  const customOrderButton = event.target.closest(
  '.open-custom-from-orders'
  );

  if (customOrderButton) {
    const customId = customOrderButton.dataset.id;

    // همان مودال کامل طرح اختصاصی، بدون تغییر تب صفحه سفارش‌ها باز می‌شود.
    customModal(customId);
  }

  if(event.target.id==='sendAdminTicketReply'){
    const text=q('#adminTicketReply').value.trim();if(!text)return D.toast('متن پاسخ را وارد کنید.','error');
    const all=D.get('tickets'),ticket=all.find(item=>item.id===activeTicket);ticket.messages.push({from:'admin',text,date:'همین حالا'});ticket.status='answered';D.set('tickets',all);ticketModal(activeTicket);renderTickets();D.toast('پاسخ برای مشتری ثبت شد.');
  }
  if(event.target.id==='closeTicketBtn'){const all=D.get('tickets'),ticket=all.find(item=>item.id===activeTicket);ticket.status='closed';D.set('tickets',all);closeModals();renderAll();D.toast('تیکت بسته شد.');}
  if(event.target.id==='reopenTicketBtn'){const all=D.get('tickets'),ticket=all.find(item=>item.id===activeTicket);ticket.status='open';D.set('tickets',all);ticketModal(activeTicket);renderTickets();D.toast('تیکت بازگشایی شد.');}
});

function exportRows(name,rows){D.downloadCSV(`${name}-${new Date().toISOString().slice(0,10)}.csv`,rows);}
q('#exportOrdersBtn')?.addEventListener('click',()=>exportRows('orders',getOrdersForDisplay().map(order=>({order:order.id,customer:order.customer,phone:order.phone,date:registrationDateTime(order),subtotal:order.subtotal,coupon:order.couponCode||'',discount:order.discount,total:order.total,note:order.customerNote||'',status:labels[order.status],payment:labels[order.paymentStatus]||order.paymentStatus,paymentGateway:paymentGatewayLabel(order)}))));
q('#exportProductsBtn')?.addEventListener('click',()=>exportRows('products',D.get('products').map(product=>({id:product.id,sku:product.sku,title:product.title,category:(product.categories||[product.category]).join(' | '),sizes:(product.sizes||[]).join(' | '),fabrics:(product.fabrics||[]).join(' | '),price:product.price,badge:product.badge,status:labels[product.status]}))));
q('#exportCategoriesBtn')?.addEventListener('click',()=>exportRows('categories',D.get('categories').map(category=>({id:category.id,name:category.name,slug:category.slug,sortOrder:category.sortOrder,status:labels[category.status]||category.status,placements:categoryPlacements(category).join(' | '),productCount:category.productCount||0}))));
q('#exportCustomersBtn')?.addEventListener('click',()=>exportRows('customers',D.get('users').map(user=>({id:user.id,name:user.name,phone:user.phone,email:user.email,orders:user.orders,total:user.total,role:user.role}))));
q('#exportCustomBtn')?.addEventListener('click',()=>exportRows('custom-designs',D.get('custom')));
q('#downloadFullReport')?.addEventListener('click',()=>exportRows('full-sales-report',D.get('orders').map(order=>({order:order.id,customer:order.customer,phone:order.phone,date:registrationDateTime(order),subtotal:order.subtotal,discount:order.discount,shipping:order.shipping,total:order.total,paymentStatus:labels[order.paymentStatus]||order.paymentStatus,paymentGateway:paymentGatewayLabel(order),status:labels[order.status]||order.status,includedInSales:order.paymentStatus==='paid'&&order.status!=='cancelled'?'بله':'خیر',coupon:order.couponCode||'',customerNote:order.customerNote||''}))));

q('#adminLogout')?.addEventListener('click',async()=>{try{await window.CribAPI.request('/api/admin/logout',{method:'POST',body:'{}'});}catch{}location.reload();});
async function bootstrapAdmin(){
  try{
    await D.syncFromApi('admin');
    renderAll();
  }catch(error){
    D.clearServerData?.();
    renderAll();
    console.error('Admin bootstrap failed:',error);
    D.toast(`دریافت اطلاعات پنل از دیتابیس ناموفق بود: ${error.message||'خطای نامشخص'}`,'error');
  }
}
bootstrapAdmin();
})();
