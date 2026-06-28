const express = require('express');
const { getDb } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/contracts/list
router.get('/list', (req, res) => {
  const { page = 1, size = 20, keyword } = req.query;
  const db = getDb();
  let where = '1=1';
  const params = [];
  if (keyword) {
    where += ' AND (c.vin LIKE ? OR v.license_plate LIKE ? OR c.headquarters_contract_no LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) as c FROM contracts c LEFT JOIN vehicles v ON c.vin = v.vin WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT c.*, v.license_plate, v.customer_name, v.service_dealer FROM contracts c LEFT JOIN vehicles v ON c.vin = v.vin WHERE ${where} ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(size), (Number(page) - 1) * Number(size));
  res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size) } });
});

// GET /api/contracts/export - 导出合同列表
router.get('/export', (req, res) => {
  const XLSX = require('xlsx');
  const db = getDb();
  const { keyword } = req.query;
  let where = '1=1';
  const params = [];
  if (keyword) {
    where += ' AND (c.vin LIKE ? OR v.license_plate LIKE ? OR c.headquarters_contract_no LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const list = db.prepare(`SELECT c.*, v.license_plate, v.customer_name, v.service_dealer FROM contracts c LEFT JOIN vehicles v ON c.vin = v.vin WHERE ${where} ORDER BY c.updated_at DESC`).all(...params);
  const data = list.map(r => ({
    'VIN': r.vin,
    '车牌': r.license_plate || '',
    '客户名称': r.customer_name || '',
    '服务经销商': r.service_dealer || '',
    '开始日期': r.contract_start_date || '',
    '结束日期': r.contract_end_date || '',
    '关闭日期': r.contract_close_date || '',
    '设置里程': r.contract_set_mileage || 0,
    '已用里程': r.mileage_used || 0,
    '总次数': r.contract_total_count || 0,
    '已完成次数': r.contract_done_count || 0,
    '合同类型': r.contract_type || '',
    '总部合同编号': r.headquarters_contract_no || '',
    '状态': r.status || '',
    '更新时间': r.updated_at || ''
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, '合同列表');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename=contracts_${Date.now()}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
