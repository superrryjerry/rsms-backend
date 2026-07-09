const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../../config/db');

const router = express.Router();

// GET /api/admin/users
router.get('/', (req, res) => {
  const db = getDb();
  const list = db.prepare("SELECT id, phone, name, dealer_code, role, status, created_at FROM users WHERE role != 'admin' ORDER BY created_at DESC").all();
  res.json({ code: 0, data: list });
});

// POST /api/admin/users
router.post('/', (req, res) => {
  const { phone, name, password, dealer_code, role } = req.body;
  if (!phone || !name || !password) return res.status(400).json({ code: 400, msg: '必填字段缺失' });
  if (password.length < 8) return res.status(400).json({ code: 400, msg: '密码至少8位' });
  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  // 允许的角色：dealer_staff（默认）、admin_test、admin
  const validRoles = ['dealer_staff', 'admin_test', 'admin'];
  const userRole = validRoles.includes(role) ? role : 'dealer_staff';
  try {
    db.prepare('INSERT INTO users (phone, password_hash, name, dealer_code, role) VALUES (?, ?, ?, ?, ?)').run(phone, hash, name, dealer_code, userRole);
    res.json({ code: 0, msg: '用户创建成功' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ code: 400, msg: '账号已存在' });
    console.error('[Admin] 创建用户失败:', e.message);
    res.status(500).json({ code: 500, msg: '创建用户失败' });
  }
});

// POST /api/admin/users/:id/reset
router.post('/:id/reset', (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) {
    return res.status(400).json({ code: 400, msg: '旧密码和新密码不能为空' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ code: 400, msg: '新密码至少8位' });
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ code: 404, msg: '用户不存在' });
  if (!bcrypt.compareSync(old_password, user.password_hash)) {
    return res.status(400).json({ code: 400, msg: '旧密码错误' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_pwd = 0, updated_at = datetime("now") WHERE id = ?')
    .run(hash, req.params.id);
  res.json({ code: 0, msg: '密码已重置' });
});

// POST /api/admin/users/:id/toggle
router.post('/:id/toggle', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE users SET status = CASE WHEN status = 1 THEN 0 ELSE 1 END, updated_at = datetime("now") WHERE id = ?').run(req.params.id);
  res.json({ code: 0, msg: '状态已更新' });
});

// PUT /api/admin/users/:id - 编辑用户
router.put('/:id', (req, res) => {
  const { phone, name, dealer_code, role, status } = req.body;
  const db = getDb();
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ code: 404, msg: '用户不存在' });
  
  // 如果修改手机号，检查是否已存在
  if (phone && phone !== user.phone) {
    const existing = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(phone, req.params.id);
    if (existing) return res.status(400).json({ code: 400, msg: '手机号已存在' });
  }
  
  try {
    db.prepare('UPDATE users SET phone=?, name=?, dealer_code=?, role=?, status=?, updated_at=datetime("now") WHERE id=?')
      .run(
        phone || user.phone,
        name || user.name,
        dealer_code !== undefined ? dealer_code : user.dealer_code,
        role || user.role,
        status !== undefined ? status : user.status,
        req.params.id
      );
    res.json({ code: 0, msg: '更新成功' });
  } catch (e) {
    console.error('[Admin] 更新用户失败:', e.message);
    res.status(500).json({ code: 500, msg: '更新失败' });
  }
});

// DELETE /api/admin/users/:id - 删除用户
router.delete('/:id', (req, res) => {
  const db = getDb();
  const userId = req.params.id;
  
  // 不能删除管理员
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ code: 404, msg: '用户不存在' });
  if (user.role === 'admin') return res.status(400).json({ code: 400, msg: '不能删除管理员账号' });
  
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.json({ code: 0, msg: '删除成功' });
  } catch (e) {
    console.error('[Admin] 删除用户失败:', e.message);
    res.status(500).json({ code: 500, msg: '删除失败' });
  }
});

module.exports = router;
