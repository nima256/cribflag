const User = require('../models/User');
const Admin = require('../models/Admin');
const { AppError } = require('../utils/http');

async function requireUser(req, _res, next) {
  try {
    if (!req.session?.userId) throw new AppError(401, 'ابتدا وارد حساب کاربری شوید');
    const user = await User.findById(req.session.userId).select('_id isActive').lean();
    if (!user?.isActive) {
      delete req.session.userId;
      throw new AppError(401, 'حساب کاربری فعال نیست؛ دوباره وارد شوید');
    }
    req.authUser = user;
    next();
  } catch (error) {
    next(error);
  }
}

async function requireAdmin(req, _res, next) {
  try {
    if (!req.session?.adminId) throw new AppError(401, 'ورود مدیر الزامی است');
    const admin = await Admin.findById(req.session.adminId).select('_id isActive').lean();
    if (!admin?.isActive) {
      delete req.session.adminId;
      throw new AppError(401, 'حساب مدیر فعال نیست؛ دوباره وارد شوید');
    }
    req.authAdmin = admin;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireUser, requireAdmin };
