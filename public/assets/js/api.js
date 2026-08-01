(function(){
  'use strict';
  // انتشار با API روی دامنه جدا: مقدار زیر را از کامنت خارج و دامنه را جایگزین کنید.
  // const API_BASE_URL = 'https://api.your-domain.ir';
  const API_BASE_URL = '';
  async function request(path, options={}){
    const headers={...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.headers||{})};
    const response=await fetch(`${API_BASE_URL}${path}`,{credentials:'include',...options,headers});
    const data=await response.json().catch(()=>({success:false,message:'پاسخ نامعتبر از سرور'}));
    if(!response.ok||data.success===false){const error=new Error(data.message||'خطا در ارتباط با سرور');error.status=response.status;error.data=data;throw error;}
    return data;
  }
  function adminLoginDialog(){return new Promise((resolve,reject)=>{
    let layer=document.getElementById('cribAdminLogin');if(layer)layer.remove();layer=document.createElement('div');layer.id='cribAdminLogin';layer.style.cssText='position:fixed;inset:0;z-index:99999;background:#0f172aeF;display:grid;place-items:center;padding:20px;direction:rtl';layer.innerHTML=`<form style="width:min(420px,100%);background:white;padding:28px;border-radius:18px;display:grid;gap:14px"><h2 style="margin:0">ورود مدیر</h2><p style="margin:0;color:#64748b">برای دسترسی به پنل مدیریت وارد شوید.</p><input name="email" type="email" placeholder="ایمیل مدیر" autocomplete="username" required style="padding:12px;border:1px solid #cbd5e1;border-radius:10px"><input name="password" type="password" placeholder="رمز عبور" autocomplete="current-password" required style="padding:12px;border:1px solid #cbd5e1;border-radius:10px"><button style="padding:12px;border:0;border-radius:10px;background:#111827;color:white;cursor:pointer">ورود</button><small class="err" style="color:#dc2626"></small></form>`;document.body.appendChild(layer);layer.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{await request('/api/admin/login',{method:'POST',body:JSON.stringify(Object.fromEntries(fd))});layer.remove();resolve();}catch(err){layer.querySelector('.err').textContent=err.message;}});});}
  window.CribAPI={request,adminLoginDialog};
})();
