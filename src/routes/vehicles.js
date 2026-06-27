const express = require('express');
const { getDb } = require('../config/db');
const { authMiddleware, requireOwnership } = require('../middleware/auth');
const { updateCustomerSummary } = require('./pool');

const router = express.Router();
router.use(authMiddleware);

// GET /api/vehicles/list - 全库车辆列表
router.get('/list', (req, res) => {
  const { page = 1, size = 20, keyword } = req.query;
  const db = getDb();
  let where = '1=1';
  const params = [];

  if (keyword) {
    where += ' AND (v.vin LIKE ? OR v.vin_full LIKE ? OR v.license_plate LIKE ? OR v.customer_name LIKE ? OR v.model LIKE ? OR v.service_dealer LIKE ?)';
    const k = `%${keyword}%`;
    params.push(k, k, k, k, k, k);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM vehicles v WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT v.*, CASE WHEN v.service_dealer = ? THEN 1 ELSE 0 END as is_mine FROM vehicles v WHERE ${where} ORDER BY v.updated_at DESC LIMIT ? OFFSET ?`)
    .all(req.user.dealer_code, ...params, Number(size), (Number(page) - 1) * Number(size));

  res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size) } });
});

// GET /api/vehicles/detail/:vin
router.get('/detail/:vin', (req, res) => {
  const db = getDb();
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE vin = ?').get(req.params.vin);
  if (!vehicle) return res.status(404).json({ code: 404, msg: '车辆不存在' });

  const contracts = db.prepare('SELECT * FROM contracts WHERE vin = ?').all(req.params.vin);
  const workOrders = db.prepare('SELECT * FROM work_orders WHERE vin = ? ORDER BY order_date DESC').all(req.params.vin);

  // 管理员或无归属经销商的用户可查看所有车辆
  const permission = (req.user.role === 'admin' || !req.user.dealer_code || vehicle.service_dealer === req.user.dealer_code) ? 'editable' : 'readonly';

  res.json({ code: 0, data: { ...vehicle, permission, contracts, work_orders: workOrders } });
});

// POST /api/vehicles/drop - 丢公海池（需归属权）
router.post('/drop', requireOwnership, (req, res) => {
  const { vin } = req.body;
  const db = getDb();

  const dropTx = db.transaction(() => {
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE vin = ?').get(vin);
    const customerName = vehicle.customer_name;

    // 1. 删除vehicles记录
    db.prepare('DELETE FROM vehicles WHERE vin = ?').run(vin);

    // 2. 插入public_pool（清空service_dealer）
    db.prepare(`INSERT INTO public_pool (vin, vin_full, license_plate, customer_name, vehicle_type, sales_dealer, model, delivery_date, production_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(vin, vehicle.vin_full, vehicle.license_plate, vehicle.customer_name,
        vehicle.vehicle_type, vehicle.sales_dealer, vehicle.model, vehicle.delivery_date, vehicle.production_date);

    // 3. 更新客户汇总
    if (customerName) updateCustomerSummary(db, customerName);
  });

  try {
    dropTx();
    res.json({ code: 0, msg: '已丢入公海池' });
  } catch (e) {
    console.error('[Vehicles] 丢公海池失败:', e.message);
    res.status(500).json({ code: 500, msg: '操作失败' });
  }
});

// POST /api/vehicles/apply - 申请成为服务经销商
router.post('/apply', (req, res) => {
  const { vin, reason } = req.body;
  if (!vin) return res.status(400).json({ code: 400, msg: '缺少VIN' });

  const db = getDb();
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE vin = ?').get(vin);
  if (!vehicle) return res.status(404).json({ code: 404, msg: '车辆不存在' });
  if (vehicle.service_dealer === req.user.dealer_code) {
    return res.status(400).json({ code: 400, msg: '已是归属经销商' });
  }

  // 去重检查
  const dup = db.prepare('SELECT id FROM service_dealer_requests WHERE vin = ? AND request_dealer = ? AND status = ?')
    .get(vin, req.user.dealer_code, 'pending');
  if (dup) return res.status(400).json({ code: 400, msg: '已有待审批申请' });

  db.prepare(`INSERT INTO service_dealer_requests (vin, current_dealer, request_dealer, request_user_id, request_type, reason)
    VALUES (?, ?, ?, ?, 'claim', ?)`)
    .run(vin, vehicle.service_dealer, req.user.dealer_code, req.user.id, reason || '');

  res.json({ code: 0, msg: '申请已提交，等待管理员审批' });
});

