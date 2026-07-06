const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');
const { JWT_SECRET, JWT_EXPIRES, authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ code: 400, msg: '手机号和密码不能为空' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE phone = ? AND status = 1').get(phone);
  if (!user) return res.status(401).json({ code: 401, msg: '用户不存在或已禁用' });

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ code: 401, msg: '密码错误' });
  }

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
