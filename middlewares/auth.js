const { AppError } = require('../utils/http');

function requireUser(req, _res, next) {
  if (!req.session?.userId) return next(new AppError(401, 'ابتدا وارد حساب کاربری شوید'));
  next();
}

function requireAdmin(req, _res, next) {
  if (!req.session?.adminId) return next(new AppError(401, 'ورود مدیر الزامی است'));
  next();
}

module.exports = { requireUser, requireAdmin };
