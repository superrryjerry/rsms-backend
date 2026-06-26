const express = require('express');
const { getDb } = require('../../config/db');

const router = express.Router();

// GET /api/admin/dealers
router.get('/', (req, res) => {
  const db = getDb();
  res.json({ code: 0, data: db.prepare('SELECT * FROM dealers ORDER BY dealer_code').all() });
});

// POST /api/admin/dealers
router.post('/', (req, res) => {
  const { dealer_code, dealer_name, dealer_type } = req.body;
  if (!dealer_code || !dealer_name) return res.status(400).json({ code: 400, msg: '经销商代码和名称不能为空' });
  const db = getDb();
  try {
    db.prepare('INSERT INTO dealers (dealer_code, dealer_name, dealer_type) VALUES (?,?,?)').run(dealer_code, dealer_name, dealer_type || 'both');
    res.json({ code: 0, msg: '创建成功' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ code: 400, msg: '经销商代码已存在' });
    console.error('[Admin] 创建经销商失败:', e.message);
    res.status(500).json({ code: 500, msg: '创建经销商失败' });
  }
});

module.exports = router;
