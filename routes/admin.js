const express = require('express');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const Order = require('../models/Order');
const Ticket = require('../models/Ticket');
const CustomRequest = require('../models/CustomRequest');
const Notification = require('../models/Notification');
const RecentAction = require('../models/RecentAction');
const { requireAdmin } = require('../middlewares/auth');
const { asyncHandler, ok, AppError } = require('../utils/http');
const S = require('../services/serializers');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { prepareProductPricing, findVariantPricing, fallbackPricing } = require('../utils/productPricing');
const upload = require('../middlewares/upload');


async function generateUniqueSku() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const sku = `CF-${crypto.randomInt(100000, 1000000)}`;
    if (!(await Product.exists({ sku }))) return sku;
  }
  return `CF-${Date.now().toString().slice(-9)}`;
}

function selectedProductOption(product, value, field) {
  const options = Array.isArray(product[field]) ? product[field] : [];
  const selected = String(value || options[0] || '').trim();
  if (options.length && !options.includes(selected)) {
    throw new AppError(400, `${field === 'sizes' ? 'سایز' : 'جنس پارچه'} انتخاب‌شده معتبر نیست`);
  }
  return selected;
}

router.post('/login',asyncHandler(async(req,res)=>{const admin=await Admin.findOne({email:String(req.body.email||'').toLowerCase()}).select('+password');if(!admin||!admin.isActive||!(await admin.comparePassword(req.body.password||'')))throw new AppError(401,'ایمیل یا رمز عبور اشتباه است');admin.lastLoginAt=new Date();admin.lastLoginIP=req.ip;await admin.save();req.session.adminId=admin._id.toString();await RecentAction.create({action:'admin_login',targetType:'admin',targetId:String(admin._id),targetName:admin.fullName,adminId:admin._id,adminName:admin.fullName,ipAddress:req.ip});ok(res,{admin:{fullName:admin.fullName,email:admin.email,role:admin.role,permissions:admin.permissions}});}));
router.post('/logout',requireAdmin,asyncHandler(async(req,res)=>{const id=req.session.adminId;await RecentAction.create({action:'admin_logout',targetType:'admin',targetId:id,adminId:id,ipAddress:req.ip});delete req.session.adminId;await new Promise((resolve,reject)=>req.session.save(err=>err?reject(err):resolve()));ok(res,{message:'خارج شدید'});}));
router.use(requireAdmin);

router.post('/products/upload-image', upload.fields([
  { name: 'images', maxCount: 12 },
  { name: 'image', maxCount: 1 }
]), asyncHandler(async (req, res) => {
  const files = [...(req.files?.images || []), ...(req.files?.image || [])];
  if (!files.length) throw new AppError(400, 'حداقل یک تصویر محصول انتخاب کنید');

  const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const invalid = files.find(file => !allowedImageTypes.has(file.mimetype));
  if (invalid) {
    await Promise.all(files.map(file => fs.promises.unlink(file.path).catch(() => {})));
    throw new AppError(400, 'فقط تصویر PNG، JPG یا WEBP مجاز است');
  }

  const images = files.map(file => `/uploads/${file.filename}`);
  ok(res, {
    message: `${images.length} تصویر محصول آپلود شد`,
    image: images[0],
    images
  }, 201);
}));

router.get(
  '/custom/:publicId/download',
  asyncHandler(async (req, res) => {
    const customRequest = await CustomRequest.findOne({
      publicId: req.params.publicId
    }).lean();

    if (!customRequest) {
      throw new AppError(404, 'درخواست طراحی پیدا نشد');
    }

    if (!customRequest.filePath) {
      throw new AppError(404, 'مسیر فایل برای این درخواست ثبت نشده است');
    }

    const uploadsDirectory = path.resolve(
      __dirname,
      '..',
      'uploads'
    );

    const absoluteFilePath = path.resolve(
      customRequest.filePath
    );

    /*
     * جلوگیری از دسترسی به فایل‌های بیرون از uploads
     */
    if (
      absoluteFilePath !== uploadsDirectory &&
      !absoluteFilePath.startsWith(`${uploadsDirectory}${path.sep}`)
    ) {
      throw new AppError(403, 'مسیر فایل معتبر نیست');
    }

    if (!fs.existsSync(absoluteFilePath)) {
      throw new AppError(404, 'فایل روی سرور پیدا نشد');
    }

    return res.download(
      absoluteFilePath,
      customRequest.fileName || path.basename(absoluteFilePath)
    );
  })
);

