const express = require('express');
const { getDb } = require('../../config/db');
const { updateCustomerSummary } = require('../pool');

const router = express.Router();

// GET /api/admin/requests
router.get('/', (req, res) => {
  const { page = 1, size = 20, status, request_type, keyword } = req.query;
  const db = getDb();
  let where = '1=1';
  const params = [];
  if (status) { where += ' AND r.status = ?'; params.push(status); }
  if (request_type) { where += ' AND r.request_type = ?'; params.push(request_type); }
  if (keyword) { where += ' AND r.vin LIKE ?'; params.push(`%${keyword}%`); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM service_dealer_requests r WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT r.*, d1.dealer_name as current_dealer_name, d2.dealer_name as request_dealer_name, u.name as request_user_name
    FROM service_dealer_requests r
    LEFT JOIN dealers d1 ON r.current_dealer = d1.dealer_code
    LEFT JOIN dealers d2 ON r.request_dealer = d2.dealer_code
    LEFT JOIN users u ON r.request_user_id = u.id
    WHERE ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(size), (Number(page) - 1) * Number(size));
  res.json({ code: 0, data: { total, list } });
});

// POST /api/admin/requests/:id/approve
router.post('/:id/approve', (req, res) => {
  const db = getDb();
  const request = db.prepare('SELECT * FROM service_dealer_requests WHERE id = ? AND status = ?').get(req.params.id, 'pending');
  if (!request) return res.status(404).json({ code: 404, msg: '申请不存在或已处理' });

  const approveTx = db.transaction(() => {
    if (request.request_type === 'claim') {
      db.prepare("UPDATE vehicles SET service_dealer = ?, claimed_by = ?, claimed_at = datetime('now'), updated_at = datetime('now') WHERE vin = ?")
        .run(request.request_dealer, request.request_user_id, request.vin);
    } else if (request.request_type === 'transfer') {
      const target = request.target_dealer;
      if (!target) throw new Error('转移目标经销商为空');
      db.prepare("UPDATE vehicles SET service_dealer = ?, updated_at = datetime('now') WHERE vin = ?")
        .run(target, request.vin);
    } else if (request.request_type === 'change_customer') {
      // 更改车辆所属客户
      const newCustomerName = request.new_customer_name;
      if (!newCustomerName) throw new Error('新客户名称为空');
      
      // 记录曾用名到历史表
      db.prepare('INSERT INTO vehicle_customer_history (vin, old_customer_name, new_customer_name, changed_by, request_id) VALUES (?, ?, ?, ?, ?)')
        .run(request.vin, request.old_customer_name, newCustomerName, request.request_dealer, request.id);
      
      // 更新车辆客户名
      db.prepare("UPDATE vehicles SET customer_name = ?, updated_at = datetime('now') WHERE vin = ?")
        .run(newCustomerName, request.vin);
      
      // 如果新客户不存在于customers表，自动创建
      const newCustomerExists = db.prepare('SELECT id FROM customers WHERE customer_name = ?').get(newCustomerName);
      if (!newCustomerExists) {
        db.prepare('INSERT INTO customers (customer_name) VALUES (?)').run(newCustomerName);
      }
      
      // 更新新旧客户的汇总
      if (request.old_customer_name) updateCustomerSummary(db, request.old_customer_name);
      updateCustomerSummary(db, newCustomerName);
    }
    const vehicle = db.prepare('SELECT customer_name FROM vehicles WHERE vin = ?').get(request.vin);
    if (vehicle?.customer_name) updateCustomerSummary(db, vehicle.customer_name);

    db.prepare("UPDATE service_dealer_requests SET status = 'approved', handled_by = ?, handled_at = datetime('now') WHERE id = ?")
      .run(req.user.id, req.params.id);
  });

  try { approveTx(); res.json({ code: 0, msg: '审批通过' }); } catch (e) { console.error('[Admin] 审批失败:', e.message); res.status(500).json({ code: 500, msg: '审批处理失败' }); }
});

// POST /api/admin/requests/:id/reject
router.post('/:id/reject', (req, res) => {
  const { admin_remark } = req.body;
  const db = getDb();
  db.prepare("UPDATE service_dealer_requests SET status = 'rejected', admin_remark = ?, handled_by = ?, handled_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .run(admin_remark || '', req.user.id, req.params.id);
  res.json({ code: 0, msg: '已拒绝' });
});

module.exports = router;
