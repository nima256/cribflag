const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const Admin = require('../models/Admin');
const User = require('../models/User');
const { ensureLegacyCategories } = require('../services/categories');

const S=['۱۵۰ × ۹۰ سانتی‌متر','۱۰۰ × ۷۰ سانتی‌متر','۵۰ × ۷۰ سانتی‌متر'];
const F=['ساتن آمریکایی','ساتن براق','مخمل'];
const categorySets={
  5:['فلگ دیواری','دکور اتاق','مینیمال','طرح آماده'],
  6:['پرچم کشورها','طرح آماده'],
  8:['فلگ دیواری','دکور اتاق','برندینگ','طرح آماده'],
  9:['پرچم مناسبتی','طرح آماده']
};
const products=[
[1,'فلگ دیواری طرح دلخواه','CF-1001','فلگ دیواری',680000,790000,'سفارشی',12,4.9,'active',47,S,F,'فلگ دیواری با چاپ طرح دلخواه، مناسب اتاق، دکور، هدیه و فضای شخصی.'],
[2,'پرچم ایران مدل پریمیوم','CF-1002','پرچم ایران',420000,520000,'پرفروش',10,4.8,'active',89,S,F.slice(0,2),'پرچم ایران با چاپ شفاف و دوخت تمیز، مناسب دکور، مراسم و استفاده رسمی.'],
[3,'پرچم تشریفات ایران با پایه استیل','CF-1003','پرچم تشریفات',1280000,1550000,'ویژه',9,4.7,'active',21,S.slice(0,2),['ساتن آمریکایی','مخمل'],'پرچم تشریفات رسمی با ظاهر لوکس و پایه استیل.'],
[4,'پرچم رومیزی با چاپ لوگوی اختصاصی','CF-1004','پرچم رومیزی',245000,320000,'تخفیف',7,4.6,'active',63,[S[2]],F.slice(0,2),'پرچم رومیزی مناسب میز مدیریت و برندینگ سازمانی.'],
[5,'فلگ مینیمال مناسب اتاق','CF-1005','فلگ دیواری',590000,690000,'جدید',13,4.8,'active',36,S,F,'فلگ دیواری با طراحی مینیمال.'],
[6,'پرچم کشورهای جهان مدل رومیزی','CF-1006','پرچم کشورها',330000,410000,'محبوب',6,4.5,'active',52,[S[2]],F.slice(0,2),'پرچم کشورهای مختلف در ابعاد رومیزی.'],
[7,'پرچم ساحلی تبلیغاتی برای کمپین','CF-1007','پرچم ساحلی',980000,1200000,'کمپین',5,4.6,'active',17,S.slice(0,2),F.slice(0,2),'پرچم ساحلی مناسب تبلیغات و نمایشگاه.'],
[8,'فلگ گرافیکی مناسب دکور','CF-1008','فلگ دیواری',640000,760000,'خاص',11,4.7,'active',31,S,F,'فلگ گرافیکی با چاپ شفاف.'],
[9,'پرچم مناسبتی با چاپ باکیفیت','CF-1009','پرچم مناسبتی',520000,640000,'سریع',4,4.4,'active',28,S,F.slice(0,2),'پرچم مناسبتی برای رویدادها و مراسم.'],
[10,'سفارش عمده فلگ با طرح اختصاصی','CF-1010','سفارش عمده',1850000,2200000,'عمده',8,4.9,'active',14,S,F,'پکیج سفارش عمده فلگ.'],
[11,'پرچم رومیزی مدیریتی دوخت تمیز','CF-1011','پرچم رومیزی',310000,390000,'اداری',3,4.5,'active',44,[S[2]],F.slice(0,2),'پرچم رومیزی اداری.'],
[12,'پرچم کشورهای اروپایی مدل اداری','CF-1012','پرچم کشورها',760000,910000,'برندینگ',14,4.8,'draft',19,S.slice(1),F,'چاپ فلگ با لوگو و طرح اختصاصی.']
].map(x=>({publicId:x[0],title:x[1],sku:x[2],category:x[3],categories:categorySets[x[0]]||[x[3]],price:x[4],oldPrice:x[5],hasDiscount:x[5]>x[4],badge:x[6],sortDate:x[7],rate:x[8],status:x[9],sales:x[10],sizes:x[11],fabrics:x[12],description:x[13],stock:999,image:'assets/images/ukflag.png'}));

async function run(){
 await mongoose.connect(env.mongodbUri);
 for(const p of products)await Product.findOneAndUpdate({publicId:p.publicId},{$set:p},{upsert:true,setDefaultsOnInsert:true});
 await ensureLegacyCategories();
 const coupons=[{publicId:1,code:'CRIB10',type:'percent',value:10,minOrderAmount:500000,usageLimit:100,usedCount:0,displayExpires:'۱۴۰۶/۱۲/۲۹',status:'active'},{publicId:2,code:'WELCOME',type:'fixed',value:100000,minOrderAmount:1000000,usageLimit:50,usedCount:0,displayExpires:'۱۴۰۶/۱۲/۲۹',status:'active'}];
 for(const c of coupons)await Coupon.findOneAndUpdate({publicId:c.publicId},{$set:c},{upsert:true,setDefaultsOnInsert:true});
 await Admin.findOneAndUpdate({email:env.adminEmail.toLowerCase()},{$set:{fullName:'مدیر Crib Flag',email:env.adminEmail.toLowerCase(),mobile:env.adminMobile,password:await bcrypt.hash(env.adminPassword,12),role:'superadmin',permissions:['*'],isActive:true}},{upsert:true,setDefaultsOnInsert:true});
 await User.findOneAndUpdate({mobile:'09121234567'},{$setOnInsert:{publicId:1,fullName:'کاربر تست',mobile:'09121234567',email:'user@cribflag.local',password:await bcrypt.hash('User123!',12),role:'customer',wishlist:[2,5,7]}},{upsert:true,setDefaultsOnInsert:true});
 console.log('Seed completed.');console.log(`Admin: ${env.adminEmail} / ${env.adminPassword}`);console.log('Test user: 09121234567 / User123!');await mongoose.disconnect();
}
run().catch(e=>{console.error(e);process.exit(1)});
