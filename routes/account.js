const express = require('express');
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Ticket = require('../models/Ticket');
const CustomRequest = require('../models/CustomRequest');
const Notification = require('../models/Notification');
const upload = require('../middlewares/upload');
const { requireUser } = require('../middlewares/auth');
const { asyncHandler, ok, AppError } = require('../utils/http');
const { publicCode, normalizeMobile } = require('../utils/formatters');
const { calculateCustomPrice } = require('../utils/customPricing');
const S = require('../services/serializers');
const router = express.Router();
router.use(requireUser);

async function bootstrap(userId){
  const user=await User.findById(userId);if(!user)throw new AppError(404,'کاربر یافت نشد');
  const [orders,tickets,custom,notifications,products]=await Promise.all([
    Order.find({user:userId}).sort({createdAt:-1}).lean(),Ticket.find({user:userId}).sort({createdAt:-1}).lean(),CustomRequest.find({user:userId}).sort({createdAt:-1}).lean(),Notification.find({user:userId}).sort({createdAt:-1}).lean(),Product.find({status:'active'}).sort({publicId:1}).lean()
  ]);
  const total=orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+Number(o.total||0),0);
  const hydratedTickets=tickets.map(t=>({...t,user})),hydratedCustom=custom.map(c=>({...c,user}));
  return {products:products.map(S.product),orders:orders.map(o=>S.order({...o,user:{publicId:user.publicId}})),users:[S.user(user,{orders:orders.length,total})],tickets:hydratedTickets.map(S.ticket),addresses:user.addresses.map(a=>S.address(a,user.publicId)),notifications:notifications.map(n=>({...S.notification(n),userId:user.publicId})),custom:hydratedCustom.map(S.custom),wishlist:user.wishlist||[],session:{userId:user.publicId,name:user.fullName,loggedIn:true}};
}
router.get('/bootstrap',asyncHandler(async(req,res)=>ok(res,await bootstrap(req.session.userId))));

async function normalizedAvailableMobile(user, value) {
  const mobile = normalizeMobile(value);
  if (!/^09\d{9}$/.test(mobile)) throw new AppError(400, 'شماره موبایل معتبر نیست');
  const duplicate = await User.exists({ _id: { $ne: user._id }, mobile });
  if (duplicate) throw new AppError(409, 'این شماره موبایل قبلاً ثبت شده است');
  return mobile;
}

router.patch('/profile',asyncHandler(async(req,res)=>{
  const user=await User.findById(req.session.userId);
  if(!user)throw new AppError(404,'کاربر یافت نشد');
  user.fullName=req.body.name||user.fullName;
  if(req.body.phone!==undefined)user.mobile=await normalizedAvailableMobile(user,req.body.phone);
  user.email=req.body.email||undefined;
  await user.save();
  ok(res,{user:S.user(user)});
}));

router.post('/tickets',asyncHandler(async(req,res)=>{const user=await User.findById(req.session.userId);const ticket=await Ticket.create({publicId:publicCode('TK'),user:user._id,customer:user.fullName,subject:req.body.subject,department:req.body.department,priority:req.body.priority||'normal',messages:[{from:'user',text:req.body.message,date:'همین حالا'}]});ok(res,{ticket:S.ticket({...ticket.toObject(),user})},201);}));
router.post('/custom',upload.single('file'),asyncHandler(async(req,res)=>{if(!req.file)throw new AppError(400,'فایل طرح الزامی است');const pricing=calculateCustomPrice(req.body.size);if(!pricing.valid)throw new AppError(400,pricing.reason==='too-large'?'حداکثر سایز قابل ثبت ۱۵۰ × ۹۰ سانتی‌متر است':'ابعاد واردشده معتبر نیست');const user=await User.findById(req.session.userId);const item=await CustomRequest.create({publicId:publicCode('DS'),user:user._id,customer:user.fullName,phone:user.mobile,email:user.email||'',fileName:req.file.originalname,filePath:req.file.path,mimeType:req.file.mimetype,size:req.body.size,fabric:req.body.fabric,requestType:req.body.requestType,notes:req.body.notes,status:'review',price:pricing.price});ok(res,{request:S.custom({...item.toObject(),user})},201);}));

router.put('/sync/:name',asyncHandler(async(req,res)=>{
  const name=req.params.name,value=req.body.value;const user=await User.findById(req.session.userId);if(!user)throw new AppError(404,'کاربر یافت نشد');
  if(name==='users'){const candidate=(value||[]).find(x=>Number(x.id)===Number(user.publicId))||(value||[])[0];if(candidate){user.fullName=candidate.name||user.fullName;if(candidate.phone!==undefined)user.mobile=await normalizedAvailableMobile(user,candidate.phone);user.email=candidate.email||undefined;await user.save();}}
  else if(name==='addresses'){const own=(value||[]).filter(x=>Number(x.userId)===Number(user.publicId));user.addresses=own.map(x=>({publicId:Number(x.id)||Date.now(),title:x.title,receiver:x.receiver,phone:x.phone,postal:x.postal,province:x.province,city:x.city,address:x.address,default:!!x.default}));await user.save();}
  else if(name==='wishlist'){user.wishlist=(value||[]).map(Number).filter(Number.isFinite);await user.save();}
  else if(name==='notifications'){for(const n of value||[]){if(n.id)await Notification.updateOne({_id:n.id,user:user._id},{read:!!n.read});}}
  else if(name==='tickets'){for(const t of (value||[]).filter(x=>Number(x.userId)===Number(user.publicId))){await Ticket.findOneAndUpdate({publicId:t.id,user:user._id},{$set:{subject:t.subject,department:t.department,priority:t.priority,status:t.status,messages:t.messages,customer:user.fullName}},{upsert:true,setDefaultsOnInsert:true});}}
  else if(name==='custom'){for(const c of (value||[]).filter(x=>Number(x.userId)===Number(user.publicId))){const pricing=calculateCustomPrice(c.size);if(!pricing.valid)throw new AppError(400,pricing.reason==='too-large'?'حداکثر سایز قابل ثبت ۱۵۰ × ۹۰ سانتی‌متر است':'ابعاد واردشده معتبر نیست');await CustomRequest.findOneAndUpdate({publicId:c.id,user:user._id},{$set:{customer:user.fullName,fileName:c.fileName,size:c.size,fabric:c.fabric,notes:c.notes,price:pricing.price}},{upsert:true,setDefaultsOnInsert:true});}}
  ok(res,{message:'ذخیره شد'});
}));
module.exports=router;
