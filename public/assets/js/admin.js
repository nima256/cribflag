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
  processing:'در حال آماده‌سازی','design-review':'بررسی طراحی',shipped:'ارسال شده',delivered:'تحویل شده',cancelled:'لغو شده',
  active:'فعال',draft:'پیش‌نویس',expired:'منقضی',open:'باز',answered:'پاسخ داده شده',closed:'بسته',review:'در حال بررسی',
  'preview-ready':'پیش‌نمایش آماده',approved:'تأیید شده',paid:'پرداخت شده',refunded:'مسترد شده'
};
const ORDER_STATUS_CHART=[
  {key:'processing',label:'در حال آماده‌سازی',color:'#f2a51a'},
  {key:'design-review',label:'بررسی طراحی',color:'#8b5cf6'},
  {key:'shipped',label:'ارسال شده',color:'#3157d5'},
  {key:'delivered',label:'تحویل شده',color:'#22a881'},
  {key:'cancelled',label:'لغو شده',color:'#e95b70'}
];
let activeOrder=null,activeCustomer=null,activeTicket=null,activeCustom=null;
let productImageItems=[];
const PRODUCT_IMAGE_LIMIT=12;
const ADMIN_PRODUCT_PAGE_SIZE=12;
let adminProductPage=1;
const DEFAULT_PRODUCT_SIZE_PRICES=Object.freeze({
  '150x90':950000,
  '100x70':800000,
  '70x50':550000
});
const DEFAULT_VELVET_PRODUCT_SIZE_PRICES=Object.freeze({
  '150x90':1200000,
  '100x70':1000000,
  '70x50':700000
});

