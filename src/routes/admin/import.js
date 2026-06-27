const express = require('express');
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../../config/db');
const { updateCustomerSummary } = require('../pool');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../../../uploads/temp') });

// 通用 Excel 文件校验中间件
function validateExcelFile(req, res, next) {
  if (!req.file) return res.status(400).json({ code: 400, msg: '请上传文件' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!['.xlsx', '.xls'].includes(ext)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ code: 400, msg: '仅支持 xlsx/xls 格式' });
  }
  next();
}

// POST /api/admin/import/pool
router.post('/pool', upload.single('file'), validateExcelFile, (req, res) => {
  const wb = XLSX.readFile(req.file.path);
  fs.unlink(req.file.path, () => {});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const db = getDb();
  let success = 0, fail = 0;
  const errors = [];

  const tx = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const vin = r['VIN'] || r['vin'];
      if (!vin) { fail++; errors.push(`第${i + 2}行: 缺少VIN`); continue; }
      const exists = db.prepare('SELECT vin FROM vehicles WHERE vin = ?').get(vin);
      if (exists) { fail++; errors.push(`第${i + 2}行: VIN已存在于车辆表`); continue; }
      try {
        db.prepare(`INSERT OR REPLACE INTO public_pool (vin, vin_full, license_plate, customer_name, vehicle_type, sales_dealer, model, delivery_date, production_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(vin, r['VIN_FULL'] || r['vin_full'] || vin, r['车牌'] || r['license_plate'] || '', r['客户名称'] || r['customer_name'] || '',
            r['车辆类型'] || r['vehicle_type'] || '', r['销售经销商'] || r['sales_dealer'] || '', r['车型'] || r['model'] || '',
            r['交付日期'] || r['delivery_date'] || null, r['生产日期'] || r['production_date'] || null);
        success++;
      } catch (e) { fail++; errors.push(`第${i + 2}行: 数据异常`); }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail, errors: errors.slice(0, 20) } }); }
  catch (e) { console.error('[Import] 公海池导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败' }); }
});

// POST /api/admin/import/vehicles
router.post('/vehicles', upload.single('file'), validateExcelFile, (req, res) => {
  const wb = XLSX.readFile(req.file.path);
  fs.unlink(req.file.path, () => {});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const db = getDb();
  let success = 0, fail = 0;
  const errors = [];

  const tx = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const vin = r['VIN'] || r['vin'];
      if (!vin) { fail++; continue; }
      try {
        db.prepare('DELETE FROM public_pool WHERE vin = ?').run(vin);
        db.prepare(`INSERT OR REPLACE INTO vehicles (vin, vin_full, license_plate, customer_name, vehicle_type, sales_dealer, service_dealer, model, delivery_date, production_date, central_contract, annual_income, claimed_by, claimed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
          .run(vin, r['VIN_FULL'] || r['vin_full'] || vin, r['车牌'] || '', r['客户名称'] || '', r['车辆类型'] || '', r['销售经销商'] || '', r['服务经销商'] || '', r['车型'] || '', r['交付日期'] || null, r['生产日期'] || null, r['中央合同'] || r['central_contract'] || null, r['年总收入'] || r['annual_income'] || null, req.user.id);
        const cn = r['客户名称'] || '';
        if (cn && !db.prepare('SELECT id FROM customers WHERE customer_name = ?').get(cn)) {
          db.prepare('INSERT INTO customers (customer_name) VALUES (?)').run(cn);
        }
        if (cn) updateCustomerSummary(db, cn);
        success++;
      } catch (e) { fail++; errors.push(`第${i + 2}行: 数据异常`); }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail, errors: errors.slice(0, 20) } }); }
  catch (e) { console.error('[Import] 车辆导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败' }); }
});