async function getBootstrap(){
  const [products,orders,users,coupons,tickets,custom]=await Promise.all([Product.find().sort({publicId:1}).lean(),Order.find().populate('user').sort({createdAt:-1}).lean(),User.find().sort({publicId:1}).lean(),Coupon.find().sort({publicId:1}).lean(),Ticket.find().populate('user').sort({createdAt:-1}).lean(),CustomRequest.find().populate('user').sort({createdAt:-1}).lean()]);
  const userStats={};for(const o of orders){const id=o.user?.publicId;if(id){userStats[id]??={orders:0,total:0};userStats[id].orders++;if(o.status!=='cancelled')userStats[id].total+=Number(o.total||0);}}
  return {products:products.map(S.product),orders:orders.map(S.order),users:users.map(u=>S.user(u,userStats[u.publicId]||{})),coupons:coupons.map(S.coupon),tickets:tickets.map(S.ticket),custom:custom.map(S.custom),notifications:[]};
}
router.get('/bootstrap',asyncHandler(async(_req,res)=>ok(res,await getBootstrap())));
router.post('/orders/manual',asyncHandler(async(req,res)=>{
  const product = await Product.findOne({ publicId: Number(req.body.productId), status: 'active' });
  if (!product) throw new AppError(404, 'محصول یافت نشد');
  const qty = Math.max(1, Math.min(100, Number(req.body.qty || 1)));
  if (product.stock < qty) throw new AppError(400, 'موجودی محصول کافی نیست');

  const size = selectedProductOption(product, req.body.size, 'sizes');
  const fabric = selectedProductOption(product, req.body.fabric, 'fabrics');
  const variant = findVariantPricing(product, size, fabric);
  if (product.variantPrices?.length && !variant) throw new AppError(400, 'برای ترکیب سایز و جنس انتخاب‌شده قیمت ثبت نشده است');
  const pricing = variant || fallbackPricing(product);

  const { orderNumber } = require('../utils/formatters');
  const shipping = Number(req.body.shipping || 0);
  const subtotal = pricing.price * qty;
  const order = await Order.create({
    orderNumber: orderNumber(),
    customer: req.body.customer || 'مشتری حضوری',
    phone: req.body.phone || '00000000000',
    email: req.body.email || '',
    address: req.body.address || 'ثبت توسط مدیر',
    items: [{ productId: product.publicId, title: product.title, category: product.category, price: pricing.price, qty, size, fabric }],
    subtotal,
    shipping,
    discount: 0,
    total: subtotal + shipping,
    status: 'processing',
    payment: 'ثبت دستی مدیر',
    paymentStatus: req.body.paymentStatus === 'paid' ? 'paid' : 'review',
    shippingMethod: req.body.shippingMethod || 'تحویل حضوری',
    inventoryApplied: true
  });
  product.stock -= qty;
  product.sales += qty;
  await product.save();
  ok(res, { message: 'سفارش دستی ثبت شد', order: S.order(order) }, 201);
}));

