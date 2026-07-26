(function(){
  'use strict';

  const PRODUCT_IMAGE='/assets/images/ukflag.png';
  const DEFAULT_SIZES=['۱۵۰ × ۹۰ سانتی‌متر','۱۰۰ × ۷۰ سانتی‌متر','۵۰ × ۷۰ سانتی‌متر'];
  const DEFAULT_FABRICS=['ساتن آمریکایی','ساتن براق','مخمل'];
  const KEYS={
    products:'cribFlagProducts',categories:'cribFlagCategories',orders:'cribFlagOrders',users:'cribFlagUsers',coupons:'cribFlagCoupons',tickets:'cribFlagTickets',
    addresses:'cribFlagAddresses',notifications:'cribFlagNotifications',custom:'cribFlagCustomRequests',wishlist:'cribFlagWishlist',session:'cribFlagSession',analytics:'cribFlagAnalytics'
  };

  const products=[
    {id:1,title:'فلگ دیواری طرح دلخواه',sku:'CF-1001',category:'فلگ دیواری',price:680000,old:790000,badge:'سفارشی',date:12,rate:4.9,status:'active',sales:47,sizes:DEFAULT_SIZES,fabrics:DEFAULT_FABRICS,image:PRODUCT_IMAGE,description:'فلگ دیواری با چاپ طرح دلخواه، مناسب اتاق، دکور، هدیه و فضای شخصی.'},
    {id:2,title:'پرچم ایران مدل پریمیوم',sku:'CF-1002',category:'پرچم ایران',price:420000,old:520000,badge:'پرفروش',date:10,rate:4.8,status:'active',sales:89,sizes:DEFAULT_SIZES,fabrics:['ساتن آمریکایی','ساتن براق'],image:PRODUCT_IMAGE,description:'پرچم ایران با چاپ شفاف و دوخت تمیز، مناسب دکور، مراسم و استفاده رسمی.'},
    {id:3,title:'پرچم تشریفات ایران با پایه استیل',sku:'CF-1003',category:'پرچم تشریفات',price:1280000,old:1550000,badge:'ویژه',date:9,rate:4.7,status:'active',sales:21,sizes:['۱۵۰ × ۹۰ سانتی‌متر','۱۰۰ × ۷۰ سانتی‌متر'],fabrics:['ساتن آمریکایی','مخمل'],image:PRODUCT_IMAGE,description:'پرچم تشریفات رسمی با ظاهر لوکس و پایه استیل، مناسب شرکت‌ها، دفاتر و سالن‌های رسمی.'},
    {id:4,title:'پرچم رومیزی با چاپ لوگوی اختصاصی',sku:'CF-1004',category:'پرچم رومیزی',price:245000,old:320000,badge:'تخفیف',date:7,rate:4.6,status:'active',sales:63,sizes:['۵۰ × ۷۰ سانتی‌متر'],fabrics:['ساتن آمریکایی','ساتن براق'],image:PRODUCT_IMAGE,description:'پرچم رومیزی مناسب میز مدیریت، شرکت، نمایشگاه و برندینگ سازمانی.'},
    {id:5,title:'فلگ مینیمال مناسب اتاق',sku:'CF-1005',category:'فلگ دیواری',price:590000,old:690000,badge:'جدید',date:13,rate:4.8,status:'active',sales:36,sizes:DEFAULT_SIZES,fabrics:DEFAULT_FABRICS,image:PRODUCT_IMAGE,description:'فلگ دیواری با طراحی مینیمال، مناسب اتاق‌های مدرن و دکورهای ساده.'},
    {id:6,title:'پرچم کشورهای جهان مدل رومیزی',sku:'CF-1006',category:'پرچم کشورها',price:330000,old:410000,badge:'محبوب',date:6,rate:4.5,status:'active',sales:52,sizes:['۵۰ × ۷۰ سانتی‌متر'],fabrics:['ساتن آمریکایی','ساتن براق'],image:PRODUCT_IMAGE,description:'پرچم کشورهای مختلف در ابعاد رومیزی، مناسب کلکسیون، اداره، آموزشگاه و میز کار.'},
    {id:7,title:'پرچم ساحلی تبلیغاتی برای کمپین',sku:'CF-1007',category:'پرچم ساحلی',price:980000,old:1200000,badge:'کمپین',date:5,rate:4.6,status:'active',sales:17,sizes:['۱۵۰ × ۹۰ سانتی‌متر','۱۰۰ × ۷۰ سانتی‌متر'],fabrics:['ساتن آمریکایی','ساتن براق'],image:PRODUCT_IMAGE,description:'پرچم ساحلی مناسب تبلیغات، ورودی فروشگاه، نمایشگاه و کمپین‌های محیطی.'},
    {id:8,title:'فلگ گرافیکی مناسب دکور',sku:'CF-1008',category:'فلگ دیواری',price:640000,old:760000,badge:'خاص',date:11,rate:4.7,status:'active',sales:31,sizes:DEFAULT_SIZES,fabrics:DEFAULT_FABRICS,image:PRODUCT_IMAGE,description:'فلگ گرافیکی با چاپ شفاف، مناسب دکورهای خاص و فضاهای شخصی.'},
    {id:9,title:'پرچم مناسبتی با چاپ باکیفیت',sku:'CF-1009',category:'پرچم مناسبتی',price:520000,old:640000,badge:'سریع',date:4,rate:4.4,status:'active',sales:28,sizes:DEFAULT_SIZES,fabrics:['ساتن آمریکایی','ساتن براق'],image:PRODUCT_IMAGE,description:'پرچم مناسبتی برای رویدادها، مراسم، هیئت‌ها و مناسبت‌های خاص با چاپ تمیز.'},
    {id:10,title:'سفارش عمده فلگ با طرح اختصاصی',sku:'CF-1010',category:'سفارش عمده',price:1850000,old:2200000,badge:'عمده',date:8,rate:4.9,status:'active',sales:14,sizes:DEFAULT_SIZES,fabrics:DEFAULT_FABRICS,image:PRODUCT_IMAGE,description:'پکیج سفارش عمده فلگ برای فروشگاه‌ها، برندها، کمپین‌ها و رویدادهای بزرگ.'},
    {id:11,title:'پرچم رومیزی مدیریتی دوخت تمیز',sku:'CF-1011',category:'پرچم رومیزی',price:310000,old:390000,badge:'اداری',date:3,rate:4.5,status:'active',sales:44,sizes:['۵۰ × ۷۰ سانتی‌متر'],fabrics:['ساتن آمریکایی','ساتن براق'],image:PRODUCT_IMAGE,description:'پرچم رومیزی اداری با دوخت تمیز و ظاهر رسمی، مناسب میز مدیریت و جلسات.'},
    {id:12,title:'پرچم کشورهای اروپایی مدل اداری',sku:'CF-1012',category:'پرچم کشورها',price:760000,old:910000,badge:'برندینگ',date:14,rate:4.8,status:'draft',sales:19,sizes:['۱۰۰ × ۷۰ سانتی‌متر','۵۰ × ۷۰ سانتی‌متر'],fabrics:DEFAULT_FABRICS,image:PRODUCT_IMAGE,description:'چاپ فلگ با لوگو و طرح اختصاصی برای برندها و کسب‌وکارها.'}
  ];

  const fallbackCategorySets={
    5:['فلگ دیواری','دکور اتاق','مینیمال','طرح آماده'],
    6:['پرچم کشورها','طرح آماده'],
    8:['فلگ دیواری','دکور اتاق','برندینگ','طرح آماده'],
    9:['پرچم مناسبتی','طرح آماده']
  };
  products.forEach(item=>{item.categories=fallbackCategorySets[item.id]||[item.category];item.category=item.categories[0];});

  const users=[
    {id:1,name:'مهدی احمدی',phone:'09121234567',email:'mehdi@example.com',joined:'۱۴۰۵/۰۳/۱۲',orders:4,total:4380000,role:'customer'},
    {id:2,name:'سارا کریمی',phone:'09351234567',email:'sara@example.com',joined:'۱۴۰۵/۰۲/۲۸',orders:7,total:7960000,role:'customer'},
    {id:3,name:'علی محمدی',phone:'09192224455',email:'ali@example.com',joined:'۱۴۰۵/۰۲/۰۱',orders:2,total:1290000,role:'customer'},
    {id:4,name:'شرکت آفتاب',phone:'02188776655',email:'order@aftab.co',joined:'۱۴۰۵/۰۱/۲۲',orders:5,total:12200000,role:'business'},
    {id:5,name:'نازنین رضایی',phone:'09911223344',email:'nazanin@example.com',joined:'۱۴۰۴/۱۲/۲۰',orders:1,total:680000,role:'customer'},
    {id:6,name:'فروشگاه آرمان',phone:'02632221100',email:'arman@shop.ir',joined:'۱۴۰۴/۱۱/۰۹',orders:11,total:19800000,role:'business'}
  ];

  const orders=[
    {id:'KR-84621',userId:1,customer:'مهدی احمدی',phone:'09121234567',email:'mehdi@example.com',date:'۱۴۰۵/۰۴/۲۳',createdAt:'2026-07-14T08:15:00',total:1445000,subtotal:1360000,shipping:85000,discount:0,status:'processing',payment:'پرداخت آنلاین',paymentStatus:'paid',shippingMethod:'تیپاکس',tracking:'',address:'تهران، سعادت‌آباد، خیابان نمونه، پلاک ۱۲',items:[{id:1,title:'فلگ دیواری طرح دلخواه',price:680000,qty:2,size:'۱۵۰ × ۹۰ سانتی‌متر',fabric:'ساتن آمریکایی'}]},
    {id:'KR-73108',userId:2,customer:'سارا کریمی',phone:'09351234567',email:'sara@example.com',date:'۱۴۰۵/۰۴/۲۲',createdAt:'2026-07-13T13:40:00',total:1065000,subtotal:980000,shipping:85000,discount:0,status:'shipped',payment:'پرداخت آنلاین',paymentStatus:'paid',shippingMethod:'تیپاکس',tracking:'TIP-98217452',address:'کرج، عظیمیه، میدان مهران، پلاک ۸',items:[{id:7,title:'پرچم ساحلی تبلیغاتی برای کمپین',price:980000,qty:1,size:'۱۵۰ × ۹۰ سانتی‌متر',fabric:'ساتن براق'}]},
    {id:'KR-62819',userId:4,customer:'شرکت آفتاب',phone:'02188776655',email:'order@aftab.co',date:'۱۴۰۵/۰۴/۲۱',createdAt:'2026-07-12T09:20:00',total:3785000,subtotal:3700000,shipping:85000,discount:0,status:'design-review',payment:'کارت به کارت',paymentStatus:'review',shippingMethod:'تیپاکس',tracking:'',address:'تهران، میرداماد، برج آفتاب، طبقه ۴',items:[{id:10,title:'سفارش عمده فلگ با طرح اختصاصی',price:1850000,qty:2,size:'۱۰۰ × ۷۰ سانتی‌متر',fabric:'مخمل'}]},
    {id:'KR-54177',userId:1,customer:'مهدی احمدی',phone:'09121234567',email:'mehdi@example.com',date:'۱۴۰۵/۰۴/۱۸',createdAt:'2026-07-09T17:10:00',total:765000,subtotal:680000,shipping:85000,discount:0,status:'delivered',payment:'پرداخت آنلاین',paymentStatus:'paid',shippingMethod:'تیپاکس',tracking:'TIP-55120430',address:'تهران، سعادت‌آباد، خیابان نمونه، پلاک ۱۲',items:[{id:1,title:'فلگ دیواری طرح دلخواه',price:680000,qty:1,size:'۱۰۰ × ۷۰ سانتی‌متر',fabric:'ساتن آمریکایی'}]},
    {id:'KR-43802',userId:3,customer:'علی محمدی',phone:'09192224455',email:'ali@example.com',date:'۱۴۰۵/۰۴/۱۶',createdAt:'2026-07-07T11:30:00',total:815000,subtotal:760000,shipping:85000,discount:30000,status:'cancelled',payment:'پرداخت آنلاین',paymentStatus:'refunded',shippingMethod:'تیپاکس',tracking:'',address:'قم، بلوار امین، کوچه ۱۰، پلاک ۲',items:[{id:12,title:'پرچم کشورهای اروپایی مدل اداری',price:760000,qty:1,size:'۱۰۰ × ۷۰ سانتی‌متر',fabric:'مخمل'}]}
  ];

  const coupons=[
    {id:1,code:'CRIB10',type:'percent',value:10,min:500000,limit:100,used:24,expires:'۱۴۰۵/۰۵/۳۱',status:'active'},
    {id:2,code:'WELCOME',type:'fixed',value:100000,min:1000000,limit:50,used:16,expires:'۱۴۰۵/۰۴/۳۱',status:'active'},
    {id:3,code:'VIP20',type:'percent',value:20,min:2000000,limit:20,used:20,expires:'۱۴۰۵/۰۳/۳۱',status:'expired'}
  ];

  const tickets=[
    {id:'TK-1042',userId:1,customer:'مهدی احمدی',subject:'پیگیری وضعیت سفارش KR-84621',department:'سفارش‌ها',priority:'normal',status:'open',date:'۱۴۰۵/۰۴/۲۳',messages:[{from:'user',text:'سلام، لطفاً زمان آماده شدن سفارشم را اعلام کنید.',date:'۱۴۰۵/۰۴/۲۳ - ۱۰:۲۵'}]},
    {id:'TK-1038',userId:2,customer:'سارا کریمی',subject:'ثبت کد رهگیری',department:'ارسال',priority:'high',status:'answered',date:'۱۴۰۵/۰۴/۲۲',messages:[{from:'user',text:'کد رهگیری هنوز برای من پیامک نشده است.',date:'۱۴۰۵/۰۴/۲۲ - ۱۳:۱۰'},{from:'admin',text:'کد رهگیری در پنل شما ثبت شد و مرسوله تحویل تیپاکس شده است.',date:'۱۴۰۵/۰۴/۲۲ - ۱۵:۳۰'}]},
    {id:'TK-1029',userId:4,customer:'شرکت آفتاب',subject:'اصلاح اندازه لوگو',department:'طراحی',priority:'high',status:'open',date:'۱۴۰۵/۰۴/۲۱',messages:[{from:'user',text:'لطفاً اندازه و محل لوگو دقیقاً مطابق فایل راهنمای برند باشد.',date:'۱۴۰۵/۰۴/۲۱ - ۰۹:۴۵'}]}
  ];

  const addresses=[
    {id:1,userId:1,title:'خانه',receiver:'مهدی احمدی',phone:'09121234567',province:'تهران',city:'تهران',postal:'1999912345',address:'سعادت‌آباد، خیابان نمونه، کوچه یاس، پلاک ۱۲، واحد ۵',default:true},
    {id:2,userId:1,title:'محل کار',receiver:'مهدی احمدی',phone:'09121234567',province:'تهران',city:'تهران',postal:'1587712345',address:'میدان هفت تیر، خیابان مفتح، ساختمان ۲۴، طبقه ۳',default:false}
  ];

  const notifications=[
    {id:1,userId:1,title:'سفارش در حال آماده‌سازی است',text:'سفارش KR-84621 وارد مرحله چاپ و آماده‌سازی شد.',date:'امروز، ۱۰:۳۰',read:false},
    {id:2,userId:1,title:'پاسخ پشتیبانی',text:'درخواست پیگیری سفارش شما دریافت شد.',date:'امروز، ۱۰:۲۶',read:false},
    {id:3,userId:1,title:'کد تخفیف ویژه',text:'کد CRIB10 تا پایان ماه برای سفارش بعدی شما فعال است.',date:'دیروز، ۱۸:۰۰',read:true}
  ];

  const custom=[
    {id:'DS-2104',userId:1,customer:'مهدی احمدی',fileName:'room-design.png',size:'۱۵۰ × ۹۰ سانتی‌متر',fabric:'ساتن آمریکایی',notes:'پس‌زمینه کمی تیره‌تر شود.',status:'preview-ready',price:680000,date:'۱۴۰۵/۰۴/۲۳'},
    {id:'DS-2097',userId:4,customer:'شرکت آفتاب',fileName:'aftab-logo-final.pdf',size:'۱۰۰ × ۷۰ سانتی‌متر',fabric:'ساتن براق',notes:'اندازه و محل لوگو مطابق راهنمای برند باشد.',status:'review',price:1850000,date:'۱۴۰۵/۰۴/۲۱'}
  ];

  function read(key,fallback){
    try{const value=JSON.parse(localStorage.getItem(key));return value===null?fallback:value;}catch{return fallback;}
  }
  let suppressPersist=false;
  function write(key,value){localStorage.setItem(key,JSON.stringify(value));return value;}
  async function persist(name,value){
    if(suppressPersist||!window.CribAPI)return;
    const scope=document.body?.dataset?.portal;
    if(!['admin','account'].includes(scope))return;
    try{await window.CribAPI.request(`/api/${scope}/sync/${encodeURIComponent(name)}`,{method:'PUT',body:JSON.stringify({value})});}
    catch(error){toast(error.message||'ذخیره در سرور انجام نشد.','error');}
  }
  async function syncFromApi(scope=document.body?.dataset?.portal){
    if(!scope||!window.CribAPI)return null;
    const load=()=>window.CribAPI.request(`/api/${scope}/bootstrap`);
    let data;
    try{data=await load();}
    catch(error){
      if(scope==='admin'&&error.status===401){await window.CribAPI.adminLoginDialog();data=await load();}
      else throw error;
    }
    // سازگاری با حالتی که فایل frontend جدید روی backend قدیمی‌تر deploy شده
    // و پاسخ bootstrap هنوز فیلد categories را برنمی‌گرداند.
    if(scope==='admin'&&!Array.isArray(data?.categories)){
      const categoryResponse=await window.CribAPI.request('/api/admin/categories');
      data={...data,categories:Array.isArray(categoryResponse?.categories)?categoryResponse.categories:[]};
    }
    suppressPersist=true;
    try{for(const name of Object.keys(KEYS)){if(Object.prototype.hasOwnProperty.call(data,name))set(name,data[name]);}}finally{suppressPersist=false;}
    return data;
  }
  function normalizeProducts(list){
    return (Array.isArray(list)?list:products).map((item,index)=>{
      const next={...item};
      delete next.stock;
      delete next.color;
      delete next.imageName;
      next.id=Number(next.id||index+1);
      next.price=Number(next.price||0);
      next.categories=[...new Set([next.category,...(Array.isArray(next.categories)?next.categories:[])].map(category=>String(category||'').trim()).filter(Boolean))];
      next.category=next.categories[0]||'';
      const legacyDiscount=next.hasDiscount===undefined&&Number(next.old)>next.price;
      next.hasDiscount=Boolean((next.hasDiscount||legacyDiscount)&&Number(next.old)>next.price);
      next.old=next.hasDiscount?Number(next.old):null;
      next.sizes=Array.isArray(next.sizes)&&next.sizes.length?next.sizes:[...DEFAULT_SIZES];
      next.fabrics=Array.isArray(next.fabrics)&&next.fabrics.length?next.fabrics:[...DEFAULT_FABRICS];
      next.variantPrices=Array.isArray(next.variantPrices)?next.variantPrices.map(variant=>({
        size:String(variant.size||''),fabric:String(variant.fabric||''),price:Number(variant.price||0),
        hasDiscount:Boolean(next.hasDiscount&&Number(variant.oldPrice??variant.old)>Number(variant.price)),
        oldPrice:next.hasDiscount&&Number(variant.oldPrice??variant.old)>Number(variant.price)?Number(variant.oldPrice??variant.old):null
      })).filter(variant=>variant.size&&variant.fabric):[];
      const rawImages=Array.isArray(next.images)&&next.images.length?next.images:[next.image];
      next.images=[...new Set(rawImages.map(image=>String(image||'').trim()).filter(Boolean))];
      if(!next.images.length)next.images=[PRODUCT_IMAGE];
      next.image=next.images[0];
      next.badge=next.badge||'';
      return next;
    });
  }
  function normalizeUsers(list){return (Array.isArray(list)?list:users).map(item=>({...item}));}
  const ADMIN_SERVER_COLLECTIONS=['products','categories','orders','users','coupons','tickets','custom','notifications'];
  function clearServerData(){
    for(const name of ADMIN_SERVER_COLLECTIONS)write(KEYS[name],[]);
    write(KEYS.analytics,{});
  }
  function ensure(){
    /*
     * پنل مدیریت باید فقط از API و دیتابیس تغذیه شود.
     * داده‌های نمونه قبلی و localStorage قدیمی در صفحه admin پاک می‌شوند
     * تا هنگام خطای API، اطلاعات ساختگی نمایش داده نشود.
     */
    if(document.body?.dataset?.portal==='admin'){
      clearServerData();
      if(!localStorage.getItem(KEYS.session))write(KEYS.session,{userId:null,name:'',loggedIn:false});
      localStorage.removeItem('cribFlagSettings');
      return;
    }

    write(KEYS.products,normalizeProducts(read(KEYS.products,products)));
    if(!localStorage.getItem(KEYS.orders))write(KEYS.orders,orders);
    write(KEYS.users,normalizeUsers(read(KEYS.users,users)));
    if(!localStorage.getItem(KEYS.coupons))write(KEYS.coupons,coupons);
    if(!localStorage.getItem(KEYS.tickets))write(KEYS.tickets,tickets);
    if(!localStorage.getItem(KEYS.addresses))write(KEYS.addresses,addresses);
    if(!localStorage.getItem(KEYS.notifications))write(KEYS.notifications,notifications);
    if(!localStorage.getItem(KEYS.custom))write(KEYS.custom,custom);
    if(!localStorage.getItem(KEYS.wishlist))write(KEYS.wishlist,[2,5,7]);
    if(!localStorage.getItem(KEYS.session))write(KEYS.session,{userId:null,name:'',loggedIn:false});
    if(!localStorage.getItem(KEYS.analytics))write(KEYS.analytics,{});
    localStorage.removeItem('cribFlagSettings');
  }
  function uid(prefix='ID'){return `${prefix}-${Math.floor(10000+Math.random()*89999)}`;}
  function fa(n){return new Intl.NumberFormat('fa-IR').format(Number(n||0));}
  function toman(n){return `${fa(n)} تومان`;}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function get(name){return read(KEYS[name],['products','categories','orders','users','coupons','tickets','addresses','notifications','custom','wishlist'].includes(name)?[]:{});}
  function set(name,value){
    if(name==='products')value=normalizeProducts(value);
    if(name==='users')value=normalizeUsers(value);
    const result=write(KEYS[name],value);
    if(name!=='analytics')persist(name,result);
    return result;
  }
  function toast(message,type='success'){
    let box=document.getElementById('portalToast');
    if(!box){box=document.createElement('div');box.id='portalToast';box.className='portal-toast';document.body.appendChild(box);}
    box.textContent=message;box.dataset.type=type;box.classList.add('show');clearTimeout(window.__portalToast);window.__portalToast=setTimeout(()=>box.classList.remove('show'),2600);
  }
  function downloadCSV(filename,rows){
    if(!rows.length)return toast('داده‌ای برای خروجی وجود ندارد.','error');
    const headers=Object.keys(rows[0]);const q=v=>`"${String(v??'').replaceAll('"','""')}"`;
    const csv='\uFEFF'+[headers.map(q).join(','),...rows.map(r=>headers.map(h=>q(r[h])).join(','))].join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=filename;a.click();URL.revokeObjectURL(a.href);
  }

  ensure();
  window.CribData={
    KEYS,read,write,get,set,ensure,clearServerData,syncFromApi,persist,uid,fa,toman,esc,toast,downloadCSV,
    PRODUCT_IMAGE,DEFAULT_SIZES,DEFAULT_FABRICS,
    defaults:{products,orders,users,coupons,tickets,addresses,notifications,custom,analytics:{}}
  };
})();
