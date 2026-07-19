const express = require('express');
const path = require('path');
const fs = require('fs');

const Order = require('../models/Order');
const { requireAdmin } = require('../middlewares/auth');

const router = express.Router();


router.get(
'/custom-file/:orderId/:itemIndex',
requireAdmin,
async(req,res)=>{

    try {

        const order = await Order.findById(req.params.orderId);

        if(!order){
            return res.status(404).send('سفارش پیدا نشد');
        }


        const item = order.items[Number(req.params.itemIndex)];


        if(!item){
            return res.status(404).send('آیتم سفارش پیدا نشد');
        }


        if(!item.filePath){
            return res.status(404).send('فایل برای این سفارش وجود ندارد');
        }


        const absolutePath = path.resolve(item.filePath);


        if(!fs.existsSync(absolutePath)){
            return res.status(404).send('فایل روی سرور حذف شده است');
        }


        res.download(
            absolutePath,
            item.fileName || 'customer-design-file'
        );


    }catch(error){

        console.log(error);

        res.status(500).send('خطا در دانلود فایل');

    }

});


module.exports = router;