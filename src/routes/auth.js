const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');
const { JWT_SECRET, JWT_EXPIRES, authMiddleware } = require('../middleware/auth');

const router = express.Router();

// ========== 登录失败锁定机制 ==========
const loginAttempts = new Map(); // key: account, value: { failCount, lockedUntil }
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30分钟

function checkAccountLocked(account) {
  const record = loginAttempts.get(account);
  if (!record) return { locked: false };
  if (record.lockedUntil && record.lockedUntil > Date.now()) {
    const remainMin = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return { locked: true, remainMin };
  }
  // 锁定已过期，清除记录
  if (record.lockedUntil) loginAttempts.delete(account);
  return { locked: false };
}

function recordLoginFailure(account) {
  const record = loginAttempts.get(account) || { failCount: 0, lockedUntil: null };
  record.failCount++;
  if (record.failCount >= MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCK_DURATION_MS;
    console.log(`[安全] 账号 "${account}" 连续失败${record.failCount}次，已锁定30分钟`);
  }
  loginAttempts.set(account, record);
  return record;
}

function clearLoginAttempts(account) {
  loginAttempts.delete(account);
}

// 定时清理过期记录（每小时一次，防止内存泄漏）
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of loginAttempts) {
    if (val.lockedUntil && val.lockedUntil <= now) loginAttempts.delete(key);
  }
}, 60 * 60 * 1000);
// ========== 登录失败锁定机制 END ==========

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ code: 400, msg: '请输入账号和密码' });

  // 统一错误提示，不泄露账号是否存在
  const GENERIC_ERROR = '账号或密码错误';

  // 1. 检查账号是否被锁定
  const lockCheck = checkAccountLocked(phone);
  if (lockCheck.locked) {
    return res.status(429).json({ code: 429, msg: `登录失败次数过多，请${lockCheck.remainMin}分钟后再试` });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE phone = ? AND status = 1').get(phone);
  if (!user) {
    recordLoginFailure(phone);
    return res.status(401).json({ code: 401, msg: GENERIC_ERROR });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    const record = recordLoginFailure(phone);
    const remain = MAX_LOGIN_ATTEMPTS - record.failCount;
    const msg = record.lockedUntil
      ? '登录失败次数过多，请30分钟后再试'
      : `${GENERIC_ERROR}，还可尝试${remain}次`;
    return res.status(401).json({ code: 401, msg });
  }

  // 登录成功，清除失败记录
  clearLoginAttempts(phone);

  const payload = { id: user.id, phone: user.phone, dealer_code: user.dealer_code, role: user.role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

  // 记录登录日志
  try {
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || '';
    const ua = req.headers['user-agent'] || '';
    db.prepare('INSERT INTO login_logs (user_id, phone, ip_address, user_agent, status) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, user.phone, ip, ua, 'success');
  } catch (e) {
    console.error('[Auth] 记录登录日志失败:', e.message);
  }

  res.json({
    code: 0,
    data: {
      token,
      must_change_pwd: !!user.must_change_pwd,
      user: { id: user.id, phone: user.phone, name: user.name, dealer_code: user.dealer_code, role: user.role }
    }
  });
});

// POST /api/auth/change-password - 修改密码
router.post('/change-password', authMiddleware, (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) {
    return res.status(400).json({ code: 400, msg: '旧密码和新密码不能为空' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ code: 400, msg: '新密码至少8位' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ code: 404, msg: '用户不存在' });

  if (!bcrypt.compareSync(old_password, user.password_hash)) {
    return res.status(400).json({ code: 400, msg: '旧密码错误' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_pwd = 0, updated_at = datetime("now") WHERE id = ?')
    .run(hash, req.user.id);

  res.json({ code: 0, msg: '密码修改成功' });
});

// POST /api/auth/refresh
router.post('/refresh', authMiddleware, (req, res) => {
  const payload = { id: req.user.id, phone: req.user.phone, dealer_code: req.user.dealer_code, role: req.user.role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ code: 0, data: { token } });
});

module.exports = router;
