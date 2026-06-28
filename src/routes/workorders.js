const express = require('express');
const { getDb } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/workorders/list
router.get('/list', (req, res) => {
  const { page = 1, size = 20, keyword } = req.query;
  const db = getDb();
  let where = '1=1';
  const params = [];
  if (keyword) {
    where += ' AND (w.vin LIKE ? OR w.order_no LIKE ? OR w.order_type LIKE ? OR v.customer_name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) as c FROM work_orders w LEFT JOIN vehicles v ON w.vin = v.vin WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT w.*, v.customer_name, v.service_dealer as dealer_code FROM work_orders w LEFT JOIN vehicles v ON w.vin = v.vin WHERE ${where} ORDER BY w.order_date DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(size), (Number(page) - 1) * Number(size));
  res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size) } });
});

// GET /api/workorders/export - 导出工单列表
router.get('/export', (req, res) => {
  const XLSX = require('xlsx');
  const db = getDb();
  const { keyword } = req.query;
  let where = '1=1';
  const params = [];
  if (keyword) {
    where += ' AND (w.vin LIKE ? OR w.order_no LIKE ? OR w.order_type LIKE ? OR v.customer_name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const list = db.prepare(`SELECT w.*, v.customer_name FROM work_orders w LEFT JOIN vehicles v ON w.vin = v.vin WHERE ${where} ORDER BY w.order_date DESC`).all(...params);
  const data = list.map(r => ({
    'VIN': r.vin,
    '客户名称': r.customer_name || '',
    '工单号': r.order_no || '',
    '工单日期': r.order_date || '',
    '工单类型': r.order_type || '',
    '维修内容': r.order_content || '',
    '服务经销商': r.service_dealer || '',
    '经销商代码': r.dealer_code || '',
    '金额': r.amount || 0,
    '创建时间': r.created_at || ''
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, '工单列表');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename=workorders_${Date.now()}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
