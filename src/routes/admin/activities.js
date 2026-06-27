const express = require('express');
const { getDb } = require('../../config/db');
const { authMiddleware, adminOnly } = require('../../middleware/auth');

const router = express.Router();
router.use(authMiddleware, adminOnly);

// GET /api/admin/activities/list - 管理员查看所有销售活动
router.get('/list', (req, res) => {
  const { page = 1, size = 20, keyword, customer_name, dealer_code } = req.query;
  const db = getDb();
  let where = '1=1';
  const params = [];
  
  if (keyword) {
    where += ' AND (a.customer_name LIKE ? OR a.visit_purpose LIKE ? OR a.content LIKE ? OR u.name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (customer_name) {
    where += ' AND a.customer_name = ?';
    params.push(customer_name);
  }
  if (dealer_code) {
    where += ' AND u.dealer_code = ?';
    params.push(dealer_code);
  }
  
  const total = db.prepare(`SELECT COUNT(*) as c FROM sales_activities a LEFT JOIN users u ON a.user_id = u.id WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT a.*, u.name as user_name, u.dealer_code, d.dealer_name, d.level, d.parent_dealer_code
    FROM sales_activities a
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN dealers d ON u.dealer_code = d.dealer_code
    WHERE ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(size), (Number(page) - 1) * Number(size));
  res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size) } });
});

module.exports = router;
