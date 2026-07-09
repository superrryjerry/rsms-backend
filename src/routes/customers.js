const express = require('express');
const { getDb } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/customers/search - 搜索客户名称（用于销售活动选择客户）
router.get('/search', (req, res) => {
  const { keyword } = req.query;
  const db = getDb();
  const dealerCode = req.user.dealer_code;

  let where = '1=1';
  const params = [];

  // 搜索关键词
  if (keyword && keyword.trim()) {
    where += ' AND customer_name LIKE ?';
    params.push(`%${keyword.trim()}%`);
  }

  // 只返回当前经销商有权限的客户（service_dealers_summary包含自己的code）
  if (dealerCode) {
    where += ' AND service_dealers_summary LIKE ?';
    params.push(`%${dealerCode}%`);
  }

  const list = db.prepare(`SELECT customer_name FROM customers WHERE ${where} ORDER BY customer_name LIMIT 20`)
    .all(...params);

  res.json({ code: 0, data: list.map(c => c.customer_name) });
});

// GET /api/customers/list - 客户列表（默认只显示我的客户，搜索时显示全部）
router.get('/list', (req, res) => {
  const { page = 1, size = 20, keyword, scope } = req.query;
  const db = getDb();
  const dealerCode = req.user.dealer_code;
  let where = '1=1';
  const params = [];

  // 默认只显示我的客户（service_dealers_summary包含我的经销商code），搜索时显示全部
  if (keyword) {
    where += ' AND c.customer_name LIKE ?';
    params.push(`%${keyword}%`);
  } else if (scope !== 'all' && dealerCode) {
    where += ' AND c.service_dealers_summary LIKE ?';
    params.push(`%${dealerCode}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM customers c WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT c.*,
    CASE WHEN EXISTS (SELECT 1 FROM vehicles v WHERE v.customer_name = c.customer_name AND v.service_dealer = ?) THEN 1 ELSE 0 END as is_mine
    FROM customers c WHERE ${where} ORDER BY is_mine DESC, c.updated_at DESC LIMIT ? OFFSET ?`)
    .all(dealerCode, ...params, Number(size), (Number(page) - 1) * Number(size));
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

  // 计算年总收入汇总（按当前登录经销商筛选）
    const dealerCode = req.user.dealer_code;
    const totalAnnualIncome = vehicles.filter(v => v.service_dealer === dealerCode)
      .reduce((sum, v) => sum + (v.annual_income || 0), 0);

  // 销售活动：根据经销商层级查询
  // 1. 获取当前用户的经销商信息
  const userDealer = db.prepare('SELECT * FROM dealers WHERE dealer_code = ?').get(req.user.dealer_code);
  
  let activities = [];
  if (userDealer && userDealer.level === 1) {
    // 一级经销商：查询自己和所有子经销商的活动
    const subDealers = db.prepare('SELECT dealer_code FROM dealers WHERE parent_dealer_code = ?')
      .all(req.user.dealer_code);
    const allDealerCodes = [req.user.dealer_code, ...subDealers.map(d => d.dealer_code)];
    
    // 获取这些经销商下所有用户的ID
    const userIds = db.prepare(`SELECT id FROM users WHERE dealer_code IN (${allDealerCodes.map(() => '?').join(',')})`)
      .all(...allDealerCodes).map(u => u.id);
    
    if (userIds.length > 0) {
      activities = db.prepare(`SELECT * FROM sales_activities WHERE customer_name = ? AND user_id IN (${userIds.map(() => '?').join(',')}) ORDER BY created_at DESC`)
        .all(req.params.name, ...userIds);
    }
  } else {
    // 二级经销商或无层级：只查询自己的活动
    activities = db.prepare('SELECT * FROM sales_activities WHERE customer_name = ? AND user_id = ? ORDER BY created_at DESC')
      .all(req.params.name, req.user.id);
  }

  // 判断是否有权新增活动
  const canAddActivity = vehicles.some(v => v.service_dealer === req.user.dealer_code);

  res.json({ code: 0, data: { ...customer, vehicles, contracts, work_orders: workOrders, activities, can_add_activity: canAddActivity, total_annual_income: totalAnnualIncome } });
});

// POST /api/customers/create
router.post('/create', (req, res) => {
  const { customer_name, tag, city, registration_info } = req.body;
  if (!customer_name) return res.json({ code: 400, msg: '客户名称不能为空' });
  const db = getDb();
  try {
    db.prepare('INSERT INTO customers (customer_name, tag, city, registration_info) VALUES (?, ?, ?, ?)')
      .run(customer_name, tag || null, city || null, registration_info || null);
    res.json({ code: 0, msg: '客户创建成功' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.json({ code: 400, msg: '客户名称已存在' });
    res.json({ code: 500, msg: e.message });
  }
});

// PUT /api/customers/tag - 更新客户标签（小程序专用）
router.put('/tag', (req, res) => {
  const { customer_name, tag } = req.body;
  if (!customer_name) return res.json({ code: 400, msg: '客户名称不能为空' });
  const db = getDb();
  try {
    db.prepare(`UPDATE customers SET tag=?, updated_at=datetime('now') WHERE customer_name=?`)
      .run(tag || null, customer_name);
    res.json({ code: 0, msg: '标签更新成功' });
  } catch (e) {
    res.json({ code: 500, msg: e.message });
  }
});

// PUT /api/customers/update
router.put('/update', (req, res) => {
  const { customer_name, tag, city, registration_info } = req.body;
  if (!customer_name) return res.json({ code: 400, msg: '客户名称不能为空' });
  const db = getDb();
  try {
    db.prepare(`UPDATE customers SET tag=?, city=?, registration_info=?, updated_at=datetime('now') WHERE customer_name=?`)
      .run(tag || null, city || null, registration_info || null, customer_name);
    res.json({ code: 0, msg: '客户更新成功' });
  } catch (e) {
    res.json({ code: 500, msg: e.message });
  }
});

// GET /api/customers/export - 导出客户列表
router.get('/export', (req, res) => {
  const XLSX = require('xlsx');
  const db = getDb();
  const { keyword } = req.query;
  let where = '1=1';
  const params = [];
  if (keyword) { where += ' AND c.customer_name LIKE ?'; params.push(`%${keyword}%`); }

  const list = db.prepare(`SELECT c.customer_name, c.tag, c.city, c.registration_info, c.sales_dealers_summary, c.service_dealers_summary, c.created_at, c.updated_at
    FROM customers c WHERE ${where} ORDER BY c.updated_at DESC`).all(...params);

  const data = list.map(r => ({
    '客户名称': r.customer_name,
    '标签': r.tag || '',
    '所在市': r.city || '',
    '注册信息': r.registration_info || '',
    '销售经销商': r.sales_dealers_summary || '',
    '服务经销商': r.service_dealers_summary || '',
    '创建时间': r.created_at || '',
    '更新时间': r.updated_at || ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, '客户列表');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', `attachment; filename=customers_${Date.now()}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
