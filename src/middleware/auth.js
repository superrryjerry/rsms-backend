require('dotenv').config();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'rsms-change-this-to-a-strong-random-string-in-production';
const JWT_EXPIRES = '7d';

// JWT 鉴权中间件
function authMiddleware(req, res, next) {
  // 支持从 Authorization header 或 URL query 参数获取 token
  let token = req.headers.authorization?.replace('Bearer ', '');
  if (!token && req.query.token) token = req.query.token;
  if (!token) return res.status(401).json({ code: 401, msg: '未登录' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, phone, dealer_code, role }
    next();
  } catch {
    res.status(401).json({ code: 401, msg: 'Token 无效或已过期' });
  }
}

// 管理员权限中间件
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ code: 403, msg: '需要管理员权限' });
  }
  next();
}

// 归属权校验中间件（用于车辆编辑/丢公海池等操作）
// 管理员（role=admin 或 dealer_code 为 null）可操作所有车辆
// 一级经销商可操作其下属二级经销商的车辆
function requireOwnership(req, res, next) {
  const { getDb } = require('../config/db');
  const db = getDb();
  const vin = req.body.vin || req.params.vin;
  if (!vin) return res.status(400).json({ code: 400, msg: '缺少VIN' });

  const vehicle = db.prepare('SELECT service_dealer FROM vehicles WHERE vin = ?').get(vin);
  if (!vehicle) return res.status(404).json({ code: 404, msg: '车辆不存在' });

  // 管理员或无归属经销商的用户可操作所有车辆
  if (req.user.role === 'admin' || !req.user.dealer_code) {
    return next();
  }

  // 当前归属经销商可操作
  if (vehicle.service_dealer === req.user.dealer_code) {
    return next();
  }

  // 一级经销商可操作其下属二级经销商的车辆
  const userDealer = db.prepare('SELECT level FROM dealers WHERE dealer_code = ?').get(req.user.dealer_code);
  if (userDealer && userDealer.level === 1) {
    const isSubDealer = db.prepare('SELECT COUNT(*) as c FROM dealers WHERE dealer_code = ? AND parent_dealer_code = ?')
      .get(vehicle.service_dealer, req.user.dealer_code);
    if (isSubDealer && isSubDealer.c > 0) {
      return next();
    }
  }

  return res.status(403).json({ code: 403, msg: '无权操作非归属车辆' });
}

module.exports = { authMiddleware, adminOnly, requireOwnership, JWT_SECRET, JWT_EXPIRES };