// POST /api/admin/import/contracts
router.post('/contracts', upload.single('file'), validateExcelFile, (req, res) => {
  const wb = XLSX.readFile(req.file.path);
  fs.unlink(req.file.path, () => {});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const db = getDb();
  let success = 0, fail = 0;

  const tx = db.transaction(() => {
    for (const r of rows) {
      const vin = r['VIN'] || r['vin'];
      if (!vin) { fail++; continue; }
      try {
        const existing = db.prepare('SELECT id FROM contracts WHERE vin = ?').get(vin);
        if (existing) {
          db.prepare(`UPDATE contracts SET contract_start_date=?, contract_end_date=?, contract_close_date=?, contract_set_mileage=?, mileage_used=?, contract_total_count=?, contract_done_count=?, contract_type=?, headquarters_contract_no=?, status=?, updated_at=datetime('now') WHERE vin=?`)
            .run(r['开始日期'] || r['contract_start_date'] || null, r['结束日期'] || r['contract_end_date'] || null, r['关闭日期'] || r['contract_close_date'] || null, r['设置里程'] || r['contract_set_mileage'] || 0, r['已用里程'] || r['mileage_used'] || 0, r['总次数'] || r['contract_total_count'] || 0, r['已完成次数'] || r['contract_done_count'] || 0, r['合同类型'] || r['contract_type'] || null, r['总部合同编号'] || r['headquarters_contract_no'] || null, r['状态'] || r['status'] || 'active', vin);
        } else {
          db.prepare(`INSERT INTO contracts (vin, contract_start_date, contract_end_date, contract_close_date, contract_set_mileage, mileage_used, contract_total_count, contract_done_count, contract_type, headquarters_contract_no, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
            .run(vin, r['开始日期'] || null, r['结束日期'] || null, r['关闭日期'] || null, r['设置里程'] || 0, r['已用里程'] || 0, r['总次数'] || 0, r['已完成次数'] || 0, r['合同类型'] || null, r['总部合同编号'] || null, r['状态'] || 'active');
        }
        success++;
      } catch (e) { fail++; }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail } }); }
  catch (e) { console.error('[Import] 合同导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败' }); }
});

// POST /api/admin/import/workorders
router.post('/workorders', upload.single('file'), validateExcelFile, (req, res) => {
  const wb = XLSX.readFile(req.file.path);
  fs.unlink(req.file.path, () => {});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const db = getDb();
  let success = 0, fail = 0;

  const tx = db.transaction(() => {
    for (const r of rows) {
      const vin = r['VIN'] || r['vin'];
      if (!vin) { fail++; continue; }
      try {
        db.prepare(`INSERT INTO work_orders (vin, order_no, order_date, order_type, order_content, service_dealer, dealer_code, amount) VALUES (?,?,?,?,?,?,?,?)`)
          .run(vin, r['工单号'] || r['order_no'] || null, r['工单日期'] || r['order_date'] || null, r['工单类型'] || r['order_type'] || '', r['维修内容'] || r['order_content'] || '', r['服务经销商'] || r['service_dealer'] || '', r['经销商代码'] || r['dealer_code'] || '', r['金额'] || r['amount'] || 0);
        success++;
      } catch (e) { fail++; }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail } }); }
  catch (e) { console.error('[Import] 工单导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败' }); }
});

// POST /api/admin/import/customers
router.post('/customers', upload.single('file'), validateExcelFile, (req, res) => {
  const wb = XLSX.readFile(req.file.path);
  fs.unlink(req.file.path, () => {});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const db = getDb();
  let success = 0, fail = 0;

  const tx = db.transaction(() => {
    for (const r of rows) {
      const name = r['客户名称'] || r['customer_name'];
      if (!name) { fail++; continue; }
      try {
        const existing = db.prepare('SELECT id FROM customers WHERE customer_name = ?').get(name);
        if (existing) {
          db.prepare(`UPDATE customers SET tag=?, city=?, registration_info=?, updated_at=datetime('now') WHERE customer_name=?`)
            .run(r['标签'] || r['tag'] || null, r['所在市'] || r['city'] || null, r['注册信息'] || r['registration_info'] || null, name);
        } else {
          db.prepare('INSERT INTO customers (customer_name, tag, city, registration_info) VALUES (?,?,?,?)')
            .run(name, r['标签'] || r['tag'] || null, r['所在市'] || r['city'] || null, r['注册信息'] || r['registration_info'] || null);
        }
        success++;
      } catch (e) { fail++; }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail } }); }
  catch (e) { console.error('[Import] 客户导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败' }); }
});

module.exports = router;