router.put('/sync/:name',asyncHandler(async(req,res)=>{
  const name=req.params.name,value=Array.isArray(req.body.value)?req.body.value:[];
  if(name==='products'){
    const ids = [];
    for (const p of value) {
      const id = Number(p.id);
      if (!Number.isFinite(id)) continue;
      ids.push(id);

      const sizes = Array.isArray(p.sizes) ? p.sizes.map(item => String(item).trim()).filter(Boolean) : [];
      const fabrics = Array.isArray(p.fabrics) ? p.fabrics.map(item => String(item).trim()).filter(Boolean) : [];
      const pricing = prepareProductPricing(p);
      pricing.variantPrices = pricing.variantPrices.filter(item => sizes.includes(item.size) && fabrics.includes(item.fabric));
      if (Array.isArray(p.variantPrices) && p.variantPrices.length && pricing.variantPrices.length !== sizes.length * fabrics.length) {
        throw new AppError(400, `قیمت همه ترکیب‌های سایز و جنس برای محصول ${p.title || id} باید ثبت شود`);
      }
      const sku = String(p.sku || '').trim().toUpperCase() || await generateUniqueSku();
      const submittedImages = Array.isArray(p.images) ? p.images : [p.image];
      if (submittedImages.length > 12) throw new AppError(400, 'حداکثر ۱۲ تصویر برای هر محصول مجاز است');
      const images = [...new Set(submittedImages.map(item => String(item || '').trim()).filter(Boolean))];
      if (!images.length) images.push('assets/images/ukflag.png');

      await Product.findOneAndUpdate(
        { publicId: id },
        { $set: {
          title: p.title,
          sku,
          category: p.category,
          price: pricing.price,
          hasDiscount: pricing.hasDiscount,
          oldPrice: pricing.oldPrice,
          variantPrices: pricing.variantPrices,
          badge: p.badge || '',
          sortDate: Number(p.date || 1),
          rate: Number(p.rate || 4.7),
          status: p.status || 'active',
          sales: Number(p.sales || 0),
          sizes,
          fabrics,
          image: images[0],
          images,
          description: p.description || ''
        } },
        { upsert: true, setDefaultsOnInsert: true, runValidators: true }
      );
    }
    await Product.deleteMany({ publicId: { $nin: ids } });
  }else if(name==='coupons'){
    const ids=[];for(const c of value){const id=Number(c.id);if(!Number.isFinite(id))continue;ids.push(id);await Coupon.findOneAndUpdate({publicId:id},{$set:{code:String(c.code).toUpperCase(),type:c.type,value:Number(c.value),minOrderAmount:Number(c.min||0),usageLimit:Number(c.limit||0),usedCount:Number(c.used||0),displayExpires:c.expires||'',status:c.status||'active'}},{upsert:true,setDefaultsOnInsert:true});}await Coupon.deleteMany({publicId:{$nin:ids}});
  }else if(name==='orders'){
    for(const o of value)await Order.updateOne({orderNumber:o.id},{$set:{status:o.status,paymentStatus:o.paymentStatus,tracking:o.tracking||'',adminNote:o.adminNote||''}});
  }else if(name==='users'){
    for(const u of value)await User.updateOne({publicId:Number(u.id)},{$set:{fullName:u.name,mobile:u.phone,email:u.email||undefined,role:u.role||'customer',isActive:u.status!=='blocked'}});
  }else if(name==='tickets'){
    for(const t of value){const user=await User.findOne({publicId:Number(t.userId)});if(user)await Ticket.findOneAndUpdate({publicId:t.id},{$set:{user:user._id,customer:t.customer||user.fullName,subject:t.subject,department:t.department,priority:t.priority,status:t.status,messages:t.messages}},{upsert:true,setDefaultsOnInsert:true});}
  }else if(name==='custom'){
    for(const c of value){const user=await User.findOne({publicId:Number(c.userId)});if(!user)continue;const old=await CustomRequest.findOne({publicId:c.id});await CustomRequest.findOneAndUpdate({publicId:c.id},{$set:{user:user._id,customer:c.customer||user.fullName,fileName:c.fileName,size:c.size,fabric:c.fabric,notes:c.notes,status:c.status,price:Number(c.price||0),adminNote:c.adminNote||''}},{upsert:true,setDefaultsOnInsert:true});if(c.status==='preview-ready'&&old?.status!=='preview-ready')await Notification.create({user:user._id,title:'پیش‌نمایش طرح آماده است',text:`پیش‌نمایش درخواست ${c.id} برای تأیید شما آماده شد.`});}
  }
  ok(res,{message:'اطلاعات ذخیره شد'});
}));
module.exports=router;