function releaseProductImageItems(){
  productImageItems.forEach(item=>{if(item.type==='file'&&item.preview)URL.revokeObjectURL(item.preview);});
  productImageItems=[];
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
function openModal(selector){q(selector)?.classList.add('open');}
function closeModals(){const productWasOpen=q('#productModal')?.classList.contains('open');qa('.portal-modal-backdrop').forEach(item=>item.classList.remove('open'));if(productWasOpen)releaseProductImageItems();}
function productThumb(title='محصول',image=D.PRODUCT_IMAGE){
  return `<span class="product-mini-img"><img src="${D.esc(image||D.PRODUCT_IMAGE)}" alt="${D.esc(title)}"></span>`;
}
function productImage(id){return D.get('products').find(product=>Number(product.id)===Number(id))?.image||D.PRODUCT_IMAGE;}
function getOrdersForDisplay() {
  const realOrders = Array.isArray(D.get('orders'))
    ? [...D.get('orders')]
    : [];

  const customRequests = Array.isArray(D.get('custom'))
    ? [...D.get('custom')]
    : [];

  const linkedCustomRequestIds = new Set(
    realOrders.flatMap(order => (order.items || [])
      .map(item => String(item.customRequestId || '').trim())
      .filter(Boolean))
  );

  /*
   * درخواست‌هایی که هنوز سفارش پرداختی برایشان ساخته نشده،
   * به‌صورت ردیف موقت در جدول سفارش‌ها دیده می‌شوند.
   */
  const customDisplayRows = customRequests
    .filter(item => !linkedCustomRequestIds.has(String(item.id || '').trim()))
    .map(item => ({
    id: item.id,
    customRequestId: item.id,
    displayType: 'custom',

    customer: item.customer || 'مشتری طرح اختصاصی',
    phone: item.phone || '—',
    email: item.email || '',

    date: item.date || '—',
    createdAt: item.createdAt || '',

    total: Number(item.price || 0),
    paymentStatus: item.paymentStatus || 'review',

    /*
     * وضعیت دقیقاً از همان CustomRequest خوانده می‌شود.
     * برای جدول سفارش فقط برچسب نمایشی می‌سازیم.
     */
    status: item.status || 'review',

    shippingMethod: 'طرح اختصاصی',

    fileName: item.fileName || '',
    size: item.size || '',
    fabric: item.fabric || '',
    notes: item.notes || ''
  }));

  return [...realOrders, ...customDisplayRows];
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
function orderRow(order, compact = false) {
  const isCustom = order.displayType === 'custom';

  const orderStatus = isCustom
    ? status(order.status || 'review')
    : status(order.status);

  const paymentStatus = isCustom
    ? '<span class="portal-status status-review">مدیریت در طرح‌های اختصاصی</span>'
    : status(order.paymentStatus);

  const customBadge = isCustom
    ? `
      <span
        class="portal-status status-design-review"
        style="margin-top:6px"
      >
        طرح اختصاصی
      </span>
    `
    : '';

  const actionButton = isCustom
    ? `
      <button
        type="button"
        class="table-action open-custom-from-orders"
        data-id="${D.esc(order.customRequestId)}"
        title="مشاهده در طرح‌های اختصاصی"
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

  if (compact) {
    return `
      <tr>
        <td>
          <span class="table-primary">
            ${D.esc(order.id)}
          </span>

          <span class="table-secondary">
            ${D.esc(order.date || '—')}
          </span>

          ${customBadge}
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

        ${customBadge}
      </td>

      <td>
        <b>${D.esc(order.customer || '—')}</b>

        <span class="table-secondary">
          ${D.esc(order.phone || '—')}
        </span>
      </td>

      <td>
        ${D.esc(order.date || '—')}
      </td>

      <td>
        <b>${D.toman(order.total || 0)}</b>${Number(order.discount||0)>0?`<span class="table-secondary">تخفیف: ${D.toman(order.discount)}</span>`:''}
      </td>

      <td>
        ${paymentStatus}
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
        </div>
      </td>
    </tr>
  `;
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
      const searchableText = `
        ${order.id || ''}
        ${order.customer || ''}
        ${order.phone || ''}
        ${order.fileName || ''}
      `.toLowerCase();

      return searchableText.includes(term);
    });
  }

  if (orderStatus) {
    list = list.filter(order => {
      if (order.displayType === 'custom') {
        /*
         * درخواست‌های اختصاصی با وضعیت review و preview-ready
         * در فیلتر بررسی طراحی نمایش داده می‌شوند.
         */
        if (orderStatus === 'design-review') {
          return [
            'draft',
            'review',
            'preview-ready'
          ].includes(order.status);
        }

        if (orderStatus === 'processing') {
          return order.status === 'approved';
        }

        return false;
      }

      return order.status === orderStatus;
    });
  }

  if (paymentStatus) {
    list = list.filter(order => {
      /*
       * برای طرح اختصاصی وضعیت پرداخت در جدول سفارش‌ها
       * قابل مدیریت نیست.
       */
      if (order.displayType === 'custom') {
        return paymentStatus === 'review';
      }

      return order.paymentStatus === paymentStatus;
    });
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
    all.filter(order => {
      if (order.displayType === 'custom') {
        return ['draft', 'review', 'preview-ready'].includes(
          order.status
        );
      }

      return ['processing', 'design-review'].includes(
        order.status
      );
    }).length
  );

  q('#orderStatProcessing').textContent = D.fa(
    all.filter(order => {
      if (order.displayType === 'custom') {
        return order.status === 'approved';
      }

      return order.status === 'processing';
    }).length
  );

  q('#orderStatShipping').textContent = D.fa(
    all.filter(order =>
      order.displayType !== 'custom' &&
      order.status === 'shipped'
    ).length
  );

  q('#orderStatValue').textContent = D.toman(
    all.reduce(
      (sum, order) => sum + Number(order.total || 0),
      0
    )
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
function couponVariantKey(size,fabric){return `${String(size||'').trim()}\u0000${String(fabric||'').trim()}`;}
function couponScopeMarkup(coupon){
  if(coupon.applicability!=='variants')return '<span class="portal-status status-active">همه ترکیب‌ها</span>';
  const variants=Array.isArray(coupon.eligibleVariants)?coupon.eligibleVariants:[];
  if(!variants.length)return '<span class="portal-status status-cancelled">بدون انتخاب</span>';
  const labels=variants.slice(0,2).map(item=>`${String(item.size||'').replace(' سانتی‌متر','')} · ${item.fabric}`);
  const more=variants.length>2?`<small class="table-secondary">+ ${D.fa(variants.length-2)} ترکیب دیگر</small>`:'';
  return `<div class="coupon-scope-summary">${labels.map(label=>`<span>${D.esc(label)}</span>`).join('')}${more}</div>`;
}
function selectedCouponVariants(){
  return qa('.coupon-variant-option:checked').map(input=>({size:input.dataset.size||'',fabric:input.dataset.fabric||''}));
}
function syncCouponVariantScope(){
  const restricted=q('#couponApplicability')?.value==='variants';
  const scope=q('#couponVariantScope');
  if(scope)scope.hidden=!restricted;
  qa('.coupon-variant-option').forEach(input=>{input.disabled=!restricted;});
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
      `.toLowerCase();

      return searchableText.includes(term);
    });
  }

  if (customStatus) {
    list = list.filter(item => item.status === customStatus);
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
            ${D.esc(item.date || '—')}
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
      <td colspan="7">
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
  const orders=D.get('orders').filter(order=>['processing','design-review'].includes(order.status));
  const tickets=D.get('tickets').filter(ticket=>ticket.status==='open');
  const items=[
    ...orders.slice(0,4).map(order=>({title:'سفارش نیازمند اقدام',text:`سفارش ${order.id} در وضعیت ${labels[order.status]} است.`,date:order.date})),
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
  q('#categoryForm')?.reset();
  q('#categoryModalTitle').textContent=category?'ویرایش دسته‌بندی':'افزودن دسته‌بندی';
  q('#categoryId').value=category?.id||'';
  q('#categoryName').value=category?.name||'';
  q('#categorySlug').value=category?.slug||'';
  q('#categorySortOrder').value=category?.sortOrder??0;
  q('#categoryStatus').value=category?.status||'active';
  q('#categoryImage').value=category?.image||'';
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
function variantPricingKey(size,fabric){return `${size}|||${fabric}`;}
function defaultProductPriceForVariant(size,fabric){
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
    return `<div class="variant-price-row" data-size="${D.esc(size)}" data-fabric="${D.esc(fabric)}">
      <div class="variant-label"><small>سایز</small><strong>${D.esc(size)}</strong></div>
      <div class="variant-label"><small>جنس</small><strong>${D.esc(fabric)}</strong></div>
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
  setChecked('.product-size-option',product?.sizes||D.DEFAULT_SIZES);
  setChecked('.product-fabric-option',product?.fabrics||D.DEFAULT_FABRICS);
  renderVariantPricing(product?.variantPrices||[]);toggleDiscountFields();toggleInventoryFields();openModal('#productModal');
}
function orderModal(id){
  const order=D.get('orders').find(item=>item.id===id);if(!order)return;activeOrder=id;
  const discount=Number(order.discount||0),shipping=Number(order.shipping||0),subtotal=Number.isFinite(Number(order.subtotal))?Number(order.subtotal):Math.max(0,Number(order.total||0)+discount-shipping);
  q('#adminOrderModalBody').innerHTML=`
    <div class="detail-summary">
      <div class="detail-chip"><small>سفارش</small><strong>${D.esc(order.id)}</strong></div>
      <div class="detail-chip"><small>مشتری</small><strong>${D.esc(order.customer)}</strong></div>
      <div class="detail-chip"><small>مبلغ نهایی</small><strong>${D.toman(order.total)}</strong></div>
      <div class="detail-chip"><small>پرداخت</small><strong>${labels[order.paymentStatus]||order.paymentStatus}</strong></div>
    </div>
    <div class="portal-grid-equal"><div>
      <h4>اقلام سفارش</h4>
      <div class="order-items-mini">${(order.items||[]).map(item=>`<div class="order-item-mini">${productThumb(item.title,productImage(item.id))}<span><strong>${D.esc(item.title)}</strong><small>${item.size?D.esc(item.size)+' — ':''}${item.fabric?D.esc(item.fabric)+' — ':''}تعداد ${D.fa(item.qty)}</small>${item.notes?`<small>یادداشت کالا: ${D.esc(item.notes)}</small>`:''}</span><b>${D.toman(item.price*item.qty)}</b></div>`).join('')}</div>
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
    </div><div><div class="form-grid"><div class="field full"><label>وضعیت سفارش</label><select id="modalOrderStatus"><option value="processing">در حال آماده‌سازی</option><option value="design-review">بررسی طراحی</option><option value="shipped">ارسال شده</option><option value="delivered">تحویل شده</option><option value="cancelled">لغو شده</option></select></div><div class="field full"><label>وضعیت پرداخت</label><select id="modalPaymentStatus"><option value="paid">پرداخت شده</option><option value="review">در انتظار بررسی</option><option value="refunded">مسترد شده</option></select></div><div class="field full"><label>کد رهگیری</label><input id="modalTracking" value="${D.esc(order.tracking||'')}"></div><div class="field full"><label>یادداشت داخلی</label><textarea id="modalAdminNote">${D.esc(order.adminNote||'')}</textarea></div></div></div></div>`;
  q('#modalOrderStatus').value=order.status;q('#modalPaymentStatus').value=order.paymentStatus;openModal('#adminOrderModal');
}
function customerModal(id){
  const user=D.get('users').find(item=>Number(item.id)===Number(id));if(!user)return;activeCustomer=id;
  const orders=D.get('orders').filter(order=>Number(order.userId)===Number(id));
  q('#customerModalBody').innerHTML=`<div class="profile-hero" style="margin-bottom:15px"><div class="portal-avatar">${D.esc(user.name[0])}</div><div><h2>${D.esc(user.name)}</h2><p>${D.esc(user.phone)} — ${D.esc(user.email)}</p></div></div><div class="detail-summary customer-summary"><div class="detail-chip"><small>تاریخ عضویت</small><strong>${D.esc(user.joined)}</strong></div><div class="detail-chip"><small>تعداد سفارش</small><strong>${D.fa(orders.length||user.orders)}</strong></div><div class="detail-chip"><small>ارزش خرید</small><strong>${D.toman(user.total)}</strong></div><div class="detail-chip"><small>نوع حساب</small><strong>${user.role==='business'?'سازمانی':'شخصی'}</strong></div></div><h4>سفارش‌های اخیر</h4><div class="order-items-mini">${orders.map(order=>`<div class="order-item-mini"><span class="list-icon">${D.esc(order.id.slice(-2))}</span><span><strong>${D.esc(order.id)} — ${labels[order.status]}</strong><small>${D.esc(order.date)}</small></span><b>${D.toman(order.total)}</b></div>`).join('')||'<div class="empty-panel">سفارشی ندارد.</div>'}</div>`;
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
        <small>مشتری</small>
        <strong>${D.esc(item.customer)}</strong>
      </div>

      <div class="detail-chip">
        <small>شماره تماس</small>
        <strong>${D.esc(item.phone || '—')}</strong>
      </div>

      <div class="detail-chip">
        <small>سایز</small>
        <strong>${D.esc(item.size || '—')}</strong>
      </div>

      <div class="detail-chip">
        <small>جنس پارچه</small>
        <strong>${D.esc(item.fabric || 'ساتن آمریکایی')}</strong>
      </div>

      <div class="detail-chip">
        <small>قیمت</small>
        <strong>${D.toman(item.price || 0)}</strong>
      </div>
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

  q('#modalCustomStatus').value = item.status || 'review';

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
  const selected=new Set((coupon?.eligibleVariants||[]).map(item=>couponVariantKey(item.size,item.fabric)));
  qa('.coupon-variant-option').forEach(input=>{input.checked=selected.has(couponVariantKey(input.dataset.size,input.dataset.fabric));});
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
q('#productImageFile')?.addEventListener('change',event=>{
  const selected=[...(event.target.files||[])];
  event.target.value='';
  if(!selected.length)return;
  const allowed=new Set(['image/png','image/jpeg','image/webp']);
  if(selected.some(file=>!allowed.has(file.type)))return D.toast('فقط تصویر PNG، JPG یا WEBP مجاز است.','error');
  if(selected.some(file=>file.size>20*1024*1024))return D.toast('حجم هر تصویر باید کمتر از ۲۰ مگابایت باشد.','error');
  const remaining=Math.max(0,PRODUCT_IMAGE_LIMIT-productImageItems.length);
  if(!remaining)return D.toast(`حداکثر ${D.fa(PRODUCT_IMAGE_LIMIT)} تصویر می‌توانید ثبت کنید.`,'error');
  selected.slice(0,remaining).forEach(file=>{
    const duplicate=productImageItems.some(item=>item.type==='file'&&item.file.name===file.name&&item.file.size===file.size&&item.file.lastModified===file.lastModified);
    if(!duplicate)productImageItems.push({type:'file',file,preview:URL.createObjectURL(file),value:''});
  });
  renderProductImageEditor();
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
qa('.product-size-option,.product-fabric-option').forEach(input=>input.addEventListener('change',()=>renderVariantPricing()));
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
});
document.addEventListener('click',event=>{if(!event.target.closest('#adminNotificationPanel')&&!event.target.closest('#adminNotificationBtn'))q('#adminNotificationPanel')?.classList.remove('open');});

[
  ['#adminOrderSearch','input',renderOrders],['#adminOrderStatus','change',renderOrders],['#adminPaymentStatus','change',renderOrders],
  ['#adminProductSearch','input',()=>{adminProductPage=1;renderProducts();}],['#adminProductCategory','change',()=>{adminProductPage=1;renderProducts();}],['#adminProductStatus','change',()=>{adminProductPage=1;renderProducts();}],
  ['#adminCategorySearch','input',renderCategories],['#adminCategoryStatus','change',renderCategories],['#adminCategoryPlacement','change',renderCategories],
  ['#couponSearch','input',renderCoupons],['#couponStatus','change',renderCoupons],['#customerSearch','input',renderCustomers],['#customerRole','change',renderCustomers],
  ['#adminTicketSearch','input',renderTickets],['#adminTicketStatus','change',renderTickets],['#adminTicketPriority','change',renderTickets],
  ['#adminCustomSearch','input',renderCustom],['#adminCustomStatus','change',renderCustom]
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
q('#saveCustomChanges')?.addEventListener('click',()=>{
  const all=D.get('custom'),item=all.find(entry=>entry.id===activeCustom);if(!item)return;
  item.status=q('#modalCustomStatus').value;item.price=Number(q('#modalCustomPrice').value);item.adminNote=q('#modalCustomAdminNote').value.trim();D.set('custom',all);
  closeModals();renderAll();D.toast('درخواست طراحی به‌روزرسانی شد.');
});
q('#addCategoryBtn')?.addEventListener('click',()=>categoryModal());
q('#categoryName')?.addEventListener('input',event=>{
  const slug=q('#categorySlug');
  if(slug&&slug.dataset.manual!=='true')slug.value=normalizeCategorySlug(event.target.value);
});
q('#categorySlug')?.addEventListener('input',event=>{event.target.dataset.manual='true';});
q('#categorySlug')?.addEventListener('blur',event=>{event.target.value=normalizeCategorySlug(event.target.value);});
q('#categoryForm')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const id=Number(q('#categoryId').value||0);
  const payload={
    name:q('#categoryName').value.trim(),slug:normalizeCategorySlug(q('#categorySlug').value||q('#categoryName').value),
    sortOrder:Number(q('#categorySortOrder').value||0),status:q('#categoryStatus').value,
    image:q('#categoryImage').value.trim(),description:q('#categoryDescription').value.trim(),
    showInMenu:q('#categoryShowInMenu').checked,showInStore:q('#categoryShowInStore').checked,
    showInHome:q('#categoryShowInHome').checked,showInReady:q('#categoryShowInReady').checked,
    isReadyRoot:q('#categoryIsReadyRoot').checked
  };
  try{
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
});
q('#couponForm')?.addEventListener('submit',event=>{
  event.preventDefault();let all=D.get('coupons');const id=Number(q('#couponId').value)||Date.now(),old=all.find(coupon=>Number(coupon.id)===id);
  const minimum=Number(q('#couponMin').value||0);
  const applicability=q('#couponApplicability').value==='variants'?'variants':'all';
  const eligibleVariants=applicability==='variants'?selectedCouponVariants():[];
  if(!Number.isInteger(minimum)||minimum<0)return D.toast('حداقل مبلغ خرید باید عدد صحیح صفر یا بیشتر باشد.','error');
  if(applicability==='variants'&&!eligibleVariants.length)return D.toast('حداقل یک ترکیب سایز و جنس را انتخاب کنید.','error');
  const data={id,code:q('#couponCode').value.trim().toUpperCase(),type:q('#couponType').value,value:Number(q('#couponValue').value),min:minimum,applicability,eligibleVariants,limit:Number(q('#couponLimit').value||0),used:old?.used||0,expires:q('#couponExpires').value.trim(),status:q('#couponStatusField').value};
  const index=all.findIndex(coupon=>Number(coupon.id)===id);if(index>=0)all[index]=data;else all.unshift(data);D.set('coupons',all);closeModals();renderCoupons();event.target.reset();D.toast('کد تخفیف ذخیره شد.');
});
q('#refreshDashboard')?.addEventListener('click',()=>{D.syncFromApi('admin').then(()=>{renderAll();D.toast('اطلاعات داشبورد به‌روزرسانی شد.');}).catch(error=>D.toast(error.message,'error'));});
q('#createOrderBtn')?.addEventListener('click',async()=>{const customer=prompt('نام مشتری:');if(!customer)return;const phone=prompt('شماره تماس مشتری:');if(!phone)return;const productId=prompt('شناسه عددی محصول:','1');if(!productId)return;const qty=prompt('تعداد:','1');if(!qty)return;try{await window.CribAPI.request('/api/admin/orders/manual',{method:'POST',body:JSON.stringify({customer,phone,productId:Number(productId),qty:Number(qty),paymentStatus:'paid'})});await D.syncFromApi('admin');renderAll();D.toast('سفارش دستی ثبت شد.');}catch(error){D.toast(error.message,'error');}});
q('#adminGlobalSearch')?.addEventListener('keydown',event=>{if(event.key==='Enter'){const value=event.target.value.trim();if(!value)return;showView('orders');q('#adminOrderSearch').value=value;renderOrders();}});

document.addEventListener('click',async event=>{
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

    /*
    * رفتن به تب طرح‌های اختصاصی
    */
    showView('custom');

    /*
    * بازکردن مودال همان درخواست
    */
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
q('#exportOrdersBtn')?.addEventListener('click',()=>exportRows('orders',D.get('orders').map(order=>({order:order.id,customer:order.customer,phone:order.phone,date:order.date,subtotal:order.subtotal,coupon:order.couponCode||'',discount:order.discount,total:order.total,note:order.customerNote||'',status:labels[order.status],payment:labels[order.paymentStatus]||order.paymentStatus}))));
q('#exportProductsBtn')?.addEventListener('click',()=>exportRows('products',D.get('products').map(product=>({id:product.id,sku:product.sku,title:product.title,category:(product.categories||[product.category]).join(' | '),sizes:(product.sizes||[]).join(' | '),fabrics:(product.fabrics||[]).join(' | '),price:product.price,badge:product.badge,status:labels[product.status]}))));
q('#exportCategoriesBtn')?.addEventListener('click',()=>exportRows('categories',D.get('categories').map(category=>({id:category.id,name:category.name,slug:category.slug,sortOrder:category.sortOrder,status:labels[category.status]||category.status,placements:categoryPlacements(category).join(' | '),productCount:category.productCount||0}))));
q('#exportCustomersBtn')?.addEventListener('click',()=>exportRows('customers',D.get('users').map(user=>({id:user.id,name:user.name,phone:user.phone,email:user.email,orders:user.orders,total:user.total,role:user.role}))));
q('#exportCustomBtn')?.addEventListener('click',()=>exportRows('custom-designs',D.get('custom')));
q('#downloadFullReport')?.addEventListener('click',()=>exportRows('full-sales-report',D.get('orders').map(order=>({order:order.id,customer:order.customer,phone:order.phone,date:order.date,subtotal:order.subtotal,discount:order.discount,shipping:order.shipping,total:order.total,paymentStatus:labels[order.paymentStatus]||order.paymentStatus,status:labels[order.status]||order.status,includedInSales:order.paymentStatus==='paid'&&order.status!=='cancelled'?'بله':'خیر',coupon:order.couponCode||'',customerNote:order.customerNote||''}))));

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