// POST /api/vehicles/transfer - 申请转移服务经销商
router.post('/transfer', requireOwnership, (req, res) => {
  const { vin, target_dealer, reason } = req.body;
  if (!vin || !target_dealer) return res.status(400).json({ code: 400, msg: '缺少必要参数' });

  const db = getDb();
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE vin = ?').get(vin);

  db.prepare(`INSERT INTO service_dealer_requests (vin, current_dealer, request_dealer, request_user_id, request_type, target_dealer, reason)
    VALUES (?, ?, ?, ?, 'transfer', ?, ?)`)
    .run(vin, vehicle.service_dealer, req.user.dealer_code, req.user.id, target_dealer, reason || '');

  res.json({ code: 0, msg: '转移申请已提交' });
});

// PUT /api/vehicles/update-service-dealer - 编辑服务经销商（仅名下VIN）
router.put('/update-service-dealer', requireOwnership, (req, res) => {
  const { vin, service_dealer } = req.body;
  if (!vin || !service_dealer) return res.status(400).json({ code: 400, msg: '缺少必要参数' });

  const db = getDb();
  
  // 检查是否有权限编辑（管理员、一级经销商、或当前归属经销商）
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE vin = ?').get(vin);
  if (!vehicle) return res.status(404).json({ code: 404, msg: '车辆不存在' });

  // 获取当前用户的经销商信息
  const userDealer = db.prepare('SELECT * FROM dealers WHERE dealer_code = ?').get(req.user.dealer_code);
  const targetDealer = db.prepare('SELECT * FROM dealers WHERE dealer_code = ?').get(service_dealer);
  
  if (!targetDealer) return res.status(400).json({ code: 400, msg: '目标经销商不存在' });

  // 权限检查：管理员、当前归属经销商、或一级经销商可以编辑
  let canEdit = false;
  if (req.user.role === 'admin') {
    canEdit = true;
  } else if (vehicle.service_dealer === req.user.dealer_code) {
    canEdit = true;
  } else if (userDealer && userDealer.level === 1) {
    // 一级经销商可以编辑其下属二级经销商的VIN
    const isSubDealer = db.prepare('SELECT COUNT(*) as c FROM dealers WHERE dealer_code = ? AND parent_dealer_code = ?')
      .get(vehicle.service_dealer, req.user.dealer_code);
    if (isSubDealer && isSubDealer.c > 0) {
      canEdit = true;
    }
  }

  if (!canEdit) {
    return res.status(403).json({ code: 403, msg: '无权编辑此车辆的服务经销商' });
  }

  try {
    db.prepare(`UPDATE vehicles SET service_dealer = ?, updated_at = datetime('now') WHERE vin = ?`)
      .run(service_dealer, vin);
    
    // 更新客户汇总
    if (vehicle.customer_name) {
      updateCustomerSummary(db, vehicle.customer_name);
    }

    res.json({ code: 0, msg: '服务经销商已更新' });
  } catch (e) {
    console.error('[Vehicles] 更新服务经销商失败:', e.message);
    res.status(500).json({ code: 500, msg: '更新失败' });
  }
});

// GET /api/vehicles/my-requests
router.get('/my-requests', (req, res) => {
  const db = getDb();
  const list = db.prepare(`SELECT r.*, d.dealer_name as current_dealer_name, d2.dealer_name as request_dealer_name
    FROM service_dealer_requests r
    LEFT JOIN dealers d ON r.current_dealer = d.dealer_code
    LEFT JOIN dealers d2 ON r.request_dealer = d2.dealer_code
    WHERE r.request_user_id = ? ORDER BY r.created_at DESC`)
    .all(req.user.id);
  res.json({ code: 0, data: list });
});

module.exports = router;
