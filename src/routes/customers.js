const express = require('express');
const { getDb } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/customers/list
router.get('/list', (req, res) => {
  const { page = 1, size = 20, keyword } = req.query;
  const db = getDb();
  let where = '1=1';
  const params = [];
  if (keyword) { where += ' AND c.customer_name LIKE ?'; params.push(`%${keyword}%`); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM customers c WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT c.*,
    CASE WHEN EXISTS (SELECT 1 FROM vehicles v WHERE v.customer_name = c.customer_name AND v.service_dealer = ?) THEN 1 ELSE 0 END as is_mine
    FROM customers c WHERE ${where} ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`)
    .all(req.user.dealer_code, ...params, Number(size), (Number(page) - 1) * Number(size));
  res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size) } });
});

// GET /api/customers/detail/:name
router.get('/detail/:name', (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE customer_name = ?').get(req.params.name);
  if (!customer) return res.status(404).json({ code: 404, msg: '客户不存在' });

  const vehicles = db.prepare('SELECT * FROM vehicles WHERE customer_name = ?').all(req.params.name);
  const vins = vehicles.map(v => v.vin);
  const contracts = vins.length ? db.prepare(`SELECT * FROM contracts WHERE vin IN (${vins.map(() => '?').join(',')})`).all(...vins) : [];
  const workOrders = vins.length ? db.prepare(`SELECT * FROM work_orders WHERE vin IN (${vins.map(() => '?').join(',')}) ORDER BY order_date DESC`).all(...vins) : [];

  // 销售活动：仅展示当前用户创建的
  const activities = db.prepare('SELECT * FROM sales_activities WHERE customer_name = ? AND user_id = ? ORDER BY created_at DESC')
    .all(req.params.name, req.user.id);

  // 判断是否有权新增活动
  const canAddActivity = vehicles.some(v => v.service_dealer === req.user.dealer_code);

  res.json({ code: 0, data: { ...customer, vehicles, contracts, work_orders: workOrders, activities, can_add_activity: canAddActivity } });
});

// POST /api/customers/create
router.post('/create', (req, res) => {
  const { customer_name } = req.body;
  if (!customer_name) return res.json({ code: 400, msg: '客户名称不能为空' });
  const db = getDb();
  try {
    db.prepare('INSERT INTO customers (customer_name) VALUES (?)').run(customer_name);
    res.json({ code: 0, msg: '客户创建成功' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.json({ code: 400, msg: '客户名称已存在' });
    res.json({ code: 500, msg: e.message });
  }
});

module.exports = router;
