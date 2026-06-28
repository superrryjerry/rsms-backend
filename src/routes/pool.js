const express = require('express');
const { getDb } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/pool/list
router.get('/list', (req, res) => {
  const { page = 1, size = 20, keyword } = req.query;
  const db = getDb();
  let where = '1=1';
  const params = [];

  if (keyword) {
    where += ' AND (vin LIKE ? OR vin_full LIKE ? OR license_plate LIKE ? OR customer_name LIKE ? OR model LIKE ?)';
    const k = `%${keyword}%`;
    params.push(k, k, k, k, k);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM public_pool WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT * FROM public_pool WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(size), (Number(page) - 1) * Number(size));

  res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size) } });
});

// POST /api/pool/claim - 认领车辆
router.post('/claim', (req, res) => {
  const { vin, service_dealer } = req.body;
  if (!vin || !service_dealer) return res.status(400).json({ code: 400, msg: '缺少必要参数' });

  const db = getDb();
  const poolRecord = db.prepare('SELECT * FROM public_pool WHERE vin = ?').get(vin);
  if (!poolRecord) return res.status(404).json({ code: 404, msg: '公海池中不存在该VIN' });

  const existing = db.prepare('SELECT vin FROM vehicles WHERE vin = ?').get(vin);
  if (existing) return res.status(400).json({ code: 400, msg: '该VIN已在车辆表中' });

  const claimTx = db.transaction(() => {
    // 1. 删除公海池记录
    db.prepare('DELETE FROM public_pool WHERE vin = ?').run(vin);

    // 2. 插入vehicles表
    db.prepare(`INSERT INTO vehicles (vin, vin_full, license_plate, customer_name, vehicle_type, sales_dealer, service_dealer, model, delivery_date, production_date, claimed_by, claimed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run(vin, poolRecord.vin_full, poolRecord.license_plate, poolRecord.customer_name,
        poolRecord.vehicle_type, poolRecord.sales_dealer, service_dealer,
        poolRecord.model, poolRecord.delivery_date, poolRecord.production_date, req.user.id);

    // 3. 自动创建客户（如不存在）
    if (poolRecord.customer_name) {
      const custExists = db.prepare('SELECT id FROM customers WHERE customer_name = ?').get(poolRecord.customer_name);
      if (!custExists) {
        db.prepare('INSERT INTO customers (customer_name) VALUES (?)').run(poolRecord.customer_name);
      }
    }

    // 4. 更新客户汇总字段
    if (poolRecord.customer_name) {
      updateCustomerSummary(db, poolRecord.customer_name);
    }
  });

  try {
    claimTx();
    res.json({ code: 0, msg: '认领成功' });
  } catch (e) {
    res.json({ code: 500, msg: '认领失败: ' + e.message });
  }
});

// GET /api/pool/export - 导出公海池列表
router.get('/export', (req, res) => {
  const XLSX = require('xlsx');
  const db = getDb();
  const { keyword } = req.query;
  let where = '1=1';
  const params = [];
  if (keyword) {
    where += ' AND (vin LIKE ? OR vin_full LIKE ? OR license_plate LIKE ? OR customer_name LIKE ? OR model LIKE ?)';
    const k = `%${keyword}%`;
    params.push(k, k, k, k, k);
  }
  const list = db.prepare(`SELECT * FROM public_pool WHERE ${where} ORDER BY created_at DESC`).all(...params);
  const data = list.map(r => ({
    'VIN': r.vin,
    '完整VIN': r.vin_full || '',
    '车牌': r.license_plate || '',
    '客户名称': r.customer_name || '',
    '车辆类型': r.vehicle_type || '',
    '销售经销商': r.sales_dealer || '',
    '车型': r.model || '',
    '交付日期': r.delivery_date || '',
    '生产日期': r.production_date || '',
    '创建时间': r.created_at || ''
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, '公海池');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename=pool_${Date.now()}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// 更新客户汇总字段
function updateCustomerSummary(db, customerName) {
  const rows = db.prepare(`SELECT DISTINCT sales_dealer, service_dealer FROM vehicles WHERE customer_name = ?`).all(customerName);
  const salesSet = new Set(), serviceSet = new Set();
  rows.forEach(r => {
    if (r.sales_dealer) salesSet.add(r.sales_dealer);
    if (r.service_dealer) serviceSet.add(r.service_dealer);
  });
  db.prepare('UPDATE customers SET sales_dealers_summary = ?, service_dealers_summary = ?, updated_at = datetime("now") WHERE customer_name = ?')
    .run([...salesSet].join(','), [...serviceSet].join(','), customerName);
}

module.exports = router;
module.exports.updateCustomerSummary = updateCustomerSummary;
